import { layout } from "./ui.js?v=land59";
import { allRules, exercisesFor, findRule, loadContent } from "./content.js?v=land57";
import { homeHitsHtml, homePage, practiceIndex, rulePage, rulesIndex, egePage, ogePage, thanksPage, literaturePage } from "./pages.js?v=land60";
import { mountLiterature } from "./literature.js?v=land59";
import { mountRussian } from "./russian.js?v=land59";
import { mountOge } from "./oge.js?v=land60";
import { bindApplyForm } from "./apply.js?v=land46";
import { EGE_TITLES } from "./ege.js?v=land57";
import { renderExercise } from "./exercises.js?v=land46";
import { mountTrainer } from "./trainers.js?v=land55";
import { adminPage, bindAdmin } from "./admin.js?v=land46";
import { parseRoute } from "./route.js?v=land52";

const app = document.getElementById("app");
let content = null;

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

async function render() {
  if (!content) {
    document.body.classList.add("is-loading");
    mountHtml(skeletonHtml(), "", { hideFooter: true });
    setTitle("Загрузка");
    try {
      content = await loadContent();
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
  ]);
  if (!a || homeAnchors.has(a)) {
    document.body.classList.add("is-landing");
    mountHtml(homePage(content), "home", { scroll: homeAnchors.has(a) ? false : true });
    bindApplyForm(app);
    setTitle("");
    if (homeAnchors.has(a)) {
      requestAnimationFrame(() => {
        document.getElementById(a)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    return;
  }

  document.body.classList.remove("is-landing");

  if (a === "thanks") {
    mountHtml(thanksPage(), "home");
    setTitle("Заявка отправлена");
    return;
  }

  if (a === "rules") {
    mountHtml(rulesIndex(content, b || "", q), "rules");
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
    mountHtml(adminPage(content), "admin");
    bindAdmin(content, app);
    setTitle("Модератор");
    return;
  }

  mountHtml(`<div class="empty">Страница не найдена. <a href="#/">На главную</a></div>`);
  setTitle("Страница не найдена");
}

window.addEventListener("hashchange", render);

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

render();
