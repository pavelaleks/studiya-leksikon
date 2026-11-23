/**
 * Прогресс ученика в графиках (#/me/progress) и отчёт для родителей (#/me/report,
 * у преподавателя — #/cabinet/student/<id>/report). Графики рисуются здесь же, в SVG.
 */
import { escapeHtml } from "./ui.js";
import { bz, bzDayStart } from "./tz.js?v=land186";
import { currentProfile, currentUser, supa } from "./supa.js";
import { RUBRICS } from "./rubrics.js?v=land186";

const SRC = { "ege-rus": "ЕГЭ", "oge-rus": "ОГЭ", "vpr-rus": "ВПР", "ege-lit": "Литература", "oge-lit": "ОГЭ · лит." };
const SRC_LONG = { "ege-rus": "ЕГЭ по русскому", "oge-rus": "ОГЭ по русскому", "vpr-rus": "ВПР по русскому", "ege-lit": "ЕГЭ по литературе", "oge-lit": "ОГЭ по литературе" };
const SRC_HREF = { "ege-rus": "#/ege", "oge-rus": "#/oge", "vpr-rus": "#/vpr", "ege-lit": "#/literature", "oge-lit": "#/literature/oge" };
const PERIODS = { week: ["Неделя", 7], month: ["Месяц", 30], all: ["Всё время", 0] };
const DAY = 86400000;

const pad = (n) => String(n).padStart(2, "0");
// Дни — по Барнаулу (tz.js), чтобы отчёт совпадал у ученика и преподавателя.
const dkey = (d) => {
  const x = bz(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const startOfDay = (t) => bzDayStart(new Date(t));
const fmtDate = (d, o = { day: "numeric", month: "long" }) => new Date(d).toLocaleDateString("ru-RU", o);
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);
const pct = (ok, n) => (n ? Math.round((100 * ok) / n) : null);

/* ------------------------------------------------------------------ */
/* Данные                                                              */
/* ------------------------------------------------------------------ */

export async function loadProgress(studentId, period = "month") {
  const days = PERIODS[period]?.[1] ?? 30;
  const now = Date.now();
  const since = days ? startOfDay(now - (days - 1) * DAY) : null;
  const prevSince = days ? new Date(since.getTime() - days * DAY) : null;
  const fetchFrom = new Date(Math.min(prevSince ? prevSince.getTime() : now, startOfDay(now - 26 * 7 * DAY).getTime()));
  const all = [];
  // ответы — страницами, чтобы не упереться в лимит
  for (let from = 0; from < 40000; from += 5000) {
    let q = supa
      .from("attempts")
      .select("is_correct, created_at, tasks(source, task_no)")
      .eq("student_id", studentId)
      .order("created_at")
      .range(from, from + 4999);
    if (days) q = q.gte("created_at", fetchFrom.toISOString());
    const { data, error } = await q;
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 5000) break;
  }
  const [{ data: works }, { data: prof }] = await Promise.all([
    supa
      .from("written_works")
      .select("id, status, score, max_score, criteria, teacher_comment, submitted_at, reviewed_at, tasks(source, task_no)")
      .eq("student_id", studentId)
      .neq("status", "draft")
      .order("submitted_at"),
    supa.from("profiles").select("full_name, grade, exam_target, courses").eq("id", studentId).maybeSingle(),
  ]);
  const t0 = since ? since.getTime() : 0;
  const cur = all.filter((a) => Date.parse(a.created_at) >= t0);
  const prev = prevSince ? all.filter((a) => Date.parse(a.created_at) >= prevSince.getTime() && Date.parse(a.created_at) < t0) : [];
  const wk = works || [];
  const curWorks = wk.filter((w) => w.submitted_at && Date.parse(w.submitted_at) >= t0);
  return { period, days, since: since || (all[0] ? startOfDay(all[0].created_at) : startOfDay(now)), all, cur, prev, works: wk, curWorks, profile: prof || {} };
}

function byNumber(list) {
  const m = new Map();
  list.forEach((a) => {
    if (!a.tasks || a.tasks.task_no == null) return;
    const k = `${a.tasks.source}|${a.tasks.task_no}`;
    const v = m.get(k) || { src: a.tasks.source, no: a.tasks.task_no, n: 0, ok: 0 };
    v.n += 1;
    if (a.is_correct) v.ok += 1;
    m.set(k, v);
  });
  return m;
}

function analyze(d) {
  const ok = d.cur.filter((a) => a.is_correct).length;
  const p = pct(ok, d.cur.length);
  const pp = pct(d.prev.filter((a) => a.is_correct).length, d.prev.length);
  const activeDays = new Set(d.cur.map((a) => dkey(new Date(a.created_at)))).size;
  const nums = byNumber(d.cur);
  const prevNums = byNumber(d.prev);
  const weak = [...nums.values()].filter((v) => v.n >= 3 && v.ok / v.n < 0.6).sort((a, b) => a.ok / a.n - b.ok / b.n || b.n - a.n);
  const strong = [...nums.values()].filter((v) => v.n >= 3 && v.ok / v.n >= 0.85).sort((a, b) => b.n - a.n);
  const graded = d.works.filter((w) => w.status === "graded" && w.score != null && w.max_score);
  // средний балл по каждому критерию за последние проверенные сочинения
  const crit = new Map();
  graded.slice(-5).forEach((w) => {
    const c = w.criteria || {};
    const rub = c.rubric && RUBRICS[c.rubric];
    if (!rub) return;
    rub.criteria.forEach((cr) => {
      const v = Number((c.scores || {})[cr.code]);
      if (Number.isNaN(v)) return;
      const max = Math.max(...cr.levels.map((l) => l[0]));
      if (!max) return;
      const x = crit.get(cr.code) || { code: cr.code, name: cr.name, sum: 0, max: 0 };
      x.sum += v;
      x.max += max;
      crit.set(cr.code, x);
    });
  });
  const weakCrit = [...crit.values()].filter((c) => c.sum / c.max < 0.6).sort((a, b) => a.sum / a.max - b.sum / b.max);
  return { ok, p, pp, delta: p != null && pp != null ? p - pp : null, activeDays, nums, prevNums, weak, strong, graded, weakCrit };
}

function recommendations(d, x) {
  const out = [];
  x.weak.slice(0, 3).forEach((v) => {
    const href = v.src === "ege-rus" ? `#/ege/${v.no}/theory` : `${SRC_HREF[v.src] || "#/ege"}/${v.no}`;
    out.push({
      text: `Задание ${v.no} (${SRC[v.src] || ""}): верно ${pct(v.ok, v.n)}% из ${v.n} ${plural(v.n, "попытки", "попыток", "попыток")}. Повторить теорию и решить 10–15 заданий этого номера.`,
      href,
    });
  });
  if (x.weakCrit.length) {
    const c = x.weakCrit[0];
    out.push({ text: `В сочинениях чаще всего теряются баллы по критерию ${c.code} «${c.name}». Перед сдачей проверять именно его.` });
  }
  if (d.days && x.activeDays < Math.max(2, Math.round(d.days * 0.35))) {
    out.push({ text: "Заниматься чаще и понемногу: 15–20 минут 4–5 раз в неделю дают больше, чем редкие долгие подходы. Удобно начинать с «Тренировки дня»." });
  }
  if (x.delta != null && x.delta <= -7) out.push({ text: "Точность снизилась по сравнению с прошлым периодом: стоит решать медленнее и перечитывать условие перед ответом." });
  if (!out.length && d.cur.length) out.push({ text: "Хороший ровный темп. Дальше — пробный экзамен по таймеру, чтобы проверить себя в условиях экзамена." });
  if (!d.cur.length) out.push({ text: "За этот период нет решённых заданий. Начать можно с «Тренировки дня» — 10 заданий, около 15 минут." });
  return out;
}

/* ------------------------------------------------------------------ */
/* Графики (SVG)                                                       */
/* ------------------------------------------------------------------ */

/** Активность по дням: 12–26 недель, неделя — столбец, как календарь. */
function heatmapSvg(d) {
  const weeks = d.period === "all" ? 26 : 12;
  const today = startOfDay(Date.now());
  const dow = (bz(today).getDay() + 6) % 7; // пн = 0
  const start = new Date(today.getTime() - ((weeks - 1) * 7 + dow) * DAY);
  const counts = new Map();
  d.all.forEach((a) => {
    const k = dkey(new Date(a.created_at));
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const cell = 14;
  const gap = 3;
  const left = 22;
  const top = 16;
  const lvl = (n) => (!n ? 0 : n < 5 ? 1 : n < 12 ? 2 : n < 25 ? 3 : 4);
  let rects = "";
  let months = "";
  let lastMonth = -1;
  let lastLabelW = -9;
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < 7; i++) {
      const day = new Date(start.getTime() + (w * 7 + i) * DAY + 3 * 3600000);
      if (day > today.getTime() + DAY) continue;
      const n = counts.get(dkey(day)) || 0;
      rects += `<rect x="${left + w * (cell + gap)}" y="${top + i * (cell + gap)}" width="${cell}" height="${cell}" rx="3" class="pg-h${lvl(n)}"><title>${fmtDate(day, { day: "numeric", month: "long", weekday: "short" })}: ${n} ${plural(n, "ответ", "ответа", "ответов")}</title></rect>`;
      if (i === 0 && day.getMonth() !== lastMonth && w - lastLabelW >= 3) {
        lastMonth = day.getMonth();
        lastLabelW = w;
        months += `<text x="${left + w * (cell + gap)}" y="10" class="pg-ax">${day.toLocaleDateString("ru-RU", { month: "short" }).replace(".", "")}</text>`;
      }
    }
  }
  const wd = ["пн", "", "ср", "", "пт", "", ""].map((t, i) => (t ? `<text x="0" y="${top + i * (cell + gap) + 11}" class="pg-ax">${t}</text>` : "")).join("");
  const W = left + weeks * (cell + gap);
  const H = top + 7 * (cell + gap);
  return `<svg class="pg-heat" viewBox="0 0 ${W} ${H}" style="max-width:${Math.round(W * 1.45)}px" role="img" aria-label="Активность по дням за ${weeks} недель">${months}${wd}${rects}</svg>
    <p class="pg-legend"><span>меньше</span>${[0, 1, 2, 3, 4].map((i) => `<i class="pg-h${i}"></i>`).join("")}<span>больше</span></p>`;
}

/** По неделям: столбики — сколько ответов, линия — процент верных. */
function weeklySvg(d) {
  const n = d.period === "all" ? 16 : 8;
  const today = startOfDay(Date.now());
  const dow = (bz(today).getDay() + 6) % 7;
  const mon = new Date(today.getTime() - dow * DAY);
  const weeks = Array.from({ length: n }, (_, i) => {
    const from = new Date(mon.getTime() - (n - 1 - i) * 7 * DAY);
    const to = from.getTime() + 7 * DAY;
    const list = d.all.filter((a) => {
      const t = Date.parse(a.created_at);
      return t >= from.getTime() && t < to;
    });
    return { from, n: list.length, p: pct(list.filter((a) => a.is_correct).length, list.length) };
  });
  const W = 640;
  const H = 170;
  const L = 50;
  const R = 10;
  const T = 14;
  const B = 26;
  const iw = (W - L - R) / n;
  const maxN = Math.max(10, ...weeks.map((w) => w.n));
  const y = (p) => T + (H - T - B) * (1 - p / 100);
  const bars = weeks
    .map((w, i) => {
      const h = ((H - T - B) * w.n) / maxN;
      return `<rect x="${L + i * iw + iw * 0.2}" y="${H - B - h}" width="${iw * 0.6}" height="${h}" rx="3" class="pg-bar"><title>Неделя с ${fmtDate(w.from)}: ${w.n} ${plural(w.n, "ответ", "ответа", "ответов")}${w.p != null ? `, верно ${w.p}%` : ""}</title></rect>`;
    })
    .join("");
  const pts = weeks.map((w, i) => (w.p == null ? null : [L + i * iw + iw / 2, y(w.p), w.p])).filter(Boolean);
  const line = pts.length > 1 ? `<polyline class="pg-line" points="${pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" />` : "";
  const dots = pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="pg-dot" />`).join("");
  const last = pts.at(-1);
  const grid = [0, 50, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="pg-grid" /><text x="${L - 6}" y="${y(v) + 4}" class="pg-ax" text-anchor="end">${v}%</text>`).join("");
  const labels = weeks
    .map((w, i) => (i % (n > 8 ? 3 : 2) === 0 || i === n - 1 ? `<text x="${L + i * iw + iw / 2}" y="${H - 8}" class="pg-ax" text-anchor="middle">${w.from.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "")}</text>` : ""))
    .join("");
  return `<svg class="pg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ответы и процент верных по неделям">${grid}${bars}${line}${dots}${last ? `<text x="${last[0]}" y="${last[1] - 9}" class="pg-val" text-anchor="middle">${last[2]}%</text>` : ""}${labels}</svg>
    <p class="pg-legend"><i class="pg-bar-key"></i><span>ответов за неделю</span><i class="pg-line-key"></i><span>процент верных</span></p>`;
}

/** Номера экзамена: цвет — процент верных; стрелка — изменение к прошлому периоду. */
function numbersHtml(x) {
  const bySrc = new Map();
  x.nums.forEach((v) => (bySrc.get(v.src) || bySrc.set(v.src, []).get(v.src)).push(v));
  if (!bySrc.size) return `<p class="muted">За этот период заданий не решалось.</p>`;
  return [...bySrc.entries()]
    .map(([src, list]) => {
      const cells = list
        .sort((a, b) => a.no - b.no)
        .map((v) => {
          const p = pct(v.ok, v.n);
          const prev = x.prevNums.get(`${src}|${v.no}`);
          const pp = prev && prev.n >= 3 ? pct(prev.ok, prev.n) : null;
          const tr = pp == null || v.n < 3 ? "" : p - pp >= 10 ? '<b class="pg-up" aria-label="лучше">↑</b>' : pp - p >= 10 ? '<b class="pg-down" aria-label="хуже">↓</b>' : "";
          const tone = v.n < 3 ? "few" : p >= 80 ? "good" : p >= 55 ? "mid" : "low";
          return `<span class="pg-num pg-${tone}" title="Задание ${v.no}: верно ${p}% из ${v.n}"><b>${v.no}</b><small>${v.n < 3 ? `${v.n} отв.` : `${p}%`}</small>${tr}</span>`;
        })
        .join("");
      return `<p class="pg-sub">${escapeHtml(SRC_LONG[src] || src)}</p><div class="pg-nums">${cells}</div>`;
    })
    .join("");
}

/** Баллы за письменные работы во времени (в процентах от максимума, подпись — баллы). */
function essaysSvg(x) {
  const g = x.graded.slice(-10);
  if (!g.length) return "";
  const W = 640;
  const H = 130;
  const L = 50;
  const R = 30;
  const T = 22;
  const B = 24;
  const step = g.length > 1 ? (W - L - R) / (g.length - 1) : 0;
  const y = (v) => T + (H - T - B) * (1 - v);
  const pts = g.map((w, i) => [g.length > 1 ? L + i * step : W / 2, y(w.score / w.max_score), w]);
  const grid = [0, 0.5, 1].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="pg-grid" /><text x="${L - 6}" y="${y(v) + 4}" class="pg-ax" text-anchor="end">${Math.round(v * 100)}%</text>`).join("");
  return `<svg class="pg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Баллы за письменные работы">${grid}
    ${pts.length > 1 ? `<polyline class="pg-line pg-line-ok" points="${pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" />` : ""}
    ${pts
      .map(
        (p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" class="pg-dot pg-dot-ok"><title>${escapeHtml(SRC[p[2].tasks?.source] || "")} № ${p[2].tasks?.task_no ?? ""}: ${p[2].score} из ${p[2].max_score}</title></circle>
        <text x="${p[0]}" y="${p[1] - 9}" class="pg-val" text-anchor="middle">${p[2].score}/${p[2].max_score}</text>
        <text x="${p[0]}" y="${H - 6}" class="pg-ax" text-anchor="middle">${fmtDate(p[2].reviewed_at || p[2].submitted_at, { day: "numeric", month: "short" }).replace(".", "")}</text>`
      )
      .join("")}</svg>`;
}

/* ------------------------------------------------------------------ */
/* Страницы                                                            */
/* ------------------------------------------------------------------ */

function periodTitle(d) {
  if (d.period === "all") return "За всё время";
  return `${fmtDate(d.since)} — ${fmtDate(Date.now())}`;
}

function summaryCards(d, x) {
  const delta = x.delta == null ? "" : `<em class="${x.delta >= 0 ? "pg-up" : "pg-down"}">${x.delta > 0 ? "+" : ""}${x.delta}</em>`;
  return `<div class="pg-cards">
    <div><strong>${x.activeDays}</strong><span>${plural(x.activeDays, "день", "дня", "дней")} занятий</span></div>
    <div><strong>${d.cur.length}</strong><span>${plural(d.cur.length, "ответ", "ответа", "ответов")} на задания</span></div>
    <div><strong>${x.p == null ? "—" : `${x.p}%`} ${delta}</strong><span>верно${x.delta != null ? " · к прошлому периоду" : ""}</span></div>
    <div><strong>${d.curWorks.length}</strong><span>письменных ${plural(d.curWorks.length, "работа", "работы", "работ")} сдано</span></div>
  </div>`;
}

function mistakesHtml(x) {
  if (!x.weak.length) return `<p class="muted">Номеров, где ошибок больше половины, за этот период нет.</p>`;
  return `<div class="me-rows">${x.weak
    .slice(0, 5)
    .map(
      (v) => `<div class="me-row"><span class="me-row-main"><strong>${escapeHtml(SRC[v.src] || "")}, задание ${v.no}</strong><span class="muted">${v.n - v.ok} ${plural(v.n - v.ok, "ошибка", "ошибки", "ошибок")} из ${v.n} ${plural(v.n, "попытки", "попыток", "попыток")}</span></span><span class="chip is-late">${pct(v.ok, v.n)}% верно</span></div>`
    )
    .join("")}</div>`;
}

function recsHtml(list, links = true) {
  return `<ul class="pg-recs">${list.map((r) => `<li>${escapeHtml(r.text)}${links && r.href ? ` <a href="${r.href}">Открыть →</a>` : ""}</li>`).join("")}</ul>`;
}

function commentsHtml(d) {
  const list = d.works.filter((w) => w.teacher_comment && (w.status === "graded" || w.status === "returned")).slice(-3).reverse();
  if (!list.length) return "";
  return `<div class="pg-comments">${list
    .map(
      (w) => `<blockquote><p>${escapeHtml(w.teacher_comment.length > 400 ? w.teacher_comment.slice(0, 397) + "…" : w.teacher_comment)}</p>
      <footer>${escapeHtml(SRC[w.tasks?.source] || "")}, задание ${w.tasks?.task_no ?? ""}${w.score != null ? ` · ${w.score} из ${w.max_score}` : ""} · ${fmtDate(w.reviewed_at || w.submitted_at)}</footer></blockquote>`
    )
    .join("")}</div>`;
}

function periodNav(base, period) {
  return `<nav class="pg-periods" aria-label="Период">${Object.entries(PERIODS)
    .map(([k, [t]]) => `<a class="pill ${k === period ? "active" : ""}" href="${base}?p=${k}" ${k === period ? 'aria-current="page"' : ""}>${t}</a>`)
    .join("")}</nav>`;
}

const periodOf = () => {
  const p = new URLSearchParams(location.hash.split("?")[1] || "").get("p");
  return PERIODS[p] ? p : "month";
};

/** #/me/progress — прогресс ученика. */
export async function mountProgress(root) {
  const host = root.querySelector("#me-root");
  const uid = currentUser()?.id;
  if (!host || !uid) return;
  const period = periodOf();
  host.innerHTML = `<p class="lede muted">Считаем прогресс…</p>`;
  let d;
  try {
    d = await loadProgress(uid, period);
  } catch (err) {
    host.innerHTML = `<div class="empty">Не удалось загрузить: ${escapeHtml(err.message)}</div>`;
    return;
  }
  const x = analyze(d);
  host.innerHTML = `
    <header class="me-hello pg-head">
      <div>
        <p class="eyebrow">${escapeHtml(periodTitle(d))}</p>
        <h1>Прогресс</h1>
      </div>
      <span class="me-hello-side"><a class="btn secondary" href="#/me/profile">Профиль и настройки</a></span>
    </header>
    <div class="pg-toolbar">${periodNav("#/me/progress", period)}<a class="btn" href="#/me/report?p=${period}">Отчёт для родителей</a></div>
    ${summaryCards(d, x)}
    <section class="me-section me-block"><h2 class="me-label">Активность по дням</h2>${heatmapSvg(d)}</section>
    <section class="me-section me-block"><h2 class="me-label">Ответы и точность по неделям</h2>${weeklySvg(d)}</section>
    <section class="me-section me-block"><h2 class="me-label">Номера экзамена</h2>${numbersHtml(x)}
      <p class="pg-legend"><i class="pg-good"></i><span>80% и выше</span><i class="pg-mid"></i><span>55–79%</span><i class="pg-low"></i><span>ниже 55%</span><i class="pg-few"></i><span>мало ответов</span></p></section>
    ${x.graded.length ? `<section class="me-section me-block"><h2 class="me-label">Письменные работы · баллы</h2>${essaysSvg(x)}${commentsHtml(d)}</section>` : ""}
    <section class="me-section me-block"><h2 class="me-label">Где чаще ошибки</h2>${mistakesHtml(x)}</section>
    <section class="me-section me-block"><h2 class="me-label">Рекомендации</h2>${recsHtml(recommendations(d, x))}</section>`;
}

/** Текст отчёта для мессенджера. */
function plainSummary(name, d, x, recs) {
  const lines = [
    `Студия «Лексикон» — отчёт об учёбе`,
    `${name}, ${periodTitle(d).toLowerCase()}`,
    `Дней занятий: ${x.activeDays}. Ответов на задания: ${d.cur.length}. Верно: ${x.p == null ? "—" : x.p + "%"}${x.delta != null ? ` (${x.delta > 0 ? "+" : ""}${x.delta} к прошлому периоду)` : ""}.`,
    `Письменных работ сдано: ${d.curWorks.length}.`,
  ];
  if (x.weak.length) lines.push(`Чаще ошибки: ${x.weak.slice(0, 3).map((v) => `${SRC[v.src]} № ${v.no} (${pct(v.ok, v.n)}%)`).join(", ")}.`);
  if (x.strong.length) lines.push(`Уверенно: ${x.strong.slice(0, 4).map((v) => `${SRC[v.src]} № ${v.no}`).join(", ")}.`);
  lines.push("Рекомендации:", ...recs.map((r) => `• ${r.text}`));
  return lines.join("\n");
}

/** Отчёт для родителей: страница для печати и сохранения в PDF. */
export async function mountReport(host, studentId, { back = "#/me/progress", base = "#/me/report" } = {}) {
  if (!host || !studentId) return;
  const period = periodOf();
  host.innerHTML = `<p class="lede muted">Готовим отчёт…</p>`;
  let d;
  try {
    d = await loadProgress(studentId, period);
  } catch (err) {
    host.innerHTML = `<div class="empty">Не удалось загрузить: ${escapeHtml(err.message)}</div>`;
    return;
  }
  const x = analyze(d);
  const recs = recommendations(d, x);
  const p = d.profile.full_name ? d.profile : currentProfile() || {};
  const name = p.full_name || "Ученик";
  const meta = [p.grade ? `${p.grade} класс` : "", p.exam_target || ""].filter(Boolean).join(" · ");
  host.innerHTML = `
    <div class="pg-report-bar no-print">
      <a href="${back}">← Назад</a>
      ${periodNav(base, period)}
      <span class="pg-report-actions">
        <button type="button" class="btn secondary" data-copy>Скопировать текстом</button>
        <button type="button" class="btn" data-print>Сохранить PDF</button>
      </span>
      <p class="muted pg-report-hint">«Сохранить PDF» откроет печать: выберите «Сохранить как PDF» и отправьте файл родителям. На телефоне — «Поделиться» → «Печать».</p>
      <p class="lit-result" data-copy-status aria-live="polite"></p>
    </div>
    <article class="pg-report">
      <header class="pg-rep-head">
        <p class="pg-rep-brand">Студия «Лексикон» · русский язык и литература</p>
        <h1>Отчёт об учёбе</h1>
        <p><strong>${escapeHtml(name)}</strong>${meta ? ` · ${escapeHtml(meta)}` : ""}</p>
        <p class="muted">${escapeHtml(periodTitle(d))}</p>
      </header>
      <section><h2>Коротко</h2>${summaryCards(d, x)}</section>
      <section><h2>Дни занятий</h2>${heatmapSvg(d)}</section>
      <section><h2>Ответы и точность по неделям</h2>${weeklySvg(d)}</section>
      <section><h2>Результаты по номерам экзамена</h2>${numbersHtml(x)}
        <p class="pg-legend"><i class="pg-good"></i><span>80% и выше</span><i class="pg-mid"></i><span>55–79%</span><i class="pg-low"></i><span>ниже 55%</span><i class="pg-few"></i><span>мало ответов</span></p></section>
      ${x.graded.length ? `<section><h2>Письменные работы</h2>${essaysSvg(x)}${commentsHtml(d)}</section>` : ""}
      <section><h2>Где чаще ошибки</h2>${mistakesHtml(x)}</section>
      ${x.strong.length ? `<section><h2>Что получается уверенно</h2><p>${x.strong.slice(0, 8).map((v) => `${escapeHtml(SRC[v.src] || "")} № ${v.no}`).join(", ")}</p></section>` : ""}
      <section><h2>Рекомендации</h2>${recsHtml(recs, false)}</section>
      <footer class="pg-rep-foot">Отчёт сформирован ${fmtDate(Date.now(), { day: "numeric", month: "long", year: "numeric" })} на платформе студии «Лексикон» (lexicon-school.ru). Данные — по ответам на платформе; работа на занятиях в тетради сюда не входит.</footer>
    </article>`;
  host.querySelector("[data-print]")?.addEventListener("click", () => window.print());
  host.querySelector("[data-copy]")?.addEventListener("click", async () => {
    const st = host.querySelector("[data-copy-status]");
    try {
      await navigator.clipboard.writeText(plainSummary(name, d, x, recs));
      st.className = "lit-result is-ok";
      st.textContent = "Скопировано — можно вставить в мессенджер.";
    } catch {
      st.className = "lit-result is-bad";
      st.textContent = "Не получилось скопировать — сохраните PDF.";
    }
  });
}
