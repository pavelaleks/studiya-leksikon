/**
 * Занятия.
 *  Преподаватель: #/cabinet/lessons — список и создание; #/cabinet/lesson/:id — конструктор и живая таблица.
 *  Ученик: #/lesson/:id — задания урока; #/lesson/:id/:item — одно задание с проверкой по правилам урока.
 */
import { BASE } from "./config.js";
import { escapeHtml } from "./ui.js";
import { taskHref } from "./account.js?v=land70";
import { bindCheck, bindWritten, checkBlockHtml, writtenBlockHtml } from "./practice.js?v=land70";
import { SOURCES, bankFiles } from "./teacher.js?v=land70";
import { currentUser, humanError, showSolution, supa } from "./supa.js";

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
const shortSource = (s) => ({ "ege-rus": "ЕГЭ", "oge-rus": "ОГЭ", "ege-lit": "Лит." }[s] || s);

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

export async function lessonsListView(host, render) {
  const [{ data: lessons, error }, { data: groups }, { data: students }, { data: items }] = await Promise.all([
    supa
      .from("lessons")
      .select("id, title, status, starts_at, created_at, group_id, student_id, groups(title), profiles(full_name, email)")
      .order("starts_at", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false }),
    supa.from("groups").select("id, title").eq("archived", false).order("title"),
    supa.from("profiles").select("id, full_name, email").neq("role", "teacher").eq("status", "active").order("full_name"),
    supa.from("lesson_items").select("lesson_id"),
  ]);
  if (error) throw humanError(error);
  const count = (id) => (items || []).filter((i) => i.lesson_id === id).length;
  const rows = (lessons || [])
    .map(
      (l) => `
      <a class="lit-item" href="#/cabinet/lesson/${l.id}">
        <span class="lit-item-n">${count(l.id)}</span>
        <span class="lit-item-body">
          <strong>${escapeHtml(l.title)}</strong>
          <span>${escapeHtml(l.groups?.title || l.profiles?.full_name || l.profiles?.email || "")}${l.starts_at ? ` · ${fmtDT(l.starts_at)}` : ""}</span>
          <span class="lesson-status lesson-${l.status}">${LESSON_STATUS[l.status]}</span>
        </span>
      </a>`
    )
    .join("");
  const groupOpts = (groups || []).map((g) => `<option value="g:${g.id}">Группа: ${escapeHtml(g.title)}</option>`).join("");
  const studentOpts = (students || [])
    .map((s) => `<option value="s:${s.id}">Ученик: ${escapeHtml(s.full_name || s.email)}</option>`)
    .join("");
  render(`
    <h1>Занятия</h1>
    <form id="l-new" class="card t-filter">
      <label>Тема занятия<input name="title" required placeholder="Задание 16: запятые при однородных членах" /></label>
      <label>Для кого<select name="target" required><option value="">— выберите —</option>${groupOpts}${studentOpts}</select></label>
      <label>Когда<input type="datetime-local" name="starts_at" /></label>
      <button class="btn" type="submit">Создать занятие</button>
    </form>
    ${!groupOpts && !studentOpts ? `<p class="muted">Сначала создайте группу или подтвердите ученика — занятие привязывается к группе или к одному ученику.</p>` : ""}
    <p class="muted">Новое занятие — черновик: ученики увидят его, когда вы нажмёте «Открыть ученикам».</p>
    <div class="lit-list">${rows || '<p class="muted">Занятий пока нет.</p>'}</div>`);
  host.querySelector("#l-new").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const [kind, id] = String(f.get("target")).split(":");
    const row = {
      title: String(f.get("title")).trim(),
      starts_at: fromLocalInput(f.get("starts_at")),
      group_id: kind === "g" ? id : null,
      student_id: kind === "s" ? id : null,
    };
    const { data, error: err } = await supa.from("lessons").insert(row).select("id").single();
    if (err) return alert(humanError(err).message);
    location.hash = `#/cabinet/lesson/${data.id}`;
  });
}

async function loadLesson(id) {
  const { data: lesson, error } = await supa
    .from("lessons")
    .select("*, groups(id, title), profiles(id, full_name, email)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw humanError(error);
  if (!lesson) return null;
  const [{ data: items }, roster] = await Promise.all([
    supa
      .from("lesson_items")
      .select("*, tasks(id, source, bank_file, source_ref, task_no, topic, answer_mode, list_item, is_published)")
      .eq("lesson_id", id)
      .order("position")
      .order("added_at"),
    lesson.group_id
      ? supa.from("group_members").select("student_id, profiles(full_name, email)").eq("group_id", lesson.group_id)
      : Promise.resolve({ data: [{ student_id: lesson.student_id, profiles: lesson.profiles }] }),
  ]);
  const students = (roster.data || [])
    .map((m) => ({ id: m.student_id, name: m.profiles?.full_name || m.profiles?.email || "ученик" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return { lesson, items: items || [], students };
}

async function loadBoard(items) {
  const ids = items.map((i) => i.id);
  if (!ids.length) return { attempts: [], works: [] };
  const [a, w] = await Promise.all([
    supa.from("attempts").select("student_id, item_id, is_correct, answer, created_at").in("item_id", ids).order("created_at"),
    supa.from("written_works").select("id, student_id, item_id, status, score, max_score").in("item_id", ids),
  ]);
  return { attempts: a.data || [], works: w.data || [] };
}

function boardHtml({ items, students }, { attempts, works }) {
  if (!items.length) return `<p class="muted">Добавьте задания — здесь появится таблица ответов.</p>`;
  if (!students.length) return `<p class="muted">В группе пока нет учеников.</p>`;
  const head = items
    .map((it, i) => `<th title="${escapeHtml(snippet(it.tasks, 200))}">${i + 1}${it.hidden ? "<small> скр.</small>" : ""}</th>`)
    .join("");
  const cell = (st, it) => {
    if (TEACHER_CHECKED.has(it.tasks?.answer_mode)) {
      const w = works.find((x) => x.student_id === st.id && x.item_id === it.id);
      if (!w || w.status === "draft") return `<td class="b-empty">·</td>`;
      const txt = w.status === "graded" ? `${w.score ?? "✓"}` : w.status === "returned" ? "дораб." : "сдано";
      return `<td class="b-work b-${w.status}"><a href="#/cabinet/works/${w.id}">${txt}</a></td>`;
    }
    const list = attempts.filter((x) => x.student_id === st.id && x.item_id === it.id);
    if (!list.length) return `<td class="b-empty">·</td>`;
    const ok = list.some((x) => x.is_correct);
    const title = list.map((x) => `${x.answer}${x.is_correct ? " ✓" : " ✗"}`).join(", ");
    return `<td class="${ok ? "b-ok" : "b-bad"}" title="${escapeHtml(title)}">${ok ? "✓" : "✗"}${list.length > 1 ? `<small>${list.length}</small>` : ""}</td>`;
  };
  const rows = students
    .map((st) => {
      const solved = items.filter((it) =>
        TEACHER_CHECKED.has(it.tasks?.answer_mode)
          ? works.some((w) => w.student_id === st.id && w.item_id === it.id && w.status !== "draft")
          : attempts.some((x) => x.student_id === st.id && x.item_id === it.id && x.is_correct)
      ).length;
      return `<tr><th><a href="#/cabinet/student/${st.id}">${escapeHtml(st.name)}</a></th>${items.map((it) => cell(st, it)).join("")}<td class="b-sum">${solved}/${items.length}</td></tr>`;
    })
    .join("");
  const foot = items
    .map((it) => {
      if (TEACHER_CHECKED.has(it.tasks?.answer_mode)) {
        const n = new Set(works.filter((w) => w.item_id === it.id && w.status !== "draft").map((w) => w.student_id)).size;
        return `<td>${n}</td>`;
      }
      const tried = new Set(attempts.filter((x) => x.item_id === it.id).map((x) => x.student_id)).size;
      const ok = new Set(attempts.filter((x) => x.item_id === it.id && x.is_correct).map((x) => x.student_id)).size;
      return `<td title="решили / пробовали">${ok}/${tried}</td>`;
    })
    .join("");
  return `
    <div class="t-table-wrap"><table class="t-table board">
      <thead><tr><th>Ученик</th>${head}<th>Итого</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>Решили</th>${foot}<td></td></tr></tfoot>
    </table></div>
    <p class="muted">✓ — решено (маленькая цифра — сколько было попыток), ✗ — пока неверно, · — не приступал. Наведите на клетку, чтобы увидеть ответы. Таблица обновляется сама.</p>`;
}

function itemsTableHtml(items) {
  if (!items.length) return `<p class="muted">В занятии пока нет заданий. Добавьте их из банка ниже.</p>`;
  const sel = (name, map, value) =>
    `<select data-f="${name}">${Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === value ? "selected" : ""}>${v}</option>`).join("")}</select>`;
  return `
    <div class="t-table-wrap"><table class="t-table l-items">
      <thead><tr><th>#</th><th>Задание</th><th>Тип</th><th>Разбор открыть</th><th>Попыток</th><th>Срок</th><th>Показ</th><th></th></tr></thead>
      <tbody>${items
        .map(
          (it, i) => `
        <tr data-id="${it.id}" class="${it.hidden ? "l-hidden" : ""}">
          <td>${i + 1}</td>
          <td><a href="${taskHref(it.tasks)}" target="_blank">${shortSource(it.tasks?.source)} № ${it.tasks?.task_no ?? ""} · ${escapeHtml(String(it.tasks?.source_ref || ""))}</a>
              ${it.tasks?.is_published ? "" : ' <span class="badge">не в банке</span>'}
              <br><small class="muted">${escapeHtml(snippet(it.tasks))}</small></td>
          <td>${sel("kind", KIND, it.kind)}</td>
          <td>${sel("reveal", REVEAL, it.reveal)}${it.revealed ? '<br><small class="t-okc">открыт</small>' : ""}</td>
          <td><input type="number" min="1" max="20" data-f="attempts_limit" value="${it.attempts_limit ?? ""}" placeholder="∞" style="width:64px" /></td>
          <td><input type="datetime-local" data-f="due_at" value="${toLocalInput(it.due_at)}" /></td>
          <td><label class="t-inline"><input type="checkbox" data-f="hidden" ${it.hidden ? "" : "checked"} /> видно</label></td>
          <td class="l-row-actions">
            <button class="btn secondary" data-act="up" title="Выше">↑</button>
            <button class="btn secondary" data-act="down" title="Ниже">↓</button>
            <button class="btn secondary" data-act="reveal" title="Открыть разбор сейчас">${it.revealed ? "Закрыть разбор" : "Открыть разбор"}</button>
            <button class="btn secondary" data-act="remove" title="Убрать из занятия">✕</button>
          </td>
        </tr>`
        )
        .join("")}</tbody>
    </table></div>`;
}

async function addPanelHtml(defaults) {
  const files = await bankFiles("ege-rus");
  const kindSel = Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${k === defaults.kind ? "selected" : ""}>${v}</option>`).join("");
  const revealSel = Object.entries(REVEAL).map(([k, v]) => `<option value="${k}" ${k === defaults.reveal ? "selected" : ""}>${v}</option>`).join("");
  return `
    <form id="l-search" class="card t-filter">
      <label>Экзамен<select name="source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}">${v.title}</option>`).join("")}</select></label>
      <label>Номер<select name="bank">${files.map((f) => `<option value="${f.bank}" data-task="${f.task}">${f.kind === "extra" ? "доп. · " : `№ ${f.task} · `}${escapeHtml(f.title)}</option>`).join("")}</select></label>
      <label>Слова из условия<input name="q" placeholder="необязательно" /></label>
      <label class="t-inline"><input type="checkbox" name="fresh" checked /> только нерешённые учениками этого занятия</label>
      <label class="t-inline"><input type="checkbox" name="own" /> только мои задания</label>
      <button class="btn secondary" type="submit">Найти</button>
    </form>
    <div class="card t-filter l-defaults">
      <label>Тип новых заданий<select id="l-def-kind">${kindSel}</select></label>
      <label>Разбор открыть<select id="l-def-reveal">${revealSel}</select></label>
      <label>Попыток<input id="l-def-attempts" type="number" min="1" max="20" value="${defaults.attempts ?? ""}" placeholder="∞" /></label>
      <label>Срок<input id="l-def-due" type="datetime-local" /></label>
      <label class="t-inline"><input type="checkbox" id="l-def-hidden" /> добавить скрытыми (открою на уроке)</label>
    </div>
    <div class="actions l-random">
      <label class="t-inline">Случайные <input id="l-rand-n" type="number" min="1" max="30" value="5" style="width:64px" /> из выбранного номера</label>
      <button class="btn secondary" id="l-rand">Добавить случайные</button>
      <a class="btn secondary" href="#/cabinet/bank/new" target="_blank">Создать своё задание</a>
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
  if (!state) return render(`<div class="empty">Занятие не найдено. <a href="#/cabinet/lessons">К занятиям</a></div>`);
  const { lesson } = state;
  const target = lesson.groups?.title ? `группа «${lesson.groups.title}»` : `ученик ${lesson.profiles?.full_name || lesson.profiles?.email || ""}`;
  const defaults = JSON.parse(sessionStorage.getItem("lesson-defaults") || '{"kind":"classwork","reveal":"after_correct","attempts":3}');
  const [{ data: groups }, { data: students }] = await Promise.all([
    supa.from("groups").select("id, title").eq("archived", false).order("title"),
    supa.from("profiles").select("id, full_name, email").neq("role", "teacher").eq("status", "active").order("full_name"),
  ]);

  render(`
    <p class="crumbs"><a href="#/cabinet/lessons">← Все занятия</a></p>
    <form id="l-head" class="l-head">
      <input name="title" class="l-title" value="${escapeHtml(lesson.title)}" aria-label="Тема занятия" />
      <p class="lede">${escapeHtml(target)} · <span class="lesson-status lesson-${lesson.status}">${LESSON_STATUS[lesson.status]}</span></p>
      <div class="t-filter card">
        <label>Когда<input type="datetime-local" name="starts_at" value="${toLocalInput(lesson.starts_at)}" /></label>
        <label>Заметка к занятию (ученики видят)<input name="notes" value="${escapeHtml(lesson.notes || "")}" placeholder="Например: повторить § 25 перед уроком" /></label>
        <button class="btn secondary" type="submit">Сохранить</button>
      </div>
      <div class="actions">
        ${lesson.status !== "live" ? `<button class="btn" type="button" data-status="live">Открыть ученикам</button>` : ""}
        ${lesson.status === "live" ? `<button class="btn secondary" type="button" data-status="done">Завершить</button><button class="btn secondary" type="button" data-status="draft">Скрыть (черновик)</button>` : ""}
        ${lesson.status === "done" ? `<button class="btn secondary" type="button" data-status="draft">В черновик</button>` : ""}
        <button class="btn secondary" type="button" id="l-reveal-all">Открыть все разборы</button>
        <button class="btn secondary" type="button" id="l-show-all">Показать все скрытые</button>
        <a class="btn secondary" href="#/lesson/${lesson.id}" target="_blank">Как видит ученик</a>
      </div>
    </form>
    <section class="me-section"><h2>Ход занятия <span class="live-dot" id="l-live" title="обновляется в реальном времени"></span></h2><div id="l-board"><p class="muted">Загружаем…</p></div></section>
    <section class="me-section"><h2>Задания занятия · ${state.items.length}</h2><div id="l-items">${itemsTableHtml(state.items)}</div></section>
    <section class="me-section"><h2>Добавить из банка</h2>${await addPanelHtml(defaults)}</section>
    <section class="me-section">
      <h2>Скопировать занятие</h2>
      <form id="l-copy" class="card t-filter">
        <label>Для кого<select name="target" required><option value="">— выберите —</option>
          ${(groups || []).map((g) => `<option value="g:${g.id}">Группа: ${escapeHtml(g.title)}</option>`).join("")}
          ${(students || []).map((s) => `<option value="s:${s.id}">Ученик: ${escapeHtml(s.full_name || s.email)}</option>`).join("")}
        </select></label>
        <button class="btn secondary" type="submit">Создать копию (черновик)</button>
      </form>
    </section>
    <section class="me-section">
      <button class="btn secondary" id="l-delete">Удалить занятие</button>
    </section>`);

  const reload = () => lessonEditView(host, render, id);
  const refreshBoard = async () => {
    const fresh = await loadLesson(id);
    if (!fresh) return;
    const board = await loadBoard(fresh.items);
    const box = host.querySelector("#l-board");
    if (box) box.innerHTML = boardHtml(fresh, board);
    return fresh;
  };
  await refreshBoard();

  // Живое обновление: ответы и сданные работы учеников.
  const itemIds = new Set(state.items.map((i) => i.id));
  let pending = null;
  const bump = (payload) => {
    const itemId = payload.new?.item_id || payload.old?.item_id;
    if (itemId && !itemIds.has(itemId)) return;
    clearTimeout(pending);
    pending = setTimeout(refreshBoard, 400);
  };
  liveChannel = supa
    .channel(`lesson-${id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "attempts" }, bump)
    .on("postgres_changes", { event: "*", schema: "public", table: "written_works" }, bump)
    .subscribe((status) => {
      const dot = host.querySelector("#l-live");
      if (dot) dot.classList.toggle("on", status === "SUBSCRIBED");
    });

  // Шапка
  const head = host.querySelector("#l-head");
  head.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(head);
    const { error } = await supa
      .from("lessons")
      .update({ title: String(f.get("title")).trim(), starts_at: fromLocalInput(f.get("starts_at")), notes: String(f.get("notes") || "").trim() || null })
      .eq("id", id);
    if (error) alert(humanError(error).message);
    else reload();
  });
  head.querySelector(".l-title").addEventListener("change", () => head.requestSubmit());
  head.querySelectorAll("[data-status]").forEach((b) =>
    b.addEventListener("click", async () => {
      const { error } = await supa.from("lessons").update({ status: b.dataset.status }).eq("id", id);
      if (error) alert(humanError(error).message);
      else reload();
    })
  );
  host.querySelector("#l-reveal-all").addEventListener("click", async () => {
    if (!confirm("Открыть разборы всех заданий занятия для учеников?")) return;
    await supa.from("lesson_items").update({ revealed: true }).eq("lesson_id", id);
    reload();
  });
  host.querySelector("#l-show-all").addEventListener("click", async () => {
    await supa.from("lesson_items").update({ hidden: false }).eq("lesson_id", id);
    reload();
  });

  // Задания занятия: настройки, порядок, удаление
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
        const act = b.dataset.act;
        if (act === "remove") {
          if (!confirm("Убрать задание из занятия? Ответы учеников на него в занятии останутся в их истории без привязки к уроку.")) return;
          await supa.from("lesson_items").delete().eq("id", itemId);
        } else if (act === "reveal") {
          await supa.from("lesson_items").update({ revealed: !items[i].revealed }).eq("id", itemId);
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

  // Добавление из банка
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
    if (saved?.source && SOURCES[saved.source]) {
      srcSel.value = saved.source;
      await fillBanks();
      if ([...bankSel.options].some((o) => o.value === saved.bank)) bankSel.value = saved.bank;
    }
  } catch {
    /* фильтр необязателен */
  }
  const readDefaults = () => {
    const d = {
      kind: host.querySelector("#l-def-kind").value,
      reveal: host.querySelector("#l-def-reveal").value,
      attempts: host.querySelector("#l-def-attempts").value ? Number(host.querySelector("#l-def-attempts").value) : null,
      due: fromLocalInput(host.querySelector("#l-def-due").value),
      hidden: host.querySelector("#l-def-hidden").checked,
    };
    sessionStorage.setItem("lesson-defaults", JSON.stringify({ kind: d.kind, reveal: d.reveal, attempts: d.attempts }));
    return d;
  };
  const addTasks = async (tasks) => {
    if (!tasks.length) return;
    const d = readDefaults();
    let pos = items.length;
    const rows = tasks
      .filter((t) => !items.some((it) => it.task_id === t.id))
      .map((t) => ({
        lesson_id: id,
        task_id: t.id,
        position: ++pos,
        kind: d.kind,
        reveal: TEACHER_CHECKED.has(t.answer_mode) && d.reveal === "after_correct" ? "after_review" : d.reveal,
        attempts_limit: TEACHER_CHECKED.has(t.answer_mode) ? null : d.attempts,
        due_at: d.due,
        hidden: d.hidden,
      }));
    if (!rows.length) return alert("Эти задания уже есть в занятии.");
    const { error } = await supa.from("lesson_items").insert(rows);
    if (error) return alert(humanError(error).message);
    reload();
  };
  const seenByStudents = async (taskIds) => {
    if (!state.students.length || !taskIds.length) return new Set();
    const { data } = await supa
      .from("attempts")
      .select("task_id")
      .in("student_id", state.students.map((s) => s.id))
      .in("task_id", taskIds);
    return new Set((data || []).map((r) => r.task_id));
  };
  const findTasks = async (limit) => {
    const f = new FormData(search);
    let q = supa
      .from("tasks")
      .select("id, source, bank_file, source_ref, task_no, topic, answer_mode, list_item, is_published")
      .eq("source", f.get("source"))
      .eq("bank_file", f.get("bank"))
      .order("position")
      .limit(limit);
    if (f.get("own")) q = q.eq("is_own", true);
    const text = String(f.get("q") || "").trim();
    if (text) q = /^L?\d+$/.test(text) ? q.eq("source_ref", text) : q.ilike("list_item->>questionText", `%${text}%`);
    const { data, error } = await q;
    if (error) throw humanError(error);
    let list = data || [];
    if (f.get("fresh")) {
      const seen = await seenByStudents(list.map((t) => t.id));
      list = list.filter((t) => !seen.has(t.id));
    }
    return list.filter((t) => !items.some((it) => it.task_id === t.id));
  };
  search.addEventListener("submit", async (e) => {
    e.preventDefault();
    resultsBox.innerHTML = `<p class="muted">Ищем…</p>`;
    try {
      const list = (await findTasks(400)).slice(0, 40);
      resultsBox.innerHTML = list.length
        ? `<div class="lit-list l-results">${list
            .map(
              (t) => `
            <div class="lit-item">
              <span class="lit-item-n"><input type="checkbox" data-pick="${t.id}" /></span>
              <span class="lit-item-body">
                <strong><a href="${taskHref(t)}" target="_blank">№ ${escapeHtml(String(t.source_ref))}</a> · ${escapeHtml(MODE_LABEL[t.answer_mode] || "")}</strong>
                <span>${escapeHtml(snippet(t, 220))}</span>
              </span>
            </div>`
            )
            .join("")}</div>
          <p class="actions"><button class="btn" id="l-add-picked">Добавить отмеченные</button></p>`
        : `<p class="muted">Ничего не нашлось${new FormData(search).get("fresh") ? " (или всё уже решено учениками этого занятия)" : ""}.</p>`;
      resultsBox.querySelector("#l-add-picked")?.addEventListener("click", () => {
        const picked = new Set([...resultsBox.querySelectorAll("[data-pick]:checked")].map((c) => Number(c.dataset.pick)));
        addTasks(list.filter((t) => picked.has(t.id)));
      });
    } catch (err) {
      resultsBox.innerHTML = `<p class="lit-result is-bad">${escapeHtml(err.message)}</p>`;
    }
  });
  host.querySelector("#l-rand").addEventListener("click", async () => {
    const n = Math.max(1, Math.min(30, Number(host.querySelector("#l-rand-n").value) || 5));
    try {
      const pool = await findTasks(1000);
      for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      if (!pool.length) return alert("Подходящих заданий не нашлось.");
      addTasks(pool.slice(0, n));
    } catch (err) {
      alert(err.message);
    }
  });

  // Копия и удаление
  host.querySelector("#l-copy").addEventListener("submit", async (e) => {
    e.preventDefault();
    const [kind, tid] = String(new FormData(e.target).get("target")).split(":");
    const { data: copy, error } = await supa
      .from("lessons")
      .insert({ title: lesson.title, notes: lesson.notes, starts_at: lesson.starts_at, group_id: kind === "g" ? tid : null, student_id: kind === "s" ? tid : null })
      .select("id")
      .single();
    if (error) return alert(humanError(error).message);
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
    if (!confirm("Удалить занятие целиком? Задания останутся в банке, ответы учеников — в их истории. Отменить нельзя.")) return;
    const { error } = await supa.from("lessons").delete().eq("id", id);
    if (error) return alert(humanError(error).message);
    location.hash = "#/cabinet/lessons";
  });
}

/* ================================================================== */
/* УЧЕНИК                                                               */
/* ================================================================== */

/** Блок «Мои занятия» для личного кабинета. */
export async function myLessonsHtml() {
  const { data: lessons } = await supa
    .from("lessons")
    .select("id, title, status, starts_at, notes, lesson_items(id, due_at, kind)")
    .order("starts_at", { ascending: false, nullsFirst: true })
    .limit(30);
  if (!lessons?.length) return "";
  const ids = lessons.flatMap((l) => (l.lesson_items || []).map((i) => i.id));
  const uid = currentUser()?.id;
  const [{ data: att }, { data: works }] = ids.length
    ? await Promise.all([
        supa.from("attempts").select("item_id, is_correct").eq("student_id", uid).in("item_id", ids),
        supa.from("written_works").select("item_id, status").eq("student_id", uid).in("item_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const done = (itemId) =>
    (att || []).some((a) => a.item_id === itemId) || (works || []).some((w) => w.item_id === itemId && w.status !== "draft");
  const rows = lessons
    .map((l) => {
      const its = l.lesson_items || [];
      const n = its.filter((i) => done(i.id)).length;
      const due = its.map((i) => i.due_at).filter(Boolean).sort()[0];
      return `
      <a class="lit-item${n === its.length && its.length ? " is-done" : ""}" href="#/lesson/${l.id}">
        <span class="lit-item-n">${n}/${its.length}</span>
        <span class="lit-item-body">
          <strong>${escapeHtml(l.title)}</strong>
          <span>${l.starts_at ? fmtDT(l.starts_at) : ""}${due ? ` · сдать до ${fmtDT(due)}` : ""}${l.status === "done" ? " · завершено" : ""}</span>
        </span>
      </a>`;
    })
    .join("");
  return `<section class="me-section"><h2>Мои занятия</h2><div class="lit-list">${rows}</div></section>`;
}

async function loadMyLesson(id) {
  const { data: lesson, error } = await supa.from("lessons").select("id, title, status, starts_at, notes").eq("id", id).maybeSingle();
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

function itemStatus(it, att, works) {
  if (TEACHER_CHECKED.has(it.tasks?.answer_mode)) {
    const w = works.find((x) => x.item_id === it.id);
    if (!w) return ["", "не начато"];
    return {
      draft: ["", "черновик"],
      submitted: ["is-wait", "на проверке"],
      returned: ["is-bad", "вернули на доработку"],
      graded: ["is-ok", `оценено${w.score != null ? `: ${w.score}${w.max_score ? `/${w.max_score}` : ""}` : ""}`],
    }[w.status];
  }
  const list = att.filter((a) => a.item_id === it.id);
  if (!list.length) return ["", "не начато"];
  if (it.kind === "test" && !it.revealed && (!it.due_at || new Date(it.due_at) > new Date())) return ["is-wait", "ответ принят"];
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
  try {
    const st = await loadMyLesson(id);
    if (!st) {
      host.innerHTML = `<div class="empty">Занятие не найдено или ещё не открыто. <a href="#/me">В кабинет</a></div>`;
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
    if (!itemId) return lessonOverview(host, st, att || [], works || []);
    return lessonTask(host, st, itemId, att || []);
  } catch (err) {
    host.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

function lessonOverview(host, { lesson, items }, att, works) {
  const rows = items
    .map((it, i) => {
      const [cls, text] = itemStatus(it, att, works);
      return `
      <a class="lit-item ${cls === "is-ok" ? "is-done" : ""}" href="#/lesson/${lesson.id}/${it.id}">
        <span class="lit-item-n">${i + 1}</span>
        <span class="lit-item-body">
          <strong>${escapeHtml(SOURCES[it.tasks?.source]?.title || "")}, задание ${it.tasks?.task_no ?? ""} · ${escapeHtml(KIND[it.kind])}</strong>
          <span>${escapeHtml(snippet(it.tasks, 160))}</span>
          <span class="l-st ${cls}">${escapeHtml(text)}${it.due_at ? ` · до ${fmtDT(it.due_at)}` : ""}</span>
        </span>
      </a>`;
    })
    .join("");
  host.innerHTML = `
    <p class="crumbs"><a href="#/me">← Личный кабинет</a></p>
    <p class="eyebrow">Занятие${lesson.starts_at ? ` · ${fmtDT(lesson.starts_at)}` : ""}${lesson.status === "done" ? " · завершено" : ""}</p>
    <h1>${escapeHtml(lesson.title)}</h1>
    ${lesson.notes ? `<p class="lede">${escapeHtml(lesson.notes)}</p>` : ""}
    <div class="lit-list">${rows || '<p class="muted">Заданий пока нет — преподаватель добавит их на уроке.</p>'}</div>`;
}

async function lessonTask(host, { lesson, items }, itemId, att) {
  const i = items.findIndex((x) => x.id === itemId);
  if (i < 0) {
    host.innerHTML = `<div class="empty">Задание не найдено. <a href="#/lesson/${lesson.id}">К занятию</a></div>`;
    return;
  }
  const it = items[i];
  const t = it.tasks;
  if (!t) {
    host.innerHTML = `<div class="empty">Задание недоступно. <a href="#/lesson/${lesson.id}">К занятию</a></div>`;
    return;
  }
  const sanitize = sanitizeFor(t.source);
  let passage = null;
  if (t.passage_id) {
    const { data } = await supa.from("passages").select("html").eq("id", t.passage_id).maybeSingle();
    passage = data?.html || null;
  }
  const written = TEACHER_CHECKED.has(t.answer_mode);
  const mine = att.filter((a) => a.item_id === it.id);
  const solved = mine.some((a) => a.is_correct);
  const hiddenTest = it.kind === "test" && !it.revealed && (!it.due_at || new Date(it.due_at) > new Date());
  const exhausted = it.attempts_limit != null && mine.length >= it.attempts_limit;
  const label = MODE_LABEL[t.answer_mode] || "Ответ";
  const numeric = ["digits-any", "digits-fixed", "numbers", "lit-match"].includes(t.answer_mode);
  const prev = items[i - 1];
  const next = items[i + 1];
  const history = mine.length && !written
    ? `<p class="muted l-history">Ваши ответы: ${mine
        .map((a) => `${escapeHtml(a.answer)}${hiddenTest ? "" : a.is_correct ? " ✓" : " ✗"}`)
        .join(", ")}${it.attempts_limit ? ` · попыток ${mine.length} из ${it.attempts_limit}` : ""}</p>`
    : "";
  host.innerHTML = `
    <p class="crumbs"><a href="#/lesson/${lesson.id}">← ${escapeHtml(lesson.title)}</a></p>
    <article class="lit-problem">
      <p class="eyebrow">${escapeHtml(KIND[it.kind])} · ${i + 1} из ${items.length}${it.due_at ? ` · сдать до ${fmtDT(it.due_at)}` : ""}</p>
      <h1>${escapeHtml(SOURCES[t.source]?.title || "")}, задание ${t.task_no ?? ""}</h1>
      ${passage ? `<section class="lit-passage"><p class="lit-kicker">Текст</p><div class="lit-html">${sanitize(passage)}</div></section>` : ""}
      <section class="lit-question"><div class="lit-html">${sanitize(t.data?.questionHtml || "")}</div></section>
      ${history}
      ${
        written
          ? writtenBlockHtml()
          : solved || exhausted || hiddenTest && exhausted
            ? `<div id="pr-solution"></div>`
            : checkBlockHtml({ label, placeholder: numeric ? "Например: 24" : "Введите ответ", numeric })
      }
      <div class="lit-pager">
        ${prev ? `<a href="#/lesson/${lesson.id}/${prev.id}">← Предыдущее</a>` : "<span></span>"}
        <a href="#/lesson/${lesson.id}" class="muted">Все задания</a>
        ${next ? `<a href="#/lesson/${lesson.id}/${next.id}">Следующее →</a>` : "<span></span>"}
      </div>
    </article>`;
  const problem = { ...t.data, _tid: t.id };
  if (written) {
    bindWritten(host, problem, { sanitize, item: it, label: t.answer_mode === "essay" ? "Сочинение" : "Ваш ответ" });
    return;
  }
  if (solved || exhausted) {
    const box = host.querySelector("#pr-solution");
    if (hiddenTest) {
      box.innerHTML = `<p class="lit-result">Ответ принят. Результат появится после проверки контрольной.</p>`;
      return;
    }
    try {
      const res = await showSolution(t.id, it.id);
      box.innerHTML = res.locked
        ? `<p class="lit-result">${solved ? "Решено верно." : "Попытки закончились."} ${escapeHtml(REVEAL_HINT_STUDENT[it.reveal] || "")}</p>`
        : `<p class="lit-result ${solved ? "is-ok" : "is-bad"}">${solved ? "Решено верно." : "Попытки закончились."}</p>
           <details class="lit-solution" open><summary>Разбор</summary>${res.answer && !res.solution ? `<p class="pr-answer-key"><strong>Ответ:</strong> ${escapeHtml(String(res.answer).replace(/\|/g, " или "))}</p>` : ""}<div class="lit-html">${sanitize(res.solution || "")}</div></details>`;
    } catch (err) {
      box.innerHTML = `<p class="lit-result is-bad">${escapeHtml(err.message)}</p>`;
    }
    return;
  }
  bindCheck(host, problem, { sanitize, item: it });
}

const REVEAL_HINT_STUDENT = {
  after_due: "Разбор откроется после срока сдачи.",
  after_review: "Разбор откроется после проверки.",
  manual: "Разбор откроет преподаватель.",
};

export function lessonPage() {
  return `<div id="lesson-root"><p class="lede muted">Загружаем занятие…</p></div>`;
}

