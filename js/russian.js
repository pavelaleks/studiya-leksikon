import { BASE, studioTelegram } from "./config.js";
import { iconTelegram } from "./icons.js";
import { doneIds, markEgeDone, pickEgeVariant, readProgress, touchEge } from "./progress.js";
import { escapeHtml } from "./ui.js";

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
  const key = `list:${file}`;
  if (bankCache.has(key)) return bankCache.get(key);
  const data = await loadJson(dataUrl(`js/russian-data/${listPath(file)}`).toString());
  bankCache.set(key, data);
  return data;
}

function orderPath(file) {
  return String(file).replace(/\.json$/i, ".order.json");
}

async function loadOrder(file) {
  const key = `order:${file}`;
  if (bankCache.has(key)) return bankCache.get(key);
  const data = await loadJson(dataUrl(`js/russian-data/${orderPath(file)}`).toString());
  bankCache.set(key, data);
  return data;
}

async function loadCached(key, path) {
  if (bankCache.has(key)) return bankCache.get(key);
  const pending = loadJson(dataUrl(path).toString()).then((data) => {
    bankCache.set(key, data);
    return data;
  });
  bankCache.set(key, pending);
  try {
    return await pending;
  } catch (err) {
    bankCache.delete(key);
    throw err;
  }
}

function loadProblem(task, id) {
  const nn = String(task).padStart(2, "0");
  return loadCached(`problem:${id}`, `js/russian-data/problems/${nn}/${id}.json`);
}

function loadPassage(id) {
  return loadCached(`passage:${id}`, `js/russian-data/passages/${id}.json`);
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
  const chips = Array.from({ length: 27 }, (_, i) => i + 1)
    .map((n) => {
      const on = Number(active) === n;
      return `<a class="lit-task-chip${on ? " is-active" : ""}" href="#/ege/${n}">${n}</a>`;
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
  return root.innerHTML;
}

function hubHtml(manifest) {
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
                ? `<span class="lit-write-mark">${iconTelegram("msg-icon msg-icon-sm")} в Telegram</span>`
                : ""
            }
          </span>
        </a>`;
    })
    .join("");
  return `
    <header class="lit-hub">
      <p class="crumbs"><a href="#/">← Студия</a></p>
      <p class="eyebrow">Русский язык · ЕГЭ</p>
      <h1>Задания 1–27</h1>
      <p class="lede">Краткий ответ проверяется на сайте. Сочинение, задание 27, можно отправить преподавателю в Telegram.</p>
      ${continueLink()}
    </header>
    <div class="lit-task-grid">${cards}</div>
    ${sourceNote()}`;
}

function listHtml({ file, bank }) {
  const task = file.task;
  const essay = task === 27;
  const done = doneIds(task);
  const topics = (file.topics || [])
    .filter((t) => t.count > 0)
    .map(
      (t) =>
        `<button type="button" class="lit-topic-chip" data-topic="${t.id}">${escapeHtml(t.title)} <small>${t.count}</small></button>`
    )
    .join("");
  const items = (bank.problems || [])
    .map((problem, i) => {
      const blob = norm([problem.questionText, problem.topic].join(" "));
      const solved = done.has(problem.id) || done.has(String(problem.id));
      return `
        <a class="lit-item${solved ? " is-done" : ""}" href="#/ege/${task}/${problem.id}" data-topic="${problem.topicId}" data-blob="${escapeHtml(blob)}">
          <span class="lit-item-n">${i + 1}</span>
          <span class="lit-item-body">
            <strong>${escapeHtml(problem.topic || `Вариант ${i + 1}`)}</strong>
            <span>${escapeHtml(clip(problem.questionText, 180))}</span>
          </span>
        </a>`;
    })
    .join("");
  return `
    <p class="crumbs"><a href="#/ege">← К заданиям 1–27</a></p>
    ${taskNav(task)}
    <header class="lit-head">
      <p class="eyebrow">Задание ${task}</p>
      <h1>${escapeHtml(file.title)}</h1>
      <p class="lede">${file.count} ${ru(file.count, "задание", "задания", "заданий")}${essay ? ". Текст сочинения можно отправить в Telegram." : "."}</p>
      <div class="home-actions">
        <a class="btn btn-lg" href="#/ege/${task}/random">Случайный вариант</a>
      </div>
      <label class="lit-search-wrap" for="rus-q">
        <span class="visually-hidden">Поиск по заданиям</span>
        <input class="search lit-search" id="rus-q" type="search" placeholder="Слова из вопроса" autocomplete="off" />
      </label>
      <p class="lit-search-status muted" id="rus-status" aria-live="polite"></p>
      ${topics ? `<div class="lit-topic-nav" aria-label="Подборки">${topics}</div>` : ""}
    </header>
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

function telegramText(problem, answer) {
  const lines = [
    "Студия «Лексикон». ЕГЭ по русскому языку",
    `Задание ${problem.task}, № ${problem.id}`,
  ];
  const source = sourceLine(problem);
  if (source) lines.push(source);
  const question = clip(problem.questionText, 500);
  if (question) lines.push("", question);
  lines.push("", "Сочинение:", String(answer || "").trim() || "(напишу в чате или пришлю фото тетради)");
  const link = `${location.origin}${location.pathname}${location.search}#/ege/${problem.task}/${problem.id}`;
  lines.push("", link);
  return lines.join("\n");
}

function problemHtml({ file, problem, passage, index, total, prevId, nextId }) {
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
    ? `
      <section class="lit-write">
        <label for="rus-essay">Сочинение</label>
        <textarea id="rus-essay" class="lit-essay" placeholder="Напишите сочинение здесь — или оставьте поле пустым, если хотите прислать фото тетради."></textarea>
        <button type="button" class="lit-send" id="rus-send">
          ${iconTelegram("msg-icon msg-icon-lg")}
          <span><strong>Отправить сочинение</strong><small>Откроется Telegram с текстом сообщения</small></span>
        </button>
        <p class="lit-send-hint muted">Фото приложите уже в чате Telegram: скрепка или кнопка вложения рядом с полем ввода.</p>
        <p class="lit-send-status muted" id="rus-send-status" aria-live="polite"></p>
      </section>`
    : problem.answer
      ? `
      <section class="lit-check">
        <label for="rus-answer">${escapeHtml(label)}</label>
        <div class="lit-check-row">
          <input id="rus-answer" class="search" type="text" autocomplete="off" ${numeric ? 'inputmode="numeric"' : ""} placeholder="${escapeHtml(placeholder(problem))}" />
          <button type="button" class="btn" id="rus-check">Проверить</button>
        </div>
        <p class="lit-result" id="rus-result" aria-live="polite"></p>
      </section>`
      : "";
  const where = sourceLine(problem);
  return `
    <p class="crumbs">
      <a href="#/ege">ЕГЭ</a><span>/</span>
      <a href="#/ege/${task}">Задание ${task}</a>
    </p>
    ${taskNav(task)}
    <article class="lit-problem">
      <p class="eyebrow">${escapeHtml(label)} · № ${problem.id}</p>
      <h1>${escapeHtml(file.title)}</h1>
      ${where ? `<p class="lit-meta muted">${escapeHtml(where)}</p>` : ""}
      ${passageBlock}
      <section class="lit-question"><div class="lit-html">${sanitizeHtml(problem.questionHtml)}</div></section>
      ${answerBlock}
      ${
        problem.solutionHtml
          ? `<details class="lit-solution"><summary>Пояснение</summary><div class="lit-html">${sanitizeHtml(problem.solutionHtml)}</div></details>`
          : ""
      }
      <div class="lit-pager">
        ${prev ? `<a href="${hrefOf(prev)}">← Предыдущее</a>` : `<span></span>`}
        <span class="muted">${index + 1} из ${total}</span>
        ${next ? `<a href="${hrefOf(next)}">Следующее →</a>` : `<span></span>`}
      </div>
    </article>
    ${sourceNote()}`;
}

function missingHtml() {
  return `<div class="empty">Такого задания нет. <a href="#/ege">К заданиям 1–27</a></div>`;
}

function normWord(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[«»"]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, "")
    .replace(/[.,;:]+$/g, "");
}

function digitsOf(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function canCover(digits, numbers) {
  function walk(rest, pool) {
    if (!rest) return pool.length === 0;
    if (!pool.length) return false;
    for (let i = 0; i < pool.length; i += 1) {
      const token = String(pool[i]);
      if (!rest.startsWith(token)) continue;
      const next = pool.slice(0, i).concat(pool.slice(i + 1));
      if (walk(rest.slice(token.length), next)) return true;
    }
    return false;
  }
  return walk(digits, [...numbers]);
}

function sameNumbers(raw, expected) {
  const exp = [...expected].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  if (!exp.length) return false;
  const text = String(raw ?? "").trim();
  if (/[\s,;]/.test(text)) {
    const got = text
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map((part) => Number(part))
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b);
    return got.length === exp.length && got.every((n, i) => n === exp[i]);
  }
  const digits = digitsOf(text);
  if (!digits) return false;
  if (exp.every((n) => n < 10)) {
    const got = [...digits].map(Number).sort((a, b) => a - b);
    return got.length === exp.length && got.every((n, i) => n === exp[i]);
  }
  return canCover(digits, exp);
}

function answersMatch(problem, raw) {
  const mode = problem.answerMode;
  if (mode === "word") {
    const got = normWord(raw);
    if (!got) return false;
    const keys = [problem.answerNorm, ...(problem.answerAlts || [])].map(normWord).filter(Boolean);
    return keys.some((key) => key === got);
  }
  if (mode === "digits-fixed") {
    const got = digitsOf(raw);
    if (!got) return false;
    const keys = [problem.answerNorm, problem.answer, ...(problem.answerAlts || [])].map(digitsOf).filter(Boolean);
    return keys.some((key) => key === got);
  }
  if (mode === "digits-any") {
    const got = [...digitsOf(raw)].sort().join("");
    const normDigits = problem.answerNorm || [...digitsOf(problem.answer || "")].sort().join("");
    return Boolean(got) && got === normDigits;
  }
  if (mode === "numbers") {
    if (Array.isArray(problem.answerNumbers) && problem.answerNumbers.length) {
      return sameNumbers(raw, problem.answerNumbers);
    }
    const got = digitsOf(raw);
    const keys = [problem.answer, problem.answerNorm, ...(problem.answerAlts || [])].map(digitsOf).filter(Boolean);
    return Boolean(got) && keys.some((key) => key === got);
  }
  return false;
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

function bindProblem(root, problem, index) {
  touchEge({ id: problem.id, egeTask: problem.task }, index);
  const input = root.querySelector("#rus-answer");
  const result = root.querySelector("#rus-result");
  const check = root.querySelector("#rus-check");
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
    result.textContent = ok ? "Верно." : "Пока не совпало. Можно проверить запись или открыть пояснение.";
    if (ok) {
      markEgeDone({ id: problem.id, egeTask: problem.task });
      if (solution) solution.open = true;
    }
  };
  check?.addEventListener("click", run);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });

  const area = root.querySelector("#rus-essay");
  const send = root.querySelector("#rus-send");
  const status = root.querySelector("#rus-send-status");
  const draftKey = `rus-draft-${problem.id}`;
  if (area) {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) area.value = saved;
    } catch {
      /* черновик необязателен */
    }
    area.addEventListener("input", () => {
      try {
        sessionStorage.setItem(draftKey, area.value);
      } catch {
        /* хранилище может быть закрыто */
      }
    });
  }
  send?.addEventListener("click", () => {
    const url = fitTelegramUrl(telegramText(problem, area?.value || ""));
    if (!url) {
      if (status) status.textContent = "Telegram не настроен.";
      return;
    }
    if (status) status.textContent = "Открываю Telegram. Нажмите «Отправить» в чате; фото добавьте скрепкой рядом с сообщением.";
    window.open(url, "_blank", "noopener");
  });
}

async function renderView(rest) {
  const manifest = await loadManifest();
  const [a, b] = rest;
  if (!a) return { html: hubHtml(manifest), view: "hub", title: "ЕГЭ по русскому" };
  const task = Number(a);
  const file = taskFiles(manifest).find((item) => item.task === task);
  if (!file) return { html: missingHtml(), view: "missing", title: "Задание не найдено" };
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
    return { html: listHtml({ file, bank: list }), view: "list", title: `Задание ${task}. ${file.title}` };
  }
  const [ids, problem] = await Promise.all([loadOrder(file.file), loadProblem(task, b)]);
  const index = ids.findIndex((id) => String(id) === String(b));
  if (index < 0) return { html: missingHtml(), view: "missing", title: "Задание не найдено" };
  const passage = problem.passageId ? await loadPassage(problem.passageId) : null;
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

export async function mountRussian(host, rest = []) {
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
    host.innerHTML = `<div class="empty">Не удалось загрузить задания. <button type="button" class="btn secondary" id="rus-retry">Повторить</button></div>`;
    host.querySelector("#rus-retry")?.addEventListener("click", () => {
      manifestCache = null;
      bankCache.clear();
      mountRussian(host, rest);
    });
    console.error(err);
  }
}
