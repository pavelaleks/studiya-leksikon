import { layout } from "./ui.js";
import { allRules, exercisesFor, findRule, loadContent } from "./content.js";
import { homeHitsHtml, homePage, practiceIndex, rulePage, rulesIndex } from "./pages.js";
import { renderExercise } from "./exercises.js";
import { adminPage, bindAdmin } from "./admin.js";
import { applyBoard, keepBoardOnHash, parseRoute, setBoard } from "./route.js";

const app = document.getElementById("app");
let content = null;

function mountHtml(html, active) {
  app.innerHTML = layout(html, active, parseRoute().board);
  applyBoard();
  bindBoardToggle();
}

function bindBoardToggle() {
  const btn = app.querySelector("#board-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const on = !parseRoute().board;
    setBoard(on);
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
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
    location.hash = q ? `#/rules?q=${encodeURIComponent(q)}` : "#/rules";
  });
}

async function render() {
  if (!content) {
    mountHtml(`<div class="empty">Загружаем материалы студии…</div>`);
    try {
      content = await loadContent();
    } catch (err) {
      mountHtml(
        `<div class="empty">Не удалось загрузить данные. Нужен локальный сервер или GitHub Pages.<br>${err.message}</div>`
      );
      return;
    }
  }

  const { parts, q } = parseRoute();
  const [a, b] = parts;

  if (!a) {
    mountHtml(homePage(content), "home");
    bindHomeSearch();
    return;
  }

  if (a === "rules") {
    mountHtml(rulesIndex(content, b || "", q), "rules");
    bindSearch(b || "", q);
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
      return;
    }
    mountHtml(practiceIndex(content, filter), "practice");
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
    return;
  }

  if (a === "admin") {
    mountHtml(adminPage(content), "admin");
    bindAdmin(content, app);
    return;
  }

  mountHtml(`<div class="empty">Страница не найдена. <a href="#/">На главную</a></div>`);
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
