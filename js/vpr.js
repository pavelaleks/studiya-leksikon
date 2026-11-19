import { BASE, STUDIO } from "./config.js";
import { escapeHtml } from "./ui.js";
import { accessState, bankList, bankProblem, clearBankCache } from "./supa.js";
import { bindCheck, bindWritten, checkBlockHtml, demoBannerHtml, gateHtml, writtenBlockHtml } from "./practice.js?v=land153";

const SOURCE = "vpr-rus";

const DATA_VER = "vpr1";
const MANIFEST_URL = new URL("js/vpr-data/manifest.json", new URL(BASE, location.href));

const KEEP_CLASS = new Set([
  "left_margin",
  "rus_single",
  "rus_double",
  "rus_dashed",
  "rus_wave",
  "rus_dotteddash",
  "rus_notes",
  "rus_example",
  "prefix",
  "wrap_flex_table",
  "wrap_flex_table_col",
  "col_name",
  "col_content",
  "sup_cont",
  "sup_word",
  "mark",
]);

const ALLOWED = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "sub", "sup",
  "table", "thead", "tbody", "tr", "td", "th",
  "ul", "ol", "li", "blockquote", "nobr", "div", "span", "center",
  "h3", "h4", "a", "img", "details", "summary",
]);

// Письменно: списывание (1), обособление с объяснением (6), синтаксический анализ (7), развёрнутый ответ (11), исправление ошибок (12)
const WRITTEN_TASKS = new Set([1, 6, 7, 11, 12]);
const isWritten = (problem) => ["essay", "open"].includes(problem.answerMode) || problem.answerKind === "essay";

// Прогресс на этом устройстве: последнее открытое и решённые (по номерам заданий).
const VPR_KEY = "leksikon-vpr-progress";
function readVpr() {
  try {
    return JSON.parse(localStorage.getItem(VPR_KEY) || "{}");
  } catch {
    return {};
  }
}
function writeVpr(p) {
  try {
    localStorage.setItem(VPR_KEY, JSON.stringify(p));
  } catch {}
}
function touchVpr(ex, index) {
  const p = readVpr();
  p.lastId = ex.id;
  p.lastTask = ex.task;
  p.lastIndex = index + 1;
  writeVpr(p);
}
export function markVprDone(ex) {
  const p = readVpr();
  p.done = p.done || {};
  const k = String(ex.task);
  const list = new Set(p.done[k] || []);
  list.add(String(ex.id));
  p.done[k] = [...list];
  writeVpr(p);
}
function doneVprIds(task) {
  return new Set(((readVpr().done || {})[String(task)] || []).map(String));
}
function pickVprVariant(task, ids) {
  if (!ids.length) return null;
  const done = doneVprIds(task);
  const fresh = ids.filter((id) => !done.has(String(id)));
  const pool = fresh.length ? fresh : ids;
  return { id: pool[Math.floor(Math.random() * pool.length)] };
}

let manifestCache = null;
const bankCache = new Map();

function dataUrl(path) {
  return new URL(path, new URL(BASE, location.href));
}

function mediaUrl(src) {
  const clean = String(src || "").replace(/^\.?\//, "");
  if (!clean.startsWith("media/")) return "";
  return new URL(`js/vpr-data/${clean}`, new URL(BASE, location.href)).href;
}

async function loadJson(url) {
  const u = new URL(url, location.href);
  if (!u.searchParams.has("v")) u.searchParams.set("v", DATA_VER);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`Не удалось загрузить данные (${res.status})`);
  return res.json();
}

async function loadManifest() {
  if (manifestCache) return manifestCache;
  manifestCache = await loadJson(MANIFEST_URL.toString());
  return manifestCache;
}

function listPath(file) {
  return String(file).replace(/\.json$/i, ".list.json");
}

async function loadList(file) {
  const problems = await bankList(SOURCE, bankId(file));
  return { problems };
}

function orderPath(file) {
  return String(file).replace(/\.json$/i, ".order.json");
}

async function loadOrder(file) {
  const list = await bankList(SOURCE, bankId(file));
  return list.map((p) => p.id);
}

function bankId(file) {
  return String(file).replace(/^bank\//, "").replace(/\.json$/i, "");
}

function taskFiles(manifest) {
  return (manifest.files || []).slice().sort((a, b) => a.task - b.task);
}

function ru(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

function norm(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function taskNav(active) {
  const chips = Array.from({ length: 12 }, (_, i) => i + 1)
    .map((n) => {
      const on = Number(active) === n;
      return `<a class="lit-task-chip${on ? " is-active" : ""}" href="#/vpr/${n}">${n}</a>`;
    })
    .join("");
  return `<nav class="lit-task-nav" aria-label="Номера заданий ВПР">${chips}</nav>`;
}

function continueLink() {
  const progress = readVpr();
  if (!progress.lastId || !progress.lastTask) return "";
  const variant = progress.lastIndex ? ` · вариант ${progress.lastIndex}` : "";
  return `<p class="home-actions"><a class="btn secondary" href="#/vpr/${encodeURIComponent(progress.lastTask)}/${encodeURIComponent(progress.lastId)}">Продолжить задание ${escapeHtml(String(progress.lastTask))}${escapeHtml(variant)}</a></p>`;
}

function sourceNote() {
  return `<p class="lit-source-note muted">Задания и пояснения: <a href="https://rus8-vpr.sdamgia.ru/" target="_blank" rel="noopener noreferrer">Решу ВПР</a></p>`;
}

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(
    `<div>${String(html || "").replace(/&nbsp;?/gi, " ")}</div>`,
    "text/html"
  );
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
      if (name === "alt" && tag === "img") return;
      if (name === "src" && tag === "img") return;
      if (name === "href" && tag === "a" && /^https?:/i.test(attr.value)) return;
      node.removeAttribute(attr.name);
    });
    if (tag === "a" && node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (tag === "img") {
      const src = node.getAttribute("src") || "";
      const local = mediaUrl(src);
      if (local) node.setAttribute("src", local);
      else if (!/^https?:/i.test(src)) node.remove();
    }
  });
  root.querySelectorAll(".sup_word").forEach((label) => {
    const next = label.nextSibling;
    if (next && next.nodeType === Node.TEXT_NODE && next.textContent && !/^\s/.test(next.textContent)) {
      label.after(doc.createTextNode("\u00a0"));
    }
  });
  return root.innerHTML;
}

function hubHtml(manifest) {
  const cards = taskFiles(manifest)
    .map((file) => {
      const essay = WRITTEN_TASKS.has(file.task);
      const solved = doneVprIds(file.task).size;
      return `
        <a class="lit-task-card${essay ? " is-written" : ""}" href="#/vpr/${file.task}">
          <span class="lit-task-num">${file.task}</span>
          <strong>${escapeHtml(file.title)}</strong>
          <span class="lit-task-meta">
            <span>${file.count} ${ru(file.count, "задание", "задания", "заданий")}</span>
            ${solved ? `<span>решено ${solved}</span>` : ""}
            ${
              essay
                ? `<span class="lit-write-mark">письменно</span>`
                : ""
            }
          </span>
        </a>`;
    })
    .join("");
  return `
    <header class="lit-hub">
      <p class="crumbs"><a href="#/">← Студия</a></p>
      <p class="eyebrow">Русский язык · 8 класс</p>
      <h1>ВПР по русскому, 8 класс</h1>
      <p class="lede">Банк заданий 1–12 Всероссийской проверочной работы. Краткий ответ проверяется на сайте; списывание, синтаксический анализ и развёрнутые ответы сдаются на проверку преподавателю в личный кабинет. Полный банк с разборами открыт ученикам студии. Это основа для ОГЭ: грамматическая основа, обособленные члены, типы предложений.</p>
      ${continueLink()}
    </header>
    <section class="oge-bank-block">
      <h2 class="lit-h2">Задания 1–12</h2>
      <div class="lit-task-grid">${cards}</div>
      ${sourceNote()}
    </section>`;
}

function listHtml({ file, bank }) {
  const task = file.task;
  const essay = WRITTEN_TASKS.has(task);
  const done = doneVprIds(task);
  const topics = (file.topics || [])
    .filter((t) => t.count > 0)
    .map(
      (t) =>
        `<button type="button" class="lit-topic-chip" data-topic="${t.id}" title="${escapeHtml(t.title)}">${escapeHtml(clip(t.title, 36))} <small>${t.count}</small></button>`
    )
    .join("");
  const items = (bank.problems || [])
    .map((problem, i) => {
      const blob = norm([problem.questionText, problem.topic].join(" "));
      const solved = done.has(problem.id) || done.has(String(problem.id));
      const q = clip(problem.questionText, 160) || `Вариант ${i + 1}`;
      return `
        <a class="lit-item${solved ? " is-done" : ""}" href="#/vpr/${task}/${problem.id}" data-topic="${problem.topicId}" data-blob="${escapeHtml(blob)}">
          <span class="lit-item-n">${i + 1}</span>
          <span class="lit-item-body">
            <strong>${escapeHtml(q)}</strong>
            ${problem.topic ? `<span>${escapeHtml(problem.topic)}</span>` : ""}
            ${problem._demo && accessState() !== "student" && accessState() !== "teacher" ? `<span class="demo-tag">демо</span>` : ""}
          </span>
        </a>`;
    })
    .join("");
  return `
    <p class="crumbs"><a href="#/vpr">← К заданиям 1–12</a></p>
    ${taskNav(task)}
    <header class="lit-head">
      <p class="eyebrow">Задание ${task} · ${file.count} ${ru(file.count, "задание", "задания", "заданий")}${essay ? " · письменно" : ""}</p>
      <h1>${escapeHtml(file.title)}</h1>
      <div class="lit-toolbar">
        <label class="lit-search-wrap" for="vpr-q">
          <span class="visually-hidden">Поиск по заданиям</span>
          <input class="search lit-search" id="vpr-q" type="search" placeholder="Слова из вопроса" autocomplete="off" />
        </label>
        <a class="btn" href="#/vpr/${task}/random">Случайный</a>
      </div>
      <p class="lit-search-status muted" id="vpr-status" aria-live="polite"></p>
      ${topics ? `<div class="lit-topic-nav" aria-label="Подборки">${topics}</div>` : ""}
    </header>
    ${demoBannerHtml(file.count, (bank.problems || []).length)}
    <div class="lit-list" id="vpr-list">${items}</div>
    ${sourceNote()}`;
}

function writtenLabel(problem) {
  if (Number(problem.task) === 1) return "Списывание — проверяет преподаватель";
  return "Развёрнутый ответ — проверяет преподаватель";
}

function kindLabel(problem) {
  if (isWritten(problem)) return writtenLabel(problem);
  if (problem.answerMode === "digits-fixed") return "Соответствие: запишите цифры подряд";
  if (problem.answerMode === "digits-any" || problem.answerMode === "numbers") return "Номера в любом порядке";
  if (problem.answerMode === "word") return "Краткий ответ";
  return "Ответ";
}

function placeholder(problem) {
  if (problem.answerMode === "digits-fixed") return "Например: 54782";
  if (problem.answerMode === "digits-any" || problem.answerMode === "numbers") return "Например: 24";
  return "Введите ответ";
}

function sourceLine(problem) {
  const titles = (problem.sources || []).map((s) => s.title).filter(Boolean);
  return titles.slice(0, 2).join("; ");
}

function problemHtml({ file, problem, passage, index, total, prevId, nextId }) {
  const task = problem.task;
  const essay = isWritten(problem);
  const prev = prevId ? { id: prevId } : null;
  const next = nextId ? { id: nextId } : null;
  const hrefOf = (item) => `#/vpr/${task}/${item.id}`;
  const label = kindLabel(problem);
  const numeric = problem.answerMode === "digits-fixed" || problem.answerMode === "digits-any" || problem.answerMode === "numbers";
  const passageBlock = passage
    ? `<section class="lit-passage"><p class="lit-kicker">${essay ? "Исходный текст" : "Текст"}</p><div class="lit-html">${sanitizeHtml(passage.html)}</div></section>`
    : "";
  const answerBlock = essay
    ? writtenBlockHtml()
    : checkBlockHtml({ label, placeholder: placeholder(problem), numeric });
  const where = sourceLine(problem);
  return `
    <p class="crumbs">
      <a href="#/vpr">ВПР</a><span>/</span>
      <a href="#/vpr/${task}">Задание ${task}</a>
    </p>
    ${taskNav(task)}
    <article class="lit-problem">
      <p class="eyebrow">${escapeHtml(label)} · № ${problem.id}${problem._demo ? " · демо" : ""}</p>
      <h1>${escapeHtml(file.title)}</h1>
      ${where ? `<p class="lit-meta muted">${escapeHtml(where)}</p>` : ""}
      ${passageBlock}
      <section class="lit-question"><div class="lit-html">${sanitizeHtml(problem.questionHtml)}</div></section>
      ${answerBlock}
      <div class="lit-pager">
        ${prev ? `<a href="${hrefOf(prev)}">← Предыдущее</a>` : `<span></span>`}
        <span class="muted">${index + 1} из ${total}</span>
        ${next ? `<a href="${hrefOf(next)}">Следующее →</a>` : `<span></span>`}
      </div>
    </article>
    ${sourceNote()}`;
}

function missingHtml() {
  return `<div class="empty">Такого задания нет. <a href="#/vpr">К заданиям 1–12</a></div>`;
}

function bindList(root) {
  const search = root.querySelector("#vpr-q");
  const status = root.querySelector("#vpr-status");
  const items = [...root.querySelectorAll(".lit-item")];
  let topic = "";
  const apply = () => {
    const q = norm(search?.value || "");
    const tokens = q ? q.split(" ") : [];
    let visible = 0;
    items.forEach((el) => {
      const okTopic = !topic || el.dataset.topic === topic;
      const blob = el.dataset.blob || "";
      const ok = okTopic && tokens.every((token) => blob.includes(token));
      el.hidden = !ok;
      if (ok) visible += 1;
    });
    root.querySelectorAll(".lit-topic-chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.topic === topic);
    });
    if (status) status.textContent = q || topic ? `Показано: ${visible}` : "";
  };
  search?.addEventListener("input", apply);
  root.querySelectorAll(".lit-topic-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      topic = topic === chip.dataset.topic ? "" : chip.dataset.topic;
      apply();
    });
  });
}

function bindProblem(root, problem, index) {
  touchVpr({ id: problem.id, task: problem.task }, index);
  if (isWritten(problem)) {
    bindWritten(root, problem, { sanitize: sanitizeHtml, label: Number(problem.task) === 1 ? "Списанный текст (можно фото тетради)" : "Ваш ответ" });
    return;
  }
  bindCheck(root, problem, {
    sanitize: sanitizeHtml,
    onCorrect: () => markVprDone({ id: problem.id, task: problem.task }),
  });
}

async function renderView(rest) {
  const manifest = await loadManifest();
  const [a, b] = rest;
  if (!a) return { html: hubHtml(manifest), view: "hub", title: "ВПР по русскому, 8 класс" };
  const task = Number(a);
  const file = taskFiles(manifest).find((item) => item.task === task);
  if (!file) return { html: missingHtml(), view: "missing", title: "Задание не найдено" };
  if (b === "random") {
    const ids = await loadOrder(file.file);
    const pick = pickVprVariant(task, ids);
    if (!pick) return { html: missingHtml(), view: "missing", title: "Задание не найдено" };
    const href = `#/vpr/${task}/${pick.id}`;
    history.replaceState(null, "", `${location.pathname}${location.search}${href}`);
    return renderView([String(task), String(pick.id)]);
  }
  if (!b) {
    const list = await loadList(file.file);
    return { html: listHtml({ file, bank: list }), view: "list", title: `Задание ${task}. ${file.title}` };
  }
  const [ids, found] = await Promise.all([loadOrder(file.file), bankProblem(SOURCE, b)]);
  if (!found) {
    return { html: `<p class="crumbs"><a href="#/vpr/${task}">← Задание ${task}</a></p>${gateHtml(`#/vpr/${task}`)}`, view: "gate", title: "Только для учеников" };
  }
  const { problem, passage } = found;
  let index = ids.findIndex((id) => String(id) === String(b));
  if (index < 0) index = 0;
  return {
    html: problemHtml({
      file,
      problem,
      passage,
      index,
      total: ids.length,
      prevId: index > 0 ? ids[index - 1] : null,
      nextId: index < ids.length - 1 ? ids[index + 1] : null,
    }),
    view: "problem",
    title: `Задание ${task} · № ${problem.id}`,
    problem,
    index,
  };
}

export async function mountVpr(host, rest = []) {
  if (!host) return;
  host.innerHTML = `<p class="lede muted">Загружаем задания…</p>`;
  try {
    const view = await renderView(rest);
    host.innerHTML = view.html;
    document.title = `${view.title} — Студия Лексикон`;
    if (view.view === "list") bindList(host);
    if (view.view === "problem") bindProblem(host, view.problem, view.index);
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  } catch (err) {
    host.innerHTML = `<div class="empty">Не удалось загрузить задания. <button type="button" class="btn secondary" id="vpr-retry">Повторить</button></div>`;
    host.querySelector("#vpr-retry")?.addEventListener("click", () => {
      manifestCache = null;
      bankCache.clear();
      clearBankCache();
      mountVpr(host, rest);
    });
    console.error(err);
  }
}
