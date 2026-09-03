import { escapeHtml } from "./ui.js";
import { legend, mark } from "./markup.js";
import { EGE_TITLES, egeByNumber, egeTasks } from "./ege.js";
import { doneIds, readProgress } from "./progress.js";

function plainText(value) {
  return String(value ?? "").replace(/\{([^{}|]+)(?:\|[prseoxzmf])?\}/g, "$1");
}

function renderTable(table) {
  if (!table?.headers || !table?.rows) return "";
  const headers = table.headers;
  return `
    <div class="table-scroll">
      <table class="rule-table">
        <thead><tr>${headers.map((h) => `<th>${mark(h)}</th>`).join("")}</tr></thead>
        <tbody>
          ${table.rows
            .map(
              (row) =>
                `<tr>${row
                  .map((cell, i) => {
                    const label = escapeHtml(plainText(headers[i] || ""));
                    return `<td data-label="${label}">${mark(cell)}</td>`;
                  })
                  .join("")}</tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTheory(rule) {
  return (rule.theory || [])
    .map(
      (block, i) => `
      <section class="theory-block">
        ${block.heading ? `<h3 id="t-${i}">${mark(block.heading)}</h3>` : ""}
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

function ruleMatches(rule, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const blob = [
    rule.title,
    rule.summary,
    ...(rule.theory || []).flatMap((t) => [
      t.heading,
      t.body,
      ...(t.examples || []),
      ...(t.table?.headers || []),
      ...(t.table?.rows || []).flat(),
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return blob.includes(q);
}

function ruleWord(n) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return "правило";
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return "правила";
  return "правил";
}

function continueHtml() {
  const p = readProgress();
  if (!p.lastId || !p.lastTask) return "";
  const variant = p.lastIndex ? ` · вариант ${p.lastIndex}` : "";
  return `
    <a class="card home-continue" href="#/ege-item/${encodeURIComponent(p.lastId)}">
      <p class="kicker">Продолжить</p>
      <h2>Задание ${p.lastTask}${variant}</h2>
      <p>Вернуться к последнему бланку</p>
    </a>`;
}

export function homeHitsHtml(content, raw) {
  const query = raw.trim();
  const q = query.toLowerCase();
  if (!q) return "";
  const rows = [];
  const num = Number(query);
  if (Number.isInteger(num) && EGE_TITLES[num]) {
    rows.push({
      href: `#/ege/${num}`,
      title: `ЕГЭ · задание ${num}. ${EGE_TITLES[num]}`,
      meta: "тренажёр",
    });
  }
  for (const [n, title] of Object.entries(EGE_TITLES)) {
    if (q.length < 2) break;
    if (title.toLowerCase().includes(q) || `задание ${n}`.includes(q)) {
      if (Number(n) === num) continue;
      rows.push({
        href: `#/ege/${n}`,
        title: `ЕГЭ · задание ${n}. ${title}`,
        meta: "тренажёр",
      });
    }
  }
  if (q.length >= 2) {
    for (const section of content.sections) {
      for (const chapter of section.chapters) {
        for (const rule of chapter.rules) {
          if (!ruleMatches(rule, query)) continue;
          rows.push({
            href: `#/rule/${encodeURIComponent(rule.slug || rule.id)}`,
            title: rule.title,
            meta: rule.rosenthal?.paragraph ? "§ " + rule.rosenthal.paragraph : "",
          });
          if (rows.length >= 10) break;
        }
        if (rows.length >= 10) break;
      }
      if (rows.length >= 10) break;
    }
  }
  if (!rows.length) {
    if (q.length < 2) return "";
    return `<p class="muted">Ничего не найдено. Попробуйте другое слово.</p>`;
  }
  return `
    <div class="card home-hits-list">
      ${rows
        .slice(0, 10)
        .map(
          (r) => `
        <a class="rule-row" href="${r.href}">
          <span>${escapeHtml(r.title)}</span>
          <small>${escapeHtml(r.meta || "")}</small>
        </a>`
        )
        .join("")}
      ${q.length >= 2 ? `<a class="rule-row" href="#/rules?q=${encodeURIComponent(query)}">Все правила в каталоге</a>` : ""}
    </div>
  `;
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
        <p class="lede">Правило на одной странице: условие, примеры с выделенной орфограммой — затем закрепление.</p>
        <div class="home-actions">
          <a class="btn btn-lg" href="#/ege/4/random">Решать ЕГЭ</a>
          <a class="btn btn-lg secondary" href="#/rules">Правила</a>
          <a class="btn btn-lg ghost" href="#/ege">Все задания 4–22</a>
        </div>
        <label class="home-search-label" for="home-search">Найти правило или задание</label>
        <input class="search" id="home-search" placeholder="НН, ударение, 15, тире…" autocomplete="off" enterkeyhint="search" />
        <div id="home-hits" class="home-hits" aria-live="polite"></div>
      </div>
      <aside class="hero-card class-only">
        <h3>На занятии</h3>
        <ol>
          <li>Откройте карточку на компьютере. Для проектора нажмите «Режим доски» в шапке — шрифт станет крупнее.</li>
          <li>Ученик читает то же правило по ссылке на телефоне.</li>
          <li>Сразу закрепляете тестом или списыванием.</li>
        </ol>
      </aside>
    </section>
    ${continueHtml()}
    <section class="grid-3">
      ${counts
        .map(
          (s) => `
        <a class="card home-section" href="#/rules/${s.id}">
          <h2>${escapeHtml(s.title)}</h2>
          <p>${s.n} ${ruleWord(s.n)}</p>
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
        .map((chapter, ci) => {
          const all = chapter.rules;
          const rules = all.filter((r) => ruleMatches(r, query));
          if (query && !rules.length) return "";
          if (!all.length && query) return "";
          const open = query || (ci === 0 && section === sections[0]);
          return `
            <details class="card chapter" ${open ? "open" : ""}>
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
  const tocItems = (rule.theory || [])
    .map((b, i) => ({ heading: b.heading, i }))
    .filter((b) => b.heading);
  const toc =
    tocItems.length >= 4
      ? `<nav class="rule-toc" aria-label="Содержание карточки">${tocItems
          .map((b) => `<a href="#t-${b.i}">${escapeHtml(plainText(b.heading))}</a>`)
          .join("")}</nav>`
      : "";
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
      ${toc}
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
            : ""
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
    <p class="lede">Можно идти отдельно от теории: выберите раздел и решайте тесты и списывание. Тренажёр ЕГЭ (задания 4–22) — отдельным пунктом.</p>
    <div class="filter-bar">
      <a class="pill ${!filterId ? "active" : ""}" href="#/practice">Все</a>
      ${content.sections.map((s) => `<a class="pill ${filterId === s.id ? "active" : ""}" href="#/practice/${s.id}">${escapeHtml(s.title)}</a>`).join("")}
      <a class="pill" href="#/ege">ЕГЭ</a>
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
      <div class="card class-only">
        <h3>На занятии</h3>
        <p>Откройте задание на проекторе или скиньте ссылку в чат. Для крупного шрифта нажмите «Режим доски» в шапке. Дома ученик проходит тот же вариант — без регистрации.</p>
      </div>
    </div>
  `;
}

export function egeIndex(content, taskNum = "") {
  const n = Number(taskNum);
  const all = egeTasks(content);
  const counts = {};
  for (const ex of all) counts[ex.egeTask] = (counts[ex.egeTask] || 0) + 1;
  const numbers = Object.keys(EGE_TITLES).map(Number);
  if (!n) {
    return `
      <p class="eyebrow">Тренажёр ЕГЭ</p>
      <h1>ЕГЭ по русскому</h1>
      <p class="lede">Форма как на экзамене: слово или последовательность цифр. Задания 4–22.</p>
      ${continueHtml()}
      <div class="ege-task-list">
        ${numbers
          .map(
            (num) => `
          <a class="card ege-task-row" href="#/ege/${num}">
            <span class="ege-num">${num}</span>
            <span>
              <strong>${escapeHtml(EGE_TITLES[num])}</strong>
              <span class="muted">${counts[num] || 0} вариантов</span>
            </span>
          </a>`
          )
          .join("")}
      </div>
      <details class="card ege-missing">
        <summary>Каких заданий нет</summary>
        <ul>
          <li><strong>1, 2, 3</strong> — микротекст: информация, средства связи, лексический анализ абзаца.</li>
          <li><strong>23–26</strong> — связный текст: содержание, тип речи, лексика, связь предложений.</li>
          <li><strong>27</strong> — сочинение.</li>
        </ul>
      </details>
    `;
  }
  const list = egeByNumber(content, n);
  const done = doneIds(n);
  return `
    <div class="crumbs"><a href="#/ege">ЕГЭ</a><span>/</span><span>задание ${n}</span></div>
    <p class="eyebrow">ЕГЭ · задание ${n}</p>
    <h1>${escapeHtml(EGE_TITLES[n] || "Задание")}</h1>
    <p class="lede">${list.length} вариантов. Ответ вписывается так же, как в бланк № 1.</p>
    <div class="home-actions">
      <a class="btn btn-lg" href="#/ege/${n}/random">Случайный вариант</a>
    </div>
    ${
      list.length
        ? `<div class="ege-var-grid">${list
            .map(
              (ex, i) => `
          <a class="ege-var${done.has(ex.id) ? " done" : ""}" href="#/ege-item/${encodeURIComponent(ex.id)}" aria-label="Вариант ${i + 1}">${i + 1}</a>`
            )
            .join("")}</div>`
        : `<div class="empty">Этот номер ещё наполняется.</div>`
    }
  `;
}
