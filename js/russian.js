import { BASE } from "./config.js";
import { doneIds, markEgeDone, pickEgeVariant, readProgress, touchEge } from "./progress.js";
import { escapeHtml } from "./ui.js";
import { accessState, bankList, bankProblem, clearBankCache } from "./supa.js";
import { theoryTasks, theoryBody, theoryArticleHtml, theoryClosedHtml, clearTheoryCache } from "./theory.js?v=land161";
import { bindCheck, bindWritten, checkBlockHtml, demoBannerHtml, gateHtml, writtenBlockHtml } from "./practice.js?v=land161";

const SOURCE = "ege-rus";

const DATA_VER = "rus3";
const MANIFEST_URL = new URL("js/russian-data/manifest.json", new URL(BASE, location.href));

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

let manifestCache = null;
const bankCache = new Map();

function dataUrl(path) {
  return new URL(path, new URL(BASE, location.href));
}

function mediaUrl(src) {
  const clean = String(src || "").replace(/^\.?\//, "");
  if (!clean.startsWith("media/")) return "";
  return new URL(`js/russian-data/${clean}`, new URL(BASE, location.href)).href;
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

function taskNav(active, theory = null) {
  const chips = Array.from({ length: 27 }, (_, i) => i + 1)
    .map((n) => {
      const on = Number(active) === n;
      const href = theory && theory.has(n) ? `#/ege/${n}/theory` : `#/ege/${n}`;
      return `<a class="lit-task-chip${on ? " is-active" : ""}" href="${href}">${n}</a>`;
    })
    .join("");
  return `<nav class="lit-task-nav" aria-label="Номера заданий ЕГЭ">${chips}</nav>`;
}

function continueLink() {
  const progress = readProgress();
  if (!progress.lastId || !progress.lastTask) return "";
  const variant = progress.lastIndex ? ` · вариант ${progress.lastIndex}` : "";
  return `<p class="home-actions"><a class="btn secondary" href="#/ege/${encodeURIComponent(progress.lastTask)}/${encodeURIComponent(progress.lastId)}">Продолжить задание ${escapeHtml(String(progress.lastTask))}${escapeHtml(variant)}</a></p>`;
}

function sourceNote() {
  return `<p class="lit-source-note muted">Задания и пояснения: <a href="https://rus-ege.sdamgia.ru/" target="_blank" rel="noopener noreferrer">Решу ЕГЭ</a></p>`;
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

function hubHtml(manifest, theory = new Set()) {
  const cards = taskFiles(manifest)
    .map((file) => {
      const essay = file.task === 27;
      const solved = doneIds(file.task).size;
      return `
        <a class="lit-task-card${essay ? " is-written" : ""}" href="#/ege/${file.task}">
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
            ${theory.has(file.task) ? `<span class="lit-theory-mark">теория</span>` : ""}
          </span>
        </a>`;
    })
    .join("");
  return `
    <header class="lit-hub">
      <p class="crumbs"><a href="#/">← Студия</a></p>
      <p class="eyebrow">Русский язык · ЕГЭ</p>
      <h1>Задания 1–27</h1>
      ${theory.size ? `<p class="home-actions"><a class="btn secondary" href="#/ege/theory">📖 Теория к заданиям</a></p>` : ""}
      <p class="lede">Краткий ответ проверяется на сайте. Задание 27 — сочинение сдаётся на проверку в личный кабинет. Полный банк с разборами открыт ученикам студии.</p>
      ${continueLink()}
    </header>
    <div class="lit-task-grid">${cards}</div>
    ${sourceNote()}`;
}

function listHtml({ file, bank, hasTheory = false }) {
  const task = file.task;
  const essay = task === 27;
  const done = doneIds(task);
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
        <a class="lit-item${solved ? " is-done" : ""}" href="#/ege/${task}/${problem.id}" data-topic="${problem.topicId}" data-blob="${escapeHtml(blob)}">
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
    <p class="crumbs"><a href="#/ege">← К заданиям 1–27</a></p>
    ${taskNav(task)}
    <header class="lit-head">
      <p class="eyebrow">Задание ${task} · ${file.count} ${ru(file.count, "задание", "задания", "заданий")}${essay ? " · письменно" : ""}</p>
      <h1>${escapeHtml(file.title)}</h1>
      <div class="lit-toolbar">
        <label class="lit-search-wrap" for="rus-q">
          <span class="visually-hidden">Поиск по заданиям</span>
          <input class="search lit-search" id="rus-q" type="search" placeholder="Слова из вопроса" autocomplete="off" />
        </label>
        <a class="btn" href="#/ege/${task}/random">Случайный</a>
      </div>
      ${hasTheory ? `<a class="th-cta" href="#/ege/${task}/theory"><span>📖</span><span><strong>Теория к заданию ${task}</strong><small>Как устроено задание, алгоритм, термины и частые ловушки</small></span></a>` : ""}
      <p class="lit-search-status muted" id="rus-status" aria-live="polite"></p>
      ${topics ? `<div class="lit-topic-nav" aria-label="Подборки">${topics}</div>` : ""}
    </header>
    ${demoBannerHtml(file.count, (bank.problems || []).length)}
    <div class="lit-list" id="rus-list">${items}</div>
    ${sourceNote()}`;
}

function kindLabel(problem) {
  if (problem.answerMode === "essay" || problem.answerKind === "essay") return "Сочинение";
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

function problemHtml({ file, problem, passage, index, total, prevId, nextId, hasTheory = false }) {
  const task = problem.task;
  const essay = problem.answerMode === "essay" || problem.answerKind === "essay";
  const prev = prevId ? { id: prevId } : null;
  const next = nextId ? { id: nextId } : null;
  const hrefOf = (item) => `#/ege/${task}/${item.id}`;
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
      <a href="#/ege">ЕГЭ</a><span>/</span>
      <a href="#/ege/${task}">Задание ${task}</a>
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

function theoryIndexHtml(manifest, theory) {
  const items = taskFiles(manifest)
    .filter((f) => theory.has(f.task))
    .map(
      (f) => `<a class="lit-item" href="#/ege/${f.task}/theory"><span class="lit-item-n">${f.task}</span><span class="lit-item-body"><strong>${escapeHtml(f.title)}</strong></span></a>`
    )
    .join("");
  return `
    <p class="crumbs"><a href="#/ege">← К заданиям 1–27</a></p>
    <header class="lit-head">
      <p class="eyebrow">Русский язык · ЕГЭ</p>
      <h1>Теория к заданиям</h1>
      <p class="lede">Что нужно знать к каждому номеру: как устроено задание, правила, алгоритм и частые ловушки. Повторяйте перед тем, как решать, и возвращайтесь, если ошибаетесь.</p>
    </header>
    ${items ? `<div class="lit-list">${items}</div>` : `<div class="empty">Теория пока не добавлена.</div>`}`;
}

function theoryHtml(file, md, theory) {
  const task = file.task;
  return `
    <p class="crumbs">
      <a href="#/ege">ЕГЭ</a><span>/</span>
      <a href="#/ege/theory">Теория</a><span>/</span>
      <a href="#/ege/${task}">Задание ${task}</a>
    </p>
    ${taskNav(task, theory)}
    <article class="th-page">
      <p class="eyebrow">Теория · задание ${task}</p>
      <h1>${escapeHtml(file.title)}</h1>
      ${md ? theoryArticleHtml(md) : theoryClosedHtml("ЕГЭ по русскому", `#/ege/${task}`)}
      ${md ? `<p class="actions th-actions"><a class="btn" href="#/ege/${task}/random">Решать задание ${task}</a> <a class="btn secondary" href="#/ege/${task}">Все задания ${task}</a></p>` : ""}
    </article>`;
}

function missingHtml() {
  return `<div class="empty">Такого задания нет. <a href="#/ege">К заданиям 1–27</a></div>`;
}

function bindList(root) {
  const search = root.querySelector("#rus-q");
  const status = root.querySelector("#rus-status");
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

function bindProblem(root, problem, index, hasTheory = false) {
  touchEge({ id: problem.id, egeTask: problem.task }, index);
  const essay = problem.answerMode === "essay" || problem.answerKind === "essay";
  if (essay) {
    bindWritten(root, problem, { sanitize: sanitizeHtml, label: "Сочинение" });
    return;
  }
  bindCheck(root, problem, {
    sanitize: sanitizeHtml,
    onCorrect: () => markEgeDone({ id: problem.id, egeTask: problem.task }),
    theory: hasTheory ? { href: `#/ege/${problem.task}/theory`, key: `${SOURCE}:${problem.task}`, task: problem.task } : null,
  });
}

async function renderView(rest) {
  const manifest = await loadManifest();
  const [a, b] = rest;
  const theory = await theoryTasks(SOURCE);
  if (!a) return { html: hubHtml(manifest, theory), view: "hub", title: "ЕГЭ по русскому" };
  if (a === "theory") return { html: theoryIndexHtml(manifest, theory), view: "theory-index", title: "Теория к заданиям ЕГЭ" };
  const task = Number(a);
  const file = taskFiles(manifest).find((item) => item.task === task);
  if (!file) return { html: missingHtml(), view: "missing", title: "Задание не найдено" };
  if (b === "theory") {
    const md = theory.has(task) ? await theoryBody(SOURCE, task) : null;
    return { html: theoryHtml(file, md, theory), view: "theory", title: `Теория к заданию ${task}` };
  }
  if (b === "random") {
    const ids = await loadOrder(file.file);
    const pick = pickEgeVariant(ids.map((id) => ({ id, egeTask: task })));
    if (!pick) return { html: missingHtml(), view: "missing", title: "Задание не найдено" };
    const href = `#/ege/${task}/${pick.id}`;
    history.replaceState(null, "", `${location.pathname}${location.search}${href}`);
    return renderView([String(task), String(pick.id)]);
  }
  if (!b) {
    const list = await loadList(file.file);
    return { html: listHtml({ file, bank: list, hasTheory: theory.has(task) }), view: "list", title: `Задание ${task}. ${file.title}` };
  }
  const [ids, found] = await Promise.all([loadOrder(file.file), bankProblem(SOURCE, b)]);
  if (!found) {
    return { html: `<p class="crumbs"><a href="#/ege/${task}">← Задание ${task}</a></p>${gateHtml(`#/ege/${task}`)}`, view: "gate", title: "Только для учеников" };
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
      hasTheory: theory.has(task),
    }),
    view: "problem",
    title: `Задание ${task} · № ${problem.id}`,
    problem,
    index,
    hasTheory: theory.has(task),
  };
}

export async function mountRussian(host, rest = []) {
  if (!host) return;
  host.innerHTML = `<p class="lede muted">Загружаем задания…</p>`;
  try {
    const view = await renderView(rest);
    host.innerHTML = view.html;
    document.title = `${view.title} — Студия Лексикон`;
    if (view.view === "list") bindList(host);
    if (view.view === "problem") bindProblem(host, view.problem, view.index, view.hasTheory);
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  } catch (err) {
    host.innerHTML = `<div class="empty">Не удалось загрузить задания. <button type="button" class="btn secondary" id="rus-retry">Повторить</button></div>`;
    host.querySelector("#rus-retry")?.addEventListener("click", () => {
      manifestCache = null;
      bankCache.clear();
      clearBankCache();
      clearTheoryCache();
      mountRussian(host, rest);
    });
    console.error(err);
  }
}
