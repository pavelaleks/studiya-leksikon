/**
 * Занятия.
 *  Преподаватель: #/cabinet/lessons — список и создание; #/cabinet/lesson/:id — конструктор и живая таблица.
 *  Ученик: #/lesson/:id — задания урока; #/lesson/:id/:item — одно задание с проверкой по правилам урока.
 */
import { BASE } from "./config.js";
import { escapeHtml } from "./ui.js";
import { taskHref } from "./account.js?v=land151";
import { bindCheck, bindWritten, checkBlockHtml, writtenBlockHtml } from "./practice.js?v=land151";
import { SOURCES, bankFiles } from "./teacher.js?v=land151";
import { currentUser, humanError, showSolution, supa } from "./supa.js";
import { nextLessonFor } from "./calendar.js?v=land151";
import {
  EXAMS, alternativeTask, bindIntro, bindTimer, composeVariant, durationText, examState, finishExam, introHtml, resultsHtml, timerHtml,
} from "./exams.js?v=land151";

export const KIND = { classwork: "в классе", homework: "домашнее", test: "контрольная" };
export const REVEAL = {
  after_attempt: "после первой попытки",
  after_correct: "после верного ответа или конца попыток",
  after_due: "после срока сдачи",
  after_review: "после моей проверки (письменные)",
  manual: "когда я открою",
};
const LESSON_STATUS = { draft: "черновик — ученики не видят", live: "открыто ученикам", done: "завершено" };
const TEACHER_CHECKED = new Set(["open", "essay"]);
const MODE_LABEL = {
  "digits-any": "Номера в любом порядке",
  "digits-fixed": "Цифры по порядку",
  numbers: "Номера в любом порядке",
  word: "Краткий ответ",
  "lit-short": "Краткий ответ",
  "lit-match": "Соответствие: цифры по порядку",
  open: "Развёрнутый ответ",
  essay: "Сочинение",
};

const fmtDT = (d) => (d ? new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "");
const toLocalInput = (d) => {
  if (!d) return "";
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
const shortSource = (s) => ({ "ege-rus": "ЕГЭ", "oge-rus": "ОГЭ", "vpr-rus": "ВПР", "ege-lit": "Лит." }[s] || s);

function snippet(task, n = 110) {
  const t = String(task?.list_item?.questionText || task?.data?.questionText || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/* ------------------------------------------------------------------ */
/* Безопасный HTML задания (как в разделах ЕГЭ/ОГЭ/литература)          */
/* ------------------------------------------------------------------ */

const ALLOWED = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "sub", "sup", "table", "thead", "tbody", "tr", "td", "th",
  "ul", "ol", "li", "blockquote", "nobr", "div", "span", "center", "h3", "h4", "a", "img", "details", "summary",
]);
const KEEP_CLASS = new Set([
  "left_margin", "rus_single", "rus_double", "rus_dashed", "rus_wave", "rus_dotteddash", "rus_notes",
  "rus_example", "prefix", "wrap_flex_table", "wrap_flex_table_col", "col_name", "col_content", "sup_cont",
  "sup_word", "mark", "lit-right",
]);

export function sanitizeFor(source) {
  const dir = SOURCES[source]?.dir || "js/russian-data";
  return (html) => {
    const doc = new DOMParser().parseFromString(`<div>${String(html || "").replace(/&nbsp;?/gi, " ")}</div>`, "text/html");
    const root = doc.body.firstElementChild;
    if (!root) return "";
    [...root.querySelectorAll("*")].reverse().forEach((node) => {
      if (!node.parentNode) return;
      const tag = node.tagName.toLowerCase();
      if (!ALLOWED.has(tag)) {
        node.replaceWith(...node.childNodes);
        return;
      }
      [...node.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name === "class") {
          const keep = attr.value.split(/\s+/).filter((c) => KEEP_CLASS.has(c));
          if (keep.length) node.setAttribute("class", keep.join(" "));
          else node.removeAttribute("class");
          return;
        }
        if (name === "style" && /^color:\s*#?[0-9a-f]{3,8}$/i.test(attr.value.trim())) return;
        if ((name === "colspan" || name === "rowspan") && (tag === "td" || tag === "th")) return;
        if ((name === "alt" || name === "src") && tag === "img") return;
        if (name === "href" && tag === "a" && /^https?:/i.test(attr.value)) return;
        node.removeAttribute(attr.name);
      });
      if (tag === "a" && node.getAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      if (tag === "img") {
        const src = String(node.getAttribute("src") || "").replace(/^\.?\//, "");
        if (src.startsWith("media/")) node.setAttribute("src", new URL(`${dir}/${src}`, new URL(BASE, location.href)).href);
        else if (!/^https?:/i.test(src)) node.remove();
      }
    });
    return root.innerHTML;
  };
}

/* ================================================================== */
/* ПРЕПОДАВАТЕЛЬ                                                        */
/* ================================================================== */

export const WORK_KIND = { lesson: "Занятие", written: "Письменная работа", test: "Контрольная работа", exam: "Пробный экзамен" };

/** Типы письменных работ: какой номер экзамена и как назвать работу, чтобы ученик сразу понял, что пишет. */
export const WRITTEN_TYPES = {
  "ege-rus-27": { source: "ege-rus", no: 27, title: "Сочинение ЕГЭ (задание 27)", group: "Русский язык · ЕГЭ" },
  "oge-rus-13.1": { source: "oge-rus", no: 13, title: "Сочинение ОГЭ 13.1", group: "Русский язык · ОГЭ", note: "Пиши сочинение 13.1 — из трёх вариантов в условии выбери первый." },
  "oge-rus-13.2": { source: "oge-rus", no: 13, title: "Сочинение ОГЭ 13.2", group: "Русский язык · ОГЭ", note: "Пиши сочинение 13.2 — из трёх вариантов в условии выбери второй." },
  "oge-rus-13.3": { source: "oge-rus", no: 13, title: "Сочинение ОГЭ 13.3", group: "Русский язык · ОГЭ", note: "Пиши сочинение 13.3 — из трёх вариантов в условии выбери третий." },
  "oge-rus-13": { source: "oge-rus", no: 13, title: "Сочинение ОГЭ (13.1, 13.2 или 13.3 на выбор)", group: "Русский язык · ОГЭ", note: "Выбери одно из трёх заданий (13.1, 13.2 или 13.3) и напиши номер в начале сочинения." },
  "oge-rus-1": { source: "oge-rus", no: 1, title: "Изложение ОГЭ (задание 1)", group: "Русский язык · ОГЭ" },
  "ege-lit-4": { source: "ege-lit", no: 4, title: "Литература, задание 4: развёрнутый ответ по прозе или драме", group: "Литература · ЕГЭ" },
  "ege-lit-5": { source: "ege-lit", no: 5, title: "Литература, задание 5: сопоставление (проза, драма)", group: "Литература · ЕГЭ" },
  "ege-lit-9": { source: "ege-lit", no: 9, title: "Литература, задание 9: развёрнутый ответ по лирике", group: "Литература · ЕГЭ" },
  "ege-lit-10": { source: "ege-lit", no: 10, title: "Литература, задание 10: сопоставление стихотворений", group: "Литература · ЕГЭ" },
  "ege-lit-11": { source: "ege-lit", no: 11, title: "Сочинение по литературе (задание 11)", group: "Литература · ЕГЭ" },
};

function writtenTypeOptions() {
  const groups = [...new Set(Object.values(WRITTEN_TYPES).map((t) => t.group))];
  return groups
    .map(
      (g) =>
        `<optgroup label="${escapeHtml(g)}">${Object.entries(WRITTEN_TYPES)
          .filter(([, t]) => t.group === g)
          .map(([k, t]) => `<option value="${k}">${escapeHtml(t.title)}</option>`)
          .join("")}</optgroup>`
    )
    .join("");
}

/** Задание для письменной работы: из банка, только такое, которое эти ученики (группа) ещё не отрабатывали. */
async function pickWrittenTask(source, no, roster = [], exclude = [], groupId = null) {
  const ex = EXAMS[source];
  let q = supa.from("tasks").select("id, answer_mode, passage_id").eq("source", source).eq("task_no", no).eq("is_published", true).limit(1000);
  if (ex) q = q.eq("bank_file", ex.bank(no));
  const { data, error } = await q;
  if (error) throw humanError(error);
  const used = await writtenUsed(roster, groupId, source, no);
  const pool = (data || []).filter((t) => !exclude.includes(t.id) && !used.has(t));
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

/** Все задания этого типа в банке (кратко) — для выбора текста вручную. */
const writtenPoolCache = new Map();
async function writtenPool(source, no) {
  const key = `${source}:${no}`;
  if (writtenPoolCache.has(key)) return writtenPoolCache.get(key);
  const ex = EXAMS[source];
  let q = supa
    .from("tasks")
    .select("id, source, task_no, source_ref, passage_id, answer_mode, q:data->>questionText, work:data->>work, author:data->>author")
    .eq("source", source)
    .eq("task_no", no)
    .eq("is_published", true)
    .order("id")
    .limit(1000);
  if (ex) q = q.eq("bank_file", ex.bank(no));
  const { data, error } = await q;
  if (error) throw humanError(error);
  writtenPoolCache.set(key, data || []);
  return data || [];
}

const chunks = (arr, n = 200) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * Тексты, которые эти ученики (или группа) уже отработали: писали по ним работу (по тому же тексту
 * и тому же номеру задания) или получали это задание в каком-либо занятии. Такие тексты больше не предлагаются.
 * Возвращает { has(task) }.
 */
async function writtenUsed(roster, groupId, source, no) {
  const ids = new Set();
  const passages = new Set();
  const lessonIds = new Set();
  if (roster.length) {
    const [{ data: works }, { data: gm }, { data: own }, { data: la }] = await Promise.all([
      supa.from("written_works").select("task_id, tasks(source, task_no, passage_id)").in("student_id", roster).limit(5000),
      supa.from("group_members").select("group_id").in("student_id", roster),
      supa.from("lessons").select("id").in("student_id", roster),
      supa.from("lesson_assignees").select("lesson_id").in("student_id", roster),
    ]);
    (works || []).forEach((w) => {
      if (!w.task_id) return;
      ids.add(w.task_id);
      if (w.tasks?.source === source && w.tasks?.task_no === no && w.tasks?.passage_id) passages.add(w.tasks.passage_id);
    });
    (own || []).forEach((l) => lessonIds.add(l.id));
    (la || []).forEach((l) => lessonIds.add(l.lesson_id));
    const groups = new Set((gm || []).map((g) => g.group_id));
    if (groupId) groups.add(groupId);
    if (groups.size) {
      const { data: gl } = await supa.from("lessons").select("id").in("group_id", [...groups]);
      (gl || []).forEach((l) => lessonIds.add(l.id));
    }
  } else if (groupId) {
    const { data: gl } = await supa.from("lessons").select("id").eq("group_id", groupId);
    (gl || []).forEach((l) => lessonIds.add(l.id));
  }
  for (const part of chunks([...lessonIds])) {
    const { data: its } = await supa.from("lesson_items").select("task_id, tasks(source, task_no, passage_id)").in("lesson_id", part);
    (its || []).forEach((i) => {
      if (i.tasks?.source !== source || i.tasks?.task_no !== no) return;
      ids.add(i.task_id);
      if (i.tasks.passage_id) passages.add(i.tasks.passage_id);
    });
  }
  return { has: (t) => ids.has(t.id) || Boolean(t.passage_id && passages.has(t.passage_id)) };
}

const plain = (html) => {
  const d = document.createElement("div");
  d.innerHTML = String(html || "");
  return (d.textContent || "").replace(/\s+/g, " ").trim();
};
const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Суть задания без общей инструкции: темы сочинений (1–5), нужное задание 13.x или проблема текста. */
function gist(qText, typeKey = "") {
  const lines = String(qText || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const oge = lines.filter((l) => /^13\.[123]\b/.test(l));
  if (oge.length) {
    const want = (typeKey.match(/13\.([123])$/) || [])[1];
    const pick = want ? oge.filter((l) => l.startsWith(`13.${want}`)) : oge;
    return (pick.length ? pick : oge).map((l) => cut(l, 220)).join(" · ");
  }
  const topics = lines.filter((l) => /^[1-5]\.\s/.test(l));
  if (topics.length >= 2) return topics.map((l) => cut(l, 140)).join(" · ");
  return lines.join(" ");
}

/** Карточка выбранного текста: начало текста, задание, полный текст — по кнопке. */
async function writtenPreviewHtml(t, seen, typeKey = "") {
  let passage = "";
  if (t.passage_id) {
    const { data } = await supa.from("passages").select("html").eq("id", t.passage_id).maybeSingle();
    passage = data?.html || "";
  }
  const { data: full } = await supa.from("tasks").select("data").eq("id", t.id).maybeSingle();
  const sanitize = sanitizeFor(t.source);
  const q = full?.data?.questionHtml || "";
  const qGist = gist(full?.data?.questionText || plain(q) || t.q || "", typeKey);
  return `
    <p class="l-wpick-head"><strong>№ ${escapeHtml(String(t.source_ref))}</strong>${t.work ? ` · «${escapeHtml(t.work)}»${t.author ? `, ${escapeHtml(t.author)}` : ""}` : ""}
      ${seen ? '<span class="badge">уже отрабатывали — выбрано вручную</span>' : '<span class="chip">ещё не отрабатывали</span>'}</p>
    ${passage ? `<p class="muted l-wpick-text">${escapeHtml(cut(plain(passage), 360))}</p>` : ""}
    <p class="l-wpick-q">${escapeHtml(cut(qGist, 700))}</p>
    <details><summary>Показать ${passage ? "текст и задание" : "задание"} полностью</summary>
      ${passage ? `<div class="lit-html l-wpick-full">${sanitize(passage)}</div>` : ""}
      <div class="lit-html">${sanitize(q)}</div>
    </details>`;
}

/** Быстрые сроки: «к концу занятия», «завтра», «через 3 дня», «через неделю» (вечер — 20:00). */
const DUE_PRESETS = [
  ["end", "к концу занятия"],
  ["1", "завтра"],
  ["3", "через 3 дня"],
  ["7", "через неделю"],
];
function dueFromPreset(key) {
  const d = new Date();
  if (key === "end") return new Date(d.getTime() + 90 * 60000);
  d.setDate(d.getDate() + Number(key));
  d.setHours(20, 0, 0, 0);
  return d;
}
function duePresetsHtml() {
  return `<span class="l-due-presets"><span data-due-next></span>${DUE_PRESETS.map(([k, v]) => `<button type="button" class="chip-btn" data-due="${k}">${v}</button>`).join("")}</span>`;
}
function bindDuePresets(form, input) {
  form.querySelectorAll("[data-due]").forEach((b) =>
    b.addEventListener("click", () => {
      input.value = toLocalInput(dueFromPreset(b.dataset.due));
      form.querySelectorAll("[data-due]").forEach((x) => x.classList.toggle("is-on", x === b));
    })
  );
}
const SHOW_RESULTS = { after_finish: "сразу после сдачи", manual: "когда я открою" };

function targetPickerHtml(groups, students, { groupId = "", picked = new Set() } = {}) {
  return `
    <label>Группа<select name="group_id"><option value="">— без группы —</option>${(groups || [])
      .map((g) => `<option value="${g.id}" ${g.id === groupId ? "selected" : ""}>${escapeHtml(g.title)}</option>`)
      .join("")}</select></label>
    <details class="l-pick" ${picked.size ? "open" : ""}>
      <summary>Отдельные ученики <span class="muted" data-pick-count>${picked.size ? `· выбрано ${picked.size}` : "(можно вместе с группой)"}</span></summary>
      <div class="l-pick-list">${(students || [])
        .map(
          (s) => `<label class="t-inline"><input type="checkbox" name="student" value="${s.id}" ${picked.has(s.id) ? "checked" : ""}/> ${escapeHtml(s.full_name || s.email)}</label>`
        )
        .join("") || '<span class="muted">Нет подтверждённых учеников.</span>'}</div>
    </details>`;
}

function bindPicker(form) {
  const count = form.querySelector("[data-pick-count]");
  form.querySelectorAll('input[name="student"]').forEach((cb) =>
    cb.addEventListener("change", () => {
      const n = form.querySelectorAll('input[name="student"]:checked').length;
      if (count) count.textContent = n ? `· выбрано ${n}` : "(можно вместе с группой)";
    })
  );
}

const pickedStudents = (form) => [...form.querySelectorAll('input[name="student"]:checked')].map((c) => c.value);

async function groupMemberIds(groupId) {
  if (!groupId) return [];
  const { data } = await supa.from("group_members").select("student_id").eq("group_id", groupId);
  return (data || []).map((r) => r.student_id);
}

async function insertItems(lessonId, tasks, opts, startPos = 0) {
  let pos = startPos;
  const rows = tasks.map((t) => ({
    lesson_id: lessonId,
    task_id: t.id,
    position: ++pos,
    kind: opts.kind,
    reveal: opts.kind === "test" ? "after_due" : TEACHER_CHECKED.has(t.answer_mode) && opts.reveal === "after_correct" ? "after_review" : opts.reveal,
    attempts_limit: opts.kind === "test" || TEACHER_CHECKED.has(t.answer_mode) ? null : opts.attempts,
    due_at: opts.due || null,
    hidden: Boolean(opts.hidden),
  }));
  if (!rows.length) return 0;
  const { error } = await supa.from("lesson_items").insert(rows);
  if (error) throw humanError(error);
  return rows.length;
}

export async function lessonsListView(host, render) {
  const [{ data: lessons, error }, { data: groups }, { data: students }, { data: items }, { data: assignees }] = await Promise.all([
    supa
      .from("lessons")
      .select("id, title, status, kind, exam_code, duration_minutes, starts_at, closes_at, created_at, group_id, student_id, self_made, groups(title), profiles!lessons_student_id_fkey(full_name, email)")
      .order("starts_at", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false }),
    supa.from("groups").select("id, title").eq("archived", false).order("title"),
    supa.from("profiles").select("id, full_name, email").neq("role", "teacher").eq("status", "active").order("full_name"),
    supa.from("lesson_items").select("id, lesson_id, due_at"),
    supa.from("lesson_assignees").select("lesson_id, student_id"),
  ]);
  if (error) throw humanError(error);
  const { data: members } = await supa.from("group_members").select("group_id, student_id");
  const itemsOf = (id) => (items || []).filter((i) => i.lesson_id === id);
  const count = (id) => itemsOf(id).length;
  const extra = (id) => (assignees || []).filter((a) => a.lesson_id === id).length;
  const rosterOf = (l) =>
    new Set([
      ...(l.student_id ? [l.student_id] : []),
      ...(members || []).filter((m) => m.group_id === l.group_id).map((m) => m.student_id),
      ...(assignees || []).filter((a) => a.lesson_id === l.id).map((a) => a.student_id),
    ]);
  const now = Date.now();
  const dueOf = (id) => itemsOf(id).map((i) => i.due_at).filter(Boolean).sort()[0] || null;
  // Куда отнести работу: идёт сейчас, запланирована, черновик, завершена; пробники, которые ученик собрал сам, — отдельно.
  const phase = (l) => {
    if (l.self_made) return "self";
    if (l.status === "draft") return "draft";
    if (l.status === "done") return "done";
    if (l.starts_at && Date.parse(l.starts_at) > now) return "planned";
    const due = dueOf(l.id);
    if ((due && Date.parse(due) < now) || (l.closes_at && Date.parse(l.closes_at) < now && !l.duration_minutes)) return "past";
    return "current";
  };
  const list = (lessons || []).map((l) => ({ l, ph: phase(l), due: dueOf(l.id), roster: rosterOf(l) }));
  // Кто уже сделал текущие и прошедшие работы: «выполнили N из M», «на проверке K»
  const watchIds = list.filter((x) => ["current", "past"].includes(x.ph)).flatMap((x) => itemsOf(x.l.id).map((i) => i.id));
  const doneBy = new Map(); // item_id -> Set(student)
  const waitBy = new Map();
  for (let i = 0; i < watchIds.length; i += 200) {
    const part = watchIds.slice(i, i + 200);
    const [{ data: at }, { data: wk }] = await Promise.all([
      supa.from("attempts").select("item_id, student_id").in("item_id", part).limit(20000),
      supa.from("written_works").select("item_id, student_id, status").in("item_id", part).neq("status", "draft"),
    ]);
    (at || []).forEach((a) => (doneBy.get(a.item_id) || doneBy.set(a.item_id, new Set()).get(a.item_id)).add(a.student_id));
    (wk || []).forEach((w) => {
      (doneBy.get(w.item_id) || doneBy.set(w.item_id, new Set()).get(w.item_id)).add(w.student_id);
      if (w.status === "submitted") (waitBy.get(w.item_id) || waitBy.set(w.item_id, new Set()).get(w.item_id)).add(w.student_id);
    });
  }
  const progress = ({ l, roster }) => {
    const its = itemsOf(l.id);
    if (!its.length || !roster.size) return "";
    const done = [...roster].filter((sid) => its.every((it) => doneBy.get(it.id)?.has(sid))).length;
    const wait = new Set(its.flatMap((it) => [...(waitBy.get(it.id) || [])])).size;
    return `<span class="l-progress"><span class="today-bar"><span style="width:${Math.round((100 * done) / roster.size)}%"></span></span>выполнили ${done} из ${roster.size}${
      wait ? ` · <b>на проверке ${wait}</b>` : ""
    }</span>`;
  };
  const rowHtml = (x) => {
    const { l, ph, due } = x;
    const who = [l.groups?.title ? `группа «${l.groups.title}»` : "", l.profiles?.full_name || l.profiles?.email || "", extra(l.id) ? `${extra(l.id)} уч.` : ""]
      .filter(Boolean)
      .join(" + ");
    const when =
      ph === "planned"
        ? ` · откроется ${fmtDT(l.starts_at)}`
        : due
          ? ` · ${ph === "past" ? "срок был" : "сдать до"} ${fmtDT(due)}`
          : l.starts_at
            ? ` · ${fmtDT(l.starts_at)}`
            : "";
    const blob = [l.title, who, ...[...x.roster].map((sid) => (students || []).find((s) => s.id === sid)?.full_name || "")].join(" ").toLowerCase();
    return `
      <a class="lit-item" href="#/cabinet/lesson/${l.id}" data-blob="${escapeHtml(blob)}" data-group="${l.group_id || ""}" data-who="${escapeHtml([...x.roster].join(" "))}" data-kind="${l.kind}">
        <span class="lit-item-n">${count(l.id)}</span>
        <span class="lit-item-body">
          <strong>${escapeHtml(l.title)}</strong>
          <span>${l.self_made ? '<span class="badge">сам</span> ' : ""}${escapeHtml(WORK_KIND[l.kind] || "Занятие")}${l.duration_minutes ? ` · ${durationText(l.duration_minutes)}` : ""} · ${escapeHtml(who || "никому не назначено")}${when}</span>
          ${["current", "past"].includes(ph) ? progress(x) : ""}
          ${ph === "draft" ? `<span class="lesson-status lesson-draft">${LESSON_STATUS.draft}</span>` : ""}
        </span>
      </a>`;
  };
  const byDue = (a, b) => (a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity);
  const SECTIONS = [
    ["current", "Сейчас — ждут выполнения", "Открыты ученикам, срок ещё не прошёл. Сверху — у которых срок раньше.", (a, b) => byDue(a, b), true],
    ["planned", "Запланированы", "Откроются ученикам в указанное время.", (a, b) => Date.parse(a.l.starts_at) - Date.parse(b.l.starts_at), true],
    ["draft", "Черновики", "Ученики их не видят, пока вы не нажмёте «Открыть ученикам».", null, true],
    ["past", "Срок прошёл", "Ещё открыты ученикам — можно проверить и нажать «Завершить».", (a, b) => byDue(b, a), false],
    ["done", "Завершённые", "", null, false],
    ["self", "Пробники, которые ученики собрали сами", "", null, false],
  ];
  const rows = SECTIONS.map(([ph, title, note, sort, open]) => {
    const part = list.filter((x) => x.ph === ph);
    if (sort) part.sort(sort);
    if (!part.length) return "";
    return `<details class="l-sec" data-ph="${ph}" ${open ? "open" : ""}>
      <summary><strong>${title}</strong> <span class="tt-count">${part.length}</span></summary>
      ${note ? `<p class="muted">${note}</p>` : ""}
      <div class="lit-list">${part.map(rowHtml).join("")}</div>
    </details>`;
  }).join("");
  const filterHtml = (lessons || []).length
    ? `<div class="t-filter l-filter">
        <label>Кому<select id="l-f-who"><option value="">все группы и ученики</option>${(groups || [])
          .map((g) => `<option value="g:${g.id}">группа «${escapeHtml(g.title)}»</option>`)
          .join("")}${(students || []).map((st) => `<option value="s:${st.id}">${escapeHtml(st.full_name || st.email)}</option>`).join("")}</select></label>
        <label>Вид<select id="l-f-kind"><option value="">все</option>${Object.entries(WORK_KIND)
          .map(([k, v]) => `<option value="${k}">${v}</option>`)
          .join("")}</select></label>
        <label>Поиск<input id="l-f-q" type="search" placeholder="название, ученик" /></label>
      </div>`
    : "";
  const examOpts = Object.entries(EXAMS).map(([k, v]) => `<option value="${k}">${escapeHtml(v.title)} — ${durationText(v.minutes)}</option>`).join("");
  render(`
    <header class="tt-head">
      <h1>Занятия и работы</h1>
      <span class="actions"><button type="button" class="btn secondary l-open-desk" data-open-new="written">+ Письменная работа</button><button type="button" class="btn l-open-desk" data-open-new>+ Новое занятие</button></span>
    </header>
    <button type="button" class="fab" data-open-new aria-label="Новое занятие">+</button>
    <form id="l-new" class="card stack l-new" data-step="1" hidden>
      <div class="l-sheet-head">
        <strong>Новая работа</strong>
        <span class="l-steps muted"><span id="l-step-n">1</span> из 3</span>
        <button type="button" class="l-x" data-close-new aria-label="Закрыть">×</button>
      </div>
      <fieldset class="l-step" data-n="1">
      <legend class="l-step-title">Что за работа</legend>
      <div class="grid-2">
        <label>Вид работы<select name="kind">${Object.entries(WORK_KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <label>Название<input name="title" placeholder="Задание 16: запятые при однородных членах" /></label>
      </div>
      <div class="grid-2" data-for="exam" hidden>
        <label>Экзамен<select name="exam_code">${examOpts}</select></label>
        <label class="t-inline"><input type="checkbox" name="compose" checked /> сразу собрать полный вариант (задания по одному тексту — вместе)</label>
      </div>
      <p class="muted" data-for="exam" hidden id="l-exam-note"></p>
      <div class="stack" data-for="written" hidden>
        <label>Что пишут<select name="wtype">${writtenTypeOptions()}</select></label>
        <label>Пояснение ученикам <span class="muted">(необязательно)</span><textarea name="wnote" rows="2" placeholder="Например: объём не меньше 150 слов; можно написать от руки и прикрепить фото"></textarea></label>
        <p class="muted">Текст подберётся из банка — такой, который эти ученики ещё не писали. Ниже, в «Тексте работы», его можно посмотреть, заменить или выбрать самому.</p>
      </div>
      <div class="grid-2" data-for="timed" hidden>
        <label>Время на работу, мин<input type="number" name="duration" min="5" max="600" placeholder="без ограничения" /></label>
        <label>Результат ученику<select name="show_results">${Object.entries(SHOW_RESULTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      </div>
      </fieldset>
      <fieldset class="l-step" data-n="2">
        <legend class="l-step-title">Кому назначить</legend>
        ${targetPickerHtml(groups, students)}
      </fieldset>
      <fieldset class="l-step" data-n="3">
        <legend class="l-step-title"><span data-for="notwritten">Когда открыть</span><span data-for="written" hidden>Срок сдачи</span></legend>
        <div class="grid-2">
          <label data-for="notwritten">Когда (открыть с)<input type="datetime-local" name="starts_at" /></label>
          <label data-for="timed" hidden>Начать можно до<input type="datetime-local" name="closes_at" /></label>
        </div>
        <div class="stack l-wtext" data-for="written" hidden>
          <p class="l-label">Текст работы <span class="muted">— посмотрите, прежде чем отправлять</span></p>
          <div class="card l-wpick" id="l-wpick"><p class="muted">Подбираем…</p></div>
          <p class="actions"><button type="button" class="btn secondary" id="l-wreroll">↻ Другой текст</button>
            <button type="button" class="btn secondary" id="l-wbrowse">Выбрать из базы</button></p>
          <div id="l-wlist" class="l-wlist" hidden>
            <input type="search" id="l-wsearch" placeholder="Слова из задания, автор, произведение или №" />
            <label class="t-inline"><input type="checkbox" id="l-wshowused" /> показать и уже отработанные этими учениками</label>
            <div id="l-wrows"></div>
          </div>
        </div>
        <div class="stack" data-for="written" hidden>
          <label>Сдать до<input type="datetime-local" name="due_at" /></label>
          ${duePresetsHtml()}
          <label class="t-inline"><input type="checkbox" name="open_now" checked /> открыть ученикам сразу (появится у них на главной)</label>
        </div>
      </fieldset>
      <p class="lit-result" id="l-new-status"></p>
      <div class="l-step-nav">
        <button type="button" class="btn secondary" data-step-prev>Назад</button>
        <button type="button" class="btn" data-step-next>Далее</button>
        <button class="btn" type="submit">Создать</button>
      </div>
    </form>
    <p class="muted">Как назначить: создайте занятие → добавьте задания → нажмите «Открыть ученикам». До этого оно черновик и ученики его не видят.</p>
    ${filterHtml}
    <div id="l-sections">${rows || '<p class="muted">Пока ничего нет.</p>'}</div>`);

  // Фильтр: кому, вид, поиск. Пустые разделы прячем, в заголовке — сколько осталось.
  const applyFilter = () => {
    const who = host.querySelector("#l-f-who")?.value || "";
    const kind = host.querySelector("#l-f-kind")?.value || "";
    const q = String(host.querySelector("#l-f-q")?.value || "").trim().toLowerCase();
    host.querySelectorAll(".l-sec").forEach((sec) => {
      let n = 0;
      sec.querySelectorAll("a.lit-item").forEach((a) => {
        const okWho = !who || (who.startsWith("g:") ? a.dataset.group === who.slice(2) : a.dataset.who.split(" ").includes(who.slice(2)));
        const ok = okWho && (!kind || a.dataset.kind === kind) && (!q || a.dataset.blob.includes(q));
        a.hidden = !ok;
        if (ok) n += 1;
      });
      sec.hidden = n === 0;
      sec.querySelector(".tt-count").textContent = n;
    });
    try {
      sessionStorage.setItem("lessons-filter", JSON.stringify({ who, kind }));
    } catch {}
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem("lessons-filter") || "{}");
    if (saved.who && host.querySelector(`#l-f-who option[value="${saved.who}"]`)) host.querySelector("#l-f-who").value = saved.who;
    if (saved.kind && host.querySelector("#l-f-kind")) host.querySelector("#l-f-kind").value = saved.kind;
  } catch {}
  ["#l-f-who", "#l-f-kind"].forEach((sel) => host.querySelector(sel)?.addEventListener("change", applyFilter));
  host.querySelector("#l-f-q")?.addEventListener("input", applyFilter);
  applyFilter();

  const form = host.querySelector("#l-new");
  bindPicker(form);
  // Создание: на компьютере — карточка целиком, на телефоне — шторка по шагам «Что → Кому → Когда».
  const stepNo = form.querySelector("#l-step-n");
  const setStep = (n) => {
    form.dataset.step = String(n);
    stepNo.textContent = String(n);
    form.scrollTop = 0;
  };
  const openNew = () => {
    form.hidden = false;
    setStep(1);
    document.body.classList.add("is-sheet");
    requestAnimationFrame(() => form.classList.add("is-open"));
    if (matchMedia("(min-width: 761px)").matches) form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.querySelector('[name="title"]').focus({ preventScroll: true });
  };
  const closeNew = () => {
    form.classList.remove("is-open");
    document.body.classList.remove("is-sheet");
    setTimeout(() => (form.hidden = true), 200);
  };
  host.querySelectorAll("[data-open-new]").forEach((b) =>
    b.addEventListener("click", () => {
      kindSel.value = b.dataset.openNew === "written" ? "written" : kindSel.value === "written" ? "lesson" : kindSel.value;
      sync();
      openNew();
      if (kindSel.value === "written" && !chosen) reroll();
      if (kindSel.value === "written") refreshNext();
    })
  );
  form.querySelector("[data-close-new]").addEventListener("click", closeNew);
  form.querySelector("[data-step-prev]").addEventListener("click", () => setStep(Math.max(1, Number(form.dataset.step) - 1)));
  form.querySelector("[data-step-next]").addEventListener("click", () => {
    const n = Number(form.dataset.step);
    const st = form.querySelector("#l-new-status");
    if (n === 2 && !form.querySelector('[name="group_id"]')?.value && !pickedStudents(form).length) {
      st.className = "lit-result is-bad";
      st.textContent = "Выберите группу и/или отдельных учеников.";
      return;
    }
    st.textContent = "";
    setStep(Math.min(3, n + 1));
  });
  window.addEventListener("hashchange", () => document.body.classList.remove("is-sheet"), { once: true });
  const kindSel = form.querySelector('[name="kind"]');
  const examSel = form.querySelector('[name="exam_code"]');
  const dur = form.querySelector('[name="duration"]');
  const sync = () => {
    const kind = kindSel.value;
    form.querySelectorAll('[data-for="exam"]').forEach((el) => (el.hidden = kind !== "exam"));
    form.querySelectorAll('[data-for="timed"]').forEach((el) => (el.hidden = kind === "lesson" || kind === "written"));
    form.querySelectorAll('[data-for="written"]').forEach((el) => (el.hidden = kind !== "written"));
    form.querySelectorAll('[data-for="notwritten"]').forEach((el) => (el.hidden = kind === "written"));
    if (kind === "written") {
      form.querySelector('[name="title"]').placeholder = WRITTEN_TYPES[wtypeSel.value].title;
      if (!dueIn.value) {
        dueIn.value = toLocalInput(dueFromPreset("7"));
        form.querySelector('[data-due="7"]')?.classList.add("is-on");
      }
      dur.value = "";
    } else if (kind === "exam") {
      const ex = EXAMS[examSel.value];
      dur.value = ex.minutes;
      form.querySelector("#l-exam-note").textContent = `Время по умолчанию: ${durationText(ex.minutes)} (${ex.note}). Задания: ${ex.numbers[0]}–${ex.numbers.at(-1)}.`;
      form.querySelector('[name="title"]').placeholder = `Пробный ${ex.title}`;
    } else if (kind === "test") {
      if (!dur.value || Object.values(EXAMS).some((x) => String(x.minutes) === dur.value)) dur.value = 45;
      form.querySelector('[name="title"]').placeholder = "Контрольная: пунктуация";
    } else {
      dur.value = "";
    }
  };
  const wtypeSel = form.querySelector('[name="wtype"]');
  const dueIn = form.querySelector('[name="due_at"]');
  bindDuePresets(form, dueIn);
  dueIn.addEventListener("input", () => form.querySelectorAll("[data-due]").forEach((x) => x.classList.remove("is-on")));
  kindSel.addEventListener("change", sync);
  examSel.addEventListener("change", sync);
  wtypeSel.addEventListener("change", sync);

  // Текст письменной работы: выбирается заранее, преподаватель видит его до отправки.
  let chosen = null;
  let pickedByHand = false;
  let tried = [];
  let pickSeq = 0;
  const pickBox = form.querySelector("#l-wpick");
  const listBox = form.querySelector("#l-wlist");
  const usedNow = async () => {
    const wt = WRITTEN_TYPES[wtypeSel.value];
    return writtenUsed(await rosterNow(), form.querySelector('[name="group_id"]')?.value || null, wt.source, wt.no);
  };
  const rosterNow = async () => [...new Set([...(await groupMemberIds(form.querySelector('[name="group_id"]')?.value || "")), ...pickedStudents(form)])];
  const showChosen = async (t, seenSet) => {
    const my = ++pickSeq;
    chosen = t;
    if (!t) {
      pickBox.innerHTML = '<p class="muted">В банке нет заданий этого типа.</p>';
      return;
    }
    pickBox.innerHTML = '<p class="muted">Загружаем текст…</p>';
    const seen = (seenSet || (await usedNow())).has(t);
    const html = await writtenPreviewHtml(t, seen, wtypeSel.value);
    if (my === pickSeq) pickBox.innerHTML = html;
  };
  const reroll = async () => {
    if (kindSel.value !== "written") return;
    const wt = WRITTEN_TYPES[wtypeSel.value];
    pickBox.innerHTML = '<p class="muted">Подбираем…</p>';
    try {
      const pool = await writtenPool(wt.source, wt.no);
      const seen = await usedNow();
      const fresh = pool.filter((t) => !seen.has(t));
      if (!fresh.length) {
        chosen = null;
        pickBox.innerHTML = '<p class="lit-result is-bad">Все тексты этого типа эти ученики уже отрабатывали. Выберите другой тип работы или возьмите текст из базы вручную («показать и отработанные»).</p>';
        return;
      }
      let options = fresh.filter((t) => !tried.includes(t.id));
      if (!options.length) {
        tried = chosen ? [chosen.id] : [];
        options = fresh.filter((t) => !tried.includes(t.id));
        if (!options.length) options = fresh;
      }
      const t = options[Math.floor(Math.random() * options.length)];
      tried.push(t.id);
      pickedByHand = false;
      await showChosen(t, seen);
    } catch (err) {
      pickBox.innerHTML = `<p class="lit-result is-bad">${escapeHtml(err.message)}</p>`;
    }
  };
  const renderList = async () => {
    const wt = WRITTEN_TYPES[wtypeSel.value];
    const rows = form.querySelector("#l-wrows");
    rows.innerHTML = '<p class="muted">Загружаем…</p>';
    const pool = await writtenPool(wt.source, wt.no);
    const seen = await usedNow();
    const showUsed = form.querySelector("#l-wshowused").checked;
    const needle = String(form.querySelector("#l-wsearch").value || "").trim().toLowerCase();
    const matching = pool.filter((t) => !needle || `${t.source_ref} ${t.q || ""} ${t.work || ""} ${t.author || ""}`.toLowerCase().includes(needle));
    const usedCount = matching.filter((t) => seen.has(t)).length;
    const hits = matching.filter((t) => showUsed || !seen.has(t)).sort((a, b) => seen.has(a) - seen.has(b));
    rows.innerHTML =
      hits
        .slice(0, 40)
        .map(
          (t) => `<button type="button" class="l-wrow${chosen?.id === t.id ? " is-on" : ""}" data-pick="${t.id}">
            <strong>№ ${escapeHtml(String(t.source_ref))}${t.work ? ` · «${escapeHtml(t.work)}»` : ""}</strong>${seen.has(t) ? ' <span class="badge">уже отрабатывали</span>' : ""}
            <span class="muted">${escapeHtml(cut(gist(t.q, wtypeSel.value), 260))}</span></button>`
        )
        .join("") +
      `<p class="muted">Найдено: ${hits.length}${hits.length > 40 ? " — показаны первые 40, уточните поиск" : ""}.${
        usedCount && !showUsed ? ` Скрыто уже отработанных этими учениками: ${usedCount}.` : ""
      }</p>`;
    rows.querySelectorAll("[data-pick]").forEach((b) =>
      b.addEventListener("click", async () => {
        const t = pool.find((x) => String(x.id) === b.dataset.pick);
        pickedByHand = true;
        listBox.hidden = true;
        await showChosen(t, seen);
        pickBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
      })
    );
  };
  form.querySelector("#l-wreroll").addEventListener("click", reroll);
  form.querySelector("#l-wbrowse").addEventListener("click", () => {
    listBox.hidden = !listBox.hidden;
    if (!listBox.hidden) renderList();
  });
  let searchTimer = null;
  form.querySelector("#l-wshowused").addEventListener("change", renderList);
  form.querySelector("#l-wsearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 250);
  });
  const restart = () => {
    tried = [];
    chosen = null;
    listBox.hidden = true;
    if (kindSel.value === "written") reroll();
  };
  wtypeSel.addEventListener("change", restart);
  kindSel.addEventListener("change", () => kindSel.value === "written" && !chosen && reroll());
  // сменились ученики — пометка «уже писали» могла измениться
  const recheck = async () => {
    if (kindSel.value !== "written") return;
    if (!chosen) return reroll();
    // выбранный случайно текст оказался уже отработанным с новыми учениками — подобрать другой
    if (!pickedByHand && (await usedNow()).has(chosen)) return reroll();
    showChosen(chosen);
  };
  // Срок «к следующему занятию» — по расписанию из Google Календаря (если подключено и занятие сопоставлено)
  const nextSlot = form.querySelector("[data-due-next]");
  let nextSeq = 0;
  const refreshNext = async () => {
    const my = ++nextSeq;
    const g = form.querySelector('[name="group_id"]')?.value;
    const keys = g ? [`g:${g}`] : pickedStudents(form).map((id) => `s:${id}`);
    let next = null;
    try {
      next = keys.length ? await nextLessonFor(keys) : null;
    } catch {}
    if (my !== nextSeq) return;
    if (!next) {
      nextSlot.innerHTML = "";
      return;
    }
    const d = new Date(next.start);
    const label = `к следующему занятию · ${d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "numeric" })}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
    nextSlot.innerHTML = `<button type="button" class="chip-btn" data-due-at="${next.start}">${escapeHtml(label)}</button>`;
    const b = nextSlot.querySelector("button");
    if (dueIn.value === toLocalInput(next.start)) b.classList.add("is-on");
    b.addEventListener("click", () => {
      dueIn.value = toLocalInput(next.start);
      form.querySelectorAll("[data-due], [data-due-at]").forEach((x) => x.classList.toggle("is-on", x === b));
    });
  };
  form.querySelector('[name="group_id"]')?.addEventListener("change", () => (recheck(), refreshNext()));
  form.querySelectorAll('input[name="student"]').forEach((cb) => cb.addEventListener("change", () => (recheck(), refreshNext())));
  dueIn.addEventListener("input", () => nextSlot.querySelector("button")?.classList.remove("is-on"));
  sync();
  const params = new URLSearchParams((location.hash.split("?")[1] || ""));
  const wantNew = params.get("new");
  if (wantNew) {
    // из «Недели»: кому и к какому сроку уже известно
    const to = params.get("to") || "";
    if (to.startsWith("g:")) {
      const sel = form.querySelector('[name="group_id"]');
      if (sel && sel.querySelector(`option[value="${CSS.escape(to.slice(2))}"]`)) sel.value = to.slice(2);
    } else if (to.startsWith("s:")) {
      const cb = form.querySelector(`input[name="student"][value="${CSS.escape(to.slice(2))}"]`);
      if (cb) {
        cb.checked = true;
        cb.closest("details")?.setAttribute("open", "");
        cb.dispatchEvent(new Event("change"));
      }
    }
    if (wantNew === "written") {
      kindSel.value = "written";
      sync();
      const due = params.get("due");
      if (due && Date.parse(due) > Date.now()) {
        dueIn.value = toLocalInput(due);
        form.querySelectorAll("[data-due]").forEach((x) => x.classList.remove("is-on"));
      }
      reroll();
      refreshNext();
    }
    openNew();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const st = form.querySelector("#l-new-status");
    const kind = f.get("kind");
    const groupId = f.get("group_id") || null;
    const picked = pickedStudents(form);
    if (!groupId && !picked.length) {
      st.className = "lit-result is-bad";
      st.textContent = "Выберите группу и/или отдельных учеников.";
      return;
    }
    const code = kind === "exam" ? f.get("exam_code") : null;
    const wtype = kind === "written" ? WRITTEN_TYPES[f.get("wtype")] : null;
    const due = kind === "written" ? fromLocalInput(f.get("due_at")) : null;
    if (wtype && !(chosen && chosen.source === wtype.source && chosen.task_no === wtype.no)) {
      st.className = "lit-result is-bad";
      st.textContent = "Сначала выберите текст работы (раздел «Текст работы»).";
      return;
    }
    if (wtype && !due) {
      st.className = "lit-result is-bad";
      st.textContent = "Укажите, до какого времени сдать работу.";
      return;
    }
    if (due && new Date(due) < new Date()) {
      st.className = "lit-result is-bad";
      st.textContent = "Срок сдачи уже прошёл — выберите время позже.";
      return;
    }
    const title =
      String(f.get("title") || "").trim() ||
      (wtype ? wtype.title : code ? `Пробный ${EXAMS[code].title}` : kind === "test" ? "Контрольная работа" : "Занятие");
    const notes = wtype ? [wtype.note, String(f.get("wnote") || "").trim()].filter(Boolean).join(" ") || null : null;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    st.className = "lit-result";
    st.textContent = "Создаём…";
    try {
      const { data: lesson, error: err } = await supa
        .from("lessons")
        .insert({
          title,
          kind,
          exam_code: code,
          duration_minutes: kind === "lesson" || kind === "written" ? null : Number(f.get("duration")) || null,
          show_results: f.get("show_results") || "manual",
          starts_at: wtype ? new Date().toISOString() : fromLocalInput(f.get("starts_at")),
          closes_at: kind === "lesson" || kind === "written" ? null : fromLocalInput(f.get("closes_at")),
          notes,
          group_id: groupId,
        })
        .select("id")
        .single();
      if (err) throw humanError(err);
      if (picked.length) {
        const { error: e2 } = await supa.from("lesson_assignees").insert(picked.map((sid) => ({ lesson_id: lesson.id, student_id: sid })));
        if (e2) throw humanError(e2);
      }
      if (code && f.get("compose")) {
        st.textContent = "Собираем вариант…";
        const roster = [...new Set([...(await groupMemberIds(groupId)), ...picked])];
        const tasks = await composeVariant(code, roster);
        await insertItems(lesson.id, tasks, { kind: "test" });
      }
      if (wtype) {
        const task = chosen;
        if (task) {
          await insertItems(lesson.id, [task], { kind: "homework", reveal: "after_review", attempts: null, due });
          if (f.get("open_now")) {
            const { error: e3 } = await supa.from("lessons").update({ status: "live" }).eq("id", lesson.id);
            if (e3) throw humanError(e3);
          }
        }
      }
      location.hash = `#/cabinet/lesson/${lesson.id}`;
    } catch (err) {
      st.className = "lit-result is-bad";
      st.textContent = err.message;
      btn.disabled = false;
    }
  });
}

async function loadLesson(id) {
  const { data: lesson, error } = await supa
    .from("lessons")
    .select("*, groups(id, title), profiles!lessons_student_id_fkey(id, full_name, email)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw humanError(error);
  if (!lesson) return null;
  const [{ data: items }, members, { data: assignees }, { data: sessions }] = await Promise.all([
    supa
      .from("lesson_items")
      .select("*, tasks(id, source, bank_file, source_ref, task_no, topic, answer_mode, list_item, is_published, passage_id)")
      .eq("lesson_id", id)
      .order("position")
      .order("added_at"),
    lesson.group_id
      ? supa.from("group_members").select("student_id, profiles(full_name, email)").eq("group_id", lesson.group_id)
      : Promise.resolve({ data: [] }),
    supa.from("lesson_assignees").select("student_id, profiles(full_name, email)").eq("lesson_id", id),
    supa.from("exam_sessions").select("*").eq("lesson_id", id),
  ]);
  const map = new Map();
  [...(members.data || []), ...(assignees || []), ...(lesson.student_id ? [{ student_id: lesson.student_id, profiles: lesson.profiles }] : [])].forEach((m) =>
    map.set(m.student_id, { id: m.student_id, name: m.profiles?.full_name || m.profiles?.email || "ученик", extra: (assignees || []).some((a) => a.student_id === m.student_id) })
  );
  const students = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return { lesson, items: items || [], students, assigneeIds: new Set((assignees || []).map((a) => a.student_id)), sessions: sessions || [] };
}

async function loadBoard(items) {
  const ids = items.map((i) => i.id);
  if (!ids.length) return { attempts: [], works: [] };
  const [a, w] = await Promise.all([
    supa.from("attempts").select("student_id, item_id, is_correct, answer, created_at").in("item_id", ids).order("created_at"),
    supa.from("written_works").select("id, student_id, item_id, status, score, max_score, submitted_at").in("item_id", ids),
  ]);
  return { attempts: a.data || [], works: w.data || [] };
}

function sessionCell(lesson, sessions, st) {
  if (!lesson.duration_minutes) return "";
  const s = sessions.find((x) => x.student_id === st.id);
  if (!s) return `<td class="b-empty">не начинал</td>`;
  const ends = new Date(s.started_at).getTime() + lesson.duration_minutes * 60000;
  if (s.finished_at) return `<td class="b-ok">сдал ${new Date(s.finished_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</td>`;
  if (Date.now() > ends) return `<td class="b-bad">время вышло</td>`;
  const left = Math.round((ends - Date.now()) / 60000);
  return `<td class="b-work b-submitted">идёт · ${left} мин</td>`;
}

function boardHtml({ lesson, items, students, sessions }, { attempts, works }) {
  if (!items.length) return `<p class="muted">Добавьте задания — здесь появится таблица ответов.</p>`;
  if (!students.length) return `<p class="muted">Работа пока никому не назначена.</p>`;
  const timed = Boolean(lesson.duration_minutes);
  const head = items
    .map((it, i) => `<th title="${escapeHtml(snippet(it.tasks, 200))}">${lesson.kind === "exam" ? it.tasks?.task_no ?? i + 1 : i + 1}${it.hidden ? "<small> скр.</small>" : ""}</th>`)
    .join("");
  const lastOnly = (it) => it.kind === "test";
  const mine = (st, it) => attempts.filter((x) => x.student_id === st.id && x.item_id === it.id);
  const isOk = (st, it) => {
    const list = mine(st, it);
    return lastOnly(it) ? Boolean(list.at(-1)?.is_correct) : list.some((x) => x.is_correct);
  };
  const cell = (st, it) => {
    if (TEACHER_CHECKED.has(it.tasks?.answer_mode)) {
      const w = works.find((x) => x.student_id === st.id && x.item_id === it.id);
      if (!w || w.status === "draft") return `<td class="b-empty">·</td>`;
      const txt = w.status === "graded" ? `${w.score ?? "✓"}` : w.status === "returned" ? "дораб." : "сдано";
      const late = it.due_at && w.submitted_at && new Date(w.submitted_at) > new Date(it.due_at);
      const when = w.submitted_at ? new Date(w.submitted_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
      return `<td class="b-work b-${w.status}" title="${when ? `сдано ${escapeHtml(when)}` : ""}${late ? " — после срока" : ""}"><a href="#/cabinet/works/${w.id}">${txt}</a>${late ? '<small class="b-late">поздно</small>' : ""}</td>`;
    }
    const list = mine(st, it);
    if (!list.length) return `<td class="b-empty">·</td>`;
    const ok = isOk(st, it);
    const title = list.map((x) => `${x.answer}${x.is_correct ? " ✓" : " ✗"}`).join(", ");
    return `<td class="${ok ? "b-ok" : "b-bad"}" title="${escapeHtml(title)}">${ok ? "✓" : "✗"}${list.length > 1 ? `<small>${list.length}</small>` : ""}</td>`;
  };
  const rows = students
    .map((st) => {
      const solved = items.filter((it) =>
        TEACHER_CHECKED.has(it.tasks?.answer_mode)
          ? works.some((w) => w.student_id === st.id && w.item_id === it.id && w.status !== "draft")
          : isOk(st, it)
      ).length;
      return `<tr><th><a href="#/cabinet/student/${st.id}">${escapeHtml(st.name)}</a></th>${sessionCell(lesson, sessions, st)}${items.map((it) => cell(st, it)).join("")}<td class="b-sum">${solved}/${items.length}</td></tr>`;
    })
    .join("");
  const foot = items
    .map((it) => {
      if (TEACHER_CHECKED.has(it.tasks?.answer_mode)) {
        const n = new Set(works.filter((w) => w.item_id === it.id && w.status !== "draft").map((w) => w.student_id)).size;
        return `<td>${n}</td>`;
      }
      const tried = students.filter((st) => mine(st, it).length).length;
      const ok = students.filter((st) => isOk(st, it)).length;
      return `<td title="решили / отвечали">${ok}/${tried}</td>`;
    })
    .join("");
  return `
    <div class="t-table-wrap"><table class="t-table board">
      <thead><tr><th>Ученик</th>${timed ? "<th>Работа</th>" : ""}${head}<th>Итого</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>Решили</th>${timed ? "<td></td>" : ""}${foot}<td></td></tr></tfoot>
    </table></div>
    <p class="muted">${lesson.kind === "written" ? "«сдано» — ждёт проверки (нажмите, чтобы проверить), число — поставленный балл, «дораб.» — вернули на доработку, «поздно» — сдано после срока, · — ещё не сдал. Таблица обновляется сама.</p>" : `${lesson.kind === "lesson" ? "✓ — решено (маленькая цифра — сколько было попыток), ✗ — пока неверно" : "✓ / ✗ — последний сохранённый ответ ученика (ученик результат пока не видит, если вы его не открыли)"}, · — не отвечал. Наведите на клетку, чтобы увидеть ответы. Таблица обновляется сама.</p>`}`;
}

function itemsTableHtml(items, lesson) {
  if (!items.length) return `<p class="muted">Заданий пока нет. Добавьте их вручную или автоподбором ниже.</p>`;
  const sel = (name, map, value) =>
    `<select data-f="${name}">${Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === value ? "selected" : ""}>${v}</option>`).join("")}</select>`;
  const isWork = lesson.kind !== "lesson";
  const isWritten = lesson.kind === "written";
  return `
    <div class="t-table-wrap"><table class="t-table l-items">
      <thead><tr><th>#</th><th>Задание</th>${isWork ? "" : "<th>Тип</th><th>Разбор открыть</th><th>Попыток</th><th>Срок</th>"}<th>Показ</th><th></th></tr></thead>
      <tbody>${items
        .map(
          (it, i) => `
        <tr data-id="${it.id}" class="${it.hidden ? "l-hidden" : ""}">
          <td>${i + 1}</td>
          <td><a href="${taskHref(it.tasks)}" target="_blank">${shortSource(it.tasks?.source)} № ${it.tasks?.task_no ?? ""} · ${escapeHtml(String(it.tasks?.source_ref || ""))}</a>
              ${it.tasks?.is_published ? "" : ' <span class="badge">не в банке</span>'}
              <br><small class="muted">${escapeHtml(snippet(it.tasks))}</small></td>
          ${
            isWork
              ? ""
              : `<td>${sel("kind", KIND, it.kind)}</td>
          <td>${sel("reveal", REVEAL, it.reveal)}${it.revealed ? '<br><small class="t-okc">открыт</small>' : ""}</td>
          <td><input type="number" min="1" max="20" data-f="attempts_limit" value="${it.attempts_limit ?? ""}" placeholder="∞" style="width:64px" /></td>
          <td><input type="datetime-local" data-f="due_at" value="${toLocalInput(it.due_at)}" /></td>`
          }
          <td><label class="t-inline"><input type="checkbox" data-f="hidden" ${it.hidden ? "" : "checked"} /> видно</label></td>
          <td class="l-row-actions">
            <button class="btn secondary" data-act="up" title="Выше">↑</button>
            <button class="btn secondary" data-act="down" title="Ниже">↓</button>
            ${lesson.kind === "exam" ? `<button class="btn secondary" data-act="replace" title="Другое задание этого номера">Заменить</button>` : ""}
            ${isWritten ? `<button class="btn secondary" data-act="replace" title="Другой текст с тем же заданием, который эти ученики ещё не писали">Другой текст</button>` : ""}
            <button class="btn secondary" data-act="reveal" title="Открыть ученикам результат и разбор">${it.revealed ? "Закрыть разбор" : "Открыть разбор"}</button>
            <button class="btn secondary" data-act="remove" title="Убрать">✕</button>
          </td>
        </tr>`
        )
        .join("")}</tbody>
    </table></div>`;
}

function numbersHtml(files) {
  return files
    .filter((f) => f.kind !== "extra")
    .map((f) => `<label class="l-num" title="${escapeHtml(f.title)}"><input type="checkbox" name="num" value="${f.bank}" data-task="${f.task}" /> ${f.task}</label>`)
    .join("");
}

async function addPanelHtml(lesson, defaults) {
  const source = lesson.exam_code || JSON.parse(sessionStorage.getItem("lesson-search") || "{}").source || "ege-rus";
  const files = await bankFiles(SOURCES[source] ? source : "ege-rus");
  const srcOpts = (sel) => Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v.title}</option>`).join("");
  const isWork = lesson.kind !== "lesson";
  const kindSel = Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${k === defaults.kind ? "selected" : ""}>${v}</option>`).join("");
  const revealSel = Object.entries(REVEAL).map(([k, v]) => `<option value="${k}" ${k === defaults.reveal ? "selected" : ""}>${v}</option>`).join("");
  return `
    ${
      isWork
        ? ""
        : `<div class="card t-filter l-defaults">
      <label>Тип новых заданий<select id="l-def-kind">${kindSel}</select></label>
      <label>Разбор открыть<select id="l-def-reveal">${revealSel}</select></label>
      <label>Попыток<input id="l-def-attempts" type="number" min="1" max="20" value="${defaults.attempts ?? ""}" placeholder="∞" /></label>
      <label>Срок<input id="l-def-due" type="datetime-local" /></label>
      <label class="t-inline"><input type="checkbox" id="l-def-hidden" /> добавлять скрытыми (открою на уроке)</label>
    </div>`
    }
    <div class="l-add-grid">
      <section class="card l-add-card">
        <h3>Автоподбор</h3>
        <form id="l-auto" class="stack">
          <label>Экзамен<select name="source">${srcOpts(SOURCES[source] ? source : "ege-rus")}</select></label>
          <div><p class="l-label">Номера заданий <button type="button" class="linklike" id="l-num-all">все</button> · <button type="button" class="linklike" id="l-num-none">снять</button></p>
            <div class="l-nums" id="l-nums">${numbersHtml(files)}</div></div>
          <label>Сколько на каждый номер<input type="number" name="per" min="1" max="20" value="1" style="width:90px" /></label>
          <label class="t-inline"><input type="checkbox" name="fresh" checked /> только ещё не отработанные с этими учениками</label>
          <button class="btn" type="submit">Подобрать и добавить</button>
          ${lesson.exam_code ? `<button class="btn secondary" type="button" id="l-recompose">Пересобрать полный вариант ${escapeHtml(EXAMS[lesson.exam_code].title)}</button>` : ""}
          <p class="lit-result" id="l-auto-status"></p>
        </form>
      </section>
      <section class="card l-add-card">
        <h3>Выбрать вручную</h3>
        <form id="l-search" class="stack">
          <div class="grid-2">
            <label>Экзамен<select name="source">${srcOpts(SOURCES[source] ? source : "ege-rus")}</select></label>
            <label>Номер<select name="bank">${files.map((f) => `<option value="${f.bank}" data-task="${f.task}">${f.kind === "extra" ? "доп. · " : `№ ${f.task} · `}${escapeHtml(f.title)}</option>`).join("")}</select></label>
          </div>
          <label>Слова из условия или № задания<input name="q" placeholder="необязательно" /></label>
          <label class="t-inline"><input type="checkbox" name="hideworked" /> скрыть уже отработанные с этими учениками</label>
          <label class="t-inline"><input type="checkbox" name="own" /> только мои задания</label>
          <button class="btn secondary" type="submit">Показать задания</button>
        </form>
      </section>
    </div>
    <div id="l-results"></div>`;
}

let liveChannel = null;
function stopLive() {
  if (liveChannel) {
    supa.removeChannel(liveChannel);
    liveChannel = null;
  }
}
window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith("#/cabinet/lesson/")) stopLive();
});

export async function lessonEditView(host, render, id) {
  stopLive();
  const state = await loadLesson(id);
  if (!state) return render(`<div class="empty">Не найдено. <a href="#/cabinet/lessons">К занятиям</a></div>`);
  const { lesson } = state;
  const isWork = lesson.kind !== "lesson";
  const isWritten = lesson.kind === "written";
  const isTimed = isWork && !isWritten;
  const lessonDue = state.items.map((i) => i.due_at).filter(Boolean).sort()[0] || null;
  const defaults = isWritten
    ? { kind: "homework", reveal: "after_review", attempts: null }
    : isWork
    ? { kind: "test", reveal: "after_due", attempts: null }
    : { reveal: "after_correct", attempts: 3, ...JSON.parse(sessionStorage.getItem("lesson-defaults") || "{}"), kind: "classwork" };
  const [{ data: groups }, { data: allStudents }] = await Promise.all([
    supa.from("groups").select("id, title").eq("archived", false).order("title"),
    supa.from("profiles").select("id, full_name, email").neq("role", "teacher").eq("status", "active").order("full_name"),
  ]);
  const who = [lesson.groups?.title ? `группа «${lesson.groups.title}»` : "", state.assigneeIds.size ? `${state.assigneeIds.size} уч. отдельно` : "", lesson.profiles?.full_name || ""]
    .filter(Boolean)
    .join(" + ");

  render(`
    <p class="crumbs"><a href="#/cabinet/lessons">← Все занятия и работы</a></p>
    <form id="l-head" class="l-head">
      <input name="title" class="l-title" value="${escapeHtml(lesson.title)}" aria-label="Название" />
      ${
        lesson.status === "draft"
          ? `<div class="l-draft card">
        <p><strong>Черновик — ученики пока не видят.</strong></p>
        <p class="muted">${state.items.length ? `Заданий: ${state.items.length}.` : "Добавьте задания ниже."} ${state.students.length ? "" : "Назначьте группу или учеников ниже. "}Когда всё готово, нажмите «Открыть ученикам»: занятие появится у них на главной, а кто подключил Telegram, получит сообщение.${lesson.starts_at && new Date(lesson.starts_at) > new Date() ? ` Сообщение в Telegram придёт ${escapeHtml(fmtDT(lesson.starts_at))} — в указанное время начала.` : ""}</p>
        <p class="actions"><button class="btn" type="button" data-status="live">Открыть ученикам</button></p>
      </div>`
          : ""
      }
      <p class="lede">${escapeHtml(WORK_KIND[lesson.kind])}${lesson.exam_code ? ` · ${escapeHtml(EXAMS[lesson.exam_code]?.title || "")}` : ""} · ${escapeHtml(who || "никому не назначено")} · <span class="lesson-status lesson-${lesson.status}">${LESSON_STATUS[lesson.status]}</span></p>
      <div class="t-filter card">
        <label>Открыть с<input type="datetime-local" name="starts_at" value="${toLocalInput(lesson.starts_at)}" /></label>
        ${isWritten ? `<label>Сдать до<input type="datetime-local" name="due_at" value="${toLocalInput(lessonDue)}" /></label>${duePresetsHtml()}` : ""}
        ${
          isTimed
            ? `<label>Начать можно до<input type="datetime-local" name="closes_at" value="${toLocalInput(lesson.closes_at)}" /></label>
        <label>Время, мин<input type="number" name="duration" min="5" max="600" value="${lesson.duration_minutes ?? ""}" placeholder="без ограничения" /></label>
        <label>Результат ученику<select name="show_results">${Object.entries(SHOW_RESULTS).map(([k, v]) => `<option value="${k}" ${k === lesson.show_results ? "selected" : ""}>${v}</option>`).join("")}</select></label>`
            : ""
        }
        <label>${isWritten ? "Пояснение ученикам" : "Заметка (ученики видят)"}<input name="notes" value="${escapeHtml(lesson.notes || "")}" placeholder="${isWritten ? "Например: объём не меньше 150 слов" : "Например: повторить § 25"}" /></label>
        <button class="btn secondary" type="submit">Сохранить</button>
      </div>
      <div class="actions">
        ${lesson.status === "done" ? `<button class="btn" type="button" data-status="live">Открыть ученикам</button>` : ""}
        ${lesson.status === "live" ? `<button class="btn secondary" type="button" data-status="done">Завершить</button><button class="btn secondary" type="button" data-status="draft">Скрыть (черновик)</button>` : ""}
        ${lesson.status === "done" ? `<button class="btn secondary" type="button" data-status="draft">В черновик</button>` : ""}
        ${isWritten ? "" : `<button class="btn secondary" type="button" id="l-reveal-all">${isWork ? "Открыть результаты и разборы" : "Открыть все разборы"}</button>`}
        ${isWork ? "" : `<button class="btn secondary" type="button" id="l-show-all">Показать все скрытые</button>`}
        <a class="btn secondary" href="#/lesson/${lesson.id}" target="_blank">Как видит ученик</a>
      </div>
    </form>
    <section class="me-section">
      <details class="card l-who" ${state.students.length ? "" : "open"}>
        <summary><strong>Кому назначено:</strong> ${escapeHtml(who || "никому")} · всего ${state.students.length}</summary>
        <form id="l-targets" class="stack">${targetPickerHtml(groups, allStudents, { groupId: lesson.group_id || "", picked: state.assigneeIds })}
          <button class="btn secondary" type="submit">Сохранить, кому назначено</button></form>
      </details>
    </section>
    <section class="me-section"><h2>Ход работы <span class="live-dot" id="l-live" title="обновляется в реальном времени"></span></h2><div id="l-board"><p class="muted">Загружаем…</p></div></section>
    <section class="me-section"><h2>Задания · ${state.items.length}</h2><div id="l-items">${itemsTableHtml(state.items, lesson)}</div></section>
    <section class="me-section"><h2>Добавить задания</h2>${await addPanelHtml(lesson, defaults)}</section>
    <section class="me-section">
      <h2>Скопировать</h2>
      <form id="l-copy" class="card stack">
        ${targetPickerHtml(groups, allStudents)}
        <button class="btn secondary" type="submit">Создать копию (черновик)</button>
      </form>
    </section>
    <section class="me-section">
      <button class="btn secondary" id="l-delete">Удалить</button>
    </section>`);

  const reload = () => lessonEditView(host, render, id);
  const refreshBoard = async () => {
    // работы на время: черновики тех, у кого время вышло, сдаются на сервере
    if (lesson.duration_minutes) await supa.rpc("finalize_exam_works", { p_lesson: id });
    const fresh = await loadLesson(id);
    if (!fresh) return;
    const board = await loadBoard(fresh.items);
    const box = host.querySelector("#l-board");
    if (box) box.innerHTML = boardHtml(fresh, board);
  };
  await refreshBoard();

  const itemIds = new Set(state.items.map((i) => i.id));
  let pending = null;
  const bump = (payload) => {
    const itemId = payload.new?.item_id || payload.old?.item_id;
    const lessonId = payload.new?.lesson_id || payload.old?.lesson_id;
    if (itemId && !itemIds.has(itemId)) return;
    if (lessonId && lessonId !== id) return;
    clearTimeout(pending);
    pending = setTimeout(refreshBoard, 400);
  };
  liveChannel = supa
    .channel(`lesson-${id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "attempts" }, bump)
    .on("postgres_changes", { event: "*", schema: "public", table: "written_works" }, bump)
    .on("postgres_changes", { event: "*", schema: "public", table: "exam_sessions" }, bump)
    .subscribe((status) => {
      const dot = host.querySelector("#l-live");
      if (dot) dot.classList.toggle("on", status === "SUBSCRIBED");
    });
  if (lesson.duration_minutes) {
    const timer = setInterval(() => (location.hash.includes(id) ? refreshBoard() : clearInterval(timer)), 60000);
  }

  // Шапка
  const head = host.querySelector("#l-head");
  head.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(head);
    const row = { title: String(f.get("title")).trim(), starts_at: fromLocalInput(f.get("starts_at")), notes: String(f.get("notes") || "").trim() || null };
    if (isWritten) {
      const due = fromLocalInput(f.get("due_at"));
      const { error: e2 } = await supa.from("lesson_items").update({ due_at: due }).eq("lesson_id", id);
      if (e2) return alert(humanError(e2).message);
    }
    if (isTimed) {
      row.closes_at = fromLocalInput(f.get("closes_at"));
      row.duration_minutes = Number(f.get("duration")) || null;
      row.show_results = f.get("show_results");
    }
    const { error } = await supa.from("lessons").update(row).eq("id", id);
    if (error) alert(humanError(error).message);
    else reload();
  });
  head.querySelector(".l-title").addEventListener("change", () => head.requestSubmit());
  if (isWritten) bindDuePresets(head, head.querySelector('[name="due_at"]'));
  head.querySelectorAll("[data-status]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (b.dataset.status === "live" && !state.students.length) return alert("Сначала назначьте работу группе или ученикам.");
      if (b.dataset.status === "live" && !state.items.length) return alert("Сначала добавьте задания.");
      const { error } = await supa.from("lessons").update({ status: b.dataset.status }).eq("id", id);
      if (error) alert(humanError(error).message);
      else reload();
    })
  );
  host.querySelector("#l-reveal-all")?.addEventListener("click", async () => {
    if (!confirm(isWork ? "Открыть ученикам результаты и разборы всех заданий?" : "Открыть разборы всех заданий для учеников?")) return;
    await supa.from("lesson_items").update({ revealed: true }).eq("lesson_id", id);
    reload();
  });
  host.querySelector("#l-show-all")?.addEventListener("click", async () => {
    await supa.from("lesson_items").update({ hidden: false }).eq("lesson_id", id);
    reload();
  });

  // Кому назначено
  const targets = host.querySelector("#l-targets");
  bindPicker(targets);
  targets.addEventListener("submit", async (e) => {
    e.preventDefault();
    const groupId = new FormData(targets).get("group_id") || null;
    const picked = new Set(pickedStudents(targets));
    const { error } = await supa.from("lessons").update({ group_id: groupId, student_id: null }).eq("id", id);
    if (error) return alert(humanError(error).message);
    const add = [...picked].filter((s) => !state.assigneeIds.has(s)).map((s) => ({ lesson_id: id, student_id: s }));
    const del = [...state.assigneeIds].filter((s) => !picked.has(s));
    if (add.length) await supa.from("lesson_assignees").insert(add);
    if (del.length) await supa.from("lesson_assignees").delete().eq("lesson_id", id).in("student_id", del);
    reload();
  });

  // Задания: настройки, порядок, замена, удаление
  const items = state.items;
  host.querySelectorAll("#l-items tr[data-id]").forEach((tr) => {
    const itemId = tr.dataset.id;
    tr.querySelectorAll("[data-f]").forEach((el) =>
      el.addEventListener("change", async () => {
        let value = el.value;
        if (el.dataset.f === "attempts_limit") value = el.value ? Number(el.value) : null;
        if (el.dataset.f === "due_at") value = fromLocalInput(el.value);
        if (el.dataset.f === "hidden") value = !el.checked;
        const { error } = await supa.from("lesson_items").update({ [el.dataset.f]: value }).eq("id", itemId);
        if (error) alert(humanError(error).message);
        if (el.dataset.f === "hidden") tr.classList.toggle("l-hidden", value);
      })
    );
    tr.querySelectorAll("[data-act]").forEach((b) =>
      b.addEventListener("click", async () => {
        const i = items.findIndex((x) => x.id === itemId);
        const it = items[i];
        const act = b.dataset.act;
        if (act === "remove") {
          if (!confirm("Убрать задание? Ответы учеников на него останутся в их истории без привязки к работе.")) return;
          await supa.from("lesson_items").delete().eq("id", itemId);
        } else if (act === "reveal") {
          await supa.from("lesson_items").update({ revealed: !it.revealed }).eq("id", itemId);
        } else if (act === "replace") {
          const answered = await supa.from("attempts").select("id", { count: "exact", head: true }).eq("item_id", itemId);
          if (answered.count && !confirm("На это задание уже отвечали. Заменить всё равно? Их ответы останутся в истории.")) return;
          if (isWritten) {
            const w = await supa.from("written_works").select("id", { count: "exact", head: true }).eq("item_id", itemId);
            if (w.count && !confirm("Кто-то уже начал писать по этому тексту. Заменить всё равно? Их черновики и работы останутся, но без привязки к этой работе.")) return;
          }
          const alt = isWritten
            ? (await pickWrittenTask(it.tasks.source, it.tasks.task_no, rosterIds, items.map((x) => x.task_id), lesson.group_id))?.id
            : await alternativeTask(lesson.exam_code, it.tasks.task_no, it.tasks.passage_id, items.map((x) => x.task_id));
          if (!alt) return alert("Другого подходящего задания в банке нет.");
          const { error } = await supa.from("lesson_items").update({ task_id: alt }).eq("id", itemId);
          if (error) return alert(humanError(error).message);
        } else {
          const j = act === "up" ? i - 1 : i + 1;
          if (j < 0 || j >= items.length) return;
          const order = items.map((x) => x.id);
          [order[i], order[j]] = [order[j], order[i]];
          await Promise.all(order.map((oid, k) => supa.from("lesson_items").update({ position: k + 1 }).eq("id", oid)));
        }
        reload();
      })
    );
  });

  // Общие помощники добавления
  const rosterIds = state.students.map((s) => s.id);
  const nameOf = new Map(state.students.map((s) => [s.id, s.name]));
  const readDefaults = () => {
    if (isWritten) return { kind: "homework", reveal: "after_review", attempts: null, due: lessonDue, hidden: false };
    if (isWork) return { kind: "test", reveal: "after_due", attempts: null, due: null, hidden: false };
    const d = {
      kind: host.querySelector("#l-def-kind").value,
      reveal: host.querySelector("#l-def-reveal").value,
      attempts: host.querySelector("#l-def-attempts").value ? Number(host.querySelector("#l-def-attempts").value) : null,
      due: fromLocalInput(host.querySelector("#l-def-due").value),
      hidden: host.querySelector("#l-def-hidden").checked,
    };
    sessionStorage.setItem("lesson-defaults", JSON.stringify({ reveal: d.reveal, attempts: d.attempts }));
    return d;
  };
  const addTasks = async (tasks) => {
    const fresh = tasks.filter((t) => !items.some((it) => it.task_id === t.id));
    if (!fresh.length) return alert("Эти задания уже есть.");
    try {
      await insertItems(id, fresh, readDefaults(), items.length);
      reload();
    } catch (err) {
      alert(err.message);
    }
  };
  /** Кто из учеников этой работы уже решал задания: Map task_id → [{name, ok}]. */
  const workedMap = async (taskIds) => {
    const out = new Map();
    if (!rosterIds.length || !taskIds.length) return out;
    for (let i = 0; i < taskIds.length; i += 300) {
      const chunk = taskIds.slice(i, i + 300);
      const [{ data: att }, { data: works }] = await Promise.all([
        supa.from("attempts").select("task_id, student_id, is_correct").in("student_id", rosterIds).in("task_id", chunk),
        supa.from("written_works").select("task_id, student_id, status").in("student_id", rosterIds).in("task_id", chunk).neq("status", "draft"),
      ]);
      (att || []).forEach((a) => {
        const list = out.get(a.task_id) || [];
        const ex = list.find((x) => x.sid === a.student_id);
        if (ex) ex.ok = ex.ok || a.is_correct;
        else list.push({ sid: a.student_id, ok: a.is_correct });
        out.set(a.task_id, list);
      });
      (works || []).forEach((w) => {
        const list = out.get(w.task_id) || [];
        if (!list.some((x) => x.sid === w.student_id)) list.push({ sid: w.student_id, ok: null });
        out.set(w.task_id, list);
      });
    }
    return out;
  };
  const workedBadge = (list) => {
    if (!list?.length) return `<span class="l-fresh">ещё не решали</span>`;
    return `<span class="l-worked">уже решали: ${list
      .map((x) => `${escapeHtml(nameOf.get(x.sid) || "ученик")} ${x.ok === null ? "(сдано)" : x.ok ? "✓" : "✗"}`)
      .join(", ")}</span>`;
  };

  // Автоподбор
  const auto = host.querySelector("#l-auto");
  const autoStatus = host.querySelector("#l-auto-status");
  const autoSrc = auto.querySelector('[name="source"]');
  const nums = host.querySelector("#l-nums");
  autoSrc.addEventListener("change", async () => {
    nums.innerHTML = numbersHtml(await bankFiles(autoSrc.value));
  });
  host.querySelector("#l-num-all").addEventListener("click", () => nums.querySelectorAll("input").forEach((c) => (c.checked = true)));
  host.querySelector("#l-num-none").addEventListener("click", () => nums.querySelectorAll("input").forEach((c) => (c.checked = false)));
  auto.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(auto);
    const banks = [...nums.querySelectorAll("input:checked")].map((c) => c.value);
    if (!banks.length) {
      autoStatus.textContent = "Отметьте хотя бы один номер (или «все»).";
      return;
    }
    const per = Math.max(1, Math.min(20, Number(f.get("per")) || 1));
    autoStatus.className = "lit-result";
    autoStatus.textContent = "Подбираем…";
    try {
      const chosen = [];
      for (const bank of banks) {
        const { data, error } = await supa
          .from("tasks")
          .select("id, answer_mode")
          .eq("source", f.get("source"))
          .eq("bank_file", bank)
          .eq("is_published", true)
          .limit(1000);
        if (error) throw humanError(error);
        let pool = (data || []).filter((t) => !items.some((it) => it.task_id === t.id) && !chosen.some((c) => c.id === t.id));
        if (f.get("fresh")) {
          const worked = await workedMap(pool.map((t) => t.id));
          const fresh = pool.filter((t) => !worked.has(t.id));
          if (fresh.length >= per) pool = fresh;
          else if (fresh.length) pool = [...fresh, ...pool.filter((t) => worked.has(t.id))].slice(0, Math.max(per, fresh.length));
        }
        for (let i = pool.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        chosen.push(...pool.slice(0, per));
      }
      if (!chosen.length) {
        autoStatus.textContent = "Подходящих заданий не нашлось.";
        return;
      }
      await insertItems(id, chosen, readDefaults(), items.length);
      reload();
    } catch (err) {
      autoStatus.className = "lit-result is-bad";
      autoStatus.textContent = err.message;
    }
  });
  host.querySelector("#l-recompose")?.addEventListener("click", async () => {
    if (items.length && !confirm("Убрать текущие задания и собрать новый полный вариант? Если ученики уже отвечали, их ответы останутся в истории.")) return;
    autoStatus.className = "lit-result";
    autoStatus.textContent = "Собираем вариант…";
    try {
      const tasks = await composeVariant(lesson.exam_code, rosterIds);
      if (items.length) await supa.from("lesson_items").delete().eq("lesson_id", id);
      await insertItems(id, tasks, { kind: "test" });
      reload();
    } catch (err) {
      autoStatus.className = "lit-result is-bad";
      autoStatus.textContent = err.message;
    }
  });

  // Ручной выбор
  const search = host.querySelector("#l-search");
  const resultsBox = host.querySelector("#l-results");
  const srcSel = search.querySelector('[name="source"]');
  const bankSel = search.querySelector('[name="bank"]');
  const fillBanks = async () => {
    const files = await bankFiles(srcSel.value);
    bankSel.innerHTML = files
      .map((f) => `<option value="${f.bank}" data-task="${f.task}">${f.kind === "extra" ? "доп. · " : `№ ${f.task} · `}${escapeHtml(f.title)}</option>`)
      .join("");
  };
  const remember = () => sessionStorage.setItem("lesson-search", JSON.stringify({ source: srcSel.value, bank: bankSel.value }));
  srcSel.addEventListener("change", async () => {
    await fillBanks();
    remember();
  });
  bankSel.addEventListener("change", remember);
  try {
    const saved = JSON.parse(sessionStorage.getItem("lesson-search") || "null");
    if (saved?.source === srcSel.value && [...bankSel.options].some((o) => o.value === saved.bank)) bankSel.value = saved.bank;
  } catch {
    /* фильтр необязателен */
  }
  search.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(search);
    resultsBox.innerHTML = `<p class="muted">Ищем…</p>`;
    try {
      let q = supa
        .from("tasks")
        .select("id, source, bank_file, source_ref, task_no, topic, answer_mode, list_item, is_published")
        .eq("source", f.get("source"))
        .eq("bank_file", f.get("bank"))
        .order("position")
        .limit(400);
      if (f.get("own")) q = q.eq("is_own", true);
      const text = String(f.get("q") || "").trim();
      if (text) q = /^L?\d+$/.test(text) ? q.eq("source_ref", text) : q.ilike("list_item->>questionText", `%${text}%`);
      const { data, error } = await q;
      if (error) throw humanError(error);
      let list = (data || []).filter((t) => !items.some((it) => it.task_id === t.id));
      const worked = await workedMap(list.map((t) => t.id));
      if (f.get("hideworked")) list = list.filter((t) => !worked.has(t.id));
      const total = list.length;
      list = list.slice(0, 60);
      let added = 0;
      resultsBox.innerHTML = list.length
        ? `<p class="l-added card" id="l-added" hidden><span></span> <button type="button" class="btn secondary" id="l-added-reload">Обновить список заданий</button></p>
          <p class="muted">Показано ${list.length} из ${total}. «Уже решали» — кто из учеников этой работы отвечал на задание раньше (✓ верно, ✗ неверно).</p>
          <div class="lit-list l-results">${list
            .map(
              (t) => `
            <div class="lit-item">
              <span class="lit-item-n"><input type="checkbox" data-pick="${t.id}" aria-label="Отметить" /></span>
              <span class="lit-item-body">
                <strong><a href="${taskHref(t)}" target="_blank">№ ${escapeHtml(String(t.source_ref))}</a> · ${escapeHtml(MODE_LABEL[t.answer_mode] || "")}</strong>
                <span>${escapeHtml(snippet(t, 220))}</span>
                ${workedBadge(worked.get(t.id))}
              </span>
              <button class="btn secondary l-add-one" data-add="${t.id}" type="button">Добавить</button>
            </div>`
            )
            .join("")}</div>
          <p class="actions"><button class="btn" id="l-add-picked">Добавить отмеченные</button></p>`
        : `<p class="muted">Ничего не нашлось.</p>`;
      resultsBox.querySelectorAll("[data-add]").forEach((b) =>
        b.addEventListener("click", async () => {
          b.disabled = true;
          b.textContent = "Добавлено";
          const t = list.find((x) => x.id === Number(b.dataset.add));
          try {
            await insertItems(id, [t], readDefaults(), items.length);
            items.push({ task_id: t.id });
            added += 1;
            const note = resultsBox.querySelector("#l-added");
            note.hidden = false;
            note.querySelector("span").textContent = `Добавлено: ${added}.`;
          } catch (err) {
            alert(err.message);
            b.disabled = false;
            b.textContent = "Добавить";
          }
        })
      );
      resultsBox.querySelector("#l-added-reload")?.addEventListener("click", reload);
      resultsBox.querySelector("#l-add-picked")?.addEventListener("click", () => {
        const picked = new Set([...resultsBox.querySelectorAll("[data-pick]:checked")].map((c) => Number(c.dataset.pick)));
        addTasks(list.filter((t) => picked.has(t.id)));
      });
    } catch (err) {
      resultsBox.innerHTML = `<p class="lit-result is-bad">${escapeHtml(err.message)}</p>`;
    }
  });

  // Копия и удаление
  const copyForm = host.querySelector("#l-copy");
  bindPicker(copyForm);
  copyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const groupId = new FormData(copyForm).get("group_id") || null;
    const picked = pickedStudents(copyForm);
    if (!groupId && !picked.length) return alert("Выберите группу и/или учеников.");
    const { data: copy, error } = await supa
      .from("lessons")
      .insert({
        title: lesson.title, notes: lesson.notes, starts_at: lesson.starts_at, closes_at: lesson.closes_at, kind: lesson.kind,
        exam_code: lesson.exam_code, duration_minutes: lesson.duration_minutes, show_results: lesson.show_results, group_id: groupId,
      })
      .select("id")
      .single();
    if (error) return alert(humanError(error).message);
    if (picked.length) await supa.from("lesson_assignees").insert(picked.map((s) => ({ lesson_id: copy.id, student_id: s })));
    if (items.length) {
      const rows = items.map((it) => ({
        lesson_id: copy.id, task_id: it.task_id, position: it.position, kind: it.kind, reveal: it.reveal,
        attempts_limit: it.attempts_limit, due_at: it.due_at, hidden: it.hidden,
      }));
      const { error: e2 } = await supa.from("lesson_items").insert(rows);
      if (e2) return alert(humanError(e2).message);
    }
    location.hash = `#/cabinet/lesson/${copy.id}`;
  });
  host.querySelector("#l-delete").addEventListener("click", async () => {
    if (!confirm("Удалить целиком? Задания останутся в банке, ответы учеников — в их истории. Отменить нельзя.")) return;
    const { error } = await supa.from("lessons").delete().eq("id", id);
    if (error) return alert(humanError(error).message);
    location.hash = "#/cabinet/lessons";
  });
}

/* ================================================================== */
/* УЧЕНИК                                                               */
/* ================================================================== */

const KIND_LABEL = { lesson: "Занятие", written: "Письменная работа", test: "Контрольная работа", exam: "Пробный экзамен" };

/** Блок «Мои занятия и работы» для личного кабинета. */
export async function myLessonsHtml({ today = false } = {}) {
  const { data: lessons } = await supa
    .from("lessons")
    .select("id, title, status, kind, duration_minutes, starts_at, closes_at, notes, lesson_items(id, due_at, kind)")
    .order("starts_at", { ascending: false, nullsFirst: true })
    .limit(40);
  if (!lessons?.length) return "";
  const ids = lessons.flatMap((l) => (l.lesson_items || []).map((i) => i.id));
  const uid = currentUser()?.id;
  const [{ data: att }, { data: works }, { data: sessions }] = await Promise.all([
    ids.length ? supa.from("attempts").select("item_id, is_correct").eq("student_id", uid).in("item_id", ids) : { data: [] },
    ids.length ? supa.from("written_works").select("item_id, status").eq("student_id", uid).in("item_id", ids) : { data: [] },
    supa.from("exam_sessions").select("lesson_id, started_at, finished_at").eq("student_id", uid),
  ]);
  const done = (itemId) =>
    (att || []).some((a) => a.item_id === itemId) || (works || []).some((w) => w.item_id === itemId && w.status !== "draft");
  if (today) return todayLessonsHtml(lessons, done, sessions || []);
  const rows = lessons
    .map((l) => {
      const its = l.lesson_items || [];
      const n = its.filter((i) => done(i.id)).length;
      const due = its.map((i) => i.due_at).filter(Boolean).sort()[0];
      const s = (sessions || []).find((x) => x.lesson_id === l.id);
      let state = "";
      if (l.duration_minutes) {
        const ends = s ? new Date(s.started_at).getTime() + l.duration_minutes * 60000 : 0;
        state = !s ? `не начата · ${durationText(l.duration_minutes)}` : s.finished_at || Date.now() > ends ? "сдана" : "идёт — вернитесь к работе";
      }
      return `
      <a class="lit-item${(l.duration_minutes ? state === "сдана" : n === its.length && its.length) ? " is-done" : ""}" href="#/lesson/${l.id}">
        <span class="lit-item-n">${l.duration_minutes ? "⏱" : `${n}/${its.length}`}</span>
        <span class="lit-item-body">
          <strong>${escapeHtml(l.title)}</strong>
          <span>${escapeHtml(KIND_LABEL[l.kind] || "Занятие")}${l.starts_at ? ` · ${fmtDT(l.starts_at)}` : ""}${due ? ` · сдать до ${fmtDT(due)}` : ""}${l.closes_at && !s ? ` · начать до ${fmtDT(l.closes_at)}` : ""}${l.status === "done" ? " · завершено" : ""}</span>
          ${state ? `<span class="l-st ${state === "сдана" ? "is-ok" : "is-wait"}">${escapeHtml(state)}</span>` : ""}
        </span>
      </a>`;
    })
    .join("");
  return `<section class="me-section"><h2>Мои занятия и работы</h2><div class="lit-list">${rows}</div></section>`;
}

/** «сегодня до 18:00», «завтра до 9:30», «до 17 нояб., 18:00». */
function fmtDue(d) {
  const t = new Date(d);
  const time = t.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(t) - day(new Date())) / 86400000);
  if (diff === 0) return `сегодня до ${time}`;
  if (diff === 1) return `завтра до ${time}`;
  if (diff < 0) return `срок прошёл ${t.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`;
  return `до ${t.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}, ${time}`;
}

/** Главная ученика: только то, что ещё нужно сделать, — ближайший срок сверху. */
function todayLessonsHtml(lessons, done, sessions) {
  const now = Date.now();
  const open = lessons
    .map((l) => {
      const its = l.lesson_items || [];
      const n = its.filter((i) => done(i.id)).length;
      const due = its.map((i) => i.due_at).filter(Boolean).sort()[0] || null;
      const s = sessions.find((x) => x.lesson_id === l.id);
      let finished = n === its.length && its.length > 0;
      let state = "";
      if (l.duration_minutes) {
        const ends = s ? new Date(s.started_at).getTime() + l.duration_minutes * 60000 : 0;
        finished = !!s && (!!s.finished_at || now > ends);
        state = !s ? `${durationText(l.duration_minutes)} на работу` : "идёт — вернись к работе";
      }
      const closed = l.closes_at && !s && new Date(l.closes_at).getTime() < now;
      return { l, its, n, due, finished: finished || closed || l.status === "done", state, live: !!s && !finished };
    })
    .filter((x) => !x.finished && x.its.length)
    .sort((a, b) => (b.live - a.live) || ((a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity)));
  if (!open.length) return "";
  return open
    .map(({ l, its, n, due, state, live }) => {
      const pct = its.length ? Math.round((100 * n) / its.length) : 0;
      const soon = due && Date.parse(due) - now < 36 * 3600000;
      return `
      <a class="today-card${live ? " is-live" : ""}" href="#/lesson/${l.id}">
        <span class="today-chips">
          <span class="chip">${escapeHtml(KIND_LABEL[l.kind] || "Занятие")}</span>
          ${due ? `<span class="chip ${soon ? "is-hot" : ""}">${fmtDue(due)}</span>` : ""}
          ${l.closes_at ? `<span class="chip">начать ${fmtDue(l.closes_at).replace(/^до /, "до ")}</span>` : ""}
        </span>
        <strong>${escapeHtml(l.title)}</strong>
        ${
          l.kind === "written"
            ? `<span class="muted">${due && Date.parse(due) < now ? "Срок прошёл — сдай как можно скорее" : "Напиши и отправь на проверку"}</span>`
            : l.duration_minutes
            ? `<span class="muted">${escapeHtml(state)}</span>`
            : `<span class="muted">${its.length} ${its.length % 10 === 1 && its.length % 100 !== 11 ? "задание" : its.length % 10 >= 2 && its.length % 10 <= 4 && (its.length % 100 < 12 || its.length % 100 > 14) ? "задания" : "заданий"} · сделано ${n}</span>
               <span class="today-bar"><span style="width:${pct}%"></span></span>`
        }
      </a>`;
    })
    .join("");
}

async function loadMyLesson(id) {
  const { data: lesson, error } = await supa
    .from("lessons")
    .select("id, title, status, kind, exam_code, duration_minutes, starts_at, closes_at, show_results, notes")
    .eq("id", id)
    .maybeSingle();
  if (error) throw humanError(error);
  if (!lesson) return null;
  const { data: items } = await supa
    .from("lesson_items")
    .select("id, position, kind, reveal, attempts_limit, due_at, revealed, task_id, tasks(id, source, bank_file, source_ref, task_no, topic, answer_mode, list_item, data, passage_id)")
    .eq("lesson_id", id)
    .order("position")
    .order("added_at");
  return { lesson, items: items || [] };
}

function itemStatus(it, att, works, timed) {
  if (TEACHER_CHECKED.has(it.tasks?.answer_mode)) {
    const w = works.find((x) => x.item_id === it.id);
    if (!w) return ["", "не начато"];
    return {
      draft: ["is-wait", timed ? "сохранено (сдастся при завершении)" : "черновик"],
      submitted: ["is-wait", "на проверке"],
      returned: ["is-bad", "вернули на доработку"],
      graded: ["is-ok", `оценено${w.score != null ? `: ${w.score}${w.max_score ? `/${w.max_score}` : ""}` : ""}`],
    }[w.status];
  }
  const list = att.filter((a) => a.item_id === it.id);
  if (!list.length) return ["", timed ? "нет ответа" : "не начато"];
  if (it.kind === "test" && !it.revealed && (!it.due_at || new Date(it.due_at) > new Date())) {
    return ["is-wait", timed ? `ответ: ${list.at(-1).answer}` : "ответ принят"];
  }
  if (list.some((a) => a.is_correct)) return ["is-ok", "решено"];
  const left = it.attempts_limit ? it.attempts_limit - list.length : null;
  return ["is-bad", left === 0 ? "неверно, попытки закончились" : `неверно${left ? `, осталось попыток: ${left}` : ""}`];
}

export async function mountLesson(root, parts) {
  const host = root.querySelector("#lesson-root");
  if (!host) return;
  const [id, itemId] = parts;
  if (!currentUser()) {
    location.hash = `#/login?next=${encodeURIComponent(location.hash)}`;
    return;
  }
  const again = () => mountLesson(root, parts);
  try {
    const st = await loadMyLesson(id);
    if (!st) {
      host.innerHTML = `<div class="empty">Не найдено или ещё не открыто. <a href="#/me">В кабинет</a></div>`;
      return;
    }
    const uid = currentUser().id;
    const ids = st.items.map((i) => i.id);
    const [{ data: att }, { data: works }] = ids.length
      ? await Promise.all([
          supa.from("attempts").select("item_id, is_correct, answer, created_at").eq("student_id", uid).in("item_id", ids).order("created_at"),
          supa.from("written_works").select("item_id, status, score, max_score").eq("student_id", uid).in("item_id", ids),
        ])
      : [{ data: [] }, { data: [] }];

    // Работа на время: старт → таймер → итог
    if (st.lesson.duration_minutes) {
      const state = await examState(id);
      if (!state.started_at) {
        host.innerHTML = introHtml(st.lesson, st.items.length);
        bindIntro(host, st.lesson, again);
        return;
      }
      if (state.over) {
        const visible = st.lesson.show_results === "after_finish" || (st.items.length && st.items.every((i) => i.revealed));
        if (itemId) return lessonTask(host, st, itemId, att || [], { mode: "over", visible });
        host.innerHTML = resultsHtml(st.lesson, st.items, att || [], works || [], visible);
        return;
      }
      if (itemId) {
        await lessonTask(host, st, itemId, att || [], { mode: "timed" });
      } else {
        lessonOverview(host, st, att || [], works || [], true);
      }
      host.insertAdjacentHTML("afterbegin", timerHtml(st.lesson));
      bindTimer(host, st.lesson, st.items, state, () => {
        location.hash = `#/lesson/${id}`;
        again();
      });
      return;
    }
    // письменная работа из одного задания — сразу к заданию, без лишнего списка
    if (!itemId && st.lesson.kind === "written" && st.items.length === 1) return lessonTask(host, st, st.items[0].id, att || [], { mode: "normal", single: true });
    if (!itemId) return lessonOverview(host, st, att || [], works || [], false);
    return lessonTask(host, st, itemId, att || [], { mode: "normal" });
  } catch (err) {
    host.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

function lessonOverview(host, { lesson, items }, att, works, timed) {
  const rows = items
    .map((it, i) => {
      const [cls, text] = itemStatus(it, att, works, timed);
      return `
      <a class="lit-item ${cls === "is-ok" ? "is-done" : ""}" href="#/lesson/${lesson.id}/${it.id}">
        <span class="lit-item-n">${lesson.kind === "exam" ? it.tasks?.task_no ?? i + 1 : i + 1}</span>
        <span class="lit-item-body">
          <strong>${escapeHtml(SOURCES[it.tasks?.source]?.title || "")}, задание ${it.tasks?.task_no ?? ""}${lesson.kind === "lesson" ? ` · ${escapeHtml(KIND[it.kind])}` : ""}</strong>
          <span>${escapeHtml(snippet(it.tasks, 160))}</span>
          <span class="l-st ${cls}">${escapeHtml(text)}${it.due_at ? ` · до ${fmtDT(it.due_at)}` : ""}</span>
        </span>
      </a>`;
    })
    .join("");
  host.innerHTML = `
    <p class="crumbs"><a href="#/me">← Главная</a></p>
    <p class="eyebrow">${escapeHtml(KIND_LABEL[lesson.kind] || "Занятие")}${lesson.starts_at ? ` · ${fmtDT(lesson.starts_at)}` : ""}${lesson.status === "done" ? " · завершено" : ""}</p>
    <h1>${escapeHtml(lesson.title)}</h1>
    ${lesson.notes ? `<p class="lede">${escapeHtml(lesson.notes)}</p>` : ""}
    <div class="lit-list">${rows || '<p class="muted">Заданий пока нет — преподаватель добавит их.</p>'}</div>`;
}

async function lessonTask(host, { lesson, items }, itemId, att, { mode = "normal", visible = false, single = false } = {}) {
  const i = items.findIndex((x) => x.id === itemId);
  if (i < 0) {
    host.innerHTML = `<div class="empty">Задание не найдено. <a href="#/lesson/${lesson.id}">Ко всем заданиям</a></div>`;
    return;
  }
  const it = items[i];
  const t = it.tasks;
  if (!t) {
    host.innerHTML = `<div class="empty">Задание недоступно. <a href="#/lesson/${lesson.id}">Ко всем заданиям</a></div>`;
    return;
  }
  const sanitize = sanitizeFor(t.source);
  let passage = null;
  if (t.passage_id) {
    const { data } = await supa.from("passages").select("html").eq("id", t.passage_id).maybeSingle();
    passage = data?.html || null;
  }
  const written = TEACHER_CHECKED.has(t.answer_mode);
  let written_done = false;
  if (lesson.kind === "written" && it.due_at && new Date(it.due_at) < new Date()) {
    const { data: w } = await supa.from("written_works").select("status").eq("item_id", it.id).eq("student_id", currentUser()?.id).neq("status", "draft").limit(1);
    written_done = Boolean(w?.length);
  }
  const mine = att.filter((a) => a.item_id === it.id);
  const solved = mine.some((a) => a.is_correct);
  const hiddenTest = it.kind === "test" && !it.revealed && (!it.due_at || new Date(it.due_at) > new Date()) && !(mode === "over" && visible);
  const exhausted = it.attempts_limit != null && mine.length >= it.attempts_limit;
  const label = MODE_LABEL[t.answer_mode] || "Ответ";
  const numeric = ["digits-any", "digits-fixed", "numbers", "lit-match"].includes(t.answer_mode);
  const prev = items[i - 1];
  const next = items[i + 1];
  const timed = mode === "timed";
  const over = mode === "over";
  const history =
    mine.length && !written
      ? timed || (hiddenTest && lesson.kind !== "lesson")
        ? `<p class="l-history"><strong>Ваш ответ:</strong> ${escapeHtml(mine.at(-1).answer)}${timed ? ' <span class="muted">— можно изменить до конца времени</span>' : ""}</p>`
        : `<p class="muted l-history">Ваши ответы: ${mine
            .map((a) => `${escapeHtml(a.answer)}${hiddenTest ? "" : a.is_correct ? " ✓" : " ✗"}`)
            .join(", ")}${it.attempts_limit ? ` · попыток ${mine.length} из ${it.attempts_limit}` : ""}</p>`
      : "";
  const lastOk = Boolean(mine.at(-1)?.is_correct);
  const showCheck = !written && !over && !(solved && !hiddenTest && !timed) && !exhausted;
  host.innerHTML = `
    <p class="crumbs">${single ? `<a href="#/me">← Главная</a>` : `<a href="#/lesson/${lesson.id}">← ${escapeHtml(lesson.title)}</a>`}</p>
    <article class="lit-problem">
      ${
        lesson.kind === "written"
          ? `<p class="eyebrow">Письменная работа${it.due_at ? ` · сдать до ${fmtDT(it.due_at)}` : ""}</p>
      <h1>${escapeHtml(lesson.title)}</h1>
      ${it.due_at && new Date(it.due_at) < new Date() && !written_done ? `<p class="lit-result is-bad">Срок сдачи прошёл. Всё равно напиши и отправь — преподаватель увидит, что работа сдана позже.</p>` : ""}
      ${lesson.notes ? `<p class="l-note">${escapeHtml(lesson.notes)}</p>` : ""}`
          : `<p class="eyebrow">${lesson.kind === "lesson" ? escapeHtml(KIND[it.kind]) : escapeHtml(KIND_LABEL[lesson.kind])} · ${i + 1} из ${items.length}${it.due_at ? ` · сдать до ${fmtDT(it.due_at)}` : ""}</p>
      <h1>${escapeHtml(SOURCES[t.source]?.title || "")}, задание ${t.task_no ?? ""}</h1>`
      }
      ${passage ? `<section class="lit-passage"><p class="lit-kicker">Текст</p><div class="lit-html">${sanitize(passage)}</div></section>` : ""}
      <section class="lit-question"><div class="lit-html">${sanitize(t.data?.questionHtml || "")}</div></section>
      ${history}
      ${written ? writtenBlockHtml() : showCheck ? checkBlockHtml({ label, placeholder: numeric ? "Например: 24" : "Введите ответ", numeric }) : `<div id="pr-solution"></div>`}
      ${single ? "" : `<div class="lit-pager">
        ${prev ? `<a href="#/lesson/${lesson.id}/${prev.id}">← Предыдущее</a>` : "<span></span>"}
        <a href="#/lesson/${lesson.id}" class="muted">Все задания</a>
        ${next ? `<a href="#/lesson/${lesson.id}/${next.id}">Следующее →</a>` : "<span></span>"}
      </div>`}
    </article>`;
  const problem = { ...t.data, _tid: t.id };
  if (written) {
    bindWritten(host, problem, {
      sanitize,
      item: it,
      label: t.answer_mode === "essay" ? "Сочинение" : "Ваш ответ",
      noSubmit: timed,
      readOnly: over,
    });
    return;
  }
  if (showCheck) {
    bindCheck(host, problem, {
      sanitize,
      item: it,
      examMode: timed,
    });
    return;
  }
  const box = host.querySelector("#pr-solution");
  if (hiddenTest) {
    box.innerHTML = `<p class="lit-result">${mine.length ? "Ответ сохранён." : "Ответа нет."} Результат появится после проверки.</p>`;
    return;
  }
  try {
    const res = await showSolution(t.id, it.id);
    const verdict = over || lesson.kind !== "lesson"
      ? mine.length ? (lastOk ? "Верно." : "Неверно.") : "Ответа не было."
      : solved ? "Решено верно." : "Попытки закончились.";
    const ok = over || lesson.kind !== "lesson" ? lastOk : solved;
    box.innerHTML = res.locked
      ? `<p class="lit-result">${escapeHtml(verdict)} ${escapeHtml(REVEAL_HINT_STUDENT[it.reveal] || "")}</p>`
      : `<p class="lit-result ${ok ? "is-ok" : "is-bad"}">${escapeHtml(verdict)}</p>
         <details class="lit-solution" open><summary>Разбор</summary>${res.answer && !res.solution ? `<p class="pr-answer-key"><strong>Ответ:</strong> ${escapeHtml(String(res.answer).replace(/\|/g, " или "))}</p>` : ""}<div class="lit-html">${sanitize(res.solution || "")}</div></details>`;
  } catch (err) {
    box.innerHTML = `<p class="lit-result is-bad">${escapeHtml(err.message)}</p>`;
  }
}

const REVEAL_HINT_STUDENT = {
  after_due: "Разбор откроется после срока сдачи.",
  after_review: "Разбор откроется после проверки.",
  manual: "Разбор откроет преподаватель.",
};

export function lessonPage() {
  return `<div id="lesson-root"><p class="lede muted">Загружаем…</p></div>`;
}
