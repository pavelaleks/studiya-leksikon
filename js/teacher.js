/** Кабинет преподавателя: #/cabinet/... */
import { BASE } from "./config.js";
import { escapeHtml } from "./ui.js";
import { taskHref } from "./account.js?v=land66";
import { clearBankCache, currentUser, humanError, isTeacher, signedFileUrl, supa } from "./supa.js";

/* ------------------------------------------------------------------ */
/* Справочники                                                          */
/* ------------------------------------------------------------------ */

const SOURCES = {
  "ege-rus": { title: "ЕГЭ · русский язык", manifest: "js/russian-data/manifest.json", dir: "js/russian-data" },
  "oge-rus": { title: "ОГЭ · русский язык", manifest: "js/oge-data/manifest.json", dir: "js/oge-data" },
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

async function bankFiles(source) {
  const m = await manifest(source);
  return (m.files || [])
    .map((f) => ({ ...f, bank: bankIdOf(f.file) }))
    .sort((a, b) => (a.kind === b.kind ? a.task - b.task : a.kind === "extra" ? 1 : -1));
}

function defaultMode(source, taskNo) {
  if (source === "ege-rus") return taskNo === 27 ? "essay" : "digits-any";
  if (source === "oge-rus") return taskNo === 1 || taskNo === 13 ? "essay" : "digits-any";
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
  ["students", "Ученики"],
  ["works", "Проверка работ"],
  ["bank", "Банк заданий"],
  ["groups", "Группы"],
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
    location.hash = `#/login?next=${encodeURIComponent(location.hash)}`;
    return;
  }
  if (!isTeacher()) {
    host.innerHTML = `<div class="empty">Этот раздел — только для преподавателя. <a href="#/me">В личный кабинет</a></div>`;
    return;
  }
  const [tab = "students", sub, arg] = parts;
  const b = await badges().catch(() => ({}));
  const render = (body) => (host.innerHTML = shell(tab === "student" ? "students" : tab, body, b));
  try {
    if (tab === "students") return await studentsView(host, render);
    if (tab === "student") return await studentView(host, render, sub);
    if (tab === "works") return await worksView(host, render, sub);
    if (tab === "groups") return await groupsView(host, render);
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

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("ru-RU") : "");
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "");

/* ------------------------------------------------------------------ */
/* Ученики                                                              */
/* ------------------------------------------------------------------ */

async function studentsView(host, render) {
  const [{ data: people, error }, { data: groups }, { data: members }] = await Promise.all([
    supa.from("profiles").select("*").neq("role", "teacher").order("created_at", { ascending: false }),
    supa.from("groups").select("id, title").eq("archived", false).order("title"),
    supa.from("group_members").select("group_id, student_id"),
  ]);
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
          <span class="muted">${escapeHtml(p.email || "")} · ${p.grade ? `${p.grade} кл.` : ""} ${escapeHtml(p.exam_target || "")} · ${escapeHtml(p.study_format || "")}</span>
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
        <td>${escapeHtml(p.exam_target || "")}</td>
        <td>${escapeHtml(groupsOf(p.id).join(", "))}</td>
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

  render(`
    <h1>Ученики</h1>
    <section class="me-section">
      <h2>Заявки на доступ ${pending.length ? `<span class="badge">${pending.length}</span>` : ""}</h2>
      <p class="muted">Ученик регистрируется сам на странице «Войти». Пока вы не подтвердите, он видит только демо-задания.</p>
      ${pendingHtml}
    </section>
    <section class="me-section">
      <h2>Все ученики · ${rest.length}</h2>
      <input class="search" id="t-q" type="search" placeholder="Поиск по имени, почте, цели" />
      <div class="t-table-wrap"><table class="t-table">
        <thead><tr><th>Ученик</th><th>Класс</th><th>Цель</th><th>Группы</th><th>Статус</th><th>Доступ до</th><th></th></tr></thead>
        <tbody>${restHtml || `<tr><td colspan="7" class="muted">Пока никого.</td></tr>`}</tbody>
      </table></div>
    </section>`);

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
    <p class="lede">${escapeHtml(p.email || "")} · ${STATUS_TEXT[p.status]}${p.grade ? ` · ${p.grade} класс` : ""}${p.exam_target ? ` · ${escapeHtml(p.exam_target)}` : ""}${p.contact ? ` · ${escapeHtml(p.contact)}` : ""}</p>
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
    </section>`);
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
  const { data, error } = await supa
    .from("written_works")
    .select("id, status, submitted_at, score, max_score, body, profiles(full_name, email), tasks(source, task_no, source_ref)")
    .in("status", ["submitted", "returned", "graded"])
    .order("submitted_at", { ascending: false })
    .limit(200);
  if (error) throw humanError(error);
  const row = (w) => `
    <a class="lit-item" href="#/cabinet/works/${w.id}">
      <span class="lit-item-n">${w.tasks?.task_no ?? "·"}</span>
      <span class="lit-item-body">
        <strong>${escapeHtml(w.profiles?.full_name || w.profiles?.email || "ученик")} · ${escapeHtml(SOURCES[w.tasks?.source]?.title || "")} № ${w.tasks?.task_no ?? ""}</strong>
        <span>${WORK_STATUS[w.status]} · ${fmtDateTime(w.submitted_at)}${w.score != null ? ` · ${w.score}${w.max_score ? `/${w.max_score}` : ""}` : ""}</span>
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
    .select("*, profiles(full_name, email), tasks(id, source, task_no, source_ref, data, passage_id)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw humanError(error);
  if (!w) return render(`<div class="empty">Работа не найдена.</div>`);
  const { data: full } = w.task_id ? await supa.rpc("teacher_get_task", { p_task: w.task_id }) : { data: null };
  const photos = await Promise.all(
    (w.files || []).map(async (p) => {
      try {
        const url = await signedFileUrl(p);
        return /\.pdf$/i.test(p)
          ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">PDF</a>`
          : `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="фото работы" class="t-photo" /></a>`;
      } catch {
        return "";
      }
    })
  );
  const crit = w.criteria ? Object.entries(w.criteria).map(([k, v]) => `${k}: ${v}`).join("\n") : "";
  render(`
    <p class="crumbs"><a href="#/cabinet/works">← Все работы</a></p>
    <h1>${escapeHtml(w.profiles?.full_name || w.profiles?.email || "Работа")}</h1>
    <p class="lede">${escapeHtml(SOURCES[w.tasks?.source]?.title || "")} · задание ${w.tasks?.task_no ?? ""} · № ${escapeHtml(String(w.tasks?.source_ref || ""))} · ${WORK_STATUS[w.status]} · сдано ${fmtDateTime(w.submitted_at)}</p>
    <details class="lit-solution"><summary>Условие задания</summary><div class="lit-html">${w.tasks?.data?.questionHtml || ""}</div></details>
    ${full?.key?.solution_html ? `<details class="lit-solution"><summary>Образец / пояснение</summary><div class="lit-html">${full.key.solution_html}</div></details>` : ""}
    <section class="me-section">
      <h2>Ответ ученика</h2>
      <div class="card t-work-body">${escapeHtml(w.body || "").replace(/\n/g, "<br>") || '<span class="muted">Текста нет — смотрите фото.</span>'}</div>
      ${photos.length ? `<div class="t-photos">${photos.join("")}</div>` : ""}
      <p class="muted">${(w.body || "").trim().split(/\s+/).filter(Boolean).length} слов</p>
    </section>
    <section class="me-section">
      <h2>Оценка</h2>
      <form id="t-grade" class="stack card" style="padding:20px">
        <div class="grid-2">
          <label>Балл<input name="score" type="number" step="0.5" min="0" value="${w.score ?? ""}" /></label>
          <label>Из скольких<input name="max_score" type="number" step="0.5" min="0" value="${w.max_score ?? ""}" /></label>
        </div>
        <label>Критерии (по строке: К1: 1)<textarea name="criteria" placeholder="К1: 1&#10;К2: 3&#10;К3: 2">${escapeHtml(crit)}</textarea></label>
        <label>Комментарий ученику<textarea name="comment" style="min-height:140px">${escapeHtml(w.teacher_comment || "")}</textarea></label>
        <div class="actions">
          <button class="btn" type="submit" name="act" value="graded">Оценить</button>
          <button class="btn secondary" type="submit" name="act" value="returned">Вернуть на доработку</button>
        </div>
        <p class="lit-result" id="t-grade-status"></p>
      </form>
    </section>`);
  host.querySelector("#t-grade").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const criteria = {};
    String(f.get("criteria") || "")
      .split("\n")
      .map((l) => l.split(/[:=]/))
      .forEach(([k, v]) => {
        if (k && k.trim() && v !== undefined) criteria[k.trim()] = isNaN(Number(v)) ? v.trim() : Number(v);
      });
    const num = (v) => (v === "" || v === null ? null : Number(v));
    const { error: err } = await supa
      .from("written_works")
      .update({
        status: e.submitter?.value || "graded",
        score: num(f.get("score")),
        max_score: num(f.get("max_score")),
        criteria: Object.keys(criteria).length ? criteria : null,
        teacher_comment: String(f.get("comment") || "").trim() || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);
    const st = host.querySelector("#t-grade-status");
    st.className = `lit-result ${err ? "is-bad" : "is-ok"}`;
    st.textContent = err ? humanError(err).message : "Сохранено — ученик увидит оценку в кабинете.";
  });
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
      <p>Переносит задания из JSON-файлов сайта (ЕГЭ и ОГЭ по русскому, литература) в базу. Ответы и разборы попадают в закрытую таблицу.
      Первые ${DEMO_PER_FILE} задания каждого номера отмечаются как демо для гостей — это можно поменять в банке.</p>
      <p>Сейчас в базе импортированных заданий: <strong>${count ?? 0}</strong>. Повторный импорт безопасен: задания обновятся, ваши авторские не тронутся.</p>
      <p class="muted">Импорт работает там, где лежат файлы банка (локальная копия сайта). Займёт несколько минут — не закрывайте вкладку.</p>
      <div class="actions">
        <label class="t-inline"><input type="checkbox" name="s" value="ege-rus" checked /> ЕГЭ · русский</label>
        <label class="t-inline"><input type="checkbox" name="s" value="oge-rus" checked /> ОГЭ · русский</label>
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
