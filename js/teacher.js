/** Кабинет преподавателя: #/cabinet/... */
import { BASE } from "./config.js";
import { GRADES, SUBJECTS, courseLabel } from "./track.js?v=land130";
import { escapeHtml } from "./ui.js";
import { taskHref } from "./account.js?v=land130";
import { clearBankCache, currentUser, humanError, isTeacher, resetPassword, signIn, signedFileUrl, supa } from "./supa.js";
import { lessonEditView, lessonsListView } from "./lessons.js?v=land130";
import { readingView } from "./teacher-reading.js?v=land130";
import { optionsOf } from "./practice.js?v=land130";
import { convertStudent, createStudent, isPseudoEmail, loginOf, newPassword, newPseudonym, resetStudentPassword } from "./pseudo.js?v=land130";
import { mountTg, tgSlotHtml } from "./telegram.js?v=land130";
import { MARKS, RUBRICS } from "./rubrics.js?v=land130";
import {
  countMarks, countWords, criteriaFormHtml, markedTextHtml, marksListHtml, openPhotoEditor, readCriteria, renderPhoto, rubricFor,
} from "./review.js?v=land130";

/* ------------------------------------------------------------------ */
/* Справочники                                                          */
/* ------------------------------------------------------------------ */

export const SOURCES = {
  "ege-rus": { title: "ЕГЭ · русский язык", manifest: "js/russian-data/manifest.json", dir: "js/russian-data" },
  "oge-rus": { title: "ОГЭ · русский язык", manifest: "js/oge-data/manifest.json", dir: "js/oge-data" },
  "vpr-rus": { title: "ВПР · русский язык, 8 класс", manifest: "js/vpr-data/manifest.json", dir: "js/vpr-data" },
  "ege-lit": { title: "ЕГЭ · литература", manifest: "js/literature-data/manifest.json", dir: "js/literature-data" },
};

const MODES = {
  "ege-rus": [
    ["digits-any", "Номера в любом порядке (24 = 42)"],
    ["digits-fixed", "Цифры по порядку (соответствие)"],
    ["word", "Слово / краткий ответ"],
    ["essay", "Сочинение — проверяет преподаватель"],
    ["open", "Развёрнутый ответ — проверяет преподаватель"],
  ],
  "oge-rus": [
    ["digits-any", "Номера в любом порядке (24 = 42)"],
    ["digits-fixed", "Цифры по порядку (соответствие)"],
    ["word", "Слово / краткий ответ"],
    ["essay", "Изложение / сочинение — проверяет преподаватель"],
    ["open", "Развёрнутый ответ — проверяет преподаватель"],
  ],
  "vpr-rus": [
    ["digits-any", "Номера в любом порядке (24 = 42)"],
    ["word", "Слово / краткий ответ"],
    ["open", "Развёрнутый ответ — проверяет преподаватель"],
  ],
  "ege-lit": [
    ["lit-short", "Краткий ответ (термин, имя)"],
    ["lit-match", "Соответствие (цифры по порядку)"],
    ["open", "Развёрнутый ответ — проверяет преподаватель"],
    ["essay", "Сочинение — проверяет преподаватель"],
  ],
};
const MODE_LABEL = Object.fromEntries(Object.values(MODES).flat());
const CHECKED_BY_TEACHER = new Set(["open", "essay"]);
const WORK_STATUS = { draft: "черновик", submitted: "на проверке", returned: "на доработке", graded: "проверена" };
const STATUS_TEXT = { pending: "ждёт подтверждения", active: "ученик", paused: "приостановлен", archived: "архив" };
const FORMAT_TEXT = { offline: "очно", online: "онлайн", mixed: "очно и онлайн" };

const manifests = {};
async function manifest(source) {
  if (manifests[source]) return manifests[source];
  const url = new URL(SOURCES[source].manifest, new URL(BASE, location.href));
  url.searchParams.set("t", Date.now());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не загрузился ${SOURCES[source].manifest}`);
  manifests[source] = await res.json();
  return manifests[source];
}

const bankIdOf = (file) => String(file).replace(/^bank\//, "").replace(/\.json$/i, "");

export async function bankFiles(source) {
  const m = await manifest(source);
  return (m.files || [])
    .map((f) => ({ ...f, bank: bankIdOf(f.file) }))
    .sort((a, b) => (a.kind === b.kind ? a.task - b.task : a.kind === "extra" ? 1 : -1));
}

function defaultMode(source, taskNo) {
  if (source === "ege-rus") return taskNo === 27 ? "essay" : "digits-any";
  if (source === "oge-rus") return taskNo === 1 || taskNo === 13 ? "essay" : "digits-any";
  if (source === "vpr-rus") return [1, 6, 7, 11, 12].includes(taskNo) ? "open" : [2, 3, 4].includes(taskNo) ? "word" : "digits-any";
  if (taskNo === 11) return "essay";
  if ([4, 5, 9, 10].includes(taskNo)) return "open";
  if (taskNo === 2) return "lit-match";
  return "lit-short";
}

function answerKindOf(source, mode) {
  if (source === "ege-lit") return { "lit-short": "short", "lit-match": "match", open: "open", essay: "essay" }[mode] || "short";
  if (mode === "word") return "word";
  if (mode === "essay" || mode === "open") return "essay";
  return "digits";
}

/* ------------------------------------------------------------------ */
/* Текст → HTML                                                         */
/* ------------------------------------------------------------------ */

/** Обычный текст → безопасный HTML: абзацы по пустой строке, **жирный**, __подчёркнутый__. HTML оставляем как есть. */
export function textToHtml(text) {
  const src = String(text || "").trim();
  if (!src) return "";
  if (/^\s*<(p|div|table|ol|ul|span|b|i|u|br)\b/i.test(src)) return src;
  const inline = (s) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/__(.+?)__/g, "<u>$1</u>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<i>$2</i>");
  return src
    .split(/\n\s*\n/)
    .map((block) => `<p>${block.split("\n").map(inline).join("<br>")}</p>`)
    .join("");
}

function htmlToText(html) {
  const div = document.createElement("div");
  div.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n");
  return div.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

function splitAlts(s) {
  return String(s || "")
    .split(/\s*(?:\||;|\bили\b)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Собрать задание для teacher_upsert_tasks из полей формы.
 * f: {source, bank, task_no, topic, mode, question, passage, answer, solution, notes, is_demo, is_published, source_ref?, author, work}
 */
export function buildTask(f) {
  const mode = f.mode;
  const alts = splitAlts(f.answer);
  const main = alts[0] || "";
  const digits = (s) => String(s).replace(/\D/g, "");
  let key = { answer: alts.join("|") || null, answer_alts: alts.slice(1), solution_html: textToHtml(f.solution) || null, teacher_notes: f.notes || null };
  if (mode === "digits-any") {
    key.answer_norm = [...digits(main)].sort().join("");
    key.answer_numbers = [...digits(main)].map(Number);
  } else if (mode === "digits-fixed" || mode === "lit-match") {
    key.answer_norm = digits(main);
  } else if (mode === "numbers") {
    key.answer_numbers = main.split(/[\s,;]+/).filter((x) => /^\d+$/.test(x)).map(Number);
    key.answer_norm = digits(main);
  } else {
    key.answer_norm = main || null;
  }
  const questionHtml = textToHtml(f.question);
  const questionText = htmlToText(questionHtml).slice(0, 600);
  const passageKey = f.passage ? f.passage_key || `own-${crypto.randomUUID().slice(0, 8)}` : null;
  const answerKind = answerKindOf(f.source, mode);
  const data = {
    task: Number(f.task_no) || null,
    answerMode: mode,
    answerKind,
    questionHtml,
    questionText,
    topic: f.topic || "Задания преподавателя",
    own: true,
  };
  if (f.author) data.author = f.author;
  if (f.work) data.work = f.work;
  if (passageKey) data.passageId = passageKey;
  if (f.source_ref) data.id = f.source_ref;
  const list_item = {
    topic: data.topic,
    questionText,
    answerMode: mode,
    answerKind,
    ...(f.author ? { author: f.author } : {}),
    ...(f.work ? { work: f.work } : {}),
    ...(f.source_ref ? { id: f.source_ref } : {}),
  };
  return {
    task: {
      source: f.source,
      bank_file: f.bank,
      source_ref: f.source_ref || null,
      position: f.position ?? 1000000,
      task_no: Number(f.task_no) || null,
      topic: data.topic,
      answer_mode: mode,
      list_item,
      data,
      passage_id: passageKey ? `${f.source}:${passageKey}` : null,
      is_demo: Boolean(f.is_demo),
      is_published: f.is_published !== false,
      is_own: true,
      key,
    },
    passage: passageKey ? { id: `${f.source}:${passageKey}`, html: textToHtml(f.passage), data: { own: true } } : null,
  };
}

function validate(f) {
  const errs = [];
  if (!htmlToText(textToHtml(f.question))) errs.push("нет условия");
  if (!CHECKED_BY_TEACHER.has(f.mode) && !String(f.answer || "").trim()) errs.push("нет ответа");
  if (["digits-any", "digits-fixed", "lit-match"].includes(f.mode) && f.answer && !/\d/.test(f.answer)) errs.push("в ответе нет цифр");
  return errs;
}

async function saveTasks(built) {
  const passages = built.map((b) => b.passage).filter(Boolean);
  if (passages.length) {
    const { error } = await supa.rpc("teacher_upsert_passages", { items: passages });
    if (error) throw humanError(error);
  }
  const out = [];
  for (let i = 0; i < built.length; i += 100) {
    const { data, error } = await supa.rpc("teacher_upsert_tasks", { items: built.slice(i, i + 100).map((b) => b.task) });
    if (error) throw humanError(error);
    out.push(...data);
  }
  clearBankCache();
  return out;
}

/* ------------------------------------------------------------------ */
/* Каркас                                                               */
/* ------------------------------------------------------------------ */

const TABS = [
  ["today", "Сегодня"],
  ["lessons", "Занятия"],
  ["students", "Ученики"],
  ["works", "Проверка работ"],
  ["bank", "Банк заданий"],
  ["groups", "Группы"],
  ["reading", "Чтение"],
];

export function teacherPage() {
  return `<div id="teacher-root"><p class="lede muted">Загружаем кабинет…</p></div>`;
}

function shell(active, body, badges = {}) {
  return `
    <p class="eyebrow">Кабинет преподавателя</p>
    <div class="filter-bar teacher-tabs">
      ${TABS.map(
        ([id, title]) =>
          `<a class="pill ${active === id ? "active" : ""}" href="#/cabinet/${id}">${title}${badges[id] ? ` <span class="badge">${badges[id]}</span>` : ""}</a>`
      ).join("")}
    </div>
    ${body}`;
}

async function badges() {
  const [p, w] = await Promise.all([
    supa.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supa.from("written_works").select("id", { count: "exact", head: true }).eq("status", "submitted"),
  ]);
  return { students: p.count || 0, works: w.count || 0 };
}

export async function mountTeacher(root, parts) {
  const host = root.querySelector("#teacher-root");
  if (!currentUser()) {
    teacherLogin(host);
    return;
  }
  if (!isTeacher()) {
    host.innerHTML = `<div class="empty">Этот раздел — только для преподавателя. Вы вошли как ученик. <a href="#/me">В личный кабинет</a></div>`;
    return;
  }
  const [tab = "today", sub, arg] = parts;
  const b = await badges().catch(() => ({}));
  const active = tab === "student" ? "students" : tab === "lesson" ? "lessons" : tab;
  const render = (body) => (host.innerHTML = shell(active, body, b));
  try {
    if (tab === "today") return await todayView(host, render);
    if (tab === "lessons") return await lessonsListView(host, render);
    if (tab === "lesson") return await lessonEditView(host, render, sub);
    if (tab === "students") return await studentsView(host, render);
    if (tab === "student") return await studentView(host, render, sub);
    if (tab === "works") return await worksView(host, render, sub);
    if (tab === "groups") return await groupsView(host, render);
    if (tab === "reading") return await readingView(host, render, sub);
    if (tab === "bank") {
      if (sub === "new" || sub === "edit") return await taskFormView(host, render, arg);
      if (sub === "batch") return await batchView(host, render);
      if (sub === "table") return await tableView(host, render);
      if (sub === "import") return await importView(host, render);
      return await bankView(host, render);
    }
    render(`<div class="empty">Раздел не найден.</div>`);
  } catch (err) {
    console.error(err);
    render(`<div class="empty">Ошибка: ${escapeHtml(err.message)}</div>`);
  }
}

/* ------------------------------------------------------------------ */
/* Сегодня: только то, что требует внимания                            */
/* ------------------------------------------------------------------ */

function agoText(d) {
  const h = Math.floor((Date.now() - new Date(d).getTime()) / 3600000);
  if (h < 1) return "меньше часа назад";
  if (h < 24) return `${h} ч назад`;
  const days = Math.floor(h / 24);
  return `${days} ${days % 10 === 1 && days % 100 !== 11 ? "день" : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 12 || days % 100 > 14) ? "дня" : "дней"} назад`;
}

const SECTION_TITLE = {
  home: "Главная сайта", me: "Кабинет", lesson: "Занятия", ege: "ЕГЭ · русский", "ege-item": "ЕГЭ · русский", oge: "ОГЭ · русский",
  literature: "Литература", library: "Библиотека", rules: "Правила", rule: "Правила", practice: "Практика",
  exercise: "Практика", trainer: "Тренажёры", admin: "Кабинет",
};
const sectionTitle = (s) => SECTION_TITLE[s] || s;

/** Когда был последний раз: «сегодня в 14:05», «вчера», «3 дня назад», «—». */
function seenText(d) {
  if (!d) return "—";
  const t = new Date(d);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(t)) / 86400000);
  const time = t.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (diff === 0) return `сегодня в ${time}`;
  if (diff === 1) return `вчера в ${time}`;
  return agoText(d);
}

/** Сеансы: заходы с перерывом меньше 30 минут — один сеанс. Длительность — от первого до последнего действия (+3 мин). */
function sessionsOf(times) {
  const ts = times.map((x) => new Date(x).getTime()).sort((a, b) => a - b);
  const out = [];
  for (const t of ts) {
    const cur = out[out.length - 1];
    if (cur && t - cur.end < 30 * 60000) cur.end = t;
    else out.push({ start: t, end: t });
  }
  return out.map((x) => ({ ...x, min: Math.round((x.end - x.start) / 60000) + 3 }));
}

async function todayView(host, render) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const fiveDays = new Date(Date.now() - 5 * 86400000).toISOString();
  const [pending, queue, live, todayLessons, todayAtt, recentAtt, recentWorks, students, creqs, drafts] = await Promise.all([
    supa.from("profiles").select("id, full_name, email, created_at").eq("status", "pending").order("created_at"),
    supa.from("written_works").select("id, submitted_at, profiles(full_name, email), tasks(source, task_no)").eq("status", "submitted").order("submitted_at"),
    supa.from("lessons").select("id, title, kind, duration_minutes, exam_sessions(student_id, started_at, finished_at)").eq("status", "live").not("duration_minutes", "is", null),
    supa.from("lessons").select("id, title, kind, status, starts_at").gte("starts_at", dayStart.toISOString()).lt("starts_at", dayEnd.toISOString()).order("starts_at"),
    supa.from("attempts").select("student_id, is_correct").gte("created_at", dayStart.toISOString()).limit(5000),
    supa.from("attempts").select("student_id").gte("created_at", fiveDays).limit(5000),
    supa.from("written_works").select("student_id").gte("updated_at", fiveDays).limit(2000),
    supa.from("profiles").select("id, full_name, email").neq("role", "teacher").eq("status", "active").order("full_name"),
    supa.from("course_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supa.from("lessons").select("id, title, starts_at").eq("status", "draft").eq("self_made", false).gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()).order("created_at", { ascending: false }),
  ]);
  const now = Date.now();
  const liveRows = (live.data || [])
    .map((l) => {
      const ss = l.exam_sessions || [];
      const going = ss.filter((x) => !x.finished_at && now < new Date(x.started_at).getTime() + l.duration_minutes * 60000);
      return { l, going: going.length, done: ss.filter((x) => x.finished_at).length, started: ss.length };
    })
    .filter((x) => x.going > 0);
  const active = new Set([...(recentAtt.data || []).map((a) => a.student_id), ...(recentWorks.data || []).map((w) => w.student_id)]);
  const idle = (students.data || []).filter((p) => !active.has(p.id));
  const att = todayAtt.data || [];
  const solvers = new Set(att.map((a) => a.student_id)).size;
  const q = queue.data || [];
  const name = (p) => escapeHtml(p?.full_name || p?.email || "ученик");
  const row = (href, title, sub, extra = "") => `
    <a class="tt-row" href="${href}">
      <span class="tt-body"><strong>${title}</strong><span class="muted">${sub}</span></span>
      ${extra}<span class="tt-go" aria-hidden="true">›</span>
    </a>`;
  const blocks = [];
  if (liveRows.length)
    blocks.push(
      liveRows
        .map(({ l, going, done, started }) =>
          row(`#/cabinet/lesson/${l.id}`, `<span class="chip is-hot">идёт сейчас</span> ${escapeHtml(l.title)}`, `пишут ${going} · сдали ${done} · начали ${started}`)
        )
        .join("")
    );
  blocks.push(
    row(
      q.length ? `#/cabinet/works/${q[0].id}` : "#/cabinet/works",
      q.length ? `Проверить работы <span class="tt-count">${q.length}</span>` : "Работы проверены",
      q.length ? `самая давняя — ${name(q[0].profiles)}, ${agoText(q[0].submitted_at)}` : "новых работ нет"
    )
  );
  if ((pending.data || []).length)
    blocks.push(
      row(
        "#/cabinet/students",
        `Заявки учеников <span class="tt-count">${pending.data.length}</span>`,
        pending.data.slice(0, 3).map(name).join(", ") + (pending.data.length > 3 ? "…" : "")
      )
    );
  const todayIds = new Set((todayLessons.data || []).map((l) => l.id));
  const draftList = (drafts.data || []).filter((l) => !todayIds.has(l.id));
  if (draftList.length)
    blocks.push(
      draftList.length === 1
        ? row(`#/cabinet/lesson/${draftList[0].id}`, `Черновик: ${escapeHtml(draftList[0].title)}`, "ученики пока не видят — откройте занятие и нажмите «Открыть ученикам»")
        : row("#/cabinet/lessons", `Черновики <span class="tt-count">${draftList.length}</span>`, "ученики их пока не видят: " + draftList.slice(0, 3).map((l) => escapeHtml(l.title)).join(", "))
    );
  if (creqs.count)
    blocks.push(row("#/cabinet/students", `Запросы на курсы <span class="tt-count">${creqs.count}</span>`, "ученики просят добавить предмет или класс"));
  (todayLessons.data || []).forEach((l) =>
    blocks.push(
      row(
        `#/cabinet/lesson/${l.id}`,
        escapeHtml(l.title),
        `сегодня в ${new Date(l.starts_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}${l.status === "draft" ? " · черновик — откройте ученикам" : ""}`
      )
    )
  );
  render(`
    <header class="tt-head">
      <div>
        <p class="eyebrow">${escapeHtml(new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }))}</p>
        <h1>Сегодня</h1>
      </div>
      <a class="btn" href="#/cabinet/lessons?new=1">+ Новое занятие</a>
    </header>
    <div class="tt-list">${blocks.join("")}</div>
    <section class="me-section">
      <h2>Ученики сегодня</h2>
      <div class="tt-stats">
        <div><strong>${solvers}</strong><span>занимались</span></div>
        <div><strong>${att.length}</strong><span>ответов</span></div>
        <div><strong>${att.length ? Math.round((100 * att.filter((a) => a.is_correct).length) / att.length) : 0}%</strong><span>верных</span></div>
      </div>
    </section>
    ${
      idle.length
        ? `<section class="me-section">
        <h2>Не занимались 5+ дней <span class="muted">${idle.length}</span></h2>
        <div class="tt-list">${idle
          .slice(0, 8)
          .map((p) => row(`#/cabinet/student/${p.id}`, name(p), "ни заданий, ни работ за 5 дней"))
          .join("")}</div>
      </section>`
        : ""
    }
    ${tgSlotHtml()}`);
  mountTg(host, "teacher");
}

/** Отдельная страница входа для преподавателя (ссылка внизу сайта). Регистрации здесь нет. */
function teacherLogin(host) {
  host.innerHTML = `
    <div class="auth-page">
      <p class="eyebrow">Студия Лексикон</p>
      <h1>Вход для преподавателя</h1>
      <p class="lede">Ученикам сюда не нужно — их вход вверху сайта, кнопка «Войти».</p>
      <form id="t-login" class="stack card auth-card">
        <label>E-mail<input type="email" name="email" required autocomplete="username" /></label>
        <label>Пароль<input type="password" name="password" required autocomplete="current-password" /></label>
        <button class="btn" type="submit">Войти в кабинет преподавателя</button>
        <p class="muted"><a href="#/login?mode=reset">Забыли пароль?</a></p>
        <p class="lit-result" id="t-login-status" aria-live="polite"></p>
      </form>
    </div>`;
  const form = host.querySelector("#t-login");
  const status = host.querySelector("#t-login-status");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const btn = form.querySelector("button");
    btn.disabled = true;
    status.className = "lit-result";
    status.textContent = "Входим…";
    try {
      await signIn(String(f.get("email")).trim(), String(f.get("password")));
      // После входа сайт сам перерисует кабинет (onAuthChange).
    } catch (err) {
      status.className = "lit-result is-bad";
      status.textContent = err.message;
      btn.disabled = false;
    }
  });
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("ru-RU") : "");
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "");

/* ------------------------------------------------------------------ */
/* Ученики                                                              */
/* ------------------------------------------------------------------ */

/* ---------- Ученики под псевдонимами ---------- */
const SITE_URL = "https://lexicon-school.ru/";
/** Готовое сообщение ученику: сайт, логин, пароль и короткая инструкция. */
function studentMessage(login, password, fresh = true) {
  return [
    fresh ? "Привет! Это твой доступ к кабинету студии «Лексикон»." : "Привет! Твой новый пароль для кабинета студии «Лексикон».",
    "",
    `Сайт: ${SITE_URL}#/login`,
    `Логин: ${login}`,
    password ? `Пароль: ${password}` : "",
    "",
    "Как войти:",
    "1. Открой ссылку выше (или сайт → «Войти», на телефоне кнопка внизу экрана).",
    "2. Введи логин и пароль — так, как они написаны здесь.",
    "3. На «Главной» — задания от меня и «Тренировка дня». Заходи каждый день: растёт серия и очки.",
    "",
    "Совет: добавь сайт на экран телефона — в браузере «Поделиться» → «На экран „Домой“».",
    "Пароль можно сменить в разделе «Я». Забудешь пароль — напиши мне, я задам новый.",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}
export const credsHtml = (login, password, name, fresh = true) => {
  const msg = studentMessage(login, password, fresh);
  return `
  <div class="t-creds card">
    <p><strong>Сообщение для ученика${name ? ` (${escapeHtml(name)})` : ""}</strong> — скопируйте и отправьте в мессенджер:</p>
    <textarea class="t-msg" readonly rows="${msg.split("\n").length + 1}">${escapeHtml(msg)}</textarea>
    <p class="actions"><button class="btn" type="button" data-copy>Скопировать сообщение</button> <span class="muted" data-copy-status></span></p>
    <p class="muted">Кто скрывается за псевдонимом, запишите у себя (в блокноте или телефоне), а не на сайте. Пароль после закрытия страницы больше не показывается — при необходимости задайте новый.</p>
  </div>`;
};
export function bindCopy(root) {
  root.querySelectorAll("[data-copy]").forEach((b) =>
    b.addEventListener("click", async () => {
      const box = b.closest(".t-creds");
      const area = box.querySelector(".t-msg");
      const status = box.querySelector("[data-copy-status]");
      let ok = false;
      try {
        await navigator.clipboard.writeText(area.value);
        ok = true;
      } catch {
        area.focus();
        area.select();
        try {
          ok = document.execCommand("copy");
        } catch {}
      }
      status.textContent = ok ? "Скопировано — вставьте в чат с учеником" : "Не получилось скопировать автоматически: текст выделен, нажмите «Копировать» вручную";
      if (ok) b.textContent = "Скопировано ✓";
    })
  );
}
const pseudoFieldsHtml = (ps, pw) => `
  <div class="grid-2">
    <label>Псевдоним (так ученик виден на сайте)<input name="name" value="${escapeHtml(ps.name)}" maxlength="40" required /></label>
    <label>Логин (латиница)<input name="login" value="${escapeHtml(ps.login)}" pattern="[a-z0-9][a-z0-9-]{2,30}[a-z0-9]" required autocomplete="off" /></label>
  </div>
  <label>Пароль<input name="password" value="${escapeHtml(pw)}" minlength="8" required autocomplete="off" /></label>
  <p class="actions"><button class="btn secondary" type="button" data-regen>Другой псевдоним</button></p>`;
function bindRegen(form) {
  form.querySelector("[data-regen]")?.addEventListener("click", () => {
    const ps = newPseudonym();
    form.elements.namedItem("name").value = ps.name;
    form.login.value = ps.login;
  });
}
function newStudentHtml(groupOpts) {
  return `
    <section class="me-section">
      <details class="card t-new-student" id="t-new-student">
        <summary class="btn">+ Новый ученик</summary>
        <form class="stack" id="t-new-student-form">
          <p class="muted">Настоящее имя и почту не вводим: ученик получает псевдоним, логин и пароль. Пароль забыл — задаёте новый на его странице.</p>
          ${pseudoFieldsHtml(newPseudonym(), newPassword())}
          <div class="grid-2">
            <label>Класс<select name="grade">${GRADES.map((g) => `<option value="${g}" ${g === 9 ? "selected" : ""}>${g} класс</option>`).join("")}</select></label>
            <label>Группа<select name="group"><option value="">без группы</option>${groupOpts}</select></label>
          </div>
          <fieldset class="t-inline-set"><legend>Предметы</legend>
            <label class="t-inline"><input type="checkbox" name="subj" value="rus" checked /> Русский язык</label>
            <label class="t-inline"><input type="checkbox" name="subj" value="lit" /> Литература</label>
          </fieldset>
          <p class="actions"><button class="btn" type="submit">Создать ученика</button></p>
          <p class="lit-result" id="t-new-student-status" aria-live="polite"></p>
        </form>
        <div id="t-new-student-done"></div>
      </details>
    </section>`;
}
function bindNewStudent(host) {
  const form = host.querySelector("#t-new-student-form");
  if (!form) return;
  bindRegen(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = host.querySelector("#t-new-student-status");
    const btn = form.querySelector('button[type="submit"]');
    const grade = Number(form.grade.value);
    const courses = [...form.querySelectorAll('input[name="subj"]:checked')].map((x) => `${x.value}:${grade}`);
    btn.disabled = true;
    st.className = "lit-result";
    st.textContent = "Создаём…";
    try {
      const r = await createStudent({
        name: form.elements.namedItem("name").value.trim(),
        login: form.login.value.trim().toLowerCase(),
        password: form.password.value.trim(),
        grade,
        courses,
        group: form.group.value || null,
      });
      st.textContent = "";
      const done = host.querySelector("#t-new-student-done");
      done.innerHTML = credsHtml(r.login, form.password.value.trim(), form.elements.namedItem("name").value.trim()) + `<p class="actions"><a class="btn secondary" href="#/cabinet/students" data-reload>К списку учеников</a></p>`;
      form.hidden = true;
      bindCopy(done);
      done.querySelector("[data-reload]").addEventListener("click", (ev) => {
        ev.preventDefault();
        mountTeacher(document, ["students"]);
      });
    } catch (err) {
      st.className = "lit-result is-bad";
      st.textContent = err.message;
      btn.disabled = false;
    }
  });
}
function accountBlockHtml(p) {
  if (isPseudoEmail(p.email))
    return `<section class="me-section" id="t-account">
      <h2>Вход ученика</h2>
      <p class="muted">Ученик забыл пароль — задайте новый и передайте ему.</p>
      <p class="actions"><button class="btn secondary" type="button" id="t-newpass">Задать новый пароль</button></p>
      <div id="t-account-out"></div>
    </section>`;
  return `<section class="me-section" id="t-account">
      <h2>Перевести на псевдоним</h2>
      <p class="muted">Сейчас у ученика на сайте настоящее имя и почта. После перевода останутся только псевдоним и логин: имя, почта, контакт и Telegram удалятся. Ответы, работы и очки сохранятся. Ученик будет входить по новому логину.</p>
      <form class="stack card" id="t-convert" style="padding:16px">
        ${pseudoFieldsHtml(newPseudonym(), newPassword())}
        <p class="actions"><button class="btn" type="submit">Перевести</button></p>
        <p class="lit-result" id="t-convert-status" aria-live="polite"></p>
      </form>
      <div id="t-account-out"></div>
    </section>`;
}
function bindAccountBlock(host, p) {
  const out = host.querySelector("#t-account-out");
  host.querySelector("#t-newpass")?.addEventListener("click", async (e) => {
    const pw = newPassword();
    if (!confirm(`Задать ученику новый пароль? Старый перестанет работать.`)) return;
    e.target.disabled = true;
    try {
      await resetStudentPassword(p.id, pw);
      out.innerHTML = credsHtml(loginOf(p.email), pw, p.full_name, false);
      bindCopy(out);
    } catch (err) {
      out.innerHTML = `<p class="lit-result is-bad">${escapeHtml(err.message)}</p>`;
      e.target.disabled = false;
    }
  });
  const form = host.querySelector("#t-convert");
  if (!form) return;
  bindRegen(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = host.querySelector("#t-convert-status");
    const name = form.elements.namedItem("name").value.trim();
    const login = form.login.value.trim().toLowerCase();
    const password = form.password.value.trim();
    if (!confirm(`Перевести ученика на псевдоним «${name}»? Имя, почта и контакт удалятся с сайта, входить он будет по логину ${login}.`)) return;
    form.querySelector('button[type="submit"]').disabled = true;
    st.textContent = "Переводим…";
    try {
      await convertStudent({ student: p.id, name, login, password });
      form.hidden = true;
      out.innerHTML = credsHtml(login, password, name);
      bindCopy(out);
      st.textContent = "";
    } catch (err) {
      st.className = "lit-result is-bad";
      st.textContent = err.message;
      form.querySelector('button[type="submit"]').disabled = false;
    }
  });
}

async function studentsView(host, render) {
  const [{ data: people, error }, { data: groups }, { data: members }, { data: xp }, { data: creq }] = await Promise.all([
    supa.from("profiles").select("*").neq("role", "teacher").order("created_at", { ascending: false }),
    supa.from("groups").select("id, title").eq("archived", false).order("title"),
    supa.from("group_members").select("group_id, student_id"),
    supa.from("xp_events").select("student_id, points, created_at").limit(20000),
    supa.from("course_requests").select("id, course, created_at, student_id").eq("status", "pending").order("created_at"),
  ]);
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const [{ data: acts }, { data: lastActs }, { data: atts7 }] = await Promise.all([
    supa.from("activity_log").select("student_id, at").gte("at", since7).limit(20000),
    supa.from("activity_log").select("student_id, at").order("at", { ascending: false }).limit(3000),
    supa.from("attempts").select("student_id, created_at").gte("created_at", since7).limit(20000),
  ]);
  const lastSeen = (id) => (lastActs || []).find((a) => a.student_id === id)?.at || null;
  const visits7 = (id) => sessionsOf((acts || []).filter((a) => a.student_id === id).map((a) => a.at)).length;
  const answers7 = (id) => (atts7 || []).filter((a) => a.student_id === id).length;
  const xpOf = (id) => (xp || []).filter((e) => e.student_id === id).reduce((a, e) => a + e.points, 0);
  const weekOf = (id) =>
    (xp || []).filter((e) => e.student_id === id && Date.now() - new Date(e.created_at) < 7 * 86400000).reduce((a, e) => a + e.points, 0);
  if (error) throw humanError(error);
  const groupOpts = (groups || []).map((g) => `<option value="${g.id}">${escapeHtml(g.title)}</option>`).join("");
  const groupsOf = (id) =>
    (members || [])
      .filter((m) => m.student_id === id)
      .map((m) => groups?.find((g) => g.id === m.group_id)?.title)
      .filter(Boolean);
  const pending = people.filter((p) => p.status === "pending");
  const rest = people.filter((p) => p.status !== "pending");

  const pendingHtml = pending.length
    ? pending
        .map(
          (p) => `
      <div class="card t-row" data-id="${p.id}">
        <div>
          <strong>${escapeHtml(p.full_name || "без имени")}</strong>
          <span class="muted">${escapeHtml(p.email || "")} · ${p.grade ? `${p.grade} кл.` : ""} ${escapeHtml(p.exam_target || "")} · ${escapeHtml(FORMAT_TEXT[p.study_format] || p.study_format || "")}</span>
          ${p.contact ? `<span>Связь: ${escapeHtml(p.contact)}</span>` : ""}
          ${p.note ? `<span class="muted">«${escapeHtml(p.note)}»</span>` : ""}
          <small class="muted">Зарегистрирован ${fmtDateTime(p.created_at)}</small>
        </div>
        <div class="t-actions">
          <select data-f="group"><option value="">без группы</option>${groupOpts}</select>
          <label class="t-inline">доступ до <input type="date" data-f="until" /></label>
          <button class="btn" data-act="approve">Подтвердить</button>
          <button class="btn secondary" data-act="reject">Отклонить</button>
        </div>
      </div>`
        )
        .join("")
    : `<p class="muted">Новых заявок нет.</p>`;

  const restHtml = rest
    .map(
      (p) => `
      <tr data-id="${p.id}" data-blob="${escapeHtml([p.full_name, p.email, p.contact, p.exam_target].join(" ").toLowerCase())}">
        <td><a href="#/cabinet/student/${p.id}">${escapeHtml(p.full_name || p.email || "—")}</a><br><small class="muted">${escapeHtml(p.email || "")}</small></td>
        <td>${p.grade || ""}</td>
        <td>${(p.courses || []).length ? (p.courses || []).map((c) => escapeHtml(courseLabel(c))).join("<br>") : escapeHtml(p.exam_target || "")}</td>
        <td>${escapeHtml(groupsOf(p.id).join(", "))}</td>
        <td title="за 7 дней: ${weekOf(p.id)}">${xpOf(p.id)}${weekOf(p.id) ? ` <small class="t-okc">+${weekOf(p.id)}</small>` : ""}</td>
        <td>${seenText(lastSeen(p.id))}</td>
        <td>${visits7(p.id) || "—"}</td>
        <td>${answers7(p.id) || "—"}</td>
        <td>
          <select data-f="status">${Object.entries(STATUS_TEXT)
            .map(([k, v]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${v}</option>`)
            .join("")}</select>
        </td>
        <td><input type="date" data-f="until" value="${p.access_until || ""}" /></td>
        <td><button class="btn secondary" data-act="save">Сохранить</button></td>
      </tr>`
    )
    .join("");

  const nameOf = (id) => {
    const p = people.find((x) => x.id === id);
    return escapeHtml(p?.full_name || p?.email || "ученик");
  };
  const creqHtml = (creq || []).length
    ? `<section class="me-section" id="course-requests">
        <h2>Запросы на курсы <span class="badge">${creq.length}</span></h2>
        <div class="tt-list">${creq
          .map(
            (r) => `<div class="tt-row" data-req="${r.id}">
              <span class="tt-body"><strong>${nameOf(r.student_id)}</strong><span class="muted">хочет курс «${escapeHtml(courseLabel(r.course))}» · ${fmtDateTime(r.created_at)}</span></span>
              <button class="btn" data-req-ok="1">Добавить</button>
              <button class="btn secondary" data-req-ok="0">Отказать</button>
            </div>`
          )
          .join("")}</div>
      </section>`
    : "";
  render(`
    <h1>Ученики</h1>
    ${newStudentHtml(groupOpts)}
    ${creqHtml}
    ${
      pending.length
        ? `<section class="me-section">
      <h2>Заявки на доступ <span class="badge">${pending.length}</span></h2>
      <p class="muted">Старые самостоятельные регистрации. Новых учеников теперь создаёте вы — кнопкой выше.</p>
      ${pendingHtml}
    </section>`
        : ""
    }
    <section class="me-section">
      <h2>Все ученики · ${rest.length}</h2>
      <input class="search" id="t-q" type="search" placeholder="Поиск по имени, почте, цели" />
      <div class="t-table-wrap"><table class="t-table">
        <thead><tr><th>Ученик</th><th>Класс</th><th>Курсы</th><th>Группы</th><th title="Очки за самостоятельную работу; зелёным — за неделю">Очки</th><th>Был на сайте</th><th title="Сеансов за 7 дней (заходы с перерывом больше 30 минут)">Заходов 7 дн.</th><th>Ответов 7 дн.</th><th>Статус</th><th>Доступ до</th><th></th></tr></thead>
        <tbody>${restHtml || `<tr><td colspan="11" class="muted">Пока никого.</td></tr>`}</tbody>
      </table></div>
    </section>`);

  bindNewStudent(host);
  host.querySelectorAll("[data-req-ok]").forEach((b) =>
    b.addEventListener("click", async () => {
      const row = b.closest("[data-req]");
      row.querySelectorAll("button").forEach((x) => (x.disabled = true));
      const { error } = await supa.rpc("decide_course_request", { p_id: Number(row.dataset.req), p_ok: b.dataset.reqOk === "1" });
      if (error) {
        alert(humanError(error).message);
        row.querySelectorAll("button").forEach((x) => (x.disabled = false));
        return;
      }
      mountTeacher(document, ["students"]);
    })
  );
  host.querySelector("#t-q")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    host.querySelectorAll("tbody tr[data-blob]").forEach((tr) => (tr.hidden = q && !tr.dataset.blob.includes(q)));
  });
  host.querySelectorAll("[data-act]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const row = btn.closest("[data-id]");
      const id = row.dataset.id;
      const get = (f) => row.querySelector(`[data-f="${f}"]`)?.value || null;
      const act = btn.dataset.act;
      const status = act === "approve" ? "active" : act === "reject" ? "archived" : get("status");
      btn.disabled = true;
      const { error } = await supa.rpc("teacher_set_student", {
        p_student: id,
        p_status: status,
        p_group: act === "approve" ? get("group") : null,
        p_until: get("until"),
      });
      if (error) {
        alert(humanError(error).message);
        btn.disabled = false;
        return;
      }
      if (act === "save") {
        btn.textContent = "Сохранено";
        setTimeout(() => ((btn.textContent = "Сохранить"), (btn.disabled = false)), 1200);
      } else {
        mountTeacher(document, ["students"]);
      }
    })
  );
}

/** Активность ученика за 30 дней: заходы, время, разделы, ответы. */
function activityHtml(acts, atts) {
  const sess = sessionsOf([...acts.map((a) => a.at), ...atts.map((a) => a.created_at)]);
  const totalMin = sess.reduce((a, s) => a + s.min, 0);
  const correct = atts.filter((a) => a.is_correct).length;
  const secs = atts.map((a) => a.seconds).filter((x) => x > 0 && x < 3600);
  const bySection = {};
  acts.forEach((a) => (bySection[sectionTitle(a.section)] = (bySection[sectionTitle(a.section)] || 0) + 1));
  const top = Object.entries(bySection).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 13 + i);
    const next = d.getTime() + 86400000;
    const inDay = (t) => {
      const x = new Date(t).getTime();
      return x >= d.getTime() && x < next;
    };
    return {
      label: d.toLocaleDateString("ru-RU", { day: "numeric" }),
      wd: d.toLocaleDateString("ru-RU", { weekday: "short" }),
      visits: sessionsOf(acts.filter((a) => inDay(a.at)).map((a) => a.at)).length,
      answers: atts.filter((a) => inDay(a.created_at)).length,
    };
  });
  const maxA = Math.max(1, ...days.map((d) => d.answers + d.visits));
  const last = acts[0]?.at || atts.map((a) => a.created_at).sort().at(-1);
  return `
    <section class="me-section">
      <h2>Активность <span class="muted">за 30 дней</span></h2>
      <div class="tt-stats t-act-stats">
        <div><strong>${seenText(last)}</strong><span>последний раз</span></div>
        <div><strong>${sess.length}</strong><span>заходов</span></div>
        <div><strong>${totalMin >= 60 ? `${Math.floor(totalMin / 60)} ч ${totalMin % 60} мин` : `${totalMin} мин`}</strong><span>на сайте (примерно)</span></div>
        <div><strong>${atts.length}</strong><span>ответов · верных ${atts.length ? Math.round((100 * correct) / atts.length) : 0}%</span></div>
        <div><strong>${secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : "—"}${secs.length ? " с" : ""}</strong><span>в среднем на ответ</span></div>
      </div>
      <div class="t-days" role="img" aria-label="Заходы и ответы по дням за 2 недели">
        ${days
          .map(
            (d) => `<div class="t-day" title="${d.wd} ${d.label}: заходов ${d.visits}, ответов ${d.answers}">
              <span class="t-bar"><span class="t-bar-a" style="height:${Math.round((100 * d.answers) / maxA)}%"></span><span class="t-bar-v" style="height:${Math.round((100 * d.visits) / maxA)}%"></span></span>
              <small>${d.label}</small></div>`
          )
          .join("")}
      </div>
      <p class="muted t-legend"><span class="t-key t-key-a"></span> ответы · <span class="t-key t-key-v"></span> заходы</p>
      ${
        top.length
          ? `<h3>Куда заходил</h3><div class="t-sections">${top.map(([k, v]) => `<span class="chip">${escapeHtml(k)} · ${v}</span>`).join("")}</div>`
          : `<p class="muted">Журнал заходов ведётся с ${new Date().toLocaleDateString("ru-RU")} — данные появятся, когда ученик откроет сайт.</p>`
      }
    </section>`;
}

async function studentView(host, render, id) {
  const [{ data: p }, { data: stats }, { data: attempts }, { data: works }, { data: note }] = await Promise.all([
    supa.from("profiles").select("*").eq("id", id).maybeSingle(),
    supa.from("task_stats").select("*").eq("student_id", id),
    supa
      .from("attempts")
      .select("answer, is_correct, created_at, seconds, tasks(source, bank_file, source_ref, task_no)")
      .eq("student_id", id)
      .order("created_at", { ascending: false })
      .limit(80),
    supa
      .from("written_works")
      .select("id, status, score, max_score, submitted_at, tasks(source, task_no, source_ref)")
      .eq("student_id", id)
      .order("created_at", { ascending: false }),
    supa.from("student_notes").select("note").eq("student_id", id).maybeSingle(),
  ]);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: xpRows }, { data: actRows }, { data: att30 }] = await Promise.all([
    supa.from("xp_events").select("points, created_at").eq("student_id", id).limit(5000),
    supa.from("activity_log").select("section, path, at").eq("student_id", id).gte("at", since30).order("at", { ascending: false }).limit(5000),
    supa.from("attempts").select("is_correct, created_at, seconds").eq("student_id", id).gte("created_at", since30).limit(10000),
  ]);
  const { data: mastered } = await supa.from("rules_mastered").select("chapter_id").eq("student_id", id);
  const xpTotal = (xpRows || []).reduce((a, e) => a + e.points, 0);
  const xpWeek = (xpRows || []).filter((e) => Date.now() - new Date(e.created_at) < 7 * 86400000).reduce((a, e) => a + e.points, 0);
  const activeDays = new Set((xpRows || []).map((e) => e.created_at.slice(0, 10))).size;
  if (!p) return render(`<div class="empty">Ученик не найден.</div>`);
  const statRows = (stats || [])
    .sort((a, b) => a.source.localeCompare(b.source) || a.task_no - b.task_no)
    .map(
      (s) =>
        `<tr><td>${escapeHtml(SOURCES[s.source]?.title || s.source)}</td><td>№ ${s.task_no}</td><td>${s.tasks_solved} / ${s.tasks_seen}</td><td>${s.pct_correct}%</td><td>${s.tries}</td><td>${fmtDate(s.last_activity)}</td></tr>`
    )
    .join("");
  const attemptRows = (attempts || [])
    .map(
      (a) =>
        `<tr class="${a.is_correct ? "t-ok" : "t-bad"}"><td>${fmtDateTime(a.created_at)}</td><td><a href="${taskHref(a.tasks)}">${escapeHtml(SOURCES[a.tasks?.source]?.title || "")} № ${a.tasks?.task_no} · ${escapeHtml(String(a.tasks?.source_ref))}</a></td><td>${escapeHtml(a.answer)}</td><td>${a.is_correct ? "верно" : "неверно"}</td><td>${a.seconds ? `${a.seconds} с` : ""}</td></tr>`
    )
    .join("");
  const workRows = (works || [])
    .map(
      (w) =>
        `<tr><td>${fmtDateTime(w.submitted_at)}</td><td>${escapeHtml(SOURCES[w.tasks?.source]?.title || "")} № ${w.tasks?.task_no ?? ""}</td><td>${WORK_STATUS[w.status]}</td><td>${w.score ?? ""}${w.max_score ? `/${w.max_score}` : ""}</td><td><a href="#/cabinet/works/${w.id}">открыть</a></td></tr>`
    )
    .join("");
  render(`
    <p class="crumbs"><a href="#/cabinet/students">← Ученики</a></p>
    <h1>${escapeHtml(p.full_name || p.email)}</h1>
    <p class="t-xp">Очки: <b>${xpTotal}</b> · за неделю: <b>+${xpWeek}</b> · дней с занятиями: <b>${activeDays}</b> · закреплено глав правил: <b>${(mastered || []).length}</b></p>
    <p class="lede">${isPseudoEmail(p.email) ? `логин <b>${escapeHtml(loginOf(p.email))}</b>` : escapeHtml(p.email || "")} · ${STATUS_TEXT[p.status]}${p.grade ? ` · ${p.grade} класс` : ""}${p.exam_target ? ` · ${escapeHtml(p.exam_target)}` : ""}</p>
    ${accountBlockHtml(p)}
    ${activityHtml(actRows || [], att30 || [])}
    <section class="me-section">
      <h2>Курсы</h2>
      <form id="t-courses" class="card t-courses">
        ${Object.entries(SUBJECTS)
          .map(
            ([s, title]) => `<fieldset><legend>${title}</legend>${GRADES.map(
              (g) => `<label class="t-course"><input type="checkbox" value="${s}:${g}" ${(p.courses || []).includes(`${s}:${g}`) ? "checked" : ""}/> ${g}${g === 9 ? " ОГЭ" : g >= 10 ? " ЕГЭ" : ""}</label>`
            ).join("")}</fieldset>`
          )
          .join("")}
        <p class="actions"><button class="btn secondary" type="submit">Сохранить курсы</button> <span class="muted" id="t-courses-status"></span></p>
      </form>
    </section>
    <section class="me-section">
      <h2>Заметки (видите только вы)</h2>
      <textarea id="t-note" class="lit-essay" style="min-height:90px">${escapeHtml(note?.note || "")}</textarea>
      <p class="actions"><button class="btn secondary" id="t-note-save">Сохранить заметку</button> <span class="muted" id="t-note-status"></span></p>
    </section>
    <section class="me-section"><h2>Статистика по номерам</h2>
      ${statRows ? `<div class="t-table-wrap"><table class="t-table"><thead><tr><th>Экзамен</th><th>Номер</th><th>Решено</th><th>Точность</th><th>Попыток</th><th>Последний раз</th></tr></thead><tbody>${statRows}</tbody></table></div>` : `<p class="muted">Ещё не решал.</p>`}
    </section>
    <section class="me-section"><h2>Письменные работы</h2>
      ${workRows ? `<div class="t-table-wrap"><table class="t-table"><tbody>${workRows}</tbody></table></div>` : `<p class="muted">Нет.</p>`}
    </section>
    <section class="me-section"><h2>Последние ответы</h2>
      ${attemptRows ? `<div class="t-table-wrap"><table class="t-table"><thead><tr><th>Когда</th><th>Задание</th><th>Ответ</th><th></th><th>Время</th></tr></thead><tbody>${attemptRows}</tbody></table></div>` : `<p class="muted">Нет.</p>`}
    </section>
    <section class="me-section t-danger">
      <h2>Удалить ученика</h2>
      <p class="muted">Удалятся учётная запись, ответы, письменные работы с фото, очки и результаты. Это нельзя отменить. Если ученик просто перестал ходить — лучше поставьте статус «в архиве» в списке учеников: всё сохранится.</p>
      <p class="actions"><button class="btn t-del" id="t-delete">Удалить ученика навсегда</button> <span class="muted" id="t-delete-status"></span></p>
    </section>`);
  host.querySelector("#t-courses")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const courses = [...e.target.querySelectorAll("input:checked")].map((x) => x.value);
    const { error } = await supa.from("profiles").update({ courses }).eq("id", id);
    host.querySelector("#t-courses-status").textContent = error ? humanError(error).message : "Сохранено";
  });
  host.querySelector("#t-delete")?.addEventListener("click", async (e) => {
    const name = p.full_name || p.email || "ученик";
    const typed = prompt(`Удалить ${name} навсегда вместе со всеми ответами, работами и очками?\n\nЧтобы подтвердить, напишите слово УДАЛИТЬ.`);
    if (String(typed || "").trim().toUpperCase() !== "УДАЛИТЬ") return;
    const st = host.querySelector("#t-delete-status");
    e.target.disabled = true;
    st.textContent = "Удаляем фото работ…";
    try {
      const { data: files } = await supa.storage.from("works").list(id, { limit: 1000 });
      if (files?.length) {
        const { error: fe } = await supa.storage.from("works").remove(files.map((f) => `${id}/${f.name}`));
        if (fe) throw fe;
      }
      st.textContent = "Удаляем учётную запись…";
      const { error } = await supa.rpc("teacher_delete_student", { p_id: id });
      if (error) throw error;
      location.hash = "#/cabinet/students";
    } catch (err) {
      st.textContent = humanError(err).message || String(err);
      e.target.disabled = false;
    }
  });
  bindAccountBlock(host, p);
  host.querySelector("#t-note-save")?.addEventListener("click", async () => {
    const { error } = await supa
      .from("student_notes")
      .upsert({ student_id: id, note: host.querySelector("#t-note").value, updated_at: new Date().toISOString() });
    host.querySelector("#t-note-status").textContent = error ? humanError(error).message : "Сохранено";
  });
}

/* ------------------------------------------------------------------ */
/* Проверка письменных работ                                            */
/* ------------------------------------------------------------------ */

async function worksView(host, render, workId) {
  if (workId) return workReview(host, render, workId);
  // работы на время, у которых вышло время: сервер сдаёт оставшиеся черновики
  const { data: timed } = await supa.from("lessons").select("id").not("duration_minutes", "is", null).neq("status", "draft").limit(30);
  await Promise.all((timed || []).map((l) => supa.rpc("finalize_exam_works", { p_lesson: l.id })));
  const { data, error } = await supa
    .from("written_works")
    .select("id, status, submitted_at, score, max_score, body, item_id, choice, profiles(full_name, email), tasks(source, task_no, source_ref, work:data->>work), lesson_items(lessons(title))")
    .in("status", ["submitted", "returned", "graded"])
    .order("submitted_at", { ascending: false })
    .limit(200);
  if (error) throw humanError(error);
  const row = (w) => `
    <a class="lit-item" href="#/cabinet/works/${w.id}">
      <span class="lit-item-n">${w.tasks?.task_no ?? "·"}</span>
      <span class="lit-item-body">
        <strong>${escapeHtml(w.profiles?.full_name || w.profiles?.email || "ученик")} · ${escapeHtml(SOURCES[w.tasks?.source]?.title || "")} № ${w.tasks?.task_no ?? ""}${w.tasks?.work ? ` · «${escapeHtml(w.tasks.work)}»` : ""}${w.choice ? ` · вариант ${w.choice}` : ""}</strong>
        <span>${w.item_id ? `из занятия «${escapeHtml(w.lesson_items?.lessons?.title || "…")}»` : "сам, по желанию"} · ${WORK_STATUS[w.status]} · ${fmtDateTime(w.submitted_at)}${w.score != null ? ` · ${w.score}${w.max_score ? `/${w.max_score}` : ""}` : ""}</span>
        <span class="muted">${escapeHtml((w.body || "фото").slice(0, 120))}</span>
      </span>
    </a>`;
  const queue = data.filter((w) => w.status === "submitted").reverse();
  const done = data.filter((w) => w.status !== "submitted");
  render(`
    <h1>Проверка работ</h1>
    <section class="me-section"><h2>Ждут проверки · ${queue.length}</h2>
      ${queue.length ? `<div class="lit-list">${queue.map(row).join("")}</div>` : `<p class="muted">Очередь пуста.</p>`}
    </section>
    <section class="me-section"><h2>Проверенные и возвращённые</h2>
      ${done.length ? `<div class="lit-list">${done.map(row).join("")}</div>` : `<p class="muted">Пока нет.</p>`}
    </section>`);
}

async function workReview(host, render, id) {
  const { data: w, error } = await supa
    .from("written_works")
    .select("*, profiles(full_name, email), tasks(id, source, bank_file, task_no, source_ref, data, passage_id)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw humanError(error);
  if (!w) return render(`<div class="empty">Работа не найдена.</div>`);
  // Очередь «ждут проверки»: стрелки к соседним работам, после оценки — сразу следующая.
  const { data: queueRows } = await supa
    .from("written_works")
    .select("id, profiles(full_name, email)")
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true })
    .limit(300);
  const queue = queueRows || [];
  const qi = queue.findIndex((x) => x.id === id);
  const qPrev = qi > 0 ? queue[qi - 1] : null;
  const qNext = qi >= 0 ? queue[qi + 1] || null : queue[0] && queue[0].id !== id ? queue[0] : null;
  const studentName = w.profiles?.full_name || w.profiles?.email || "ученик";
  // Откуда работа: из вашего занятия или ученик написал сам, по желанию.
  let origin = `<span class="chip">сам, по желанию</span>`;
  if (w.item_id) {
    const { data: it } = await supa.from("lesson_items").select("lessons(id, title, kind)").eq("id", w.item_id).maybeSingle();
    origin = it?.lessons
      ? `<a class="chip is-hot" href="#/cabinet/lesson/${it.lessons.id}">из занятия «${escapeHtml(it.lessons.title)}»</a>`
      : `<span class="chip">из занятия (удалено)</span>`;
  }
  const openText = matchMedia("(max-width: 760px)").matches ? " open" : "";
  const { data: full } = w.task_id ? await supa.rpc("teacher_get_task", { p_task: w.task_id }) : { data: null };
  let passage = "";
  if (w.tasks?.passage_id) {
    const { data } = await supa.from("passages").select("html").eq("id", w.tasks.passage_id).maybeSingle();
    passage = data?.html || "";
  }
  const ann = { text: [...(w.annotations?.text || [])], photos: { ...(w.annotations?.photos || {}) } };
  const body = w.body || "";
  const words = countWords(body);
  const saved = w.criteria?.rubric ? w.criteria : { rubric: rubricFor(w.tasks), scores: w.criteria || {} };
  let rubricId = saved.rubric;
  let scores = { ...(saved.scores || {}) };
  const photoUrls = {};
  await Promise.all(
    (w.files || []).map(async (p) => {
      try {
        photoUrls[p] = await signedFileUrl(p);
      } catch {
        /* нет доступа к файлу */
      }
    })
  );

  render(`
    <p class="crumbs"><a href="#/cabinet/works">← Все работы</a></p>
    <nav class="rv-nav" aria-label="Очередь проверки">
      ${qPrev ? `<a class="tb-btn" href="#/cabinet/works/${qPrev.id}" aria-label="Предыдущая работа">‹</a>` : `<span class="tb-btn is-off" aria-hidden="true">‹</span>`}
      <span class="tb-mid"><span>${escapeHtml(studentName)}</span><span class="muted">${qi >= 0 ? `в очереди ${qi + 1} из ${queue.length}` : queue.length ? `в очереди ещё ${queue.length}` : "очередь пуста"}</span></span>
      ${qNext ? `<a class="tb-btn" href="#/cabinet/works/${qNext.id}" aria-label="Следующая работа">›</a>` : `<span class="tb-btn is-off" aria-hidden="true">›</span>`}
    </nav>
    <h1>${escapeHtml(w.profiles?.full_name || w.profiles?.email || "Работа")}</h1>
    <p class="rv-origin">${origin}</p>
    <p class="lede">${escapeHtml(SOURCES[w.tasks?.source]?.title || "")} · задание ${w.tasks?.task_no ?? ""} · № ${escapeHtml(String(w.tasks?.source_ref || ""))} · ${WORK_STATUS[w.status]} · сдано ${fmtDateTime(w.submitted_at)}</p>
    ${(() => {
      const opts = optionsOf(w.tasks?.data?.questionHtml || "");
      const work = w.tasks?.data?.work ? `«${escapeHtml(w.tasks.data.work)}»${w.tasks.data.author ? `, ${escapeHtml(w.tasks.data.author)}` : ""}` : "";
      const chosen = opts.length && w.choice ? opts[w.choice - 1] : null;
      return `
      <section class="rv-task card">
        ${work ? `<p class="eyebrow">${work}</p>` : ""}
        ${
          opts.length
            ? chosen
              ? `<p class="rv-choice"><span class="chip is-hot">${opts.length === 2 ? "вопрос" : "тема"} ${w.choice}</span> ${escapeHtml(chosen)}</p>
                 <details><summary class="muted">Полное условие с остальными вариантами</summary><div class="lit-html">${w.tasks?.data?.questionHtml || ""}</div></details>`
              : `<p class="rv-choice is-missing">Ученик не отметил, ${opts.length === 2 ? "какой вопрос" : "какую тему"} выбрал — посмотрите по тексту ответа.</p>
                 <div class="lit-html">${w.tasks?.data?.questionHtml || ""}</div>`
            : `<div class="lit-html">${w.tasks?.data?.questionHtml || ""}</div>`
        }
      </section>
      ${passage ? `<details class="lit-solution"${openText}><summary>Исходный текст (фрагмент / стихотворение)</summary><div class="lit-html rv-passage">${passage}</div></details>` : ""}`;
    })()}
    ${full?.key?.solution_html ? `<details class="lit-solution"><summary>Образец / пояснение</summary><div class="lit-html">${full.key.solution_html}</div></details>` : ""}

    <section class="me-section">
      <h2>Ответ ученика <small class="muted">${words} сл.</small></h2>
      ${
        body.trim()
          ? `<p class="muted">Выделите слово или фрагмент (на телефоне — долгим нажатием) — появится панель пометок.</p>
        <div class="card rv-body" id="rv-body">${markedTextHtml(body, ann.text)}</div>
        <div id="rv-pop" class="rv-pop" hidden>
          ${Object.entries(MARKS).map(([k, m]) => `<button type="button" data-mark="${k}" class="rv-chip rv-${k}" title="${escapeHtml(m.title)}">${escapeHtml(m.label)}</button>`).join("")}
          <input id="rv-note" placeholder="комментарий (необязательно)" />
        </div>
        <div id="rv-list">${marksListHtml(ann.text, { editable: true })}</div>`
          : '<p class="muted">Текста нет — смотрите фото.</p>'
      }
      ${
        (w.files || []).length
          ? `<h3>Фото работы</h3><p class="muted">Нажмите на фото, чтобы отметить ошибки красной ручкой, выделить маркером или написать на полях.</p>
        <div class="rv-photos">${(w.files || [])
          .map(
            (p, i) => `<figure class="rv-photo" data-path="${escapeHtml(p)}">
              ${/\.pdf$/i.test(p) ? `<a href="${escapeHtml(photoUrls[p] || "#")}" target="_blank" rel="noopener">PDF-файл ${i + 1}</a>` : `<canvas></canvas>`}
              <figcaption>Страница ${i + 1}${ann.photos[p]?.strokes?.length || ann.photos[p]?.labels?.length ? " · есть пометки" : ""}</figcaption>
            </figure>`
          )
          .join("")}</div>`
          : ""
      }
    </section>

    <section class="me-section">
      <h2>Оценка</h2>
      <form id="t-grade" class="stack card" style="padding:20px">
        <div id="rv-criteria">${criteriaFormHtml(rubricId, scores, { words, counts: countMarks(ann.text) })}</div>
        <div class="grid-2" id="rv-manual" ${RUBRICS[rubricId]?.criteria.length ? "hidden" : ""}>
          <label>Балл<input name="score" type="number" step="0.5" min="0" value="${w.score ?? ""}" /></label>
          <label>Из скольких<input name="max_score" type="number" step="0.5" min="0" value="${w.max_score ?? ""}" /></label>
        </div>
        <label>Комментарий ученику<textarea name="comment" style="min-height:140px">${escapeHtml(w.teacher_comment || "")}</textarea></label>
        <div class="actions">
          <button class="btn" type="submit" name="act" value="graded">Оценить и отправить ученику</button>
          <button class="btn secondary" type="submit" name="act" value="returned">Вернуть на доработку</button>
          <button class="btn secondary" type="submit" name="act" value="keep">Сохранить без отправки</button>
        </div>
        <p class="lit-result" id="t-grade-status"></p>
        <div class="rv-dock" aria-label="Оценка">
          <span class="rv-dock-total" id="rv-dock-total">—</span>
          <button type="button" class="btn secondary" data-dock="returned">Вернуть</button>
          <button type="button" class="btn" data-dock="graded">Готово</button>
        </div>
      </form>
    </section>`);

  // ----- пометки в тексте
  const bodyEl = host.querySelector("#rv-body");
  const pop = host.querySelector("#rv-pop");
  const refreshText = () => {
    bodyEl.innerHTML = markedTextHtml(body, ann.text);
    host.querySelector("#rv-list").innerHTML = marksListHtml(ann.text, { editable: true });
    bindDeletes();
    refreshCriteria();
  };
  const bindDeletes = () =>
    host.querySelectorAll("#rv-list [data-del]").forEach((b) =>
      b.addEventListener("click", () => {
        ann.text.splice(Number(b.dataset.del), 1);
        refreshText();
      })
    );
  let sel = null;
  const offsetIn = (node, offset) => {
    const r = document.createRange();
    r.setStart(bodyEl, 0);
    r.setEnd(node, offset);
    // теги пометок (sup) не входят в текст ответа
    const frag = r.cloneContents();
    frag.querySelectorAll(".rv-tag").forEach((x) => x.remove());
    return frag.textContent.length;
  };
  const onSelect = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !bodyEl.contains(s.anchorNode) || !bodyEl.contains(s.focusNode)) {
      pop.hidden = true;
      return;
    }
    const r = s.getRangeAt(0);
    let start = offsetIn(r.startContainer, r.startOffset);
    let end = offsetIn(r.endContainer, r.endOffset);
    if (end < start) [start, end] = [end, start];
    while (start < end && /\s/.test(body[start])) start += 1;
    while (end > start && /\s/.test(body[end - 1])) end -= 1;
    if (end <= start) return;
    sel = { start, end };
    const rect = r.getBoundingClientRect();
    const box = host.getBoundingClientRect();
    pop.style.left = `${Math.max(0, rect.left - box.left)}px`;
    pop.style.top = `${rect.bottom - box.top + 6}px`;
    pop.hidden = false;
    pop.querySelector("#rv-note").value = "";
  };
  bodyEl?.addEventListener("mouseup", onSelect);
  // на телефоне выделение заканчивается не «мышью», а пальцем
  bodyEl?.addEventListener("touchend", () => setTimeout(onSelect, 350));
  pop?.querySelectorAll("[data-mark]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!sel) return;
      if (ann.text.some((m) => sel.start < m.end && sel.end > m.start)) {
        alert("Этот фрагмент пересекается с уже отмеченным. Уберите старую пометку или выделите другой фрагмент.");
        return;
      }
      ann.text.push({ ...sel, type: b.dataset.mark, note: pop.querySelector("#rv-note").value.trim() || undefined, quote: body.slice(sel.start, sel.end).slice(0, 80) });
      pop.hidden = true;
      window.getSelection()?.removeAllRanges();
      sel = null;
      refreshText();
    })
  );
  bindDeletes();

  // ----- фото
  const drawPhotos = () =>
    host.querySelectorAll(".rv-photo").forEach(async (fig) => {
      const p = fig.dataset.path;
      const canvas = fig.querySelector("canvas");
      if (!canvas || !photoUrls[p]) return;
      try {
        await renderPhoto(canvas, photoUrls[p], ann.photos[p]);
      } catch {
        fig.querySelector("figcaption").textContent = "Фото не загрузилось";
      }
    });
  drawPhotos();
  host.querySelectorAll(".rv-photo canvas").forEach((canvas) =>
    canvas.addEventListener("click", async () => {
      const fig = canvas.closest(".rv-photo");
      const p = fig.dataset.path;
      const layer = await openPhotoEditor(photoUrls[p], ann.photos[p]);
      if (!layer) return;
      ann.photos[p] = layer;
      await renderPhoto(canvas, photoUrls[p], layer);
      fig.querySelector("figcaption").textContent = `${fig.querySelector("figcaption").textContent.split(" · ")[0]}${layer.strokes.length || layer.labels.length ? " · есть пометки (не забудьте сохранить)" : ""}`;
    })
  );

  // ----- критерии
  const form = host.querySelector("#t-grade");
  const refreshCriteria = (rerender = false) => {
    const ctx = { words, counts: countMarks(ann.text) };
    if (rerender) {
      const current = readCriteria(form, rubricId, ctx);
      scores = { ...scores, ...current.raw };
      form.querySelector("#rv-criteria").innerHTML = criteriaFormHtml(rubricId, scores, ctx);
      bindCriteria();
    } else {
      // обновить подсказки по пометкам без потери выбора
      const current = readCriteria(form, rubricId, ctx);
      scores = { ...scores, ...current.raw };
      form.querySelector("#rv-criteria").innerHTML = criteriaFormHtml(rubricId, scores, ctx);
      bindCriteria();
    }
  };
  const showTotal = () => {
    const res = readCriteria(form, rubricId, { words, counts: countMarks(ann.text) });
    const has = RUBRICS[rubricId]?.criteria.length;
    form.querySelector("#rv-manual").hidden = Boolean(has);
    form.querySelector("#rv-fired").innerHTML = res.fired.map(escapeHtml).join("<br>");
    form.querySelector("#rv-total").innerHTML = has
      ? `Итого: <b>${res.total}</b> из ${res.max}${res.filled ? "" : ' <span class="muted">— не все критерии отмечены</span>'}`
      : "";
    const dock = host.querySelector("#rv-dock-total");
    if (dock) {
      const manual = form.querySelector('[name="score"]')?.value;
      dock.innerHTML = has ? `<b>${res.total}</b>/${res.max}` : manual ? `<b>${escapeHtml(manual)}</b>` : "—";
    }
    // выставить нули, которых требуют правила
    Object.entries(res.scores).forEach(([code, v]) => {
      if (res.raw[code] !== v) {
        const r = form.querySelector(`input[name="crit-${code}"][value="${v}"]`);
        if (r) r.checked = true;
      }
    });
    return res;
  };
  const bindCriteria = () => {
    form.querySelector("#rv-rubric").addEventListener("change", (e) => {
      rubricId = e.target.value;
      scores = {};
      form.querySelector("#rv-criteria").innerHTML = criteriaFormHtml(rubricId, scores, { words, counts: countMarks(ann.text) });
      bindCriteria();
    });
    form.querySelectorAll(".rv-crit input").forEach((r) => r.addEventListener("change", showTotal));
    form.querySelectorAll(".rv-hint").forEach((b) =>
      b.addEventListener("click", () => {
        const r = form.querySelector(`input[name="crit-${b.dataset.code}"][value="${b.dataset.val}"]`);
        if (r) r.checked = true;
        showTotal();
      })
    );
    showTotal();
  };
  bindCriteria();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const act = e.submitter?.value || "graded";
    const f = new FormData(form);
    const res = showTotal();
    const has = RUBRICS[rubricId]?.criteria.length;
    if (act === "graded" && has && !res.filled && !confirm("Не все критерии отмечены. Всё равно отправить оценку?")) return;
    const num = (v) => (v === "" || v === null ? null : Number(v));
    // при возврате на доработку баллы сохраняем, только если они действительно выставлены
    const scored = has ? res.filled || act === "graded" : f.get("score") !== "";
    const row = {
      annotations: ann,
      criteria: has && scored ? { rubric: rubricId, scores: res.scores, fired: res.fired } : null,
      score: !scored ? null : has ? res.total : num(f.get("score")),
      max_score: !scored ? null : has ? res.max : num(f.get("max_score")),
      teacher_comment: String(f.get("comment") || "").trim() || null,
    };
    if (act !== "keep") {
      row.status = act;
      row.reviewed_at = new Date().toISOString();
    }
    const { error: err } = await supa.from("written_works").update(row).eq("id", id);
    const st = host.querySelector("#t-grade-status");
    st.className = `lit-result ${err ? "is-bad" : "is-ok"}`;
    st.textContent = err
      ? humanError(err).message
      : act === "keep"
        ? "Пометки и баллы сохранены. Ученик увидит их, когда вы нажмёте «Оценить» или «Вернуть»."
        : act === "returned"
          ? "Работа возвращена на доработку — ученик видит ваши пометки и комментарий."
          : "Оценка отправлена — ученик видит баллы, пометки и комментарий в кабинете.";
    if (!err && act !== "keep" && qNext) {
      st.textContent += " Открываю следующую работу…";
      setTimeout(() => (location.hash = `#/cabinet/works/${qNext.id}`), 1200);
    }
  });
  host.querySelectorAll("[data-dock]").forEach((b) =>
    b.addEventListener("click", () => form.requestSubmit(form.querySelector(`button[type="submit"][value="${b.dataset.dock}"]`)))
  );
  form.querySelector('[name="score"]')?.addEventListener("input", showTotal);
}

/* ------------------------------------------------------------------ */
/* Группы                                                               */
/* ------------------------------------------------------------------ */

async function groupsView(host, render) {
  const [{ data: groups }, { data: members }] = await Promise.all([
    supa.from("groups").select("*").order("archived").order("title"),
    supa.from("group_members").select("group_id, student_id, profiles(full_name, email)"),
  ]);
  const cards = (groups || [])
    .map((g) => {
      const list = (members || []).filter((m) => m.group_id === g.id);
      return `
      <div class="card t-group" data-id="${g.id}">
        <h3>${escapeHtml(g.title)} ${g.archived ? '<small class="muted">архив</small>' : ""}</h3>
        <p class="muted">${{ online: "онлайн", offline: "очно", mixed: "очно и онлайн" }[g.format]} · код для вступления: <code>${escapeHtml(g.invite_code || "")}</code></p>
        <p>${list.map((m) => `<a href="#/cabinet/student/${m.student_id}">${escapeHtml(m.profiles?.full_name || m.profiles?.email || "—")}</a>`).join(", ") || '<span class="muted">пусто</span>'}</p>
        <button class="btn secondary" data-act="archive">${g.archived ? "Вернуть из архива" : "В архив"}</button>
      </div>`;
    })
    .join("");
  render(`
    <h1>Группы</h1>
    <form id="t-group-form" class="card stack" style="padding:20px;max-width:560px">
      <label>Название<input name="title" required placeholder="ЕГЭ-2027, вторник 17:00" /></label>
      <label>Формат<select name="format"><option value="offline">очно</option><option value="online">онлайн</option><option value="mixed">очно и онлайн</option></select></label>
      <button class="btn" type="submit">Создать группу</button>
    </form>
    <p class="muted">Ученика можно добавить в группу при подтверждении заявки или дать ему код — он введёт его в личном кабинете.</p>
    <div class="t-groups">${cards || ""}</div>`);
  host.querySelector("#t-group-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await supa.from("groups").insert({ title: f.get("title"), format: f.get("format") });
    if (error) return alert(humanError(error).message);
    mountTeacher(document, ["groups"]);
  });
  host.querySelectorAll('[data-act="archive"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = btn.closest("[data-id]").dataset.id;
      const g = groups.find((x) => x.id === id);
      await supa.from("groups").update({ archived: !g.archived }).eq("id", id);
      mountTeacher(document, ["groups"]);
    })
  );
}

/* ------------------------------------------------------------------ */
/* Банк: поиск и список                                                 */
/* ------------------------------------------------------------------ */

function bankSubnav(active) {
  const items = [
    ["", "Все задания"],
    ["new", "Добавить одно"],
    ["batch", "Пакетом (текстом)"],
    ["table", "Таблицей (Excel, CSV)"],
    ["import", "Импорт банка сайта"],
  ];
  return `<div class="filter-bar">${items
    .map(([id, t]) => `<a class="pill ${active === id ? "active" : ""}" href="#/cabinet/bank${id ? "/" + id : ""}">${t}</a>`)
    .join("")}</div>`;
}

async function sourceAndBankSelects(prefix, { source = "ege-rus", bank = "" } = {}) {
  const files = await bankFiles(source);
  return `
    <label>Экзамен
      <select name="${prefix}source">${Object.entries(SOURCES)
        .map(([k, v]) => `<option value="${k}" ${k === source ? "selected" : ""}>${v.title}</option>`)
        .join("")}</select>
    </label>
    <label>Номер задания
      <select name="${prefix}bank">${files
        .map(
          (f) =>
            `<option value="${f.bank}" data-task="${f.task}" ${f.bank === bank ? "selected" : ""}>${f.kind === "extra" ? "доп. · " : `№ ${f.task} · `}${escapeHtml(f.title)}</option>`
        )
        .join("")}</select>
    </label>`;
}

function bindSourceSwitch(form, prefix, onChange) {
  const src = form.querySelector(`[name="${prefix}source"]`);
  const bank = form.querySelector(`[name="${prefix}bank"]`);
  src?.addEventListener("change", async () => {
    const files = await bankFiles(src.value);
    bank.innerHTML = files
      .map(
        (f) =>
          `<option value="${f.bank}" data-task="${f.task}">${f.kind === "extra" ? "доп. · " : `№ ${f.task} · `}${escapeHtml(f.title)}</option>`
      )
      .join("");
    onChange?.();
  });
  bank?.addEventListener("change", () => onChange?.());
}

async function bankView(host, render) {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  const source = q.get("source") || "ege-rus";
  const bank = q.get("bank") || "";
  const text = q.get("q") || "";
  const own = q.get("own") === "1";
  const page = Number(q.get("page") || 0);
  let query = supa
    .from("tasks")
    .select("id, source, bank_file, source_ref, task_no, topic, answer_mode, list_item, is_demo, is_published, is_own, updated_at", { count: "exact" })
    .eq("source", source)
    .order("bank_file")
    .order("position")
    .range(page * 50, page * 50 + 49);
  if (bank) query = query.eq("bank_file", bank);
  if (own) query = query.eq("is_own", true);
  if (text) query = /^\d+$/.test(text) ? query.eq("source_ref", text) : query.ilike("list_item->>questionText", `%${text}%`);
  const { data, count, error } = await query;
  if (error) throw humanError(error);
  const rows = (data || [])
    .map(
      (t) => `
    <tr data-id="${t.id}">
      <td><a href="${taskHref(t)}" target="_blank">${escapeHtml(t.source_ref)}</a>${t.is_own ? ' <span class="badge">своё</span>' : ""}</td>
      <td>${t.bank_file}</td>
      <td>${escapeHtml((t.list_item?.questionText || "").slice(0, 140))}<br><small class="muted">${escapeHtml(t.topic || "")} · ${escapeHtml(MODE_LABEL[t.answer_mode] || t.answer_mode)}</small></td>
      <td><label class="t-inline"><input type="checkbox" data-f="is_published" ${t.is_published ? "checked" : ""}/> ученикам</label>
          <label class="t-inline"><input type="checkbox" data-f="is_demo" ${t.is_demo ? "checked" : ""}/> демо</label></td>
      <td><a class="btn secondary" href="#/cabinet/bank/edit/${t.id}">Изменить</a></td>
    </tr>`
    )
    .join("");
  const pages = Math.ceil((count || 0) / 50);
  const link = (p) => {
    const n = new URLSearchParams(q);
    n.set("page", p);
    return `#/cabinet/bank?${n}`;
  };
  render(`
    <h1>Банк заданий</h1>
    ${bankSubnav("")}
    <form id="t-bank-filter" class="card t-filter">
      ${await sourceAndBankSelects("", { source, bank })}
      <label>Поиск<input name="q" value="${escapeHtml(text)}" placeholder="слова из условия или № задания" /></label>
      <label class="t-inline"><input type="checkbox" name="own" ${own ? "checked" : ""}/> только мои</label>
      <button class="btn" type="submit">Найти</button>
    </form>
    <p class="muted">Найдено: ${count ?? 0}. Галочка «ученикам» — задание видно ученикам; «демо» — видно всем гостям сайта.</p>
    <div class="t-table-wrap"><table class="t-table"><thead><tr><th>№</th><th>Раздел</th><th>Условие</th><th>Доступ</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="muted">Ничего не найдено. Если банк ещё не загружен — откройте «Импорт банка сайта».</td></tr>'}</tbody></table></div>
    ${pages > 1 ? `<p class="lit-pager">${page > 0 ? `<a href="${link(page - 1)}">← Назад</a>` : "<span></span>"}<span class="muted">стр. ${page + 1} из ${pages}</span>${page < pages - 1 ? `<a href="${link(page + 1)}">Дальше →</a>` : "<span></span>"}</p>` : ""}`);

  const form = host.querySelector("#t-bank-filter");
  const bankSel = form.querySelector('[name="bank"]');
  if (!bank) bankSel.insertAdjacentHTML("afterbegin", '<option value="" selected>все номера</option>');
  bindSourceSwitch(form, "", () => {
    if (!bankSel.querySelector('option[value=""]')) bankSel.insertAdjacentHTML("afterbegin", '<option value="">все номера</option>');
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const n = new URLSearchParams();
    n.set("source", f.get("source"));
    if (f.get("bank")) n.set("bank", f.get("bank"));
    if (f.get("q")) n.set("q", f.get("q"));
    if (f.get("own")) n.set("own", "1");
    location.hash = `#/cabinet/bank?${n}`;
  });
  host.querySelectorAll("tbody input[type=checkbox]").forEach((cb) =>
    cb.addEventListener("change", async () => {
      const id = cb.closest("tr").dataset.id;
      const { error: err } = await supa.from("tasks").update({ [cb.dataset.f]: cb.checked }).eq("id", id);
      if (err) {
        alert(humanError(err).message);
        cb.checked = !cb.checked;
      }
      clearBankCache();
    })
  );
}

/* ------------------------------------------------------------------ */
/* Одно задание: форма создания и редактирования                       */
/* ------------------------------------------------------------------ */

async function taskFormView(host, render, editId) {
  let t = null;
  if (editId) {
    const { data, error } = await supa.rpc("teacher_get_task", { p_task: Number(editId) });
    if (error) throw humanError(error);
    t = data;
    if (!t) return render(`<div class="empty">Задание не найдено.</div>`);
  }
  let passageHtml = "";
  if (t?.passage_id) {
    const { data } = await supa.from("passages").select("html").eq("id", t.passage_id).maybeSingle();
    passageHtml = data?.html || "";
  }
  const source = t?.source || "ege-rus";
  const files = await bankFiles(source);
  const bank = t?.bank_file || files[0]?.bank;
  const taskNo = t?.task_no || files.find((f) => f.bank === bank)?.task;
  const mode = t?.answer_mode || defaultMode(source, taskNo);
  const key = t?.key || {};
  const answerVal = key.answer ? String(key.answer) : "";
  const modeOpts = (src, m) => MODES[src].map(([k, v]) => `<option value="${k}" ${k === m ? "selected" : ""}>${v}</option>`).join("");

  render(`
    <h1>${t ? `Задание № ${escapeHtml(t.source_ref)}` : "Новое задание"}</h1>
    ${bankSubnav(t ? "" : "new")}
    <form id="t-task" class="stack card t-task-form">
      <div class="grid-2">${await sourceAndBankSelects("", { source, bank })}</div>
      <div class="grid-2">
        <label>Тема (для фильтра у учеников)<input name="topic" value="${escapeHtml(t?.topic || "")}" placeholder="Задания преподавателя" /></label>
        <label>Тип ответа<select name="mode">${modeOpts(source, mode)}</select></label>
      </div>
      <div class="grid-2" data-lit ${source === "ege-lit" ? "" : "hidden"}>
        <label>Автор<input name="author" value="${escapeHtml(t?.data?.author || "")}" /></label>
        <label>Произведение<input name="work" value="${escapeHtml(t?.data?.work || "")}" /></label>
      </div>
      <label>Текст / фрагмент (если задание по тексту)<textarea name="passage" rows="5" placeholder="Можно оставить пустым">${escapeHtml(passageHtml)}</textarea></label>
      <label>Условие задания <small class="muted">— абзацы через пустую строку, **жирный**, __подчеркнуть__; можно вставить HTML</small>
        <textarea name="question" rows="8" required>${escapeHtml(t?.data?.questionHtml || "")}</textarea></label>
      <label data-answer>Ответ <small class="muted">— несколько верных вариантов через | (например: 24 | 42 или жёлудь | желудь)</small>
        <input name="answer" value="${escapeHtml(answerVal)}" /></label>
      <label>Разбор / пояснение (ученик увидит после попытки)<textarea name="solution" rows="6">${escapeHtml(key.solution_html || "")}</textarea></label>
      <label>Заметка для себя (ученики не видят)<input name="notes" value="${escapeHtml(key.teacher_notes || "")}" /></label>
      <div class="actions">
        <label class="t-inline"><input type="checkbox" name="is_published" ${t ? (t.is_published ? "checked" : "") : "checked"} /> видно ученикам</label>
        <label class="t-inline"><input type="checkbox" name="is_demo" ${t?.is_demo ? "checked" : ""} /> демо для гостей</label>
      </div>
      <div class="actions">
        <button class="btn" type="submit">${t ? "Сохранить" : "Добавить задание"}</button>
        <button class="btn secondary" type="button" id="t-preview-btn">Предпросмотр</button>
        ${t ? `<button class="btn secondary" type="button" id="t-delete">Удалить</button>` : ""}
      </div>
      <p class="lit-result" id="t-status" aria-live="polite"></p>
    </form>
    <article class="lit-problem card" id="t-preview" hidden></article>`);

  const form = host.querySelector("#t-task");
  const modeSel = form.querySelector('[name="mode"]');
  const syncMode = () => {
    const src = form.querySelector('[name="source"]').value;
    const opt = form.querySelector('[name="bank"]').selectedOptions[0];
    const n = Number(opt?.dataset.task);
    if (!t) modeSel.innerHTML = modeOpts(src, defaultMode(src, n));
    form.querySelector("[data-lit]").hidden = src !== "ege-lit";
    form.querySelector("[data-answer]").hidden = CHECKED_BY_TEACHER.has(modeSel.value);
  };
  bindSourceSwitch(form, "", syncMode);
  modeSel.addEventListener("change", () => (form.querySelector("[data-answer]").hidden = CHECKED_BY_TEACHER.has(modeSel.value)));
  syncMode();

  const collect = () => {
    const f = new FormData(form);
    const opt = form.querySelector('[name="bank"]').selectedOptions[0];
    return {
      source: f.get("source"),
      bank: f.get("bank"),
      task_no: Number(opt?.dataset.task) || null,
      topic: String(f.get("topic") || "").trim(),
      mode: f.get("mode"),
      question: f.get("question"),
      passage: String(f.get("passage") || "").trim(),
      passage_key: t?.passage_id ? t.passage_id.split(":").slice(1).join(":") : null,
      answer: f.get("answer"),
      solution: f.get("solution"),
      notes: String(f.get("notes") || "").trim(),
      author: String(f.get("author") || "").trim(),
      work: String(f.get("work") || "").trim(),
      is_demo: Boolean(f.get("is_demo")),
      is_published: Boolean(f.get("is_published")),
      source_ref: t?.source_ref || null,
      position: t?.position,
    };
  };
  const status = form.querySelector("#t-status");
  host.querySelector("#t-preview-btn").addEventListener("click", () => {
    const v = collect();
    const box = host.querySelector("#t-preview");
    box.hidden = false;
    box.innerHTML = `
      <p class="eyebrow">Так увидит ученик</p>
      ${v.passage ? `<section class="lit-passage"><div class="lit-html">${textToHtml(v.passage)}</div></section>` : ""}
      <section class="lit-question"><div class="lit-html">${textToHtml(v.question)}</div></section>
      ${!CHECKED_BY_TEACHER.has(v.mode) ? `<p><strong>Ответ:</strong> ${escapeHtml(splitAlts(v.answer).join(" или "))}</p>` : "<p class=muted>Письменный ответ — проверяете вы.</p>"}
      ${v.solution ? `<details class="lit-solution" open><summary>Разбор</summary><div class="lit-html">${textToHtml(v.solution)}</div></details>` : ""}`;
    box.scrollIntoView({ behavior: "smooth" });
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = collect();
    const errs = validate(v);
    if (errs.length) {
      status.className = "lit-result is-bad";
      status.textContent = `Проверьте: ${errs.join(", ")}.`;
      return;
    }
    status.className = "lit-result";
    status.textContent = "Сохраняем…";
    try {
      const [res] = await saveTasks([buildTask(v)]);
      status.className = "lit-result is-ok";
      status.innerHTML = `Сохранено: задание № ${escapeHtml(res.source_ref)}. <a href="${taskHref({ source: v.source, bank_file: v.bank, task_no: v.task_no, source_ref: res.source_ref })}" target="_blank">Открыть как ученик</a> · <a href="#/cabinet/bank/new">Добавить ещё</a>`;
      if (!t) {
        form.querySelector('[name="question"]').value = "";
        form.querySelector('[name="answer"]').value = "";
        form.querySelector('[name="solution"]').value = "";
        form.querySelector('[name="notes"]').value = "";
      }
    } catch (err) {
      status.className = "lit-result is-bad";
      status.textContent = err.message;
    }
  });
  host.querySelector("#t-delete")?.addEventListener("click", async () => {
    if (!confirm("Удалить задание из банка? Вместе с ним удалятся ответы учеников на него. Это нельзя отменить.")) return;
    const { error } = await supa.from("tasks").delete().eq("id", t.id);
    if (error) return alert(humanError(error).message);
    clearBankCache();
    location.hash = "#/cabinet/bank";
  });
}

/* ------------------------------------------------------------------ */
/* Пакет текстом                                                        */
/* ------------------------------------------------------------------ */

const BATCH_EXAMPLE = `Номер: 16
Тема: Однородные члены и ССП
Укажите предложения, в которых нужно поставить ОДНУ запятую. Запишите номера этих предложений.
1) Он шёл быстро и уверенно.
2) Небо было ясным но холодным.
3) Ни солнце ни ветер не радовали нас.
4) Дети и взрослые и старики вышли на улицу.
Ответ: 23
Разбор: 2) одна запятая перед союзом НО; 3) повторяющийся союз НИ…НИ при двух однородных членах — одна запятая; 4) повторяющийся союз И — две запятые; 1) одиночный союз И — запятая не нужна.
===
Номер: 9
Укажите варианты ответов, в которых в обоих словах пропущена безударная проверяемая гласная корня.
1) к..сание, р..сток
2) в..да, л..сной
3) в..негрет, к..рман
Ответ: 2
Разбор: 2) вода — во́ды, лесной — лес. 1) чередование кас/кос, раст/рос; 3) словарные слова: винегрет, карман.`;

/** Разбор пакета: блоки через строку === (или ---). */
export function parseBatch(text, defaults) {
  return String(text || "")
    .split(/^\s*(?:={3,}|-{3,})\s*$/m)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((block) => {
      const f = { ...defaults, question: "", answer: "", solution: "", passage: "", notes: "" };
      let target = "question";
      const buf = { question: [], solution: [], passage: [], notes: [] };
      block.split("\n").forEach((line) => {
        const m = line.match(/^\s*(Номер|Тема|Тип|Текст|Задание|Условие|Ответ|Разбор|Пояснение|Заметка|Автор|Произведение|Демо)\s*:\s*(.*)$/i);
        if (!m) {
          buf[target]?.push(line);
          return;
        }
        const k = m[1].toLowerCase();
        const v = m[2];
        if (k === "номер") f.task_no = Number(v) || f.task_no;
        else if (k === "тема") f.topic = v.trim();
        else if (k === "тип") f.mode = v.trim();
        else if (k === "автор") f.author = v.trim();
        else if (k === "произведение") f.work = v.trim();
        else if (k === "демо") f.is_demo = /^(да|1|yes|true)/i.test(v);
        else if (k === "ответ") f.answer = v.trim();
        else if (k === "текст") (target = "passage"), v && buf.passage.push(v);
        else if (k === "задание" || k === "условие") (target = "question"), v && buf.question.push(v);
        else if (k === "разбор" || k === "пояснение") (target = "solution"), v && buf.solution.push(v);
        else if (k === "заметка") (target = "notes"), v && buf.notes.push(v);
      });
      f.question = buf.question.join("\n").trim();
      f.solution = buf.solution.join("\n").trim();
      f.passage = buf.passage.join("\n").trim();
      f.notes = buf.notes.join("\n").trim();
      return f;
    });
}

async function resolveBanks(items, source) {
  const files = await bankFiles(source);
  return items.map((it) => {
    const file = files.find((x) => x.kind !== "extra" && x.task === Number(it.task_no)) || files.find((x) => x.bank === it.bank);
    const out = { ...it, source, bank: file?.bank || it.bank, task_no: file?.task || it.task_no };
    const valid = new Set(MODES[source].map(([k]) => k));
    if (!valid.has(out.mode)) out.mode = defaultMode(source, out.task_no);
    out.errors = [...validate(out), ...(file ? [] : ["нет такого номера"])];
    return out;
  });
}

function previewTable(items) {
  return `
    <div class="t-table-wrap"><table class="t-table">
      <thead><tr><th>#</th><th>Номер</th><th>Условие</th><th>Ответ</th><th>Тип</th><th>Разбор</th><th></th></tr></thead>
      <tbody>${items
        .map(
          (it, i) => `
        <tr class="${it.errors.length ? "t-bad" : ""}">
          <td>${i + 1}</td><td>${it.task_no ?? "?"}</td>
          <td>${escapeHtml(htmlToText(textToHtml(it.question)).slice(0, 160))}</td>
          <td>${escapeHtml(it.answer || "")}</td>
          <td><small>${escapeHtml(MODE_LABEL[it.mode] || it.mode)}</small></td>
          <td>${it.solution ? "есть" : '<span class="muted">нет</span>'}</td>
          <td>${it.errors.length ? `<strong>${escapeHtml(it.errors.join(", "))}</strong>` : "✓"}</td>
        </tr>`
        )
        .join("")}</tbody></table></div>`;
}

async function batchView(host, render) {
  render(`
    <h1>Добавить пакетом</h1>
    ${bankSubnav("batch")}
    <form id="t-batch" class="stack card t-task-form">
      <p>Вставьте задания текстом. Каждое задание отделяйте строкой <code>===</code>. Внутри — служебные строки
      <code>Номер:</code>, <code>Тема:</code>, <code>Текст:</code> (фрагмент), <code>Ответ:</code> (варианты через |), <code>Разбор:</code>, <code>Заметка:</code>, <code>Демо: да</code>.
      Всё, что не помечено, — условие. Номер можно не писать, если все задания одного номера.</p>
      <div class="grid-2">${await sourceAndBankSelects("")}</div>
      <label class="t-inline"><input type="checkbox" name="is_published" checked /> сразу видно ученикам</label>
      <textarea name="text" rows="16" class="t-mono" placeholder="${escapeHtml(BATCH_EXAMPLE)}"></textarea>
      <div class="actions">
        <button class="btn secondary" type="button" id="t-batch-preview">Проверить</button>
        <button class="btn" type="submit" id="t-batch-save" disabled>Добавить</button>
        <button class="btn secondary" type="button" id="t-batch-example">Вставить пример</button>
      </div>
      <p class="lit-result" id="t-status"></p>
    </form>
    <div id="t-batch-out"></div>`);
  const form = host.querySelector("#t-batch");
  bindSourceSwitch(form, "");
  let parsed = [];
  const check = async () => {
    const f = new FormData(form);
    const opt = form.querySelector('[name="bank"]').selectedOptions[0];
    const source = f.get("source");
    parsed = await resolveBanks(
      parseBatch(f.get("text"), {
        source,
        bank: f.get("bank"),
        task_no: Number(opt?.dataset.task),
        mode: "",
        is_published: Boolean(f.get("is_published")),
      }),
      source
    );
    const ok = parsed.filter((p) => !p.errors.length).length;
    host.querySelector("#t-batch-out").innerHTML = parsed.length ? previewTable(parsed) : "";
    const save = form.querySelector("#t-batch-save");
    save.disabled = !ok;
    save.textContent = ok ? `Добавить ${ok}` : "Добавить";
    form.querySelector("#t-status").textContent = parsed.length
      ? `Распознано заданий: ${parsed.length}, готово к добавлению: ${ok}${ok < parsed.length ? " (с ошибками будут пропущены)" : ""}.`
      : "Не нашёл ни одного задания.";
  };
  form.querySelector("#t-batch-preview").addEventListener("click", check);
  form.querySelector("#t-batch-example").addEventListener("click", () => {
    form.querySelector('[name="text"]').value = BATCH_EXAMPLE;
    check();
  });
  form.querySelector('[name="text"]').addEventListener("input", () => (form.querySelector("#t-batch-save").disabled = true));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await check();
    const good = parsed.filter((p) => !p.errors.length);
    if (!good.length) return;
    const st = form.querySelector("#t-status");
    st.textContent = "Сохраняем…";
    try {
      const res = await saveTasks(good.map(buildTask));
      st.className = "lit-result is-ok";
      st.innerHTML = `Добавлено заданий: ${res.length} (№ ${res.map((r) => escapeHtml(r.source_ref)).join(", ")}). <a href="#/cabinet/bank?own=1&source=${good[0].source}">Посмотреть в банке</a>`;
      form.querySelector('[name="text"]').value = "";
      form.querySelector("#t-batch-save").disabled = true;
    } catch (err) {
      st.className = "lit-result is-bad";
      st.textContent = err.message;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Таблица: вставка из Excel / Google Таблиц или файл CSV              */
/* ------------------------------------------------------------------ */

function parseDelimited(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n");
  const first = src.split("\n")[0] || "";
  const delim = first.includes("\t") ? "\t" : first.split(";").length > first.split(",").length ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') (cell += '"'), (i += 1);
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) row.push(cell), (cell = "");
    else if (ch === "\n") row.push(cell), rows.push(row), (row = []), (cell = "");
    else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

const COLS = {
  task_no: /^(номер|№|задание №|task)/i,
  topic: /^(тема|topic)/i,
  passage: /^(текст|фрагмент|passage)/i,
  question: /^(условие|задание|вопрос|question)/i,
  answer: /^(ответ|answer)/i,
  solution: /^(разбор|пояснение|решение|solution)/i,
  mode: /^(тип|mode)/i,
  notes: /^(заметка|notes)/i,
  author: /^(автор)/i,
  work: /^(произведение)/i,
  is_demo: /^(демо|demo)/i,
};

async function tableView(host, render) {
  render(`
    <h1>Добавить таблицей</h1>
    ${bankSubnav("table")}
    <form id="t-table" class="stack card t-task-form">
      <p>Скопируйте строки из Excel или Google Таблиц (вместе с заголовками) и вставьте сюда — или загрузите файл CSV.
      Распознаются столбцы: <b>Номер, Тема, Текст, Условие, Ответ, Разбор, Тип, Заметка, Автор, Произведение, Демо</b>. Обязательны «Условие» и (для автопроверки) «Ответ».</p>
      <div class="grid-2">${await sourceAndBankSelects("")}</div>
      <label class="t-inline"><input type="checkbox" name="is_published" checked /> сразу видно ученикам</label>
      <label class="btn secondary pr-file-btn">Загрузить CSV<input type="file" id="t-csv" accept=".csv,.tsv,.txt,text/csv" hidden /></label>
      <textarea name="text" rows="12" class="t-mono" placeholder="Номер	Условие	Ответ	Разбор"></textarea>
      <div class="actions">
        <button class="btn secondary" type="button" id="t-table-preview">Проверить</button>
        <button class="btn" type="submit" id="t-table-save" disabled>Добавить</button>
      </div>
      <p class="lit-result" id="t-status"></p>
    </form>
    <div id="t-table-out"></div>`);
  const form = host.querySelector("#t-table");
  bindSourceSwitch(form, "");
  let parsed = [];
  const check = async () => {
    const f = new FormData(form);
    const opt = form.querySelector('[name="bank"]').selectedOptions[0];
    const rows = parseDelimited(f.get("text"));
    const st = form.querySelector("#t-status");
    if (rows.length < 2) {
      st.textContent = "Нужна строка заголовков и хотя бы одна строка с заданием.";
      return;
    }
    const head = rows[0].map((h) => h.trim());
    const map = {};
    head.forEach((h, i) => {
      const k = Object.keys(COLS).find((key) => COLS[key].test(h));
      if (k && map[k] === undefined) map[k] = i;
    });
    if (map.question === undefined) {
      st.textContent = `Не нашёл столбец «Условие». Заголовки: ${head.join(", ")}`;
      return;
    }
    const source = f.get("source");
    const items = rows.slice(1).map((r) => {
      const get = (k) => (map[k] !== undefined ? String(r[map[k]] || "").trim() : "");
      return {
        source,
        bank: f.get("bank"),
        task_no: Number(get("task_no")) || Number(opt?.dataset.task),
        topic: get("topic"),
        passage: get("passage"),
        question: get("question"),
        answer: get("answer"),
        solution: get("solution"),
        mode: get("mode"),
        notes: get("notes"),
        author: get("author"),
        work: get("work"),
        is_demo: /^(да|1|yes|true)/i.test(get("is_demo")),
        is_published: Boolean(f.get("is_published")),
      };
    });
    parsed = await resolveBanks(items, source);
    const ok = parsed.filter((p) => !p.errors.length).length;
    host.querySelector("#t-table-out").innerHTML = previewTable(parsed);
    const save = form.querySelector("#t-table-save");
    save.disabled = !ok;
    save.textContent = ok ? `Добавить ${ok}` : "Добавить";
    st.className = "lit-result";
    st.textContent = `Строк: ${parsed.length}, готово к добавлению: ${ok}.`;
  };
  form.querySelector("#t-csv").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    form.querySelector('[name="text"]').value = await file.text();
    check();
  });
  form.querySelector("#t-table-preview").addEventListener("click", check);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await check();
    const good = parsed.filter((p) => !p.errors.length);
    if (!good.length) return;
    const st = form.querySelector("#t-status");
    st.textContent = "Сохраняем…";
    try {
      const res = await saveTasks(good.map(buildTask));
      st.className = "lit-result is-ok";
      st.innerHTML = `Добавлено: ${res.length}. <a href="#/cabinet/bank?own=1&source=${good[0].source}">Посмотреть в банке</a>`;
      form.querySelector("#t-table-save").disabled = true;
    } catch (err) {
      st.className = "lit-result is-bad";
      st.textContent = err.message;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Импорт текущего банка сайта (JSON-файлы) в базу                     */
/* ------------------------------------------------------------------ */

const KEY_FIELDS = ["answer", "answerNorm", "answerNumbers", "answerAlts", "solutionHtml", "solutionText"];
const DEMO_PER_FILE = 3;

function strip(problem) {
  const data = { ...problem };
  KEY_FIELDS.forEach((k) => delete data[k]);
  return data;
}

function keyOf(p) {
  return {
    answer: p.answer ?? null,
    answer_norm: p.answerNorm ?? null,
    answer_alts: Array.isArray(p.answerAlts) ? p.answerAlts.map(String) : [],
    answer_numbers: Array.isArray(p.answerNumbers) ? p.answerNumbers : null,
    solution_html: p.solutionHtml ?? null,
  };
}

const LIT_MODE = { short: "lit-short", match: "lit-match", open: "open", essay: "essay" };

async function getJson(path) {
  const url = new URL(path, new URL(BASE, location.href));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const n = i++;
        out[n] = await fn(items[n], n);
      }
    })
  );
  return out;
}

async function importRus(source, log) {
  const dir = SOURCES[source].dir;
  const files = await bankFiles(source);
  let total = 0;
  for (const file of files) {
    const [list, order] = await Promise.all([
      getJson(`${dir}/bank/${file.bank}.list.json`),
      getJson(`${dir}/bank/${file.bank}.order.json`),
    ]);
    const listById = new Map((list.problems || []).map((p) => [String(p.id), p]));
    const pos = new Map(order.map((id, i) => [String(id), i]));
    const nn = String(file.task).padStart(2, "0");
    const problems = await pool(order, 12, (id) => getJson(`${dir}/problems/${nn}/${id}.json`));
    const passageIds = [...new Set(problems.map((p) => p.passageId).filter(Boolean))];
    const passages = await pool(passageIds, 12, (id) => getJson(`${dir}/passages/${id}.json`).then((p) => ({ id, p })));
    if (passages.length) {
      for (let i = 0; i < passages.length; i += 50) {
        const items = passages.slice(i, i + 50).map(({ id, p }) => {
          const rest = { ...p };
          delete rest.html;
          return { id: `${source}:${id}`, html: p.html || "", data: rest };
        });
        const { error } = await supa.rpc("teacher_upsert_passages", { items });
        if (error) throw humanError(error);
      }
    }
    const tasks = problems.map((p) => {
      const li = listById.get(String(p.id)) || {};
      const position = pos.get(String(p.id)) ?? 0;
      return {
        source,
        bank_file: file.bank,
        source_ref: String(p.id),
        position,
        task_no: file.task,
        topic: li.topic || null,
        topic_id: li.topicId ?? null,
        answer_mode: p.answerMode || "word",
        list_item: li,
        data: strip(p),
        passage_id: p.passageId ? `${source}:${p.passageId}` : null,
        is_demo: position < DEMO_PER_FILE,
        is_published: true,
        is_own: false,
        key: keyOf(p),
      };
    });
    for (let i = 0; i < tasks.length; i += 100) {
      const { error } = await supa.rpc("teacher_upsert_tasks", { items: tasks.slice(i, i + 100) });
      if (error) throw humanError(error);
    }
    total += tasks.length;
    log(`${SOURCES[source].title}, № ${file.task}: ${tasks.length} заданий, ${passages.length} текстов`);
  }
  return total;
}

async function importLit(log) {
  const source = "ege-lit";
  const files = await bankFiles(source);
  let total = 0;
  for (const file of files) {
    const [bank, list] = await Promise.all([
      getJson(`js/literature-data/bank/${file.bank}.json`),
      getJson(`js/literature-data/bank/${file.bank}.list.json`).catch(() => ({ problems: [] })),
    ]);
    const listById = new Map((list.problems || []).map((p) => [String(p.id), p]));
    const passages = Object.entries(bank.passages || {}).map(([id, p]) => {
      const rest = { ...p };
      delete rest.html;
      return { id: `${source}:${id}`, html: p.html || "", data: rest };
    });
    for (let i = 0; i < passages.length; i += 50) {
      const { error } = await supa.rpc("teacher_upsert_passages", { items: passages.slice(i, i + 50) });
      if (error) throw humanError(error);
    }
    const tasks = (bank.problems || []).map((p, position) => {
      const li = listById.get(String(p.id)) || {
        id: p.id,
        topic: p.topic,
        topicId: p.topicId,
        questionText: p.questionText,
        answerKind: p.answerKind,
        author: p.author,
        work: p.work,
        typeLabel: p.typeLabel,
      };
      return {
        source,
        bank_file: file.bank,
        source_ref: String(p.id),
        position,
        task_no: p.task ?? file.task,
        topic: p.topic || null,
        topic_id: p.topicId ?? null,
        answer_mode: LIT_MODE[p.answerKind] || "open",
        list_item: li,
        data: strip(p),
        passage_id: p.passageId ? `${source}:${p.passageId}` : null,
        is_demo: file.kind === "ege" && position < DEMO_PER_FILE,
        is_published: true,
        is_own: false,
        key: keyOf(p),
      };
    });
    for (let i = 0; i < tasks.length; i += 50) {
      const { error } = await supa.rpc("teacher_upsert_tasks", { items: tasks.slice(i, i + 50) });
      if (error) throw humanError(error);
    }
    total += tasks.length;
    log(`Литература, ${file.kind === "extra" ? "доп." : "№ " + file.task} (${file.bank}): ${tasks.length} заданий, ${passages.length} текстов`);
  }
  return total;
}

async function importView(host, render) {
  const { count } = await supa.from("tasks").select("id", { count: "exact", head: true }).eq("is_own", false);
  render(`
    <h1>Импорт банка сайта</h1>
    ${bankSubnav("import")}
    <div class="card stack t-task-form">
      <p>Переносит задания из JSON-файлов сайта (ЕГЭ, ОГЭ и ВПР по русскому, литература) в базу. Ответы и разборы попадают в закрытую таблицу.
      Первые ${DEMO_PER_FILE} задания каждого номера отмечаются как демо для гостей — это можно поменять в банке.</p>
      <p>Сейчас в базе импортированных заданий: <strong>${count ?? 0}</strong>. Повторный импорт безопасен: задания обновятся, ваши авторские не тронутся.</p>
      <p class="muted">Импорт работает там, где лежат файлы банка (локальная копия сайта). Займёт несколько минут — не закрывайте вкладку.</p>
      <div class="actions">
        <label class="t-inline"><input type="checkbox" name="s" value="ege-rus" checked /> ЕГЭ · русский</label>
        <label class="t-inline"><input type="checkbox" name="s" value="oge-rus" checked /> ОГЭ · русский</label>
        <label class="t-inline"><input type="checkbox" name="s" value="vpr-rus" checked /> ВПР · русский, 8 кл.</label>
        <label class="t-inline"><input type="checkbox" name="s" value="ege-lit" checked /> Литература</label>
      </div>
      <button class="btn" id="t-import">Начать импорт</button>
      <pre id="t-import-log" class="t-log"></pre>
    </div>`);
  const btn = host.querySelector("#t-import");
  const logEl = host.querySelector("#t-import-log");
  const log = (t) => {
    logEl.textContent += `${t}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  };
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const chosen = [...host.querySelectorAll('input[name="s"]:checked')].map((x) => x.value);
    const started = Date.now();
    let total = 0;
    try {
      for (const s of chosen) total += s === "ege-lit" ? await importLit(log) : await importRus(s, log);
      log(`Готово: ${total} заданий за ${Math.round((Date.now() - started) / 1000)} с.`);
      window.__importDone = { ok: true, total };
    } catch (err) {
      log(`Ошибка: ${err.message}`);
      window.__importDone = { ok: false, error: err.message };
    } finally {
      clearBankCache();
      btn.disabled = false;
    }
  });
}
