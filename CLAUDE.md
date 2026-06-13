# FitLog — 食事・運動・体重トラッカー（スマホ向けPWA）

個人用（1人用）の食事PFC・運動・体重トラッカー。**スマホでの入力をメイン**に使う。
完全無料・課金ゼロ・**完全オフライン**で動く。

> 当初は Flask + SQLite のローカルサーバー型だったが、「出先でもスマホで手軽に入力したい」
> という要件に合わせ、**サーバー不要・データは端末内（IndexedDB）に保存するクライアント型PWA**へ
> 作り替えた。旧バックエンド（app.py / db.py / Flask / SQLite）は廃止済み。

---

## 設計の絶対前提（必ず守る）

- **外部API・ネット通信でデータをやり取りしない。** 記録データは端末の外に一切出さない。
  - データは各端末の **IndexedDB** に保存（DB名 `fitlog`）。サーバーもクラウドも使わない。
  - 従量課金が発生する要素はゼロ。
- **写真解析はこのアプリに組み込まない。**
  - 解析は無料の Claude.ai 側で行い、その結果テキストを「貼り付け欄」に貼って取り込む。
- **完全オフラインで動く。** Service Worker でアプリの殻をキャッシュし、電波が無くても起動・入力できる。
  - Chart.js も同梱（`chart.min.js`）。実行時に外部から何も取得しない。
- **スマホ優先。** iPhone(iOS) の Safari で「ホーム画面に追加」してアプリのように使う想定。

---

## 技術スタック

| 領域 | 採用 |
|------|------|
| 実行形態 | 静的ファイルのみ（バックエンドなし）のPWA |
| フロント | 素の HTML + JavaScript（フレームワーク不使用） |
| データ保存 | IndexedDB（端末内）。DB名 `fitlog` |
| グラフ | Chart.js v4（同梱 `chart.min.js`） |
| オフライン | Service Worker（`sw.js`）＋ manifest |

---

## ファイル構成（フラットな静的構成）

```
fitlog/
├── index.html            # 画面（記録/グラフ/目標タブ）。iOS用メタ・manifest参照
├── style.css             # スタイル
├── store.js              # データ層（IndexedDB）。旧APIと同じ形のオブジェクトを返す
├── app.js                # 画面ロジック（store.js を呼ぶ）＋ SW登録
├── chart.min.js          # Chart.js v4（同梱・オフライン用）
├── manifest.webmanifest  # PWA manifest（名前・アイコン・standalone）
├── sw.js                 # Service Worker（アプリの殻をキャッシュ）
├── icons/                # アイコン（192/512/maskable/apple-touch）
├── README.md             # セットアップ・スマホへの入れ方・貼り付けフォーマット
└── CLAUDE.md             # このファイル
```

---

## データモデル（IndexedDB / DB名 `fitlog`）

```
goals       keyPath:id（id=1 固定の1件）  { id, calorie, protein, fat, carb, target_weight }
weights     keyPath:date（1日1件）        { date(YYYY-MM-DD), weight }
meals       keyPath:id(autoIncrement)     { id, date, name, protein, fat, carb }   index: date
exercises   keyPath:id(autoIncrement)     { id, date, name, category, memo }       index: date
```

- カロリーは保存せず、常に `P×4 + F×9 + C×4`（`Store.calcCalorie`）で計算。
- 目標デフォルト：**2200kcal / P150 / F60 / C250 / 目標体重75.0kg**（初回アクセス時に自動投入）。

## データ層 API（`store.js` の `Store`）

`getDay(date)` / `setWeight(date,w)` / `deleteWeight(date)` /
`addMeal(date,d)` / `updateMeal(id,d)` / `deleteMeal(id)` /
`addExercise(date,d)` / `updateExercise(id,d)` / `deleteExercise(id)` /
`getGoals()` / `setGoals(g)` / `getChart(days)` / `exportAll()` / `importAll(data,mode)`

すべて Promise を返す。`getDay`/`getChart` の戻り値は旧 Flask API と同形（画面側を流用するため）。

---

## 機能要件（変更なし）

1. **日次の記録**：日付移動／体重（1日1件・目標差表示）／食事（複数・カロリー自動計算）／
   運動（複数・種別＝筋トレ/有酸素/その他・メモ）／PFC・カロリーの進捗バー。
2. **グラフ（直近30日）**：体重折れ線・摂取カロリー棒・タンパク質棒（各目標の基準線つき）。
3. **目標設定**：カロリー/P/F/C/目標体重を変更・保存。除脂肪体重×2.0〜2.3g の注記。
4. **解析結果の貼り付け取り込み**：`1行＝メニュー名 | P○ F○ C○`（順不同・空白区切り）を
   フロントでパースして食事に展開。読めない行はスキップせず行番号つきで通知。手入力欄も併存。

### 追加機能（PWA化に伴う）
- **バックアップ**：目標タブで全データを JSON 書き出し／読み込み（端末内のみで完結）。
  機種変更・紛失時の保全用。読み込みは現在のデータを置き換える。

---

## 配信（スマホへの入れ方）についての注意

Service Worker は **セキュアコンテキスト**（HTTPS もしくは `http://localhost`・`127.0.0.1`）でしか
登録できない。家庭内LANの素のHTTP（`http://192.168.x.x`）では登録されずオフライン化できない。
そのため iPhone へ入れる現実的な方法は次のどちらか（README参照）：

- **A. 無料の静的ホスティング（GitHub Pages 等）にアプリのコードだけ置く**
  - データは引き続き端末内のみ・外に出ない。一度インストールすれば完全オフライン。最も手軽。
- **B. 家庭内で自己署名HTTPSを立てて入れる**
  - コードも家から出ないが、iOSは証明書プロファイル導入が必要でやや手間。

PC での動作確認は `http://127.0.0.1:<port>`（セキュアコンテキスト）で可能。

---

## コーディング方針
- 依存は最小限（追加ランタイム依存なし）。素のJS。
- 1人用ツールなので過剰な抽象化はしない。読みやすさ優先。日本語UI・日本語コメント可。
