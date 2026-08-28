import { escapeHtml } from "./ui.js";
import { legend, mark } from "./markup.js";

function renderTable(table) {
  if (!table?.headers || !table?.rows) return "";
  return `
    <table class="rule-table">
      <thead><tr>${table.headers.map((h) => `<th>${mark(h)}</th>`).join("")}</tr></thead>
      <tbody>
        ${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${mark(cell)}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderTheory(rule) {
  return (rule.theory || [])
    .map(
      (block) => `
      <section class="theory-block">
        ${block.heading ? `<h3>${mark(block.heading)}</h3>` : ""}
        ${block.body ? `<p>${mark(block.body)}</p>` : ""}
        ${renderTable(block.table)}
        ${
          block.examples?.length
            ? `<ul class="ex-list">${block.examples
                .map((ex) => `<li class="ex-line">${mark(ex)}</li>`)
                .join("")}</ul>`
            : ""
        }
        ${block.note ? `<div class="note">${mark(block.note)}</div>` : ""}
      </section>`
    )
    .join("");
}

export function homePage(content) {
  const counts = content.sections.map((s) => ({
    ...s,
    n: s.chapters.reduce((a, c) => a + c.rules.length, 0),
  }));
  return `
    <section class="hero">
      <div>
        <p class="eyebrow">Русский язык · 8–11 кл.</p>
        <h1>Студия Лексикон</h1>
        <p class="lede">Орфография, пунктуация и стилистика русского языка для 8–11 кл. Правило на одной странице: условие, таблица, примеры с выделенной орфограммой — затем закрепление.</p>
        <div class="actions">
          <a class="btn" href="#/rules">К правилам</a>
          <a class="btn secondary" href="#/practice">К заданиям</a>
        </div>
      </div>
      <div class="hero-card">
        <h3>Как пользоваться</h3>
        <ol>
          <li>Педагог даёт ссылку на конкретное правило.</li>
          <li>Ученик читает условие и смотрит выделенные буквы и морфемы.</li>
          <li>Сразу проходит тест или списывание.</li>
        </ol>
      </div>
    </section>
    <section class="grid-3">
      ${counts
        .map(
          (s) => `
        <a class="card" href="#/rules/${s.id}">
          <div class="kicker">${s.status === "ready" ? `${s.n} правил` : "Каталог глав готов"}</div>
          <h2>${escapeHtml(s.title)}</h2>
          <p>${escapeHtml(s.lead)}</p>
        </a>`
        )
        .join("")}
    </section>
  `;
}

export function rulesIndex(content, sectionId = "", q = "") {
  const query = q.trim().toLowerCase();
  const sections = sectionId ? content.sections.filter((s) => s.id === sectionId) : content.sections;
  const filters = `
    <div class="filter-bar">
      <a class="pill ${!sectionId ? "active" : ""}" href="#/rules">Все</a>
      ${content.sections
        .map(
          (s) =>
            `<a class="pill ${sectionId === s.id ? "active" : ""}" href="#/rules/${s.id}">${escapeHtml(s.title)}</a>`
        )
        .join("")}
    </div>
    <input class="search" id="rule-search" placeholder="Найти правило или пример…" value="${escapeHtml(q)}" />
  `;

  const chapters = sections
    .map((section) => {
      const ch = section.chapters
        .map((chapter) => {
          const all = chapter.rules;
          const rules = all.filter((r) => {
            if (!query) return true;
            const blob = [
              r.title,
              r.summary,
              ...(r.theory || []).flatMap((t) => [
                t.heading,
                t.body,
                ...(t.examples || []),
                ...(t.table?.headers || []),
                ...(t.table?.rows || []).flat(),
              ]),
            ]
              .join(" ")
              .toLowerCase();
            return blob.includes(query);
          });
          if (query && !rules.length) return "";
          if (!all.length && query) return "";
          return `
            <details class="card chapter" ${query ? "open" : ""}>
              <summary><span>${escapeHtml(chapter.roman ? chapter.roman + ". " : "")}${escapeHtml(chapter.title)}</span><span class="muted">${rules.length || "скоро"}</span></summary>
              ${
                rules.length
                  ? rules
                      .map(
                        (r) => `
                <a class="rule-row" href="#/rule/${encodeURIComponent(r.slug || r.id)}">
                  <span>${escapeHtml(r.title)}</span>
                  <small>${r.rosenthal?.paragraph ? "§ " + r.rosenthal.paragraph : ""}</small>
                </a>`
                      )
                      .join("")
                  : `<div class="rule-row"><span class="muted">Этот блок ещё наполняется.</span></div>`
              }
            </details>`;
        })
        .join("");
      return ch
        ? `<h2>${escapeHtml(section.title)}</h2>${section.status !== "ready" ? `<p class="muted">${escapeHtml(section.lead)}</p>` : ""}${ch}`
        : "";
    })
    .join("");

  return `
    <p class="eyebrow">Справочник студии</p>
    <h1>Правила</h1>
    <p class="lede">Откройте главу, затем карточку. Орфограмма в примерах выделена цветом — так удобнее объяснять у доски и читать дома.</p>
    ${filters}
    ${chapters || `<div class="empty">Ничего не найдено.</div>`}
  `;
}

export function rulePage(rule, neighbors = {}) {
  if (!rule) {
    return `<div class="empty">Правило не найдено. <a href="#/rules">Ко всем правилам</a></div>`;
  }
  const hasPractice = (neighbors.exerciseCount || 0) > 0;
  return `
    <div class="crumbs">
      <a href="#/rules">Правила</a>
      <span>/</span>
      <a href="#/rules/${rule.section.id}">${escapeHtml(rule.section.title)}</a>
      <span>/</span>
      <span>${escapeHtml(rule.title)}</span>
    </div>
    <article class="rule-article">
      <p class="kicker">${escapeHtml(rule.chapter.title)}${rule.rosenthal?.paragraph ? " · § " + rule.rosenthal.paragraph : ""}</p>
      <h1>${escapeHtml(rule.title)}</h1>
      <div class="summary-box">${mark(rule.summary)}</div>
      ${legend(rule.section?.id)}
      ${renderTheory(rule)}
      ${
        rule.exceptions?.length
          ? `<div class="exceptions"><strong>Исключения.</strong> ${rule.exceptions.map((x) => mark(x)).join("; ")}</div>`
          : ""
      }
      ${
        rule.typicalMistakes?.length
          ? `<div class="mistakes"><strong>Типичные ошибки.</strong> ${rule.typicalMistakes.map((x) => mark(x)).join("; ")}</div>`
          : ""
      }
      <div class="actions">
        ${
          hasPractice
            ? `<a class="btn" href="#/practice/${encodeURIComponent(rule.slug || rule.id)}">Закрепить заданиями</a>`
            : `<span class="muted">Заданий к этому правилу пока нет — можно разобрать примеры на уроке.</span>`
        }
      </div>
      <div class="pager">
        ${
          neighbors.prev
            ? `<a href="#/rule/${encodeURIComponent(neighbors.prev.slug || neighbors.prev.id)}">← ${escapeHtml(neighbors.prev.title)}</a>`
            : "<span></span>"
        }
        ${
          neighbors.next
            ? `<a href="#/rule/${encodeURIComponent(neighbors.next.slug || neighbors.next.id)}">${escapeHtml(neighbors.next.title)} →</a>`
            : "<span></span>"
        }
      </div>
    </article>
  `;
}

export function practiceIndex(content, filterId = "") {
  const rules = content.sections.flatMap((s) => s.chapters.flatMap((c) => c.rules.map((r) => ({ ...r, section: s }))));
  const list = content.exercises.filter((ex) => {
    if (!filterId) return true;
    return ex.ruleId === filterId || (ex.ruleIds || []).includes(filterId) || ex.section === filterId;
  });
  const ruleMap = Object.fromEntries(rules.map((r) => [r.id, r]));
  return `
    <p class="eyebrow">Тренировка</p>
    <h1>Задания</h1>
    <p class="lede">Можно идти отдельно от теории: выберите раздел и решайте тесты и списывание.</p>
    <div class="filter-bar">
      <a class="pill ${!filterId ? "active" : ""}" href="#/practice">Все</a>
      ${content.sections.map((s) => `<a class="pill ${filterId === s.id ? "active" : ""}" href="#/practice/${s.id}">${escapeHtml(s.title)}</a>`).join("")}
    </div>
    <div class="grid-2">
      <div>
        ${
          list
            .map((ex) => {
              const rule = ruleMap[ex.ruleId];
              return `
              <a class="card" href="#/exercise/${encodeURIComponent(ex.id)}" style="margin-bottom:12px">
                <div class="kicker">${ex.type === "copy" ? "Списывание" : ex.type === "insert" ? "Вставить букву" : "Тест"}</div>
                <h3>${escapeHtml(ex.title)}</h3>
                <p>${escapeHtml(rule?.title || ex.prompt || "")}</p>
              </a>`;
            })
            .join("") || `<div class="empty">Заданий в этом разделе пока нет.</div>`
        }
      </div>
      <div class="card">
        <h3>На занятии</h3>
        <p>Откройте задание на проекторе или скиньте ссылку в чат. Дома ученик проходит тот же вариант — без регистрации.</p>
      </div>
    </div>
  `;
}
