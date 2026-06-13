"use strict";

/*
 * FitLog のデータ層。データはすべて端末内の IndexedDB に保存する。
 * 外部にもサーバーにも一切送信しない（完全オフライン）。
 *
 * 旧バックエンド(Flask/SQLite)の API と同じ形のオブジェクトを返すので、
 * 画面側(app.js)はほぼそのまま使える。
 */

const Store = (() => {
  const DB_NAME = "fitlog";
  const DB_VERSION = 1;

  const DEFAULT_GOALS = {
    calorie: 2200, protein: 150, fat: 60, carb: 250, target_weight: 75.0,
  };

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("goals")) {
          db.createObjectStore("goals", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("weights")) {
          // 体重は日付をキーにして1日1件
          db.createObjectStore("weights", { keyPath: "date" });
        }
        if (!db.objectStoreNames.contains("meals")) {
          const s = db.createObjectStore("meals", { keyPath: "id", autoIncrement: true });
          s.createIndex("date", "date", { unique: false });
        }
        if (!db.objectStoreNames.contains("exercises")) {
          const s = db.createObjectStore("exercises", { keyPath: "id", autoIncrement: true });
          s.createIndex("date", "date", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  // トランザクション補助
  async function tx(stores, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
      result = fn(t);
    });
  }

  function reqAsync(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function calcCalorie(p, f, c) {
    return p * 4 + f * 9 + c * 4;
  }

  function withCalorie(meal) {
    return { ...meal, calorie: calcCalorie(meal.protein, meal.fat, meal.carb) };
  }

  // ---- 目標 ----
  async function getGoals() {
    const db = await openDB();
    const t = db.transaction("goals", "readonly");
    const row = await reqAsync(t.objectStore("goals").get(1));
    if (row) return row;
    // 初回：デフォルトを保存して返す
    return setGoals(DEFAULT_GOALS);
  }

  async function setGoals(g) {
    const row = {
      id: 1,
      calorie: Math.round(+g.calorie),
      protein: Math.round(+g.protein),
      fat: Math.round(+g.fat),
      carb: Math.round(+g.carb),
      target_weight: Math.round(+g.target_weight * 10) / 10,
    };
    if ([row.calorie, row.protein, row.fat, row.carb, row.target_weight].some((v) => isNaN(v) || v < 0)) {
      throw new Error("目標値はすべて0以上の数値で入力してください");
    }
    await tx("goals", "readwrite", (t) => t.objectStore("goals").put(row));
    return row;
  }

  // ---- 体重 ----
  async function setWeight(date, weight) {
    const w = Math.round(+weight * 10) / 10;
    if (isNaN(w)) throw new Error("体重は数値で入力してください");
    await tx("weights", "readwrite", (t) => t.objectStore("weights").put({ date, weight: w }));
    return { date, weight: w };
  }

  async function deleteWeight(date) {
    await tx("weights", "readwrite", (t) => t.objectStore("weights").delete(date));
    return { ok: true };
  }

  // ---- 食事 ----
  function validateMeal(data) {
    const name = (data.name || "").trim();
    if (!name) throw new Error("メニュー名を入力してください");
    const protein = Math.round((+data.protein || 0) * 10) / 10;
    const fat = Math.round((+data.fat || 0) * 10) / 10;
    const carb = Math.round((+data.carb || 0) * 10) / 10;
    if ([protein, fat, carb].some((v) => isNaN(v) || v < 0)) {
      throw new Error("P/F/C は0以上の数値で入力してください");
    }
    return { name, protein, fat, carb };
  }

  async function addMeal(date, data) {
    const v = validateMeal(data);
    const rec = { date, ...v };
    const id = await tx("meals", "readwrite", (t) => reqAsync(t.objectStore("meals").add(rec)));
    return withCalorie({ id, ...rec });
  }

  async function updateMeal(id, data) {
    const v = validateMeal(data);
    const db = await openDB();
    const t = db.transaction("meals", "readwrite");
    const store = t.objectStore("meals");
    const cur = await reqAsync(store.get(id));
    if (!cur) throw new Error("対象の食事が見つかりません");
    const rec = { ...cur, ...v };
    await reqAsync(store.put(rec));
    return withCalorie(rec);
  }

  async function deleteMeal(id) {
    await tx("meals", "readwrite", (t) => t.objectStore("meals").delete(id));
    return { ok: true };
  }

  // ---- 運動 ----
  const VALID_CATEGORIES = ["筋トレ", "有酸素", "その他"];
  function validateExercise(data) {
    const name = (data.name || "").trim();
    if (!name) throw new Error("種目名を入力してください");
    let category = (data.category || "その他").trim();
    if (!VALID_CATEGORIES.includes(category)) category = "その他";
    const memo = (data.memo || "").trim();
    return { name, category, memo };
  }

  async function addExercise(date, data) {
    const v = validateExercise(data);
    const rec = { date, ...v };
    const id = await tx("exercises", "readwrite", (t) => reqAsync(t.objectStore("exercises").add(rec)));
    return { id, ...rec };
  }

  async function updateExercise(id, data) {
    const v = validateExercise(data);
    const db = await openDB();
    const t = db.transaction("exercises", "readwrite");
    const store = t.objectStore("exercises");
    const cur = await reqAsync(store.get(id));
    if (!cur) throw new Error("対象の運動が見つかりません");
    const rec = { ...cur, ...v };
    await reqAsync(store.put(rec));
    return rec;
  }

  async function deleteExercise(id) {
    await tx("exercises", "readwrite", (t) => t.objectStore("exercises").delete(id));
    return { ok: true };
  }

  // ---- 取得系 ----
  async function getByDateIndex(storeName, date) {
    const db = await openDB();
    const t = db.transaction(storeName, "readonly");
    const idx = t.objectStore(storeName).index("date");
    return reqAsync(idx.getAll(IDBKeyRange.only(date)));
  }

  async function getDay(date) {
    const db = await openDB();
    const t = db.transaction("weights", "readonly");
    const wRow = await reqAsync(t.objectStore("weights").get(date));
    const weight = wRow ? wRow.weight : null;

    const mealsRaw = await getByDateIndex("meals", date);
    const meals = mealsRaw.sort((a, b) => a.id - b.id).map(withCalorie);
    const exercises = (await getByDateIndex("exercises", date)).sort((a, b) => a.id - b.id);
    const goals = await getGoals();

    const round1 = (n) => Math.round(n * 10) / 10;
    const totals = {
      protein: round1(meals.reduce((s, m) => s + m.protein, 0)),
      fat: round1(meals.reduce((s, m) => s + m.fat, 0)),
      carb: round1(meals.reduce((s, m) => s + m.carb, 0)),
      calorie: round1(meals.reduce((s, m) => s + m.calorie, 0)),
    };
    return { date, weight, meals, exercises, totals, goals };
  }

  // 直近 days 日の系列（体重/カロリー/P）
  async function getChart(days = 30) {
    days = Math.max(1, Math.min(days | 0 || 30, 365));
    const today = new Date();
    const labels = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      labels.push(toDateStr(d));
    }
    const first = labels[0], last = labels[labels.length - 1];

    const db = await openDB();
    const t = db.transaction(["weights", "meals"], "readonly");
    const weightRows = await reqAsync(
      t.objectStore("weights").getAll(IDBKeyRange.bound(first, last))
    );
    const mealRows = await reqAsync(
      t.objectStore("meals").index("date").getAll(IDBKeyRange.bound(first, last))
    );
    const goals = await getGoals();

    const wMap = {};
    weightRows.forEach((r) => { wMap[r.date] = r.weight; });
    const calMap = {}, protMap = {};
    labels.forEach((d) => { calMap[d] = 0; protMap[d] = 0; });
    mealRows.forEach((m) => {
      if (m.date in calMap) {
        calMap[m.date] += calcCalorie(m.protein, m.fat, m.carb);
        protMap[m.date] += m.protein;
      }
    });
    const round1 = (n) => Math.round(n * 10) / 10;
    return {
      labels,
      weight: labels.map((d) => (d in wMap ? wMap[d] : null)),
      calorie: labels.map((d) => round1(calMap[d])),
      protein: labels.map((d) => round1(protMap[d])),
      goals: { calorie: goals.calorie, protein: goals.protein, target_weight: goals.target_weight },
    };
  }

  function toDateStr(d) {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }

  // ---- バックアップ（書き出し／読み込み）----
  async function exportAll() {
    const db = await openDB();
    const t = db.transaction(["goals", "weights", "meals", "exercises"], "readonly");
    const [goals, weights, meals, exercises] = await Promise.all([
      reqAsync(t.objectStore("goals").getAll()),
      reqAsync(t.objectStore("weights").getAll()),
      reqAsync(t.objectStore("meals").getAll()),
      reqAsync(t.objectStore("exercises").getAll()),
    ]);
    return { app: "FitLog", version: 1, exportedAt: new Date().toISOString(),
             goals, weights, meals, exercises };
  }

  // mode: "replace"=全消し後に取込 / "merge"=既存に追記
  async function importAll(data, mode = "replace") {
    if (!data || data.app !== "FitLog") throw new Error("FitLog のバックアップファイルではありません");
    const db = await openDB();
    const t = db.transaction(["goals", "weights", "meals", "exercises"], "readwrite");
    const g = t.objectStore("goals"), w = t.objectStore("weights"),
          m = t.objectStore("meals"), e = t.objectStore("exercises");
    if (mode === "replace") { g.clear(); w.clear(); m.clear(); e.clear(); }
    (data.goals || []).forEach((r) => g.put(r));
    (data.weights || []).forEach((r) => w.put(r));
    // id は振り直す（衝突回避）
    (data.meals || []).forEach((r) => { const { id, ...rest } = r; m.add(rest); });
    (data.exercises || []).forEach((r) => { const { id, ...rest } = r; e.add(rest); });
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve({ ok: true });
      t.onerror = () => reject(t.error);
    });
  }

  return {
    calcCalorie, getGoals, setGoals, setWeight, deleteWeight,
    addMeal, updateMeal, deleteMeal,
    addExercise, updateExercise, deleteExercise,
    getDay, getChart, exportAll, importAll,
  };
})();
