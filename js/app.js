import { mountHelper } from "./helper.js?v=land138";
import { applyTheme, layout } from "./ui.js?v=land138";
import { allRules, exercisesFor, findRule, loadContent } from "./content.js?v=land138";
import { homeHitsHtml, homePage, practiceIndex, rulePage, rulesIndex, egePage, ogePage, thanksPage, literaturePage } from "./pages.js?v=land138";
import { mountLiterature } from "./literature.js?v=land138";
import { libraryPage, libraryTitle, mountLibrary } from "./library.js?v=land138";
import { mountRussian } from "./russian.js?v=land138";
import { mountOge } from "./oge.js?v=land138";
import { markVprDone, mountVpr } from "./vpr.js?v=land138";
import { mountQuiz } from "./quiz.js?v=land138";
import { bindApplyForm } from "./apply.js?v=land138";
import { EGE_TITLES } from "./ege.js?v=land138";
import { renderExercise } from "./exercises.js?v=land138";
import { mountTrainer } from "./trainers.js?v=land138";
import { parseRoute } from "./route.js?v=land138";
import { accessState, currentProfile, hasAccess, initAuth, mySolved, onAuthChange, supa } from "./supa.js";
import { routeSubject, subjectsOf } from "./track.js?v=land138";
import { markEgeDone, markOgeDone } from "./progress.js";
import { bindLogin, bindPassword, loginPage, mePage, mountMe, passwordPage } from "./account.js?v=land138";
import { mountTeacher, teacherPage } from "./teacher.js?v=land138";
import "./session.js?v=land138";
import { lessonPage, mountLesson } from "./lessons.js?v=land138";

const app = document.getElementById("app");
let content = null;
let contentPromise = null;

function setTitle(page) {
  document.title = page
    ? `${page} — Студия Лексикон`
    : "Студия Лексикон — русский язык и литература, Горно-Алтайск";
}

function skeletonHtml() {
  return `
    <div class="skeleton-page" aria-busy="true" aria-live="polite">
      <p class="muted">Загружаем материалы студии…</p>
      <div class="skeleton-line sk-title"></div>
      <div class="skeleton-line sk-lede"></div>
      <div class="skeleton-line sk-lede short"></div>
      <div class="grid-3">
        <div class="card skeleton-card"></div>
        <div class="card skeleton-card"></div>
        <div class="card skeleton-card"></div>
      </div>
    </div>`;
}

function scrollToTop() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function mountHtml(html, active, opts = {}) {
  app.innerHTML = layout(html, active, opts);
  bindSkip();
  mountHelper();
  if (!(opts.preserveScroll || opts.scroll === false)) scrollToTop();
}

function bindSkip() {
  const btn = app.querySelector(".skip-link");
  btn?.addEventListener("click", () => {
    const main = app.querySelector("#main");
    if (!main) return;
    main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: false });
  });
}

function bindRulePrint() {
  app.querySelector("#rule-print")?.addEventListener("click", () => window.print());
}

function bindSearch(sectionId, q) {
  const search = app.querySelector("#rule-search");
  if (!search) return;
  search.addEventListener("input", () => {
    mountHtml(rulesIndex(content, sectionId, search.value), "rules", { scroll: false });
    import("./rulequiz.js?v=land138").then((m) => m.markRulesIndex(app)).catch(() => {});
    bindSearch(sectionId, search.value);
    const again = app.querySelector("#rule-search");
    if (again) {
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    }
  });
}

function bindHomeSearch() {
  const input = app.querySelector("#home-search");
  const box = app.querySelector("#home-hits");
  if (!input || !box) return;
  input.addEventListener("input", () => {
    box.innerHTML = homeHitsHtml(content, input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = input.value.trim();
    const n = Number(q);
    if (Number.isInteger(n) && EGE_TITLES[n]) {
      location.hash = `#/ege/${n}`;
      return;
    }
    location.hash = q ? `#/rules?q=${encodeURIComponent(q)}` : "#/rules";
  });
}

// Правила (≈1 МБ) нужны только этим разделам; кабинеты и библиотека их не ждут.
const NEEDS_CONTENT = new Set(["", "formats", "apply", "learn", "contact", "materials", "about", "teacher", "faq", "prices", "reviews", "program-vpr", "program-oge", "program-ege", "rules", "rule", "practice", "exercise"]);

/** Журнал для преподавателя: какой раздел открыл ученик (не чаще раза в 5 минут на раздел). */
function logVisit() {
  const st = accessState();
  if (st === "guest" || st === "teacher") return;
  const parts = parseRoute().parts;
  const section = parts[0] || "home";
  if (["login", "cabinet", "thanks"].includes(section)) return;
  const key = "visit:" + section;
  try {
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last < 5 * 60000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {}
  supa.rpc("log_visit", { p_section: section, p_path: "/" + parts.join("/").slice(0, 190) }).then(() => {}, () => {});
}

async function render() {
  setTimeout(logVisit, 0);
  const first = parseRoute().parts[0] || "";
  if (!content && NEEDS_CONTENT.has(first)) {
    document.body.classList.add("is-loading");
    mountHtml(skeletonHtml(), "", { hideFooter: true });
    setTitle("Загрузка");
    try {
      content = (await contentPromise) || (await loadContent());
    } catch (err) {
      document.body.classList.remove("is-loading");
      mountHtml(
        `<div class="empty">Не удалось загрузить данные. Нужен локальный сервер или GitHub Pages.<br>${err.message}</div>`
      );
      setTitle("Ошибка загрузки");
      return;
    }
    document.body.classList.remove("is-loading");
  }
  document.body.classList.remove("is-loading");

  const { parts, q } = parseRoute();
  const [a, b] = parts;

  const homeAnchors = new Set([
    "formats",
    "apply",
    "learn",
    "contact",
    "materials",
    "about",
    "teacher",
    "faq",
    "prices",
    "reviews",
    "program-vpr",
    "program-oge",
    "program-ege",
  ]);
  if (!a || homeAnchors.has(a)) {
    document.body.classList.add("is-landing");
    mountHtml(homePage(content), "home", { scroll: homeAnchors.has(a) ? false : true });
    bindApplyForm(app);
    setTitle("");
    if (homeAnchors.has(a)) {
      requestAnimationFrame(() => {
        const el = document.getElementById(a);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (el?.classList.contains("landing-program")) {
          el.classList.remove("is-target");
          void el.offsetWidth;
          el.classList.add("is-target");
        }
      });
    }
    return;
  }

  document.body.classList.remove("is-landing");
  document.body.classList.remove("is-reading");

  // Ученик видит только разделы своих предметов: русского — правила и задания, литературы — библиотеку и литературу.
  const need = routeSubject(parts);
  if (need && !subjectsOf(currentProfile())[need]) {
    const name = need === "lit" ? "литературы" : "русского языка";
    mountHtml(
      `<div class="empty"><p><strong>Этот раздел — для учеников курса ${name}.</strong></p>
        <p class="muted">Если хотите заниматься и этим предметом, попросите преподавателя добавить курс.</p>
        <p class="actions" style="justify-content:center"><a class="btn" href="#/me/profile#courses">Попросить доступ к курсу</a> <a class="btn secondary" href="#/me">На главную</a></p></div>`,
      "me"
    );
    setTitle("Раздел другого курса");
    return;
  }

  if (a === "thanks") {
    mountHtml(thanksPage(), "home");
    setTitle("Заявка отправлена");
    return;
  }

  if (a === "rules") {
    mountHtml(rulesIndex(content, b || "", q), "rules");
    import("./rulequiz.js?v=land138").then((m) => m.markRulesIndex(app)).catch(() => {});
    bindSearch(b || "", q);
    setTitle(b ? "Правила" : "Правила");
    return;
  }

  if (a === "rule") {
    const rule = findRule(content, b);
    const list = allRules(content);
    const i = list.findIndex((r) => r.id === rule?.id);
    const neighbors = rule
      ? {
          prev: i > 0 ? list[i - 1] : null,
          next: i >= 0 && i < list.length - 1 ? list[i + 1] : null,
          exerciseCount: exercisesFor(content, rule.id).length,
        }
      : {};
    mountHtml(rulePage(rule, neighbors), "rules");
    bindRulePrint();
    import("./rulequiz.js?v=land138").then((m) => m.mountRuleQuiz(app)).catch((e) => console.warn(e));
    setTitle(rule?.title || "Правило");
    return;
  }

  if (a === "practice") {
    const filter = b || "";
    const rule = findRule(content, filter);
    if (rule) {
      const list = exercisesFor(content, rule.id);
      mountHtml(
        `<div class="crumbs"><a href="#/rule/${encodeURIComponent(rule.slug || rule.id)}">← ${rule.title}</a></div>` +
          practiceIndex({ ...content, exercises: list }, rule.id),
        "practice"
      );
      setTitle(rule.title);
      return;
    }
    mountHtml(practiceIndex(content, filter), "practice");
    setTitle("Задания");
    return;
  }

  if (a === "oge") {
    mountHtml(ogePage(), "oge");
    setTitle("ОГЭ по русскому");
    const root = app.querySelector("#oge-root");
    if (root) await mountOge(root, parts.slice(1));
    return;
  }

  if (a === "check") {
    mountHtml(`<div class="lit-page" id="quiz-root"></div>`, "home");
    setTitle("Проверь себя перед экзаменом");
    const root = app.querySelector("#quiz-root");
    if (root) await mountQuiz(root);
    return;
  }

  if (a === "vpr") {
    mountHtml(`<div class="lit-page" id="vpr-root"><p class="lede muted">Загружаем задания…</p></div>`, "vpr");
    setTitle("ВПР по русскому, 8 класс");
    const root = app.querySelector("#vpr-root");
    if (root) await mountVpr(root, parts.slice(1));
    return;
  }

  if (a === "trainer") {
    if (!b) {
      mountHtml(`<div class="empty">Выберите тренажёр. <a href="#/oge">К разделу ОГЭ</a></div>`, "oge");
      setTitle("Тренажёр");
      return;
    }
    mountHtml(`<div id="trainer-root"></div>`, "oge");
    const host = app.querySelector("#trainer-root");
    await mountTrainer(host, decodeURIComponent(b));
    scrollToTop();
    setTitle("Тренажёр ОГЭ");
    return;
  }

  if (a === "library") {
    mountHtml(libraryPage(), "literature");
    setTitle(libraryTitle(parts.slice(1)));
    await mountLibrary(app, parts.slice(1));
    return;
  }

  if (a === "literature") {
    mountHtml(literaturePage(), "literature");
    setTitle("Литература · ЕГЭ");
    const root = app.querySelector("#lit-root");
    if (root) await mountLiterature(root, parts.slice(1));
    return;
  }

  if (a === "ege") {
    mountHtml(egePage(), "ege");
    setTitle("ЕГЭ по русскому");
    const root = app.querySelector("#rus-root");
    if (root) await mountRussian(root, parts.slice(1));
    return;
  }

  if (a === "ege-item") {
    location.hash = "#/ege";
    return;
  }

  if (a === "exercise") {
    const ex = content.exercises.find((e) => e.id === b);
    if (!ex) {
      mountHtml(`<div class="empty">Задание не найдено.</div>`, "practice");
      return;
    }
    mountHtml("", "practice");
    const wrap = app.querySelector("main .wrap");
    wrap.innerHTML = `<div class="crumbs"><a href="#/practice">← К заданиям</a></div>`;
    wrap.appendChild(renderExercise(ex));
    setTitle(ex.title || "Задание");
    return;
  }

  if (a === "admin") {
    location.hash = "#/cabinet";
    return;
  }

  if (a === "login") {
    mountHtml(loginPage(), "login");
    bindLogin(app);
    setTitle("Вход");
    return;
  }

  if (a === "me") {
    if (b === "password") {
      mountHtml(passwordPage(), "me");
      bindPassword(app);
      setTitle("Новый пароль");
      return;
    }
    mountHtml(mePage(), "me");
    setTitle(b === "daily" ? "Тренировка дня" : String(b || "").startsWith("profile") ? "Мой профиль" : "Главная");
    await mountMe(app);
    return;
  }

  if (a === "lesson") {
    mountHtml(lessonPage(), "me");
    setTitle("Занятие");
    await mountLesson(app, parts.slice(1));
    return;
  }

  if (a === "cabinet") {
    mountHtml(teacherPage(), "teacher");
    setTitle("Кабинет преподавателя");
    await mountTeacher(app, parts.slice(1));
    return;
  }

  mountHtml(`<div class="empty">Страница не найдена. <a href="#/">На главную</a></div>`);
  setTitle("Страница не найдена");
}

window.addEventListener("hashchange", render);
onAuthChange(() => render());

app.addEventListener("click", (e) => {
  const link = e.target.closest('a[href^="#"]');
  if (!link || link.target === "_blank") return;
  const href = link.getAttribute("href") || "";
  // Якорные секции лендинга (#about) обрабатывает render
  if (/^#[a-zA-Z]/.test(href) && !href.startsWith("#/")) return;
  const nextRaw = href.replace(/^#/, "") || "/";
  const curRaw = (location.hash || "#").replace(/^#/, "") || "/";
  const nextPath = (nextRaw.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const curPath = (curRaw.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  if (nextPath === curPath) {
    scrollToTop();
  }
});

/**
 * Экран задания на телефоне: сверху «‹ 3 из 8 ›» с полосой прогресса, листание свайпом.
 * Работает для всех разделов, где есть .lit-pager (ЕГЭ, ОГЭ, литература, занятия).
 */
let lastTaskHash = "";
const passageScroll = new Map();

/** Шторка с исходным текстом: читаешь текст, закрываешь — вопрос и ответ на месте. */
function openPassageSheet(passage) {
  document.querySelector(".passage-sheet")?.remove();
  const key = location.hash;
  const sheet = document.createElement("div");
  sheet.className = "passage-sheet";
  sheet.innerHTML = `
    <div class="ps-backdrop" data-ps-close></div>
    <div class="ps-panel" role="dialog" aria-label="Исходный текст">
      <div class="ps-head"><strong>Текст</strong><button type="button" class="l-x" data-ps-close aria-label="Закрыть">×</button></div>
      <div class="ps-body lit-html"></div>
    </div>`;
  const body = sheet.querySelector(".ps-body");
  body.innerHTML = passage.querySelector(".lit-html")?.innerHTML || passage.innerHTML;
  body.querySelector(".passage-more")?.remove();
  document.body.append(sheet);
  document.body.classList.add("is-sheet-open");
  requestAnimationFrame(() => {
    sheet.classList.add("is-open");
    body.scrollTop = passageScroll.get(key) || 0;
  });
  const close = () => {
    passageScroll.set(key, body.scrollTop);
    sheet.classList.remove("is-open");
    document.body.classList.remove("is-sheet-open");
    setTimeout(() => sheet.remove(), 200);
    window.removeEventListener("hashchange", close);
  };
  sheet.querySelectorAll("[data-ps-close]").forEach((b) => b.addEventListener("click", close));
  window.addEventListener("hashchange", close);
}

function enhanceTask(root) {
  const nav = root.querySelector(".lit-task-nav:not([data-done])");
  if (nav) {
    nav.dataset.done = "1";
    const on = nav.querySelector(".is-active");
    if (on) nav.scrollLeft = on.offsetLeft - nav.clientWidth / 2 + on.clientWidth / 2;
  }
  const article = root.querySelector(".lit-problem");
  const pager = article?.querySelector(".lit-pager");
  if (!article || !pager || article.querySelector(".task-bar")) return;
  const links = [...pager.querySelectorAll("a")];
  const prev = links.find((a) => /Предыдущ/.test(a.textContent));
  const next = links.find((a) => /Следующ/.test(a.textContent));
  const text = (pager.textContent + " " + (article.querySelector(".eyebrow")?.textContent || "")).replace(/\s+/g, " ");
  const m = text.match(/(\d+) из (\d+)/);
  const all = links.find((a) => /Все задания/.test(a.textContent));
  const bar = document.createElement("div");
  bar.className = "task-bar";
  const pct = m ? Math.round((100 * Number(m[1])) / Number(m[2])) : 0;
  bar.innerHTML = `
    ${prev ? `<a class="tb-btn" href="${prev.getAttribute("href")}" aria-label="Предыдущее задание">‹</a>` : `<span class="tb-btn is-off" aria-hidden="true">‹</span>`}
    <span class="tb-mid">${m ? `<span>${m[1]} из ${m[2]}</span><span class="today-bar"><span style="width:${pct}%"></span></span>` : all ? `<a href="${all.getAttribute("href")}">Все задания</a>` : ""}</span>
    ${next ? `<a class="tb-btn" href="${next.getAttribute("href")}" aria-label="Следующее задание">›</a>` : `<span class="tb-btn is-off" aria-hidden="true">›</span>`}`;
  article.prepend(bar);
  // Новое задание открывается сверху (а не там, где была прокрутка у предыдущего).
  if (lastTaskHash !== location.hash) {
    lastTaskHash = location.hash;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }
  // Исходный текст: на телефоне — свёрнут и открывается шторкой кнопкой «Текст»,
  // на широком экране — колонкой рядом с вопросом.
  const passage = article.querySelector(".lit-passage");
  if (passage) {
    article.classList.add("has-passage");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tb-text";
    btn.textContent = "Текст";
    btn.setAttribute("aria-label", "Открыть исходный текст");
    bar.querySelector(".tb-mid")?.after(btn);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "passage-more";
    more.textContent = "Открыть текст целиком";
    passage.append(more);
    const open = () => openPassageSheet(passage);
    btn.addEventListener("click", open);
    more.addEventListener("click", open);
  }
  let sx = 0, sy = 0, st = 0;
  article.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || e.target.closest("input, textarea, canvas, select, .table-scroll, .lit-check")) return (st = 0);
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    st = Date.now();
  }, { passive: true });
  article.addEventListener("touchend", (e) => {
    if (!st || Date.now() - st > 600 || String(getSelection?.() || "")) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const go = dx < 0 ? next : prev;
    if (go) location.hash = go.getAttribute("href");
  }, { passive: true });
}
new MutationObserver(() => enhanceTask(app)).observe(app, { childList: true, subtree: true });

// Нижнее меню «Ещё» и переключатель темы — делегированием, переживают перерисовку.
app.addEventListener("click", (e) => {
  const sheet = app.querySelector("#more-sheet");
  if (e.target.closest("[data-more]") && sheet) {
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add("is-open"));
    return;
  }
  if (sheet && !sheet.hidden && (e.target.closest("[data-close]") || e.target.closest(".sheet-panel a"))) {
    sheet.classList.remove("is-open");
    setTimeout(() => (sheet.hidden = true), 200);
  }
  const t = e.target.closest("[data-theme-set]");
  if (t) {
    applyTheme(t.dataset.themeSet);
    markTheme();
  }
});
function markTheme() {
  let m = "auto";
  try {
    m = localStorage.getItem("leksikon-theme") || "auto";
  } catch {}
  app.querySelectorAll("[data-theme-set]").forEach((b) => b.classList.toggle("is-on", b.dataset.themeSet === m));
}
new MutationObserver(markTheme).observe(app, { childList: true });
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme());

// Заставка сразу, а не пустой экран; правила грузятся параллельно с проверкой входа.
document.body.classList.add("is-loading");
mountHtml(skeletonHtml(), "", { hideFooter: true });
contentPromise = loadContent().catch(() => null);
/** Отметки «решено» в списках — из базы, чтобы они были на любом устройстве. */
async function syncSolved() {
  if (!hasAccess()) return;
  try {
    const map = await mySolved();
    Object.entries(map["ege-rus"] || {}).forEach(([no, refs]) => refs.forEach((id) => markEgeDone({ id, egeTask: Number(no) })));
    Object.entries(map["oge-rus"] || {}).forEach(([no, refs]) => refs.forEach((id) => markOgeDone({ id, ogeTask: Number(no) })));
    Object.entries(map["vpr-rus"] || {}).forEach(([no, refs]) => refs.forEach((id) => markVprDone({ id, task: Number(no) })));
  } catch (err) {
    console.warn("sync", err);
  }
}

initAuth()
  .catch((err) => console.warn("auth", err))
  .finally(() => {
    render();
    syncSolved();
  });
