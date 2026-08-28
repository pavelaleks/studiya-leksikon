import { layout } from "./ui.js";
import { allRules, exercisesFor, findRule, loadContent } from "./content.js";
import { homePage, practiceIndex, rulePage, rulesIndex } from "./pages.js";
import { renderExercise } from "./exercises.js";
import { adminPage, bindAdmin } from "./admin.js";

const app = document.getElementById("app");
let content = null;

function mountHtml(html, active) {
  app.innerHTML = layout(html, active);
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

  const parts = decodeURIComponent(location.hash.replace(/^#/, "") || "/")
    .split("/")
    .filter(Boolean);
  const [a, b] = parts;

  if (!a) {
    mountHtml(homePage(content), "home");
    return;
  }

  if (a === "rules") {
    mountHtml(rulesIndex(content, b || "", ""), "rules");
    bindSearch(b || "", "");
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

window.addEventListener("hashchange", render);
render();
