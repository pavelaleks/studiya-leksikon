import { BASE, studioTelegram } from "./config.js";
import { iconTelegram } from "./icons.js";
import { escapeHtml } from "./ui.js";

const MANIFEST_URL = new URL("js/literature-data/manifest.json", new URL(BASE, location.href));
const TOPICS_URL = new URL("js/literature-data/ege-task-11-topics.json", new URL(BASE, location.href));
const TERMS_URL = new URL("js/literature-data/terms.json", new URL(BASE, location.href));

const WRITTEN = new Set([4, 5, 9, 10, 11]);

const TASK_COPY = {
  1: ["Проза", "Краткий ответ по фрагменту"],
  2: ["Соответствие", "Цифры к каждой позиции"],
  3: ["Термины", "Эпос и драма"],
  4: ["Развёрнутый ответ", "5–10 предложений по фрагменту"],
  5: ["Анализ прозы", "Фрагмент и всё произведение"],
  6: ["Термины", "Лирика"],
  7: ["Тропы и стих", "Средства, размер, рифма"],
  8: ["Приёмы", "Средства в стихотворении"],
  9: ["Развёрнутый ответ", "Анализ стихотворения"],
  10: ["Сопоставление", "Два стихотворения"],
  11: ["Сочинение", "Одна тема из пяти"],
};

const PERIOD_SHORT = {
  "древнерусская-литература": "Древнерусская",
  "литература-xviii-века": "XVIII в.",
  "литература-первой-половины-xix-века": "1-я пол. XIX",
  "литература-второй-половины-xix-века": "2-я пол. XIX",
  "литература-рубежа-xix-xx-веков-и-серебряный-век": "Рубеж XIX–XX",
  "литература-xx-начала-xxi-века": "XX–XXI вв.",
  "свободные-сопоставительные-междисциплинарные-темы": "Свободные темы",
};

const ALLOWED = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "sub", "sup",
  "table", "thead", "tbody", "tr", "td", "th",
  "ul", "ol", "li", "blockquote", "nobr", "div", "span", "center", "h3", "h4", "a",
]);

let manifestCache = null;
const bankCache = new Map();
let topicsCache = null;
let termsCache = null;

function ru(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function answerKey(s) {
  return norm(s).replace(/^[.:;\s]+|[.:;\s]+$/g, "");
}

function clip(s, n) {
  const text = String(s || "").replace(/\s+/g, " ").trim();
  if (text.length <= n) return text;
  return `${text.slice(0, n - 1).trim()}…`;
}

function dataUrl(path) {
  return new URL(path, new URL(BASE, location.href)).toString();
}

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Не удалось загрузить данные (${res.status})`);
  return res.json();
}

async function loadManifest() {
  if (manifestCache) return manifestCache;
  manifestCache = await loadJson(MANIFEST_URL.toString());
  return manifestCache;
}

async function loadBank(file) {
  if (bankCache.has(file)) return bankCache.get(file);
  const data = await loadJson(dataUrl(`js/literature-data/${file}`));
  bankCache.set(file, data);
  return data;
}

async function loadTopics() {
  if (topicsCache) return topicsCache;
  topicsCache = await loadJson(TOPICS_URL.toString());
  return topicsCache;
}

async function loadTerms() {
  if (termsCache) return termsCache;
  termsCache = await loadJson(TERMS_URL.toString());
  return termsCache;
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function egeFiles(manifest) {
  return (manifest.files || []).filter((f) => f.kind === "ege").sort((a, b) => a.task - b.task);
}

function extraFiles(manifest) {
  return (manifest.files || []).filter((f) => f.kind === "extra");
}

function taskNav(active) {
  const chips = egeNumbers()
    .map((n) => {
      const on = Number(active) === n;
      return `<a class="lit-task-chip${on ? " is-active" : ""}" href="#/literature/${n}">${n}</a>`;
    })
    .join("");
  return `<nav class="lit-task-nav" aria-label="Номера заданий ЕГЭ">${chips}</nav>`;
}

function egeNumbers() {
  return Array.from({ length: 11 }, (_, i) => i + 1);
}

function sourceNote() {
  return `<p class="lit-source-note muted">Задания и пояснения: <a href="https://lit-ege.sdamgia.ru/" target="_blank" rel="noopener noreferrer">Решу ЕГЭ</a></p>`;
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function workLine(problem) {
  const bits = [];
  if (problem.author) bits.push(decodeEntities(problem.author));
  if (problem.work) bits.push(`«${decodeEntities(problem.work)}»`);
  return bits.join(". ");
}

function cardTitle(problem) {
  return workLine(problem) || problem.topic || "Задание";
}

function sanitizeHtml(html) {
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
      if (name === "class" && attr.value.split(/\s+/).includes("lit-right")) return;
      if ((name === "colspan" || name === "rowspan") && (tag === "td" || tag === "th")) return;
      if (name === "href" && tag === "a" && /^https?:/i.test(attr.value)) return;
      node.removeAttribute(attr.name);
    });
    if (tag === "a" && node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  return root.innerHTML;
}

function hubHtml(manifest) {
  const files = egeFiles(manifest);
  const cards = files
    .map((file) => {
      const [title, hint] = TASK_COPY[file.task] || [file.title, ""];
      const written = WRITTEN.has(file.task);
      return `
        <a class="lit-task-card${written ? " is-written" : ""}" href="#/literature/${file.task}">
          <span class="lit-task-num">${file.task}</span>
          <strong>${escapeHtml(title)}</strong>
          <span class="muted">${escapeHtml(hint)}</span>
          <span class="lit-task-meta">
            <span>${file.count} ${ru(file.count, "задание", "задания", "заданий")}</span>
            ${
              written
                ? `<span class="lit-write-mark">${iconTelegram("msg-icon msg-icon-sm")} письменно</span>`
                : ""
            }
          </span>
        </a>`;
    })
    .join("");
  const extras = extraFiles(manifest);
  const extraCount = extras.reduce((sum, f) => sum + (f.count || 0), 0);
  const extraLinks = extras
    .map(
      (f) => `
      <a class="lit-extra-link" href="#/literature/archive/${escapeHtml(f.id)}">
        <span>${escapeHtml(f.title)}</span>
        <small>${f.count}</small>
      </a>`
    )
    .join("");
  return `
    <header class="lit-hub">
      <p class="eyebrow">Литература · ЕГЭ</p>
      <h1>Задания 1–11</h1>
      <p class="lede">Фрагмент, вопрос и пояснение. Краткий ответ проверяется на сайте. Письменные задания 4, 5, 9, 10 и 11 можно отправить преподавателю в Telegram.</p>
    </header>
    <div class="lit-tools">
      <a class="lit-tool-card" href="#/literature/terms">
        <strong>Словарь терминов</strong>
        <span>Алфавит, темы и поиск по литературоведческим понятиям</span>
      </a>
      <a class="lit-tool-card lit-tool-train" href="#/literature/terms/train">
        <strong>Тренажёр терминов</strong>
        <span>Определение → термин, карточки для повторения</span>
      </a>
    </div>
    <div class="lit-task-grid">${cards}</div>
    <details class="lit-archive">
      <summary>Дополнительные задания прежнего формата <span class="lit-count">${extraCount}</span></summary>
      <div class="lit-extra-list">${extraLinks}</div>
    </details>
    ${sourceNote()}`;
}

function listHtml({ file, bank, mode }) {
  const task = file.task;
  const written = WRITTEN.has(task);
  const [title, hint] = TASK_COPY[task] || [file.title, file.title];
  const topics = (file.topics || [])
    .map(
      (t) =>
        `<button type="button" class="lit-topic-chip" data-topic="${t.id}">${escapeHtml(t.title)} <small>${t.count}</small></button>`
    )
    .join("");
  const items = (bank.problems || [])
    .map((problem, i) => {
      const href =
        mode === "extra"
          ? `#/literature/archive/${file.id}/${problem.id}`
          : `#/literature/${task}/${problem.id}`;
      const blob = norm([cardTitle(problem), problem.questionText, problem.topic, problem.author, problem.work].join(" "));
      return `
        <a class="lit-item" href="${href}" data-topic="${problem.topicId}" data-blob="${escapeHtml(blob)}">
          <span class="lit-item-n">${i + 1}</span>
          <span class="lit-item-body">
            <strong>${escapeHtml(cardTitle(problem))}</strong>
            <span>${escapeHtml(clip(decodeEntities(problem.questionText), 180))}</span>
          </span>
        </a>`;
    })
    .join("");
  const themes =
    task === 11
      ? `<p class="lit-side-link"><a href="#/literature/11/themes">Сводный список тем сочинений</a></p>`
      : "";
  const head =
    mode === "extra"
      ? `<p class="eyebrow">Дополнительно</p><h1>${escapeHtml(file.title)}</h1>`
      : `<p class="eyebrow">Задание ${task}</p><h1>${escapeHtml(title)}</h1><p class="lede">${escapeHtml(hint)}. ${file.count} ${ru(file.count, "задание", "задания", "заданий")}${written ? ". Ответ можно отправить в Telegram." : "."}</p>`;
  const back = mode === "extra" ? `<p class="crumbs"><a href="#/literature">← К заданиям 1–11</a></p>` : taskNav(task);
  return `
    ${back}
    <header class="lit-head">
      ${head}
      ${themes}
      <label class="lit-search-wrap" for="lit-q">
        <span class="visually-hidden">Поиск по заданиям</span>
        <input class="search lit-search" id="lit-q" type="search" placeholder="Автор, произведение или слова из вопроса" autocomplete="off" />
      </label>
      <p class="lit-search-status muted" id="lit-status" aria-live="polite"></p>
      ${topics ? `<div class="lit-topic-nav" aria-label="Темы">${topics}</div>` : ""}
    </header>
    <div class="lit-list" id="lit-list">${items}</div>
    ${sourceNote()}`;
}

function passageLabel(problem) {
  if (problem.answerKind === "essay") return "Текст варианта";
  if (problem.task >= 6) return "Стихотворение";
  return "Фрагмент";
}

function fitTelegramUrl(text) {
  const tg = studioTelegram();
  if (!tg.url) return "";
  let body = text;
  let url = `${tg.url}?text=${encodeURIComponent(body)}`;
  while (url.length > 3900 && body.length > 180) {
    body = `${body.slice(0, Math.floor(body.length * 0.82)).trim()}…`;
    url = `${tg.url}?text=${encodeURIComponent(body)}`;
  }
  return url;
}

function telegramText(problem, answer, listHref) {
  const lines = [
    "Студия «Лексикон». ЕГЭ по литературе",
    `Задание ${problem.task}, № ${problem.id}`,
  ];
  const who = workLine(problem);
  if (who) lines.push(who);
  const question = clip(problem.questionText, 700);
  if (question) lines.push("", question);
  lines.push("", "Ответ ученика:", String(answer || "").trim() || "(напишу в чате или пришлю фото)");
  const link = `${location.origin}${location.pathname}${location.search}${listHref}`;
  lines.push("", link);
  return lines.join("\n");
}

function problemHtml({ file, bank, problem, index, total, mode }) {
  const task = problem.task;
  const written = WRITTEN.has(task) && (problem.answerKind === "open" || problem.answerKind === "essay");
  const passage = problem.passageId ? bank.passages?.[problem.passageId] : null;
  const listHref = mode === "extra" ? `#/literature/archive/${file.id}` : `#/literature/${task}`;
  const prev = index > 0 ? bank.problems[index - 1] : null;
  const next = index < bank.problems.length - 1 ? bank.problems[index + 1] : null;
  const hrefOf = (item) =>
    mode === "extra" ? `#/literature/archive/${file.id}/${item.id}` : `#/literature/${task}/${item.id}`;
  const who = workLine(problem);
  const kindLabel =
    problem.answerKind === "match"
      ? "Соответствие: запишите цифры подряд"
      : problem.answerKind === "short"
        ? "Краткий ответ"
        : problem.answerKind === "essay"
          ? "Сочинение"
          : "Развёрнутый ответ";
  const passageBlock = passage
    ? `<section class="lit-passage"><p class="lit-kicker">${passageLabel(problem)}</p><div class="lit-html">${sanitizeHtml(passage.html)}</div></section>`
    : "";
  const answerBlock = written
    ? `
      <section class="lit-write">
        <label for="lit-essay">Ваш ответ</label>
        <textarea id="lit-essay" class="lit-essay" placeholder="Напишите ответ здесь — или оставьте поле пустым, если хотите прислать фото тетради."></textarea>
        <button type="button" class="lit-send" id="lit-send">
          ${iconTelegram("msg-icon msg-icon-lg")}
          <span><strong>Отправить задание</strong><small>Откроется Telegram с текстом сообщения</small></span>
        </button>
        <p class="lit-send-hint muted">Фото приложите уже в чате Telegram: скрепка или кнопка вложения рядом с полем ввода.</p>
        <p class="lit-send-status muted" id="lit-send-status" aria-live="polite"></p>
      </section>`
    : problem.answer
      ? `
      <section class="lit-check">
        <label for="lit-answer">${escapeHtml(kindLabel)}</label>
        <div class="lit-check-row">
          <input id="lit-answer" class="search" type="text" autocomplete="off" placeholder="${problem.answerKind === "match" ? "Например: 243" : "Введите ответ"}" />
          <button type="button" class="btn" id="lit-check">Проверить</button>
        </div>
        <p class="lit-result" id="lit-result" aria-live="polite"></p>
      </section>`
      : "";
  const nav = `
    <div class="lit-pager">
      ${prev ? `<a href="${hrefOf(prev)}">← Предыдущее</a>` : `<span></span>`}
      <span class="muted">${index + 1} из ${total}</span>
      ${next ? `<a href="${hrefOf(next)}">Следующее →</a>` : `<span></span>`}
    </div>`;
  return `
    <p class="crumbs"><a href="${listHref}">← ${mode === "extra" ? escapeHtml(file.title) : `Задание ${task}`}</a></p>
    ${mode === "extra" ? "" : taskNav(task)}
    <article class="lit-problem">
      <p class="eyebrow">${escapeHtml(kindLabel)} · № ${problem.id}</p>
      <h1>${escapeHtml(who || file.title)}</h1>
      <p class="lit-meta muted">${escapeHtml(decodeEntities(problem.topic || ""))}${
        problem.source ? ` · ${escapeHtml(decodeEntities(problem.source))}` : ""
      }</p>
      ${passageBlock}
      <section class="lit-question"><div class="lit-html">${sanitizeHtml(problem.questionHtml)}</div></section>
      ${answerBlock}
      ${
        problem.solutionHtml
          ? `<details class="lit-solution"><summary>Пояснение</summary><div class="lit-html">${sanitizeHtml(problem.solutionHtml)}</div></details>`
          : ""
      }
      ${nav}
    </article>
    ${sourceNote()}`;
}

function themesHtml(data) {
  const nav = data.periods
    .map(
      (p) => `
      <a class="lit-nav-chip" href="#lit-${escapeHtml(p.id)}" data-period="${escapeHtml(p.id)}">
        <span>${escapeHtml(PERIOD_SHORT[p.id] || p.title)}</span>
        <small>${p.count}</small>
      </a>`
    )
    .join("");
  const periods = data.periods
    .map((period) => {
      const authors = period.authors
        .map((author, ai) => {
          const topics = author.topics
            .map(
              (t) => `
              <li class="lit-topic" data-n="${t.n}">
                <span class="lit-topic-n">${t.n}</span>
                <span class="lit-topic-text">${escapeHtml(t.text)}</span>
              </li>`
            )
            .join("");
          return `
            <details class="lit-author" open>
              <summary>
                <span class="lit-author-name">${escapeHtml(author.name)}</span>
                <span class="lit-count">${author.topics.length}</span>
              </summary>
              <ol class="lit-topic-list">${topics}</ol>
            </details>`;
        })
        .join("");
      return `
        <section class="lit-period" id="lit-${escapeHtml(period.id)}" data-period="${escapeHtml(period.id)}">
          <details class="lit-period-box" open>
            <summary class="lit-period-summary">
              <span>
                <span class="lit-period-title">${escapeHtml(period.title)}</span>
                <span class="muted lit-period-meta">${period.count} тем · ${period.authors.length} ${ru(period.authors.length, "автор", "автора", "авторов")}</span>
              </span>
              <span class="lit-count lit-count-lg">${period.count}</span>
            </summary>
            <div class="lit-authors">${authors}</div>
          </details>
        </section>`;
    })
    .join("");
  return `
    <p class="crumbs"><a href="#/literature/11">← Задание 11</a></p>
    ${taskNav(11)}
    <header class="lit-head">
      <p class="eyebrow">Задание 11</p>
      <h1>Темы сочинений</h1>
      <p class="lede">Сводный список: <strong>${data.total}</strong> тем. Рядом — <a href="#/literature/11">готовые варианты с пояснениями</a>.</p>
      <label class="lit-search-wrap" for="lit-search">
        <span class="visually-hidden">Поиск по темам</span>
        <input class="search lit-search" id="lit-search" type="search" placeholder="Пушкин, Онегин, честь, Печорин…" autocomplete="off" />
      </label>
      <p class="lit-search-status muted" id="lit-search-status" aria-live="polite"></p>
      <nav class="lit-nav" aria-label="Периоды">${nav}</nav>
    </header>
    <div class="lit-body">${periods}</div>`;
}

function missingHtml() {
  return `<div class="empty">Такого задания нет. <a href="#/literature">К списку</a></div>`;
}

function termsSourceNote() {
  return `<p class="lit-source-note muted">Источники: <a href="https://www.literatura100.ru/termin" target="_blank" rel="noopener noreferrer">literatura100.ru</a>; недостающие позиции — из словаря терминов кодификатора ЕГЭ.</p>`;
}

function termsHtml(data, focusId = "") {
  const letters = (data.letters || [])
    .map((L) => `<a class="lit-letter" href="#letter-${escapeHtml(L)}" data-letter="${escapeHtml(L)}">${escapeHtml(L)}</a>`)
    .join("");
  const cats = (data.categories || [])
    .map(
      (c) =>
        `<button type="button" class="lit-topic-chip" data-cat="${escapeHtml(c.id)}">${escapeHtml(c.title)}</button>`
    )
    .join("");
  const byLetter = new Map();
  (data.terms || []).forEach((t) => {
    const L = t.letter || "#";
    if (!byLetter.has(L)) byLetter.set(L, []);
    byLetter.get(L).push(t);
  });
  const groups = [...byLetter.entries()]
    .map(([L, items]) => {
      const rows = items
        .map((t) => {
          const blob = norm([t.term, t.definition, t.categoryTitle].join(" "));
          const open = focusId && t.id === focusId ? " open" : "";
          return `
            <details class="lit-term"${open} id="term-${escapeHtml(t.id)}" data-letter="${escapeHtml(L)}" data-cat="${escapeHtml(t.category)}" data-blob="${escapeHtml(blob)}">
              <summary>
                <strong>${escapeHtml(t.term)}</strong>
                <span class="muted">${escapeHtml(t.categoryTitle || "")}</span>
              </summary>
              <p>${escapeHtml(t.definition)}</p>
            </details>`;
        })
        .join("");
      return `
        <section class="lit-term-group" id="letter-${escapeHtml(L)}" data-letter="${escapeHtml(L)}">
          <h2 class="lit-letter-head">${escapeHtml(L)}</h2>
          <div class="lit-term-list">${rows}</div>
        </section>`;
    })
    .join("");
  return `
    <p class="crumbs"><a href="#/literature">← К заданиям</a></p>
    <header class="lit-head lit-terms-head">
      <p class="eyebrow">Литература · ЕГЭ</p>
      <h1>Словарь терминов</h1>
      <p class="lede">${data.count} ${ru(data.count, "понятие", "понятия", "понятий")}. Поиск по названию и определению, алфавит и темы. <a href="#/literature/terms/train">Открыть тренажёр</a>.</p>
      <label class="lit-search-wrap" for="lit-terms-q">
        <span class="visually-hidden">Поиск по терминам</span>
        <input class="search lit-search" id="lit-terms-q" type="search" placeholder="Метафора, ямб, конфликт…" autocomplete="off" />
      </label>
      <p class="lit-search-status muted" id="lit-terms-status" aria-live="polite"></p>
      <nav class="lit-letter-nav" aria-label="Алфавит">${letters}</nav>
      <div class="lit-topic-nav" aria-label="Темы">${cats}</div>
    </header>
    <div class="lit-terms-body" id="lit-terms-body">${groups}</div>
    ${termsSourceNote()}`;
}

function termsTrainHtml(data) {
  const cats = [`<option value="">Все темы</option>`]
    .concat((data.categories || []).map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`))
    .join("");
  return `
    <p class="crumbs"><a href="#/literature/terms">← К словарю</a></p>
    <header class="lit-head">
      <p class="eyebrow">Тренажёр</p>
      <h1>Литературоведческие термины</h1>
      <p class="lede">По определению выберите термин или листайте карточки. Всего в словаре: ${data.count}.</p>
      <div class="lit-train-toolbar">
        <label>
          <span class="visually-hidden">Тема</span>
          <select id="lit-train-cat" class="lit-train-select">${cats}</select>
        </label>
        <div class="lit-train-modes" role="tablist" aria-label="Режим">
          <button type="button" class="lit-topic-chip is-active" data-mode="quiz">Викторина</button>
          <button type="button" class="lit-topic-chip" data-mode="cards">Карточки</button>
        </div>
      </div>
    </header>
    <div class="lit-train" id="lit-train" data-mode="quiz">
      <p class="muted">Загрузка…</p>
    </div>`;
}

async function renderView(rest) {
  const [a, b, c] = rest;
  if (a === "terms") {
    const data = await loadTerms();
    if (b === "train") {
      return { html: termsTrainHtml(data), view: "terms-train", title: "Тренажёр терминов", terms: data };
    }
    if (b) {
      const hit = (data.terms || []).find((t) => t.id === b);
      if (!hit) {
        return {
          html: `<div class="empty">Термин не найден. <a href="#/literature/terms">К словарю</a></div>`,
          view: "missing",
          title: "Термин не найден",
        };
      }
      return { html: termsHtml(data, hit.id), view: "terms", title: hit.term, terms: data, focusId: hit.id };
    }
    return { html: termsHtml(data), view: "terms", title: "Словарь терминов", terms: data };
  }

  const manifest = await loadManifest();
  if (!a) return { html: hubHtml(manifest), view: "hub", title: "Литература · ЕГЭ" };
  if (a === "archive") {
    if (!b) return { html: hubHtml(manifest), view: "hub", title: "Литература · ЕГЭ" };
    const file = extraFiles(manifest).find((f) => f.id === b);
    if (!file) return { html: missingHtml(), view: "missing", title: "Задание не найдено" };
    const bank = await loadBank(file.file);
    if (!c) return { html: listHtml({ file, bank, mode: "extra" }), view: "list", title: file.title };
    const index = bank.problems.findIndex((p) => String(p.id) === String(c));
    if (index < 0) return { html: missingHtml(), view: "missing", title: "Задание не найдено" };
    return {
      html: problemHtml({ file, bank, problem: bank.problems[index], index, total: bank.problems.length, mode: "extra" }),
      view: "problem",
      title: `Дополнительно · № ${c}`,
      problem: bank.problems[index],
    };
  }
  if (a === "11" && b === "themes") {
    const data = await loadTopics();
    return { html: themesHtml(data), view: "themes", title: "Темы сочинений" };
  }
  const task = Number(a);
  const file = egeFiles(manifest).find((f) => f.task === task);
  if (!file) return { html: missingHtml(), view: "missing", title: "Задание не найдено" };
  const bank = await loadBank(file.file);
  if (!b) {
    const [title] = TASK_COPY[task] || [file.title];
    return { html: listHtml({ file, bank, mode: "ege" }), view: "list", title: `Задание ${task}. ${title}` };
  }
  const index = bank.problems.findIndex((p) => String(p.id) === String(b));
  if (index < 0) return { html: missingHtml(), view: "missing", title: "Задание не найдено" };
  const problem = bank.problems[index];
  return {
    html: problemHtml({ file, bank, problem, index, total: bank.problems.length, mode: "ege" }),
    view: "problem",
    title: `Задание ${task} · № ${problem.id}`,
    problem,
  };
}

function bindTerms(root, focusId = "") {
  const search = root.querySelector("#lit-terms-q");
  const status = root.querySelector("#lit-terms-status");
  const terms = [...root.querySelectorAll(".lit-term")];
  const groups = [...root.querySelectorAll(".lit-term-group")];
  let cat = "";
  const apply = () => {
    const q = norm(search?.value || "");
    const tokens = q ? q.split(" ") : [];
    let visible = 0;
    terms.forEach((el) => {
      const okCat = !cat || el.dataset.cat === cat;
      const blob = el.dataset.blob || "";
      const okQ = tokens.every((token) => blob.includes(token));
      const ok = okCat && okQ;
      el.hidden = !ok;
      if (ok) visible += 1;
    });
    groups.forEach((group) => {
      const any = [...group.querySelectorAll(".lit-term")].some((el) => !el.hidden);
      group.hidden = !any;
    });
    root.querySelectorAll(".lit-topic-chip[data-cat]").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.cat === cat);
    });
    if (status) status.textContent = q || cat ? `Показано: ${visible}` : "";
  };
  search?.addEventListener("input", apply);
  root.querySelectorAll(".lit-topic-chip[data-cat]").forEach((chip) => {
    chip.addEventListener("click", () => {
      cat = cat === chip.dataset.cat ? "" : chip.dataset.cat;
      apply();
    });
  });
  root.querySelectorAll(".lit-letter").forEach((link) => {
    link.addEventListener("click", (e) => {
      const L = link.dataset.letter;
      const target = root.querySelector(`#letter-${CSS.escape(L)}`);
      if (!target || target.hidden) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  apply();
  if (focusId) {
    const el = root.querySelector(`#term-${CSS.escape(focusId)}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function bindTermsTrain(root, data) {
  const panel = root.querySelector("#lit-train");
  const catSelect = root.querySelector("#lit-train-cat");
  let mode = "quiz";
  let score = { ok: 0, bad: 0 };
  let deck = [];
  let index = 0;
  let revealed = false;
  let locked = false;

  const pool = () => {
    const cat = catSelect?.value || "";
    return (data.terms || []).filter((t) => !cat || t.category === cat);
  };

  const optionsFor = (item, all) => {
    const others = shuffle(all.filter((t) => t.id !== item.id)).slice(0, 3);
    return shuffle([item, ...others]);
  };

  const render = () => {
    const all = pool();
    if (all.length < 2) {
      panel.innerHTML = `<div class="empty">В этой теме мало терминов. Выберите другую.</div>`;
      return;
    }
    if (!deck.length || index >= deck.length) {
      deck = shuffle(all);
      index = 0;
    }
    const item = deck[index];
    const progress = `<p class="lit-train-score muted">Верно ${score.ok} · Ошибки ${score.bad} · Карточка ${index + 1} из ${deck.length}</p>`;

    if (mode === "cards") {
      panel.innerHTML = `
        ${progress}
        <article class="lit-train-card${revealed ? " is-open" : ""}" id="lit-card">
          <p class="lit-train-prompt">${escapeHtml(item.term)}</p>
          <p class="lit-train-def"${revealed ? "" : " hidden"}>${escapeHtml(item.definition)}</p>
          <p class="muted"${revealed ? " hidden" : ""}>Нажмите, чтобы показать определение</p>
        </article>
        <div class="lit-train-actions">
          <button type="button" class="btn secondary" id="lit-train-prev">Назад</button>
          <button type="button" class="btn" id="lit-train-next">Дальше</button>
        </div>`;
      panel.querySelector("#lit-card")?.addEventListener("click", () => {
        revealed = true;
        render();
      });
      panel.querySelector("#lit-train-prev")?.addEventListener("click", () => {
        index = Math.max(0, index - 1);
        revealed = false;
        render();
      });
      panel.querySelector("#lit-train-next")?.addEventListener("click", () => {
        index += 1;
        revealed = false;
        render();
      });
      return;
    }

    const choices = optionsFor(item, all);
    panel.innerHTML = `
      ${progress}
      <article class="lit-train-card">
        <p class="eyebrow">Что это за термин?</p>
        <p class="lit-train-def lit-train-def-quiz">${escapeHtml(item.definition)}</p>
      </article>
      <div class="lit-train-choices" id="lit-choices">
        ${choices
          .map(
            (t) =>
              `<button type="button" class="lit-train-choice" data-id="${escapeHtml(t.id)}">${escapeHtml(t.term)}</button>`
          )
          .join("")}
      </div>
      <p class="lit-train-feedback muted" id="lit-feedback" aria-live="polite"></p>
      <div class="lit-train-actions">
        <button type="button" class="btn" id="lit-train-next" hidden>Дальше</button>
      </div>`;

    locked = false;
    const feedback = panel.querySelector("#lit-feedback");
    const next = panel.querySelector("#lit-train-next");
    panel.querySelectorAll(".lit-train-choice").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (locked) return;
        locked = true;
        const ok = btn.dataset.id === item.id;
        btn.classList.add(ok ? "is-ok" : "is-bad");
        panel.querySelectorAll(".lit-train-choice").forEach((other) => {
          other.disabled = true;
          if (other.dataset.id === item.id) other.classList.add("is-ok");
        });
        if (ok) {
          score.ok += 1;
          feedback.textContent = "Верно";
        } else {
          score.bad += 1;
          feedback.textContent = `Правильный ответ: ${item.term}`;
        }
        next.hidden = false;
      });
    });
    next?.addEventListener("click", () => {
      index += 1;
      render();
    });
  };

  root.querySelectorAll(".lit-train-modes [data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      root.querySelectorAll(".lit-train-modes [data-mode]").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.mode === mode);
      });
      panel.dataset.mode = mode;
      deck = [];
      index = 0;
      revealed = false;
      score = { ok: 0, bad: 0 };
      render();
    });
  });
  catSelect?.addEventListener("change", () => {
    deck = [];
    index = 0;
    revealed = false;
    score = { ok: 0, bad: 0 };
    render();
  });
  render();
}

function bindList(root) {
  const search = root.querySelector("#lit-q");
  const status = root.querySelector("#lit-status");
  const items = [...root.querySelectorAll(".lit-item")];
  let topic = "";
  const apply = () => {
    const q = norm(search?.value || "");
    const tokens = q ? q.split(" ") : [];
    let visible = 0;
    items.forEach((el) => {
      const okTopic = !topic || el.dataset.topic === topic;
      const blob = el.dataset.blob || "";
      const okQ = tokens.every((token) => blob.includes(token));
      const ok = okTopic && okQ;
      el.hidden = !ok;
      if (ok) visible += 1;
    });
    root.querySelectorAll(".lit-topic-chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.topic === topic);
    });
    if (!status) return;
    status.textContent = q || topic ? `Показано: ${visible}` : "";
  };
  search?.addEventListener("input", apply);
  root.querySelectorAll(".lit-topic-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      topic = topic === chip.dataset.topic ? "" : chip.dataset.topic;
      apply();
    });
  });
}

function answersMatch(problem, raw) {
  const got = answerKey(raw);
  if (!got) return false;
  const keys = [problem.answerNorm, ...(problem.answerAlts || [])].filter(Boolean).map(answerKey);
  if (problem.answerKind === "match") {
    const digits = (s) => String(s).replace(/\D/g, "");
    return keys.some((k) => digits(k) && digits(k) === digits(got));
  }
  return keys.some((k) => k === got);
}

function bindProblem(root, problem) {
  const input = root.querySelector("#lit-answer");
  const result = root.querySelector("#lit-result");
  const check = root.querySelector("#lit-check");
  const solution = root.querySelector(".lit-solution");
  const run = () => {
    if (!input || !result) return;
    const value = input.value.trim();
    if (!value) {
      result.textContent = "Введите ответ.";
      result.className = "lit-result";
      return;
    }
    const ok = answersMatch(problem, value);
    result.className = `lit-result ${ok ? "is-ok" : "is-bad"}`;
    result.textContent = ok ? "Верно." : "Пока не совпало. Можно проверить формулировку или открыть пояснение.";
    if (ok && solution) solution.open = true;
  };
  check?.addEventListener("click", run);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });

  const area = root.querySelector("#lit-essay");
  const send = root.querySelector("#lit-send");
  const status = root.querySelector("#lit-send-status");
  const draftKey = `lit-draft-${problem.id}`;
  if (area) {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) area.value = saved;
    } catch {
      /* ignore */
    }
    area.addEventListener("input", () => {
      try {
        sessionStorage.setItem(draftKey, area.value);
      } catch {
        /* ignore */
      }
    });
  }
  send?.addEventListener("click", () => {
    const href = `#/literature/${problem.task}/${problem.id}`;
    const url = fitTelegramUrl(telegramText(problem, area?.value || "", href));
    if (!url) {
      if (status) status.textContent = "Telegram не настроен.";
      return;
    }
    if (status) status.textContent = "Открываю Telegram. Нажмите «Отправить» в чате; фото добавьте скрепкой рядом с сообщением.";
    window.open(url, "_blank", "noopener");
  });
}

function bindThemes(root) {
  const search = root.querySelector("#lit-search");
  const status = root.querySelector("#lit-search-status");
  const apply = () => {
    const q = norm(search?.value || "");
    const tokens = q ? q.split(" ") : [];
    let visible = 0;
    root.querySelectorAll(".lit-topic").forEach((li) => {
      const author = li.closest(".lit-author");
      const period = li.closest(".lit-period");
      const blob = norm(
        [
          li.dataset.n,
          li.querySelector(".lit-topic-text")?.textContent,
          author?.querySelector(".lit-author-name")?.textContent,
          period?.querySelector(".lit-period-title")?.textContent,
        ].join(" ")
      );
      const ok = tokens.every((token) => blob.includes(token));
      li.hidden = !ok;
      if (ok) visible += 1;
    });
    root.querySelectorAll(".lit-author").forEach((author) => {
      const any = [...author.querySelectorAll(".lit-topic")].some((li) => !li.hidden);
      author.hidden = !any;
      if (q && any) author.open = true;
    });
    root.querySelectorAll(".lit-period").forEach((section) => {
      const any = [...section.querySelectorAll(".lit-author")].some((a) => !a.hidden);
      section.hidden = !any;
      const box = section.querySelector(".lit-period-box");
      if (box && q && any) box.open = true;
    });
    root.querySelectorAll(".lit-nav-chip").forEach((chip) => {
      const section = root.querySelector(`.lit-period[data-period="${CSS.escape(chip.dataset.period || "")}"]`);
      chip.hidden = Boolean(section?.hidden);
    });
    if (status) status.textContent = q ? `Найдено: ${visible} ${ru(visible, "тема", "темы", "тем")}` : "";
  };
  search?.addEventListener("input", apply);
  root.querySelectorAll(".lit-nav-chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      const id = chip.getAttribute("href")?.slice(1);
      const target = id ? root.querySelector(`#${CSS.escape(id)}`) : null;
      if (!target || target.hidden) return;
      const box = target.querySelector(".lit-period-box");
      if (box) box.open = true;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

export async function mountLiterature(host, rest = []) {
  if (!host) return;
  host.innerHTML = `<p class="lede muted">Загружаем задания…</p>`;
  try {
    const view = await renderView(rest);
    host.innerHTML = view.html;
    document.title = `${view.title} — Студия Лексикон`;
    if (view.view === "list") bindList(host);
    if (view.view === "problem") bindProblem(host, view.problem);
    if (view.view === "themes") bindThemes(host);
    if (view.view === "terms") bindTerms(host, view.focusId || "");
    if (view.view === "terms-train") bindTermsTrain(host, view.terms);
  } catch (err) {
    host.innerHTML = `<div class="empty">Не удалось загрузить задания. <button type="button" class="btn secondary" id="lit-retry">Повторить</button></div>`;
    host.querySelector("#lit-retry")?.addEventListener("click", () => {
      manifestCache = null;
      topicsCache = null;
      termsCache = null;
      bankCache.clear();
      mountLiterature(host, rest);
    });
    console.error(err);
  }
}
