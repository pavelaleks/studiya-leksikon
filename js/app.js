import { layout } from "./ui.js?v=land37";
import { allRules, exercisesFor, findRule, loadContent } from "./content.js?v=land37";
import { homeHitsHtml, homePage, practiceIndex, rulePage, rulesIndex, egeIndex, ogePage, thanksPage, literaturePage } from "./pages.js?v=land37";
import { bindApplyForm } from "./apply.js?v=land37";
import { EGE_TITLES, egeByNumber } from "./ege.js?v=land37";
import { renderExercise } from "./exercises.js?v=land37";
import { mountTrainer } from "./trainers.js?v=land37";
import { adminPage, bindAdmin } from "./admin.js?v=land37";
import { applyBoard, keepBoardOnHash, parseRoute, setBoard } from "./route.js?v=land37";
import { pickEgeVariant, touchEge } from "./progress.js?v=land37";

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

function mountHtml(html, active, opts) {
  app.innerHTML = layout(html, active, parseRoute().board, opts);
  applyBoard();
  bindBoardToggle();
  bindSkip();
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

function bindBoardToggle() {
  const btn = app.querySelector("#board-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const on = !parseRoute().board;
    setBoard(on);
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
    const header = app.querySelector(".site-header");
    header?.querySelector(".board-banner")?.remove();
    if (on && header) {
      const banner = document.createElement("p");
      banner.className = "board-banner";
      banner.setAttribute("role", "status");
      banner.textContent = "Крупный шрифт для проектора. Нажмите ещё раз в шапке, чтобы выключить.";
      header.appendChild(banner);
    }
  });
}

function bindSearch(sectionId, q) {
  const search = app.querySelector("#rule-search");
  if (!search) return;
  search.addEventListener("input", () => {
    mountHtml(rulesIndex(content, sectionId, search.value), "rules");
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
    mountHtml(homePage(content), "home");
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
    mountTrainer(host, decodeURIComponent(b));
    setTitle("Тренажёр ОГЭ");
    return;
  }

  if (a === "literature") {
    mountHtml(literaturePage(), "literature");
    setTitle("Литература");
    return;
  }

  if (a === "ege") {
    if (parts[2] === "random") {
      const list = egeByNumber(content, b);
      const pick = pickEgeVariant(list);
      if (!pick) {
        mountHtml(`<div class="empty">Этот номер ещё наполняется. <a href="#/ege">К тренажёру</a></div>`, "ege");
        setTitle("ЕГЭ");
        return;
      }
      const href = keepBoardOnHash(`#/ege-item/${encodeURIComponent(pick.id)}`);
      history.replaceState(null, "", location.pathname + location.search + href);
      render();
      return;
    }
    mountHtml(egeIndex(content, b || ""), "ege");
    setTitle(b && EGE_TITLES[Number(b)] ? `Задание ${b}. ${EGE_TITLES[Number(b)]}` : "ЕГЭ по русскому");
    return;
  }

  if (a === "ege-item") {
    const ex = (content.ege || []).find((e) => e.id === b);
    if (!ex) {
      mountHtml(`<div class="empty">Задание не найдено. <a href="#/ege">К тренажёру ЕГЭ</a></div>`, "ege");
      setTitle("Задание не найдено");
      return;
    }
    const list = egeByNumber(content, ex.egeTask);
    const index = Math.max(0, list.findIndex((e) => e.id === ex.id));
    const nextEx = list.length > 1 ? list[(index + 1) % list.length] : null;
    const rules = (ex.ruleIds || []).map((id) => findRule(content, id)).filter(Boolean);
    touchEge(ex, index);
    mountHtml("", "ege");
    const wrap = app.querySelector("main .wrap");
    wrap.innerHTML = `<div class="crumbs"><a href="#/ege/${ex.egeTask}">← Задание ${ex.egeTask}</a></div>`;
    wrap.appendChild(
      renderExercise(ex, null, {
        index,
        total: list.length,
        nextId: nextEx?.id,
        rules,
      })
    );
    setTitle(`Задание ${ex.egeTask} · вариант ${index + 1}`);
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

app.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || a.target === "_blank") return;
  const next = keepBoardOnHash(a.getAttribute("href") || "");
  if (next === (a.getAttribute("href") || "")) return;
  e.preventDefault();
  location.hash = next;
});

window.addEventListener("hashchange", render);
render();
