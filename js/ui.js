import { accessState, currentProfile } from "./supa.js";
import { studioTelegram, studioWhatsApp } from "./config.js";
import { TRACK_HREF, currentTrack, subjectsOf } from "./track.js?v=land179";

/* Значки нижнего меню: тонкая линия, как в мобильных приложениях. */
const ICON = {
  home: '<path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/>',
  pencil: '<path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M13.5 6.5l4 4"/>',
  rules: '<path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/><path d="M3 6l0 13"/><path d="M12 6l0 13"/><path d="M21 6l0 13"/>',
  books: '<path d="M5 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"/><path d="M9 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z"/><path d="M5 8h4"/><path d="M9 16h4"/><path d="M13.803 4.56l2.184 -.53c.562 -.135 1.133 .19 1.282 .732l3.695 13.418a1.02 1.02 0 0 1 -.634 1.219l-.133 .041l-2.184 .53c-.562 .135 -1.133 -.19 -1.282 -.732l-3.695 -13.418a1.02 1.02 0 0 1 .634 -1.219l.133 -.041z"/>',
  chart: '<path d="M4 19h16"/><path d="M4 15l4 -6l4 2l4 -5l4 4"/>',
  user: '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/>',
  login: '<path d="M15 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"/><path d="M21 12h-13l3 -3"/><path d="M11 15l-3 -3"/>',
  calendar: '<path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M4 11h16"/>',
  users: '<path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"/>',
  check: '<path d="M9 11l3 3l8 -8"/><path d="M20 12v6a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h9"/>',
  dots: '<path d="M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/>',
  school: '<path d="M22 9l-10 -4l-10 4l10 4l10 -4v6"/><path d="M6 10.6v5.4a6 3 0 0 0 12 0v-5.4"/>',
};

export function icon(name) {
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ""}</svg>`;
}

/** Раздел заданий ученика — по выбранному треку (курсу). */
function tasksHref() {
  return TRACK_HREF[currentTrack(currentProfile())] || "#/ege";
}

/** Нижнее меню на телефоне: у гостя, ученика и преподавателя — свои разделы. */
/** Сколько домашнего не сдано — запоминает главная ученика. */
function hwBadge(prefix = "lx-hw-open") {
  let n = 0;
  try {
    n = Number(localStorage.getItem(`${prefix}-${currentProfile()?.id}`)) || 0;
  } catch {}
  return n ? `<span class="tab-badge" aria-label="не сдано: ${n}">${n}</span>` : "";
}

function tabbar(active) {
  const state = accessState();
  const hash = location.hash || "#/";
  let items;
  if (state === "teacher") {
    const sub = (hash.match(/^#\/cabinet\/?([a-z]*)/) || [])[1] || "";
    items = [
      ["#/cabinet/today", "home", "Сегодня", active === "teacher" && (sub === "" || sub === "today")],
      ["#/cabinet/lessons", "calendar", "Занятия", active === "teacher" && (sub === "lessons" || sub === "lesson")],
      ["#/cabinet/students", "users", "Ученики", active === "teacher" && (sub === "students" || sub === "student")],
      ["#/cabinet/works", "check", "Работы", active === "teacher" && sub === "works"],
      ["more", "dots", "Ещё", (active === "teacher" && ["bank", "groups", "reading", "week", "settings"].includes(sub)) || active === "literature" || active === "rules"],
    ];
  } else if (state === "guest") {
    // гость — чаще родитель: программы, цены, тест и запись; материалы — в разделе «Материалы» на главной
    items = [
      ["#/", "home", "Студия", active === "home" && !/^#(about|prices|apply|learn|program-)/.test(hash) && !hash.startsWith("#/check")],
      ["#about", "books", "Программы", /^#(about|program-)/.test(hash)],
      ["#/check", "check", "Тест", hash.startsWith("#/check")],
      ["#apply", "pencil", "Записаться", hash.startsWith("#apply")],
      ["#/login", "login", "Войти", active === "login"],
    ];
  } else {
    const tasks = tasksHref();
    const subj = subjectsOf(currentProfile());
    items = [
      ["#/me", "home", "Главная", active === "me" && !/^#\/me\/(progress|report|profile|password)/.test(hash)],
      [tasks, "pencil", "Задания", ["ege", "oge", "vpr"].includes(active) || (active === "literature" && hash.startsWith("#/literature"))],
      subj.rus && ["#/rules", "rules", "Правила", active === "rules" || active === "practice"],
      subj.lit && ["#/library", "books", "Читать", active === "literature" && hash.startsWith("#/library")],
      ["#/me/progress", "chart", "Прогресс", active === "me" && /^#\/me\/(progress|report|profile|password)/.test(hash)],
    ].filter(Boolean);
  }
  const links = items
    .map(([href, ic, label, on]) =>
      href === "more"
        ? `<button type="button" class="tab ${on ? "is-on" : ""}" data-more aria-haspopup="true">${icon(ic)}<span>${label}</span></button>`
        : `<a class="tab ${on ? "is-on" : ""}" href="${href}" ${on ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span>${href === "#/me" ? hwBadge() : href === "#/cabinet/works" ? hwBadge("lx-works-open") : ""}</a>`
    )
    .join("");
  const more =
    state === "teacher"
      ? `<div class="sheet" id="more-sheet" hidden>
          <div class="sheet-backdrop" data-close></div>
          <div class="sheet-panel" role="menu" aria-label="Ещё">
            <span class="sheet-grip" aria-hidden="true"></span>
            <a role="menuitem" href="#/cabinet/week">Неделя (расписание)</a>
            <a role="menuitem" href="#/cabinet/bank">Банк заданий</a>
            <a role="menuitem" href="#/cabinet/groups">Группы</a>
            <a role="menuitem" href="#/cabinet/reading">Чтение и стихи</a>
            <a role="menuitem" href="#/cabinet/settings">Настройки и Telegram</a>
            <a role="menuitem" href="#/library">Библиотека</a>
            <a role="menuitem" href="#/rules">Правила</a>
            <a role="menuitem" href="#/ege">ЕГЭ</a>
            <a role="menuitem" href="#/oge">ОГЭ</a>
            <a role="menuitem" href="#/literature">Литература</a>
            <a role="menuitem" href="#/">Сайт студии</a>
            <div class="sheet-theme"><span class="muted">Тема</span> ${themeSwitchHtml()}</div>
          </div>
        </div>`
      : "";
  return `<nav class="tabbar" aria-label="Разделы">${links}</nav>${more}`;
}

/** Переключатель темы — в подвале, в «Я» у ученика и в «Ещё» у преподавателя. */
/** Подвал: навигация по сайту, связь, адрес. На телефоне внутри заданий и кабинетов его нет — там меню внизу экрана. */
function footerHtml(full) {
  const st = accessState();
  const cabinet =
    st === "teacher"
      ? `<a href="#/cabinet/today">Кабинет преподавателя</a>`
      : st === "guest"
        ? `<a href="#/login">Войти в кабинет</a>`
        : `<a href="#/me">Мой кабинет</a>`;
  const tg = studioTelegram();
  const wa = studioWhatsApp();
  const year = new Date().getFullYear();
  return `<footer class="site-footer site-footer-v2${full ? "" : " is-app"}">
      <div class="wrap">
        <div class="fv-grid">
          <div class="fv-col fv-about">
            <p class="footer-name">Студия Лексикон</p>
            <p class="fv-note">Русский язык и литература для 8–11 классов. Очно в Горно-Алтайске и онлайн.</p>
            <p class="fv-note">Основатель и руководитель — П. В. <a href="https://palekseev.ru/" target="_blank" rel="noopener noreferrer">Алексеев</a></p>
          </div>
          <nav class="fv-col" aria-label="О студии">
            <p class="footer-h">Студия</p>
            <a href="#about">Программы</a>
            <a href="#platform">Учебная платформа</a>
            <a href="#prices">Цены</a>
            <a href="#reviews">Отзывы</a>
            <a href="#faq">Вопросы и ответы</a>
          </nav>
          <nav class="fv-col" aria-label="Подготовка">
            <p class="footer-h">Подготовка</p>
            <a href="#/ege">ЕГЭ по русскому</a>
            <a href="#/oge">ОГЭ по русскому</a>
            <a href="#/vpr">ВПР по русскому</a>
            <a href="#/literature">Литература</a>
            <a href="#/check">Проверь себя перед экзаменом</a>
          </nav>
          <nav class="fv-col" aria-label="Ученикам">
            <p class="footer-h">Ученикам</p>
            ${cabinet}
            <a href="#/ege/theory">Теория к заданиям ЕГЭ</a>
            <a href="#/rules">Правила</a>
          </nav>
          <div class="fv-col">
            <p class="footer-h">Связаться</p>
            <a href="#apply">Записаться</a>
            ${tg.url ? `<a href="${tg.url}" target="_blank" rel="noopener noreferrer">Telegram</a>` : ""}
            ${wa.url ? `<a href="${wa.url}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ""}
            <button type="button" class="link-btn fv-phone" data-reveal-phone>Позвонить</button>
            <a href="https://go.2gis.com/lknNX" target="_blank" rel="noopener noreferrer">пр. Коммунистический, 47<span class="fv-sub">вход с ул. Головина</span></a>
          </div>
        </div>
        <div class="fv-bottom">
          <span>© 2024–${year} Студия Лексикон</span>
          <a class="fv-admin" href="#/privacy">Политика конфиденциальности</a>
          ${themeSwitchHtml()}
          <a class="fv-admin" href="#/cabinet">Для преподавателя</a>
        </div>
      </div>
    </footer>`;
}

export function themeSwitchHtml() {
  return `<span class="theme-switch" role="group" aria-label="Тема оформления">
    <button type="button" data-theme-set="auto">Авто</button>
    <button type="button" data-theme-set="light">Светлая</button>
    <button type="button" data-theme-set="dark">Тёмная</button>
  </span>`;
}

/** Тема оформления: авто (как в телефоне), светлая, тёмная. */
export function applyTheme(mode = null) {
  let m = mode;
  try {
    if (m) localStorage.setItem("leksikon-theme", m);
    else m = localStorage.getItem("leksikon-theme") || "auto";
  } catch {
    m = m || "auto";
  }
  if (m === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", m);
  const dark = m === "dark" || (m === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#171513" : "#f4efe4");
  return m;
}

function accountLink(active) {
  const state = accessState();
  if (state === "guest") return `<a href="#/login" class="nav-account ${active === "login" ? "active" : ""}">Войти</a>`;
  if (state === "teacher") return `<a href="#/cabinet" class="nav-account ${active === "teacher" ? "active" : ""}">Кабинет</a>`;
  return `<a href="#/me" class="nav-account ${active === "me" ? "active" : ""}">Кабинет</a>`;
}

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function layout(content, active = "", { hideFooter = false } = {}) {
  const isHome = active === "home";
  const subj = subjectsOf(currentProfile());
  const nav = isHome
    ? `
          <a href="#about">Программы</a>
          <a href="#platform">Платформа</a>
          <a href="#teacher">Команда</a>
          <a href="#apply">Запись</a>
          <a href="#learn">Материалы</a>
          ${accountLink(active)}`
    : `
          <a href="#/">Студия</a>
          ${subj.rus ? `<a href="#/rules" class="${active === "rules" ? "active" : ""}">Правила</a>
          <a href="#/ege" class="${active === "ege" ? "active" : ""}">ЕГЭ</a>
          <a href="#/oge" class="${active === "oge" ? "active" : ""}">ОГЭ</a>
          <a href="#/vpr" class="${active === "vpr" ? "active" : ""}">ВПР</a>` : ""}
          ${subj.lit ? `<a href="#/literature" class="${active === "literature" ? "active" : ""}">Литература</a>` : ""}
          ${accountLink(active)}`;
  return `
    <button type="button" class="skip-link">К содержанию</button>
    <header class="site-header">
      <div class="wrap header-inner">
        <a class="brand" href="#/">
          <span class="brand-mark">Л</span>
          <span class="brand-text">
            <strong>Студия Лексикон</strong>
            <span>${isHome ? "русский язык и литература" : "русский язык"}</span>
          </span>
        </a>
        <span class="header-account">${accountLink(active)}</span>
        <nav class="nav">${nav}
        </nav>
      </div>
    </header>
    <main id="main" class="${isHome ? "is-home" : "is-app"}"><div class="wrap">${content}</div></main>
    ${tabbar(active)}
    ${
      // в кабинетах ученика и преподавателя (и в занятиях) подвала нет — там всё как в приложении
      hideFooter || active === "me" || active === "teacher"
        ? ""
        : footerHtml(isHome || active === "login" || active === "legal")
    }
  `;
}
