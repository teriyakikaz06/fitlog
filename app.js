"use strict";

// ===== 状態 =====
let currentDate = todayStr();   // 表示中の日付 (YYYY-MM-DD)
let goals = null;               // 目標（その日の取得時に更新）

// ===== ユーティリティ =====
function todayStr() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function $(sel) { return document.querySelector(sel); }

function toast(msg, isError) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast" + (isError ? " error" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

function fmt(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// ===== タブ切替 =====
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.tab;
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    $("#tab-" + target).classList.remove("hidden");
    if (target === "goals") loadGoals();
    if (target === "chart") loadCharts();
  });
});

// ===== 日付ナビ =====
$("#prev-day").addEventListener("click", () => { currentDate = shiftDate(currentDate, -1); loadDay(); });
$("#next-day").addEventListener("click", () => { currentDate = shiftDate(currentDate, 1); loadDay(); });
$("#today-btn").addEventListener("click", () => { currentDate = todayStr(); loadDay(); });
$("#date-picker").addEventListener("change", (e) => {
  if (e.target.value) { currentDate = e.target.value; loadDay(); }
});

// ===== その日の読み込み・描画 =====
async function loadDay() {
  $("#date-picker").value = currentDate;
  try {
    const day = await Store.getDay(currentDate);
    goals = day.goals;
    renderWeight(day.weight);
    renderProgress(day.totals);
    renderMeals(day.meals);
    renderExercises(day.exercises);
  } catch (e) {
    toast(e.message, true);
  }
}

function renderWeight(weight) {
  $("#weight-input").value = weight != null ? weight : "";
  const diffEl = $("#weight-diff");
  if (weight != null && goals) {
    const diff = Math.round((weight - goals.target_weight) * 10) / 10;
    if (diff > 0) { diffEl.textContent = `目標まで -${fmt(diff)}kg`; diffEl.className = "diff over"; }
    else if (diff < 0) { diffEl.textContent = `目標より ${fmt(-diff)}kg 下`; diffEl.className = "diff under"; }
    else { diffEl.textContent = "目標達成！"; diffEl.className = "diff under"; }
  } else {
    diffEl.textContent = "";
    diffEl.className = "diff";
  }
}

function renderProgress(totals) {
  const items = [
    { label: "カロリー", v: totals.calorie, g: goals.calorie, unit: "kcal" },
    { label: "P タンパク質", v: totals.protein, g: goals.protein, unit: "g" },
    { label: "F 脂質", v: totals.fat, g: goals.fat, unit: "g" },
    { label: "C 炭水化物", v: totals.carb, g: goals.carb, unit: "g" },
  ];
  $("#progress-area").innerHTML = items.map((it) => {
    const pct = it.g > 0 ? (it.v / it.g) * 100 : 0;
    const width = Math.min(pct, 100);
    const over = pct > 100;
    return `
      <div class="progress-item">
        <div class="progress-label">
          <span>${it.label}</span>
          <span>${fmt(it.v)} / ${it.g} ${it.unit}（${Math.round(pct)}%）</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill${over ? " over" : ""}" style="width:${width}%"></div>
        </div>
      </div>`;
  }).join("");
}

// ===== 食事 =====
function renderMeals(meals) {
  const list = $("#meal-list");
  if (!meals.length) {
    list.innerHTML = `<p class="empty-msg">まだ食事の記録がありません</p>`;
    return;
  }
  list.innerHTML = "";
  meals.forEach((m) => list.appendChild(mealCard(m)));
}

function mealCard(m) {
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `
    <div class="item-line1">
      <input type="text" value="${escapeHtml(m.name)}" placeholder="メニュー名">
      <button class="del-btn" type="button">削除</button>
    </div>
    <div class="item-line2">
      <label class="pfc-field">P<input type="number" inputmode="decimal" step="0.1" min="0" value="${m.protein}"></label>
      <label class="pfc-field">F<input type="number" inputmode="decimal" step="0.1" min="0" value="${m.fat}"></label>
      <label class="pfc-field">C<input type="number" inputmode="decimal" step="0.1" min="0" value="${m.carb}"></label>
      <span class="kcal">${fmt(m.calorie)} kcal</span>
    </div>`;
  const nameI = div.querySelector(".item-line1 input");
  const [pI, fI, cI] = div.querySelectorAll(".item-line2 input");
  const kcalEl = div.querySelector(".kcal");

  const save = async () => {
    try {
      const updated = await Store.updateMeal(m.id, {
        name: nameI.value, protein: pI.value, fat: fI.value, carb: cI.value,
      });
      kcalEl.textContent = `${fmt(updated.calorie)} kcal`;
      loadDay();
    } catch (e) { toast(e.message, true); loadDay(); }
  };
  [nameI, pI, fI, cI].forEach((inp) => inp.addEventListener("change", save));

  div.querySelector(".del-btn").addEventListener("click", async () => {
    try { await Store.deleteMeal(m.id); loadDay(); }
    catch (e) { toast(e.message, true); }
  });
  return div;
}

$("#meal-add").addEventListener("click", async () => {
  const name = $("#meal-name").value.trim();
  if (!name) { toast("メニュー名を入力してください", true); return; }
  try {
    await Store.addMeal(currentDate, {
      name, protein: $("#meal-p").value, fat: $("#meal-f").value, carb: $("#meal-c").value,
    });
    ["#meal-name", "#meal-p", "#meal-f", "#meal-c"].forEach((s) => ($(s).value = ""));
    loadDay();
  } catch (e) { toast(e.message, true); }
});

// ===== 解析結果の貼り付け取り込み =====
function parsePasteLine(line) {
  const idx = line.indexOf("|");
  if (idx < 0) return null;
  const name = line.slice(0, idx).trim();
  const rest = line.slice(idx + 1);
  if (!name) return null;
  const grab = (letter) => {
    const m = rest.match(new RegExp(letter + "\\s*(\\d+(?:\\.\\d+)?)", "i"));
    return m ? parseFloat(m[1]) : null;
  };
  const p = grab("P"), f = grab("F"), c = grab("C");
  if (p === null && f === null && c === null) return null;
  return { name, protein: p || 0, fat: f || 0, carb: c || 0 };
}

$("#paste-import").addEventListener("click", async () => {
  const raw = $("#paste-input").value;
  const lines = raw.split("\n");
  const parsed = [], failed = [];
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    const values = parsePasteLine(line);
    if (values) parsed.push({ lineNo: i + 1, values });
    else failed.push({ lineNo: i + 1, text: line.trim() });
  });
  if (parsed.length === 0 && failed.length === 0) { toast("貼り付け内容が空です", true); return; }

  let added = 0;
  for (const item of parsed) {
    try { await Store.addMeal(currentDate, item.values); added++; }
    catch (e) { failed.push({ lineNo: item.lineNo, text: `${item.values.name}（登録失敗: ${e.message}）` }); }
  }
  renderPasteResult(added, failed);
  if (added > 0) { $("#paste-input").value = ""; loadDay(); }
});

$("#paste-clear").addEventListener("click", () => {
  $("#paste-input").value = "";
  $("#paste-result").classList.add("hidden");
});

// 解析用プロンプトをコピー（① 料理 / ② 市販品 の両ボタンに対応）
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("プロンプトをコピーしました");
  } catch (e) {
    // 古いSafari等のフォールバック
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand("copy"); toast("プロンプトをコピーしました"); }
    catch (_) { toast("コピーできませんでした。手動で選択してください", true); }
    document.body.removeChild(ta);
  }
}
document.querySelectorAll(".copy-prompt-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const el = document.getElementById(btn.dataset.target);
    if (el) copyText(el.textContent);
  });
});

function renderPasteResult(added, failed) {
  const el = $("#paste-result");
  let html = `<span class="ok">${added}件 取り込みました</span>`;
  if (failed.length) {
    html += ` / <span class="ng">${failed.length}件 読めませんでした</span>`;
    html += "<ul>" + failed.map((f) =>
      `<li><span class="lineno">${f.lineNo}行目:</span> ${escapeHtml(f.text)}</li>`).join("") + "</ul>";
    html += `<p class="hint">読めなかった行は取り込んでいません。形式（<code>名前 | P○ F○ C○</code>）を直してもう一度どうぞ。</p>`;
  }
  el.innerHTML = html;
  el.classList.remove("hidden");
}

// ===== 運動 =====
function renderExercises(exs) {
  const list = $("#ex-list");
  if (!exs.length) {
    list.innerHTML = `<p class="empty-msg">まだ運動の記録がありません</p>`;
    return;
  }
  list.innerHTML = "";
  exs.forEach((x) => list.appendChild(exCard(x)));
}

function exCard(x) {
  const cats = ["筋トレ", "有酸素", "その他"];
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `
    <div class="item-line1">
      <input type="text" value="${escapeHtml(x.name)}" placeholder="種目名">
      <button class="del-btn" type="button">削除</button>
    </div>
    <div class="item-line2">
      <select>${cats.map((c) => `<option${c === x.category ? " selected" : ""}>${c}</option>`).join("")}</select>
      <input class="memo" type="text" value="${escapeHtml(x.memo)}" placeholder="メモ">
    </div>`;
  const nameI = div.querySelector(".item-line1 input");
  const catS = div.querySelector("select");
  const memoI = div.querySelector(".memo");

  const save = async () => {
    try { await Store.updateExercise(x.id, { name: nameI.value, category: catS.value, memo: memoI.value }); }
    catch (e) { toast(e.message, true); loadDay(); }
  };
  [nameI, catS, memoI].forEach((el) => el.addEventListener("change", save));

  div.querySelector(".del-btn").addEventListener("click", async () => {
    try { await Store.deleteExercise(x.id); loadDay(); }
    catch (e) { toast(e.message, true); }
  });
  return div;
}

$("#ex-add").addEventListener("click", async () => {
  const name = $("#ex-name").value.trim();
  if (!name) { toast("種目名を入力してください", true); return; }
  try {
    await Store.addExercise(currentDate, { name, category: $("#ex-cat").value, memo: $("#ex-memo").value });
    $("#ex-name").value = ""; $("#ex-memo").value = "";
    loadDay();
  } catch (e) { toast(e.message, true); }
});

// ===== 体重 =====
$("#weight-save").addEventListener("click", async () => {
  const v = $("#weight-input").value;
  if (v === "") { toast("体重を入力してください", true); return; }
  try { await Store.setWeight(currentDate, v); toast("体重を保存しました"); loadDay(); }
  catch (e) { toast(e.message, true); }
});

$("#weight-clear").addEventListener("click", async () => {
  try { await Store.deleteWeight(currentDate); loadDay(); }
  catch (e) { toast(e.message, true); }
});

// ===== 目標 =====
async function loadGoals() {
  try {
    const g = await Store.getGoals();
    $("#goal-calorie").value = g.calorie;
    $("#goal-protein").value = g.protein;
    $("#goal-fat").value = g.fat;
    $("#goal-carb").value = g.carb;
    $("#goal-weight").value = g.target_weight;
  } catch (e) { toast(e.message, true); }
}

$("#goal-save").addEventListener("click", async () => {
  try {
    goals = await Store.setGoals({
      calorie: $("#goal-calorie").value, protein: $("#goal-protein").value,
      fat: $("#goal-fat").value, carb: $("#goal-carb").value, target_weight: $("#goal-weight").value,
    });
    toast("目標を保存しました");
  } catch (e) { toast(e.message, true); }
});

// ===== バックアップ（書き出し／読み込み）=====
$("#backup-export").addEventListener("click", async () => {
  try {
    const data = await Store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fitlog-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("バックアップを書き出しました");
  } catch (e) { toast(e.message, true); }
});

$("#backup-import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm("読み込むと現在のデータは置き換わります。続けますか？")) { e.target.value = ""; return; }
  try {
    const text = await file.text();
    await Store.importAll(JSON.parse(text), "replace");
    toast("バックアップを読み込みました");
    loadDay();
  } catch (err) { toast("読み込み失敗: " + err.message, true); }
  e.target.value = "";
});

// ===== グラフ =====
const charts = {};
const goalLinePlugin = {
  id: "goalLine",
  afterDraw(chart, args, opts) {
    if (opts == null || opts.value == null) return;
    const { ctx, chartArea, scales } = chart;
    const y = scales.y.getPixelForValue(opts.value);
    if (y < chartArea.top || y > chartArea.bottom) return;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = opts.color || "#e0533d";
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = opts.color || "#e0533d";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`目標 ${opts.value}`, chartArea.right - 4, y - 4);
    ctx.restore();
  },
};
Chart.register(goalLinePlugin);

function shortLabel(d) {
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

function drawChart(canvasId, type, labels, data, color, goalValue) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const ctx = document.getElementById(canvasId).getContext("2d");
  charts[canvasId] = new Chart(ctx, {
    type,
    data: {
      labels: labels.map(shortLabel),
      datasets: [{
        data, borderColor: color,
        backgroundColor: type === "bar" ? color : "transparent",
        pointRadius: type === "line" ? 3 : 0, spanGaps: true, tension: 0.2, borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, goalLine: { value: goalValue, color: "#e0533d" } },
      scales: {
        y: {
          beginAtZero: type === "bar",
          suggestedMin: type === "line" ? goalValue : undefined,
          suggestedMax: goalValue,
        },
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
      },
    },
  });
}

async function loadCharts() {
  try {
    const c = await Store.getChart(30);
    drawChart("chart-weight", "line", c.labels, c.weight, "#2f6df0", c.goals.target_weight);
    drawChart("chart-calorie", "bar", c.labels, c.calorie, "#21a97a", c.goals.calorie);
    drawChart("chart-protein", "bar", c.labels, c.protein, "#7a5af0", c.goals.protein);
  } catch (e) { toast(e.message, true); }
}

// ===== HTMLエスケープ =====
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ===== Service Worker 登録（オフライン対応）=====
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* 失敗しても通常動作はする */ });
  });
}

// ===== 初期化 =====
loadDay();
