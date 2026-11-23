// ОГЭ по литературе: задания 1–5 (банк «Решу ОГЭ», источник oge-lit). Все задания письменные —
// ответ сдаётся на проверку преподавателю. Маршруты: #/literature/oge, /oge/N, /oge/N/<id>.
import { BASE } from "./config.js";
import { escapeHtml } from "./ui.js";
import { accessState, bankFull, bankList } from "./supa.js";
import { bindWritten, demoBannerHtml, gateHtml, writtenBlockHtml } from "./practice.js?v=land190";
import { clip, decodeEntities, norm, ru, sanitizeHtml, workLine } from "./literature.js?v=land190";

export const SOURCE = "oge-lit";
const ROOT = "#/literature/oge";

// Номера и названия — по демоверсии ОГЭ 2027; число заданий в банке берётся из базы.
const TASKS = [
  { n: 1, title: "Ответ по фрагменту", hint: "Эпос или драма: развёрнутый ответ на вопрос по тексту" },
  { n: 2, title: "Вопрос по прозе", hint: "Другой фрагмент того же произведения — свой анализ" },
  { n: 3, title: "Ответ по стихотворению", hint: "Лирика: развёрнутый ответ на вопрос" },
  { n: 4, title: "Сопоставление", hint: "Сравнить с другим произведением" },
  { n: 5, title: "Сочинение", hint: "Одна тема из пяти, не менее 200 слов" },
];
const bankOf = (n) => `oge-${String(n).padStart(2, "0")}`;

// Сколько заданий в банке (гостю база отдаёт только демо, поэтому итог — из manifest.json)
let manifestP = null;
function totals() {
  if (!manifestP) {
    const url = new URL("js/literature-oge-data/manifest.json", new URL(BASE, location.href));
    url.searchParams.set("v", "litoge1");
    manifestP = fetch(url)
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((m) => Object.fromEntries((m.files || []).map((f) => [f.task, f.count])))
      .catch(() => ({}));
  }
  return manifestP;
}

function taskNav(active) {
  return `<nav class="lit-task-nav" aria-label="Номера заданий ОГЭ">${TASKS.map(
    (t) => `<a class="lit-task-chip${Number(active) === t.n ? " is-active" : ""}" href="${ROOT}/${t.n}">${t.n}</a>`
  ).join("")}</nav>`;
}

function sourceNote() {
  return `<p class="lit-source-note muted">Задания и пояснения: <a href="https://lit-oge.sdamgia.ru/" target="_blank" rel="noopener noreferrer">Решу ОГЭ</a></p>`;
}

const cardTitle = (p) => workLine(p) || p.topic || "Задание";

async function hubHtml() {
  const counts = await totals();
  const cards = TASKS.map((t) => {
    const count = counts[t.n] || 0;
    return `
      <a class="lit-task-card is-written" href="${ROOT}/${t.n}">
        <span class="lit-task-num">${t.n}</span>
        <strong>${escapeHtml(t.title)}</strong>
        <span class="muted">${escapeHtml(t.hint)}</span>
        <span class="lit-task-meta">
          <span>${count} ${ru(count, "задание", "задания", "заданий")}</span>
          <span class="lit-write-mark">письменно</span>
        </span>
      </a>`;
  }).join("");
  return `
    <header class="lit-hub">
      <p class="crumbs"><a href="#/literature">← Литература · ЕГЭ</a></p>
      <p class="eyebrow">Литература · ОГЭ</p>
      <h1>Задания 1–5</h1>
      <p class="lede">Все задания ОГЭ по литературе — с развёрнутым ответом: напишите ответ и сдайте его на проверку, преподаватель оценит по критериям ФИПИ. После оценки откроется пояснение.</p>
    </header>
    <div class="lit-tools lit-tools-lib">
      <a class="lit-tool-card lit-tool-lib" href="#/library">
        <strong>Библиотека</strong>
        <span>Тексты произведений из кодификатора</span>
      </a>
      <a class="lit-tool-card" href="#/literature/terms">
        <strong>Словарь терминов</strong>
        <span>Понятия, которые пригодятся в ответах</span>
      </a>
    </div>
    <div class="lit-task-grid">${cards}</div>
    ${sourceNote()}`;
}

function listHtml(task, problems, total) {
  const items = problems
    .map((p, i) => {
      const blob = norm([cardTitle(p), p.questionText, p.topic, p.author, p.work].join(" "));
      return `
        <a class="lit-item" href="${ROOT}/${task.n}/${p.id}" data-topic="${p.topicId}" data-blob="${escapeHtml(blob)}">
          <span class="lit-item-n">${i + 1}</span>
          <span class="lit-item-body">
            <strong>${escapeHtml(cardTitle(p))}</strong>
            <span>${escapeHtml(clip(decodeEntities(p.questionText), 180))}</span>
            ${p._demo && accessState() !== "student" && accessState() !== "teacher" ? `<span class="demo-tag">демо</span>` : ""}
          </span>
        </a>`;
    })
    .join("");
  const topics = [...new Map(problems.map((p) => [p.topicId, p.topic])).entries()]
    .filter(([id]) => id != null)
    .map(([id, title]) => {
      const n = problems.filter((p) => p.topicId === id).length;
      return `<button type="button" class="lit-topic-chip" data-topic="${id}">${escapeHtml(title || "")} <small>${n}</small></button>`;
    })
    .join("");
  return `
    <p class="crumbs"><a href="${ROOT}">← К заданиям 1–5</a></p>${taskNav(task.n)}
    <header class="lit-head">
      <p class="eyebrow">ОГЭ · задание ${task.n}</p>
      <h1>${escapeHtml(task.title)}</h1>
      <p class="lede">${escapeHtml(task.hint)}. ${total} ${ru(total, "задание", "задания", "заданий")}. Ответ сдаётся на проверку в личный кабинет.</p>
      <div class="lit-toolbar">
        <label class="lit-search-wrap" for="lit-q">
          <span class="visually-hidden">Поиск по заданиям</span>
          <input class="search lit-search" id="lit-q" type="search" placeholder="Автор, произведение или слова из вопроса" autocomplete="off" />
        </label>
      </div>
      <p class="lit-search-status muted" id="lit-status" aria-live="polite"></p>
      ${topics ? `<div class="lit-topic-nav" aria-label="Темы">${topics}</div>` : ""}
    </header>
    ${demoBannerHtml(total, problems.length)}
    <div class="lit-list" id="lit-list">${items}</div>
    ${sourceNote()}`;
}

function problemHtml(task, bank, index) {
  const problem = bank.problems[index];
  const passage = problem.passageId ? bank.passages?.[problem.passageId] : null;
  const prev = bank.problems[index - 1];
  const next = bank.problems[index + 1];
  const href = (p) => `${ROOT}/${task.n}/${p.id}`;
  const label = problem.answerKind === "essay" ? "Сочинение" : "Развёрнутый ответ";
  const kicker = task.n === 3 || task.n === 4 ? "Текст" : "Фрагмент";
  return `
    <p class="crumbs">
      <a href="${ROOT}">Литература · ОГЭ</a><span>/</span>
      <a href="${ROOT}/${task.n}">Задание ${task.n}</a>
    </p>
    ${taskNav(task.n)}
    <article class="lit-problem">
      <p class="eyebrow">${label} · № ${escapeHtml(String(problem.id))}${problem._demo ? " · демо" : ""}</p>
      <h1>${escapeHtml(workLine(problem) || task.title)}</h1>
      <p class="lit-meta muted">${escapeHtml(decodeEntities(problem.topic || ""))}${problem.source ? ` · ${escapeHtml(decodeEntities(problem.source))}` : ""}</p>
      ${passage ? `<section class="lit-passage"><p class="lit-kicker">${kicker}</p><div class="lit-html">${sanitizeHtml(passage.html)}</div></section>` : ""}
      <section class="lit-question"><div class="lit-html">${sanitizeHtml(problem.questionHtml)}</div></section>
      ${writtenBlockHtml()}
      <div class="lit-pager">
        ${prev ? `<a href="${href(prev)}">← Предыдущее</a>` : `<span></span>`}
        <span class="muted">${index + 1} из ${bank.problems.length}</span>
        ${next ? `<a href="${href(next)}">Следующее →</a>` : `<span></span>`}
      </div>
    </article>
    ${sourceNote()}`;
}

function bindList(root) {
  const search = root.querySelector("#lit-q");
  const status = root.querySelector("#lit-status");
  const items = [...root.querySelectorAll(".lit-item")];
  let topic = "";
  const apply = () => {
    const tokens = norm(search?.value || "").split(" ").filter(Boolean);
    let visible = 0;
    items.forEach((el) => {
      const ok = (!topic || el.dataset.topic === topic) && tokens.every((t) => (el.dataset.blob || "").includes(t));
      el.hidden = !ok;
      if (ok) visible += 1;
    });
    root.querySelectorAll(".lit-topic-chip").forEach((chip) => chip.classList.toggle("is-active", chip.dataset.topic === topic));
    if (status) status.textContent = tokens.length || topic ? `Показано: ${visible}` : "";
  };
  search?.addEventListener("input", apply);
  root.querySelectorAll(".lit-topic-chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      topic = topic === chip.dataset.topic ? "" : chip.dataset.topic;
      apply();
    })
  );
}

/** rest — части адреса после #/literature/oge */
export async function mountLitOge(host, rest = []) {
  const [a, b] = rest;
  const task = TASKS.find((t) => String(t.n) === String(a));
  let title = "Литература · ОГЭ";
  if (!a) {
    host.innerHTML = await hubHtml();
  } else if (!task) {
    host.innerHTML = `<div class="empty">Такого задания нет. <a href="${ROOT}">К списку</a></div>`;
  } else if (!b) {
    const [problems, counts] = await Promise.all([bankList(SOURCE, bankOf(task.n)), totals()]);
    host.innerHTML = listHtml(task, problems, counts[task.n] || problems.length);
    bindList(host);
    bankFull(SOURCE, bankOf(task.n)).catch(() => {});
    title = `ОГЭ · задание ${task.n}. ${task.title}`;
  } else {
    const bank = await bankFull(SOURCE, bankOf(task.n));
    const index = bank.problems.findIndex((p) => String(p.id) === String(b));
    if (index < 0) {
      host.innerHTML = `<p class="crumbs"><a href="${ROOT}">← Литература · ОГЭ</a></p>${gateHtml(ROOT)}`;
      title = "Только для учеников";
    } else {
      const problem = bank.problems[index];
      host.innerHTML = problemHtml(task, bank, index);
      bindWritten(host, problem, { sanitize: sanitizeHtml, label: problem.answerKind === "essay" ? "Сочинение" : "Ваш ответ" });
      title = `ОГЭ · задание ${task.n} · № ${problem.id}`;
    }
  }
  document.title = `${title} — Студия Лексикон`;
  window.scrollTo(0, 0);
}
