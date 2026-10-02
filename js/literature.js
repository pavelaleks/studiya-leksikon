import { BASE } from "./config.js";
import { escapeHtml } from "./ui.js";

const DATA_URL = new URL("js/literature-data/ege-task-11-topics.json", new URL(BASE, location.href));

const PERIOD_SHORT = {
  "древнерусская-литература": "Древнерусская",
  "литература-xviii-века": "XVIII в.",
  "литература-первой-половины-xix-века": "1-я пол. XIX",
  "литература-второй-половины-xix-века": "2-я пол. XIX",
  "литература-рубежа-xix-xx-веков-и-серебряный-век": "Рубеж XIX–XX",
  "литература-xx-начала-xxi-века": "XX–XXI вв.",
  "свободные-сопоставительные-междисциплинарные-темы": "Свободные темы",
};

let cache = null;

async function loadTopics() {
  if (cache) return cache;
  const res = await fetch(DATA_URL.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Не удалось загрузить темы (${res.status})`);
  cache = await res.json();
  return cache;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function periodShort(period) {
  return PERIOD_SHORT[period.id] || period.title;
}

function renderShell(data) {
  const nav = data.periods
    .map(
      (p) => `
      <a class="lit-nav-chip" href="#lit-${escapeHtml(p.id)}" data-period="${escapeHtml(p.id)}">
        <span>${escapeHtml(periodShort(p))}</span>
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
            <details class="lit-author" data-author-id="${escapeHtml(period.id)}-${ai}" open>
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
                <span class="muted lit-period-meta">${period.count} тем · ${period.authors.length} ${authorWord(
                  period.authors.length
                )}</span>
              </span>
              <span class="lit-count lit-count-lg">${period.count}</span>
            </summary>
            <div class="lit-authors">${authors}</div>
          </details>
        </section>`;
    })
    .join("");

  return `
    <div class="lit-page" id="lit-root">
      <header class="lit-head" id="lit-task-11">
        <p class="eyebrow">Задание 11</p>
        <h2 class="lit-h2">Темы сочинений</h2>
        <p class="lede">Сводный список: <strong>${data.total}</strong> тем (80 вариантов × 5). Поиск по автору, произведению или формулировке.</p>
        <label class="lit-search-wrap" for="lit-search">
          <span class="visually-hidden">Поиск по темам</span>
          <input class="search lit-search" id="lit-search" type="search" placeholder="Например: Пушкин, Онегин, честь, Печорин…" autocomplete="off" />
        </label>
        <p class="lit-search-status muted" id="lit-search-status" aria-live="polite"></p>
        <nav class="lit-nav" aria-label="Периоды">${nav}</nav>
      </header>
      <div class="lit-body">${periods}</div>
      <div class="home-actions lit-foot">
        <a class="btn btn-lg secondary" href="#/ege">К ЕГЭ по русскому</a>
        <a class="btn btn-lg secondary" href="#/">О студии</a>
      </div>
    </div>`;
}

function authorWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "автор";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "автора";
  return "авторов";
}

function applyFilter(root, rawQuery) {
  const q = norm(rawQuery);
  const status = root.querySelector("#lit-search-status");
  const topics = [...root.querySelectorAll(".lit-topic")];
  let visible = 0;

  topics.forEach((li) => {
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
    const ok = !q || q.split(/\s+/).every((token) => blob.includes(token));
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
    const id = chip.dataset.period;
    const section = root.querySelector(`.lit-period[data-period="${CSS.escape(id)}"]`);
    chip.hidden = Boolean(section?.hidden);
    chip.classList.toggle("is-dim", Boolean(q) && !chip.hidden && visible === 0);
  });

  if (!status) return;
  if (!q) {
    status.textContent = "";
    return;
  }
  status.textContent =
    visible === 0
      ? "Ничего не найдено — попробуйте другое слово или фамилию автора."
      : `Найдено: ${visible} ${topicWord(visible)}`;
}

function topicWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "тема";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "темы";
  return "тем";
}

function bindUi(root) {
  const search = root.querySelector("#lit-search");
  search?.addEventListener("input", () => applyFilter(root, search.value));

  root.querySelectorAll(".lit-nav-chip").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      const id = chip.getAttribute("href")?.slice(1);
      const target = id ? root.querySelector(`#${CSS.escape(id)}`) : null;
      if (!target || target.hidden) return;
      const box = target.querySelector(".lit-period-box");
      if (box) box.open = true;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `${location.pathname}${location.search}#/literature`);
    });
  });
}

export async function mountLiterature(host) {
  if (!host) return;
  try {
    const data = await loadTopics();
    const tmp = document.createElement("div");
    tmp.innerHTML = renderShell(data).trim();
    const next = tmp.firstElementChild;
    host.replaceWith(next);
    bindUi(next);
  } catch (err) {
    host.classList.remove("lit-loading");
    host.innerHTML = `
      <p class="eyebrow">Задание 11</p>
      <h2 class="lit-h2">Темы сочинений</h2>
      <div class="empty">Не удалось загрузить список тем. <button type="button" class="btn secondary" id="lit-retry">Повторить</button></div>`;
    host.querySelector("#lit-retry")?.addEventListener("click", () => {
      cache = null;
      mountLiterature(host);
    });
    console.error(err);
  }
}
