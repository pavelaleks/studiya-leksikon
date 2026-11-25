/**
 * Список обязательного чтения к ОГЭ/ЕГЭ по литературе.
 * Ученик отмечает прочитанное; работы по произведению (малые сочинения, сочинения, задания)
 * подсчитываются сами — по заданиям из банка, теме задания и названию урока.
 *  #/me/reading[/oge|/ege]                — ученик
 *  #/cabinet/student/<id>/reading[/…]     — преподаватель смотрит ученика (только чтение)
 */
import { BASE } from "./config.js";
import { escapeHtml } from "./ui.js";
import { currentProfile, currentUser, supa } from "./supa.js";
import { CANON, ERAS, EXAMS, examsOf, isRequired, yearsAhead } from "./reading-canon.js?v=land195";

const DATA = new URL("js/library-data/", new URL(BASE, location.href));
const cache = {};
const loadJson = (name) => (cache[name] ||= fetch(new URL(name + "?v=lib1", DATA)).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));

const DAY = 86400000;
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/<[^>]+>/g, " ")
    .replace(/[«»"„“”]/g, "");

function ru(n, one, few, many) {
  const a = n % 10,
    b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

/** Фамилии авторов пункта: «А. С. Пушкин» → ["пушкин"]; «Ломоносов, Державин» → обе. */
const surnames = (a) =>
  String(a || "")
    .split(/,| и /)
    .map((x) => norm(x.trim().split(/\s+/).pop()))
    .filter((x) => x.length > 3);

/* ------------------------------------------------------------------ */
/* Данные                                                               */
/* ------------------------------------------------------------------ */

const DEFAULT_DATES = Object.fromEntries(Object.entries(EXAMS).map(([k, e]) => [k, e.fallback]));
const fallbackDates = () => Object.fromEntries(Object.entries(DEFAULT_DATES).map(([k, date]) => [k, { date, exact: false }]));

/** Даты экзаменов: из настроек преподавателя, иначе — ориентировочные. */
export async function examDates() {
  const { data } = await supa.from("app_settings").select("key, value").like("key", "exam_date_%");
  const out = {};
  for (const [k, e] of Object.entries(EXAMS)) {
    const v = (data || []).find((r) => r.key === e.dateKey)?.value;
    out[k] = { date: v || e.fallback, exact: Boolean(v) };
  }
  return out;
}

const pad2 = (n) => String(n).padStart(2, "0");

/** Дата экзамена для ученика: 8 и 10 класс сдают через год. Если дата уже прошла
 *  (лето, курс ещё не переведён на следующий класс) — берём следующий год. */
export function dateFor(info, ahead = 0) {
  const d = new Date(info.date + "T12:00:00");
  d.setFullYear(d.getFullYear() + ahead);
  let exact = Boolean(info.exact) && !ahead;
  while (d.getTime() < Date.now() - DAY) {
    d.setFullYear(d.getFullYear() + 1);
    exact = false;
  }
  return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, exact, ahead };
}

/** В какой «экзамен» пишутся отметки: ВПР делит отметки с ОГЭ. */
const storeOf = (exam) => EXAMS[exam]?.store || exam;
const untilOf = (exam) => (exam === "vpr" ? "до ВПР" : "до экзамена");

export async function saveExamDate(exam, value) {
  const key = EXAMS[exam].dateKey;
  if (!value) return supa.from("app_settings").delete().eq("key", key);
  return supa.from("app_settings").upsert({ key, value });
}

/** Отметки и работы ученика по одному экзамену. */
export async function loadReading(studentId, exam) {
  const [marks, works, attempts, learned, wt, poems, quizzes, results] = await Promise.all([
    supa.from("reading_marks").select("code, note, read_at").eq("student_id", studentId).eq("exam", storeOf(exam)),
    supa
      .from("written_works")
      .select("id, status, task_id, tasks(answer_mode, topic, list_item, work:data->>work, author:data->>author), lesson_items(lessons(title))")
      .eq("student_id", studentId)
      .neq("status", "draft")
      .limit(500),
    supa.from("attempts").select("task_id").eq("student_id", studentId).limit(5000),
    supa.from("poems_learned").select("poem_id").eq("student_id", studentId),
    loadJson("work-tasks.json"),
    loadJson("poems.json"),
    supa.from("reading_quizzes").select("id, work_id, title, points").eq("is_published", true),
    supa.from("reading_results").select("quiz_id").eq("student_id", studentId).eq("passed", true),
  ]);
  const passedQuiz = new Set((results.data || []).map((r) => r.quiz_id));
  const learnedIds = new Set((learned.data || []).map((r) => r.poem_id));
  if (marks.error) throw marks.error;
  const markMap = new Map((marks.data || []).map((m) => [m.code, m]));
  const solved = new Set((attempts.data || []).map((a) => a.task_id));
  const poemAuthor = new Map((poems.poems || []).map((p) => [p.id, norm(p.author.split(" ").pop())]));
  const learnedBy = {};
  (learned.data || []).forEach((r) => {
    const s = poemAuthor.get(r.poem_id);
    if (s) learnedBy[s] = (learnedBy[s] || 0) + 1;
  });
  const written = (works.data || []).map((w) => ({
    id: w.id,
    status: w.status,
    task: w.task_id,
    big: w.tasks?.answer_mode === "essay",
    hay: norm([w.tasks?.work, w.tasks?.author, w.tasks?.topic, w.tasks?.list_item?.questionText, w.tasks?.list_item?.topic, w.lesson_items?.lessons?.title].join(" | ")),
  }));

  const items = CANON[exam].map((it) => {
    const map = it.w ? wt[it.w] : null;
    const taskSet = new Set((map?.tasks || []).map((x) => x[0]));
    const essaySet = new Set(map?.essays || []);
    // Лирика: фамилия поэта и слово «стихотворение/лирика» — иначе засчитались бы сочинения по его прозе.
    const keys = it.k === "lyric" ? surnames(it.a) : (it.m || []).map(norm);
    const lyricOk = (w) => it.k !== "lyric" || /стих|лирик/.test(w.hay);
    const mine = written.filter((w) => essaySet.has(w.task) || taskSet.has(w.task) || (lyricOk(w) && keys.some((k) => k && w.hay.includes(k))));
    const tasks = [...taskSet].filter((id) => solved.has(id)).length;
    const poemsLearned = it.k === "lyric" ? surnames(it.a).reduce((s, x) => s + (learnedBy[x] || 0), 0) : 0;
    const quiz = it.w ? (quizzes.data || []).find((q) => q.work_id === it.w) : null;
    // Что предложить после «прочитал»: тест по статье, нерешённые задания по тексту, сочинение, стихи наизусть.
    const offer = {
      quiz: quiz && !passedQuiz.has(quiz.id) ? quiz : null,
      tasks: (map?.tasks || []).filter((x) => !solved.has(x[0])).slice(0, 40),
      essay: (map?.essays || []).length ? map.essays[Math.floor(Math.random() * map.essays.length)] : null,
      poems: it.k === "lyric" ? (poems.poems || []).filter((p) => surnames(it.a).includes(norm(p.author.split(" ").pop())) && !learnedIds.has(p.id)).slice(0, 3) : [],
    };
    return {
      ...it,
      offer,
      read: markMap.get(it.c) || null,
      small: mine.filter((w) => !w.big).length,
      big: mine.filter((w) => w.big).length,
      tasks,
      poems: poemsLearned,
      works: mine.map((w) => w.id),
    };
  });
  return { items, exam };
}

/** Сводка: сколько обязательного прочитано, сколько дней осталось, нужный темп. */
export function summarize(items, dateInfo, exam = "") {
  const req = items.filter(isRequired);
  const done = req.filter((i) => i.read).length;
  const left = req.length - done;
  const days = Math.max(0, Math.ceil((new Date(dateInfo.date + "T09:00:00") - Date.now()) / DAY));
  const weeks = Math.max(1, days / 7);
  const perWeek = left / weeks;
  const level = !left ? "done" : perWeek <= 1 ? "ok" : perWeek <= 2 ? "warn" : "bad";
  const worksDone = items.reduce((s, i) => s + i.small + i.big, 0);
  const essays = items.reduce((s, i) => s + i.big, 0);
  const extra = items.filter((i) => !isRequired(i) && i.read).length;
  return { total: req.length, done, left, days, perWeek, level, worksDone, essays, extra, date: dateInfo.date, exact: dateInfo.exact, until: untilOf(exam) };
}

function paceText(s) {
  if (s.level === "done") return "Всё обязательное прочитано — теперь перечитывай и пиши сочинения.";
  if (!s.days) return `Осталось ${s.left} ${ru(s.left, "произведение", "произведения", "произведений")}.`;
  const per = s.perWeek < 1 ? "меньше одного" : `≈ ${Math.ceil(s.perWeek)}`;
  const tone = s.level === "ok" ? "Успеваешь спокойно" : s.level === "warn" ? "Нужно поднажать" : "Отстаёшь — пора читать каждый день";
  return `${tone}: ${per} в неделю, чтобы прочитать оставшиеся ${s.left} ${s.until || "до экзамена"}.`;
}

const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

function ringSvg(done, total) {
  const r = 34,
    c = 2 * Math.PI * r,
    f = total ? done / total : 0;
  return `<svg class="rl-ring" viewBox="0 0 80 80" aria-hidden="true">
    <circle cx="40" cy="40" r="${r}" class="rl-ring-bg"/>
    <circle cx="40" cy="40" r="${r}" class="rl-ring-fg" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/>
    <text x="40" y="38" text-anchor="middle" class="rl-ring-n">${done}</text>
    <text x="40" y="54" text-anchor="middle" class="rl-ring-of">из ${total}</text>
  </svg>`;
}

/* ------------------------------------------------------------------ */
/* Карточка на главной ученика                                          */
/* ------------------------------------------------------------------ */

export async function mountHomeCard(host, profile) {
  const exams = examsOf(profile);
  if (!host || !exams.length) return;
  const uid = currentUser()?.id;
  const dates = await examDates().catch(() => fallbackDates());
  const blocks = await Promise.all(
    exams.map(async (exam) => {
      const { items } = await loadReading(uid, exam);
      const s = summarize(items, dateFor(dates[exam], yearsAhead(profile, exam)), exam);
      const next = items.filter((i) => isRequired(i) && !i.read && i.k !== "lyric").slice(0, 3);
      return `
        <a class="rl-home card rl-${s.level}" href="#/me/reading/${exam}">
          ${ringSvg(s.done, s.total)}
          <span class="rl-home-body">
            <strong>Список чтения · ${EXAMS[exam].short}</strong>
            <span class="rl-home-days">${s.days ? `${s.until} ${s.days} ${ru(s.days, "день", "дня", "дней")}` : exam === "vpr" ? "ВПР в эти дни" : "экзамен сегодня"} <span class="muted">(${new Date(s.date + "T12:00:00").toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}${s.exact ? "" : ", примерно"})</span></span>
            <span class="rl-home-pace">${escapeHtml(paceText(s))}</span>
            ${s.worksDone ? `<span class="muted">Работ по прочитанному: ${s.worksDone}${s.essays ? `, из них сочинений: ${s.essays}` : ""}</span>` : ""}
            ${next.length ? `<span class="rl-home-next">Дальше: ${next.map((i) => escapeHtml(i.t)).join(", ")}</span>` : ""}
          </span>
          <span class="me-rec-go" aria-hidden="true">›</span>
        </a>`;
    })
  );
  host.innerHTML = `<h2 class="me-label">Чтение к экзамену</h2>${blocks.join("")}`;
  host.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Страница списка                                                      */
/* ------------------------------------------------------------------ */

function chipsHtml(it) {
  const c = [];
  if (it.big) c.push(`<span class="rl-chip is-big">${it.big} ${ru(it.big, "сочинение", "сочинения", "сочинений")}</span>`);
  if (it.small) c.push(`<span class="rl-chip is-small">${it.small} ${ru(it.small, "малое сочинение", "малых сочинения", "малых сочинений")}</span>`);
  if (it.tasks) c.push(`<span class="rl-chip">${it.tasks} ${ru(it.tasks, "задание", "задания", "заданий")} по тексту</span>`);
  if (it.poems) c.push(`<span class="rl-chip">${it.poems} наизусть</span>`);
  return c.join("");
}

function tagsHtml(it, exam) {
  const t = [];
  if (it.p1) t.push(`<span class="lib-mark is-focus" title="Фрагменты этого произведения бывают в части 1 (задания 1–5)">часть 1</span>`);
  if (it.uu) t.push(`<span class="lib-mark" title="Только для углублённого уровня">углублённый</span>`);
  if (it.k === "pick") t.push(`<span class="lib-mark">на выбор</span>`);
  if (it.k === "list") t.push(`<span class="lib-mark">по желанию</span>`);
  if (exam === "oge" && it.g) t.push(`<span class="lib-mark">${escapeHtml(it.g)} кл.</span>`);
  return t.join("");
}

const TASK_NAME = { 1: "краткий ответ", 2: "краткий ответ", 3: "соответствие", 4: "малое сочинение", 5: "сопоставление" };

/** Блок «Закрепи прочитанное» — появляется после отметки; можно отложить. */
function offerHtml(it) {
  const o = it.offer || {};
  const acts = [];
  if (o.quiz) acts.push(`<a class="rl-act" href="#/library/quiz/${o.quiz.id}"><b>Тест по статье</b><span>«Полка» · +${o.quiz.points} очков</span></a>`);
  const byNo = {};
  o.tasks.forEach(([id, n]) => (byNo[n] ||= id));
  Object.entries(byNo)
    .slice(0, 3)
    .forEach(([n, id]) => acts.push(`<a class="rl-act" href="#/literature/${n}/${id}"><b>Задание ${n}</b><span>${TASK_NAME[n] || "по фрагменту"}${Number(n) >= 4 ? " · проверит преподаватель" : ""}</span></a>`));
  if (o.essay) acts.push(`<a class="rl-act is-big" href="#/literature/11/${o.essay}"><b>Сочинение</b><span>тема по этому произведению</span></a>`);
  o.poems.forEach((p) => acts.push(`<a class="rl-act" href="#/library/poems/${p.id}"><b>Наизусть</b><span>${escapeHtml(p.title)}</span></a>`));
  return `
    <div class="rl-offer" role="group" aria-label="Закрепить прочитанное">
      <p class="rl-offer-h"><strong>Закрепи прочитанное</strong> — пока текст свежий в памяти. Выбери, что сделать; можно и позже.</p>
      ${acts.length ? `<div class="rl-acts">${acts.join("")}</div>` : `<p class="muted">Готовых заданий по этому тексту в банке пока нет — попроси преподавателя дать малое сочинение: оно отметится здесь само.</p>`}
      <button type="button" class="linklike rl-offer-close" data-offer-close>Не сейчас</button>
    </div>`;
}

const OFFER_KEY = "lx-reading-offer-off";
function offerOff() {
  try {
    return new Set(JSON.parse(localStorage.getItem(OFFER_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function setOfferOff(key, off) {
  const set = offerOff();
  off ? set.add(key) : set.delete(key);
  try {
    localStorage.setItem(OFFER_KEY, JSON.stringify([...set]));
  } catch {}
}

function rowHtml(it, exam, readOnly, openOffer = null) {
  const links = [];
  if (it.w && it.k !== "list") links.push(`<a href="#/library/w/${it.w}">Читать</a>`);
  if (it.k === "lyric") links.push(`<a href="#/library/poems">Стихи</a>`);
  const noteNeeded = it.k === "pick" || it.k === "list" || it.k === "lyric";
  const note = it.read?.note || "";
  const id = `rl-${exam}-${it.c}`;
  return `
    <li class="rl-row ${it.read ? "is-read" : ""} ${isRequired(it) ? "" : "is-extra"}" data-code="${escapeHtml(it.c)}">
      <input type="checkbox" class="rl-check" id="${id}" ${it.read ? "checked" : ""} ${readOnly ? "disabled" : ""} aria-label="Прочитано: ${escapeHtml(it.t)}" />
      <div class="rl-main">
        <label for="${id}">
          ${it.a ? `<span class="rl-author">${escapeHtml(it.a)}</span>` : ""}
          <span class="rl-title">${escapeHtml(it.t)}</span>
        </label>
        <span class="rl-tags">${tagsHtml(it, exam)}${chipsHtml(it)}</span>
        ${
          noteNeeded && (it.read || note)
            ? readOnly
              ? note
                ? `<p class="rl-note-ro muted">Прочитано: ${escapeHtml(note)}</p>`
                : ""
              : `<input class="rl-note" maxlength="300" value="${escapeHtml(note)}" placeholder="${it.k === "lyric" ? "Какие стихотворения? (необязательно)" : "Что именно прочитал(а)?"}" />`
            : ""
        }
        ${it.read ? `<small class="rl-when muted">отмечено ${new Date(it.read.read_at).toLocaleDateString("ru-RU")}</small>` : ""}
        ${
          !readOnly && it.read && it.k !== "list"
            ? openOffer === it.c
              ? offerHtml(it)
              : !it.small && !it.big && !it.tasks && !it.poems
                ? `<button type="button" class="linklike rl-offer-open" data-offer-open>Закрепить прочитанное →</button>`
                : ""
            : ""
        }
      </div>
      ${links.length ? `<span class="rl-links">${links.join("")}</span>` : ""}
    </li>`;
}

export async function mountReadingList(host, { studentId = null, exam = null, base = "#/me/reading", back = "#/me", readOnly = false, name = "" } = {}) {
  const sid = studentId || currentUser()?.id;
  if (!sid) {
    location.hash = "#/login?next=" + encodeURIComponent(location.hash);
    return;
  }
  host.innerHTML = `<p class="muted">Загружаем список…</p>`;
  let prof = studentId ? null : currentProfile();
  let exams = studentId ? null : examsOf(prof);
  if (studentId) {
    const { data: p } = await supa.from("profiles").select("courses, full_name, email").eq("id", studentId).maybeSingle();
    prof = p;
    exams = examsOf(p);
    name = name || p?.full_name || p?.email || "";
  }
  if (!exams.length) exams = ["oge", "ege"];
  const cur = exams.includes(exam) ? exam : exams[0];
  const [dates, data] = await Promise.all([examDates().catch(() => fallbackDates()), loadReading(sid, cur)]);
  let filter = "all";
  // Открытое предложение: после новой отметки — у этого пункта; «Не сейчас» прячет его.
  let openOffer = null;

  const groups = () =>
    ERAS.map(([era, title]) => {
      const list = data.items.filter((i) => i.e === era).filter((i) => (filter === "left" ? !i.read && isRequired(i) : filter === "read" ? i.read : filter === "p1" ? i.p1 : true));
      if (!list.length) return "";
      const req = list.filter(isRequired);
      return `<section class="rl-era"><h2>${escapeHtml(title)} <small class="muted">${req.filter((i) => i.read).length} из ${req.length}</small></h2>
        <ul class="rl-list">${list.map((i) => rowHtml(i, cur, readOnly, openOffer)).join("")}</ul></section>`;
    }).join("") || `<p class="empty">Здесь пусто.</p>`;

  const head = () => {
    const st = summarize(data.items, dateFor(dates[cur], yearsAhead(prof, cur)), cur);
    return `
      <div class="rl-head card rl-${st.level}">
        ${ringSvg(st.done, st.total)}
        <div>
          <p class="rl-head-big"><strong>${st.days ? `${st.days} ${ru(st.days, "день", "дня", "дней")}` : "—"}</strong> ${st.until} <span class="muted">(${fmtDate(st.date)}${st.exact ? "" : ", примерно"})</span></p>
          <p>${escapeHtml(paceText(st))}</p>
          <p class="muted">Работ по произведениям: ${st.worksDone}${st.essays ? ` · сочинений: ${st.essays}` : ""}${st.extra ? ` · по желанию прочитано: ${st.extra}` : ""}</p>
        </div>
      </div>`;
  };

  host.innerHTML = `
    <p class="crumbs"><a href="${back}">← ${readOnly ? "Ученик" : "Главная"}</a></p>
    <header class="rl-top">
      <p class="eyebrow">${readOnly ? escapeHtml(name) : "Литература"}</p>
      <h1>Список чтения · ${EXAMS[cur].title}</h1>
      <p class="lede">${readOnly ? "Что ученик отметил прочитанным и какие работы писал по каждому произведению." : `${cur === "vpr" ? "Произведения 5–8 классов из кодификатора ФИПИ 2027 — по ним строится ВПР. Всё прочитанное сейчас засчитается и к ОГЭ в 9 классе." : "Всё, что нужно прочитать по кодификатору ФИПИ 2027 года."} Отмечай прочитанное — работы по произведению (малые сочинения, сочинения, задания по тексту) отмечаются сами.`}</p>
    </header>
    ${exams.length > 1 ? `<nav class="filter-bar">${exams.map((e) => `<a class="pill ${e === cur ? "active" : ""}" href="${base}/${e}">${EXAMS[e].short}</a>`).join("")}</nav>` : ""}
    <div id="rl-head">${head()}</div>
    <nav class="filter-bar rl-filter">
      <button type="button" class="pill active" data-f="all">Все</button>
      <button type="button" class="pill" data-f="left">Не прочитано</button>
      <button type="button" class="pill" data-f="read">Прочитано</button>
      ${cur === "ege" ? `<button type="button" class="pill" data-f="p1">Фрагменты в части 1</button>` : ""}
    </nav>
    <div id="rl-groups">${groups()}</div>
    <p class="muted rl-foot">«По желанию» и «углублённый» в общий счёт не входят: это списки авторов для кругозора и сочинения. По пунктам «на выбор» напиши, что именно прочитал(а).</p>`;

  const redraw = () => {
    host.querySelector("#rl-groups").innerHTML = groups();
    host.querySelector("#rl-head").innerHTML = head();
  };
  host.querySelector(".rl-filter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]");
    if (!b) return;
    filter = b.dataset.f;
    host.querySelectorAll(".rl-filter .pill").forEach((p) => p.classList.toggle("active", p === b));
    redraw();
  });
  if (readOnly) return;

  const itemOf = (el) => data.items.find((i) => i.c === el.closest(".rl-row")?.dataset.code);
  host.querySelector("#rl-groups").addEventListener("change", async (e) => {
    const box = e.target.closest(".rl-check");
    if (!box) return;
    const it = itemOf(box);
    box.disabled = true;
    const res = box.checked
      ? await supa.from("reading_marks").upsert({ student_id: sid, exam: storeOf(cur), code: it.c, note: it.read?.note || null }).select("code, note, read_at").single()
      : await supa.from("reading_marks").delete().eq("student_id", sid).eq("exam", storeOf(cur)).eq("code", it.c);
    box.disabled = false;
    if (res.error) {
      box.checked = !box.checked;
      alert("Не удалось сохранить: " + res.error.message);
      return;
    }
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    it.read = box.checked ? { note: it.read?.note || null, ...row, read_at: row?.read_at || new Date().toISOString() } : null;
    const key = `${sid}:${cur}:${it.c}`;
    openOffer = box.checked && it.k !== "list" && !offerOff().has(key) ? it.c : openOffer === it.c ? null : openOffer;
    redraw();
    const li = host.querySelector(`.rl-row[data-code="${CSS.escape(it.c)}"]`);
    if (box.checked && (it.k === "pick" || it.k === "list")) li?.querySelector(".rl-note")?.focus();
    else li?.querySelector(".rl-offer")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  host.querySelector("#rl-groups").addEventListener("click", (e) => {
    const close = e.target.closest("[data-offer-close]");
    const open = e.target.closest("[data-offer-open]");
    if (!close && !open) return;
    const it = itemOf(e.target);
    setOfferOff(`${sid}:${cur}:${it.c}`, Boolean(close));
    openOffer = open ? it.c : null;
    redraw();
  });
  let t = null;
  host.querySelector("#rl-groups").addEventListener("input", (e) => {
    const inp = e.target.closest(".rl-note");
    if (!inp) return;
    const it = itemOf(inp);
    clearTimeout(t);
    t = setTimeout(async () => {
      const note = inp.value.trim() || null;
      const { error } = await supa.from("reading_marks").upsert({ student_id: sid, exam: storeOf(cur), code: it.c, note, read_at: it.read?.read_at || new Date().toISOString() });
      if (!error && it.read) it.read.note = note;
      inp.classList.toggle("is-saved", !error);
    }, 600);
  });
}

/** Для таблицы преподавателя: сколько обязательного прочитал каждый ученик. */
export async function readCounts() {
  const { data } = await supa.from("reading_marks").select("student_id, exam, code");
  const out = new Map();
  (data || []).forEach((r) => {
    for (const exam of Object.keys(CANON).filter((e) => storeOf(e) === r.exam)) {
      const it = CANON[exam].find((i) => i.c === r.code);
      if (!it || !isRequired(it)) continue;
      const k = r.student_id + ":" + exam;
      out.set(k, (out.get(k) || 0) + 1);
    }
  });
  const totals = Object.fromEntries(Object.keys(CANON).map((e) => [e, CANON[e].filter(isRequired).length]));
  return { counts: out, totals };
}
