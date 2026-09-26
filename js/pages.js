import { escapeHtml } from "./ui.js";
import { legend, mark } from "./markup.js";
import { EGE_TITLES, egeByNumber, egeTasks } from "./ege.js";
import { doneIds, readProgress } from "./progress.js";
import { STUDIO } from "./config.js";

function contactsBlock(extraClass = "") {
  const tg = STUDIO.telegram;
  const mail = STUDIO.applyEmail;
  return `
    <div class="landing-contacts ${extraClass}">
      <button type="button" class="btn btn-lg secondary" data-reveal-phone>Позвонить</button>
      <a class="btn btn-lg secondary" href="https://t.me/${escapeHtml(tg)}" target="_blank" rel="noopener noreferrer">Telegram</a>
      <a class="btn btn-lg secondary" href="mailto:${escapeHtml(mail)}">Почта</a>
    </div>`;
}

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
  const ruleCount = content.sections.reduce(
    (a, s) => a + s.chapters.reduce((b, c) => b + c.rules.length, 0),
    0
  );
  return `
    <section class="landing-hero" aria-label="Студия Лексикон">
      <div class="landing-hero-copy">
        <p class="landing-exams landing-exams-hero" aria-label="К чему готовим">
          <span class="exam-vpr">ВПР</span><span class="exam-oge">ОГЭ</span><span class="exam-ege">ЕГЭ</span>
        </p>
        <p class="eyebrow">Горно-Алтайск · русский язык и литература</p>
        <p class="landing-brand">Студия Лексикон</p>
        <h1 class="landing-title">Подготовка к экзаменам и развитие интеллекта</h1>
        <p class="lede landing-lede">База заданий ФИПИ и наши тренажёры. Очно и онлайн, один на один или в группе до четырёх.</p>
        <div class="landing-cta home-actions">
          <a class="btn btn-lg" href="#apply">Записаться</a>
          <button type="button" class="btn btn-lg secondary" data-reveal-phone>Позвонить</button>
          <a class="btn btn-lg secondary" href="https://t.me/${escapeHtml(STUDIO.telegram)}" target="_blank" rel="noopener noreferrer">Telegram</a>
        </div>
        <p class="landing-hero-more"><a href="#learn">Материалы на сайте</a></p>
      </div>
      <figure class="landing-hero-art">
        <div class="landing-hero-frame">
          <picture>
            <source media="(max-width: 720px)" srcset="./css/art/sarbinaz-hero-sm.jpg" />
            <img
              src="./css/art/sarbinaz-hero.jpg"
              alt="Рисунок Сарбиназ Алексеевой: манулы в горах"
              width="1500"
              height="2000"
              decoding="async"
              fetchpriority="high"
            />
          </picture>
        </div>
        <figcaption>Рисунок Сарбиназ Алексеевой</figcaption>
      </figure>
    </section>

    ${continueHtml()}

    <section class="landing-offer" aria-labelledby="offer-title">
      <p class="eyebrow">Чему учим</p>
      <h2 id="offer-title">Два предмета</h2>
      <div class="landing-offer-grid">
        <div>
          <h3>Русский язык</h3>
          <p>Орфография, пунктуация, то, что нужно в школе и на экзамене.</p>
        </div>
        <div>
          <h3>Литература</h3>
          <p>Чтение, разбор текста, сочинение своими словами.</p>
        </div>
      </div>
      <p class="landing-exams"><span>Школьная программа</span></p>
    </section>

    <section class="landing-about" id="about" aria-labelledby="about-title">
      <p class="eyebrow">О студии</p>
      <h2 id="about-title">Как устроена учёба</h2>
      <p class="lede">Опираемся на официальную базу ФИПИ. На занятии и дома — наши материалы: правила, тренажёры, маршрут под задачи ученика.</p>

      <dl class="landing-format-dl">
        <div>
          <dt>Очно или онлайн</dt>
          <dd>В студии в Горно-Алтайске или по видеосвязи. Ссылка на онлайн — только записанным ученикам.</dd>
        </div>
        <div>
          <dt>Один на один или в группе</dt>
          <dd>В группе не больше четырёх человек.</dd>
        </div>
      </dl>

      <div class="landing-teacher-inline">
        <div class="landing-teacher-card">
          <img
            class="landing-teacher-photo"
            src="./css/art/alekseev.jpg"
            alt="Павел Викторович Алексеев"
            width="160"
            height="160"
            decoding="async"
          />
          <div>
            <p class="landing-teacher-inline-label">Руководитель и ведущий преподаватель</p>
            <h3>Павел Викторович Алексеев</h3>
            <p>Доктор филологических наук, профессор. Сам ведёт занятия в студии.</p>
            <p><a href="https://palekseev.ru/" target="_blank" rel="noopener noreferrer">Личный сайт</a></p>
          </div>
        </div>
      </div>
    </section>

    <section class="landing-apply" id="apply" aria-labelledby="apply-title">
      <div class="landing-apply-intro">
        <p class="eyebrow">Запись</p>
        <h2 id="apply-title">Оставить заявку</h2>
        <p class="lede">Можно заполнить форму или сразу написать / позвонить.</p>
        ${contactsBlock("landing-contacts-compact")}
      </div>
      <form class="apply-form" id="apply-form" novalidate>
        <input type="hidden" name="_subject" value="Заявка в Студию Лексикон" />
        <input type="hidden" name="_captcha" value="false" />
        <input type="hidden" name="_template" value="table" />
        <input type="hidden" name="_next" value="" />
        <input type="text" name="_honey" style="display:none" tabindex="-1" autocomplete="off" />

        <div class="apply-row">
          <label class="apply-field">
            <span>Имя ученика или родителя</span>
            <input class="search apply-input" name="name" required autocomplete="name" placeholder="Как к вам обращаться" />
          </label>
          <label class="apply-field">
            <span>Телефон</span>
            <input class="search apply-input" name="phone" type="tel" required autocomplete="tel" placeholder="+7 …" />
          </label>
        </div>

        <div class="apply-row">
          <label class="apply-field">
            <span>Класс</span>
            <select class="search apply-input" name="grade" required>
              <option value="">Выберите</option>
              <option>5</option><option>6</option><option>7</option>
              <option>8</option><option>9</option><option>10</option><option>11</option>
            </select>
          </label>
          <label class="apply-field">
            <span>Предмет</span>
            <select class="search apply-input" name="subject" required>
              <option value="">Выберите</option>
              <option>Русский язык</option>
              <option>Литература</option>
              <option>Русский язык и литература</option>
            </select>
          </label>
        </div>

        <div class="apply-row">
          <label class="apply-field">
            <span>Зачем приходите</span>
            <select class="search apply-input" name="goal" required>
              <option value="">Выберите</option>
              <option>ВПР</option>
              <option>ОГЭ</option>
              <option>ЕГЭ</option>
              <option>Подтянуть школьную программу</option>
              <option>Другое</option>
            </select>
          </label>
          <fieldset class="apply-field apply-fieldset">
            <legend>Где удобнее</legend>
            <label class="apply-check"><input type="radio" name="place" value="Очно в студии" required /> Очно</label>
            <label class="apply-check"><input type="radio" name="place" value="Онлайн" /> Онлайн</label>
            <label class="apply-check"><input type="radio" name="place" value="Пока не знаю" /> Пока не знаю</label>
          </fieldset>
        </div>

        <fieldset class="apply-field apply-fieldset">
          <legend>С кем заниматься</legend>
          <label class="apply-check"><input type="radio" name="mode" value="Индивидуально" required /> Один на один</label>
          <label class="apply-check"><input type="radio" name="mode" value="В группе до 4 человек" /> В группе (до 4)</label>
          <label class="apply-check"><input type="radio" name="mode" value="Посоветуйте" /> Посоветуйте</label>
        </fieldset>

        <label class="apply-field">
          <span>Пара слов о себе <span class="muted">(по желанию)</span></span>
          <textarea class="search apply-input apply-textarea" name="note" rows="3" placeholder="Удобное время, что уже пробовали, о чём хочется спросить…"></textarea>
        </label>

        <div class="landing-cta home-actions apply-actions">
          <button type="submit" class="btn btn-lg">Отправить</button>
          <button type="button" class="btn btn-lg secondary" id="apply-mailto">Открыть в почте</button>
        </div>
        <p class="muted apply-hint">Заявка придёт нам на почту. Если удобнее через свою почтовую программу — нажмите «Открыть в почте».</p>
        <p class="apply-status" id="apply-status" role="status" hidden></p>
      </form>
    </section>

    <section class="landing-learn" id="learn" aria-labelledby="learn-title">
      <p class="eyebrow">На сайте</p>
      <h2 id="learn-title">Учебные материалы</h2>
      <p class="lede">Два предмета. Пока открыт русский язык — литературу добавим позже.</p>

      <div class="landing-learn-subjects">
        <div class="landing-learn-subject">
          <p class="landing-learn-label">Русский язык</p>
          <div class="landing-learn-links">
            <a href="#/ege"><strong>ЕГЭ</strong><span>Задания 4–22</span></a>
            <a href="#/oge"><strong>ОГЭ</strong><span>Раздел готовится</span></a>
            <a href="#/rules"><strong>Правила</strong><span>${ruleCount} ${ruleWord(ruleCount)}</span></a>
          </div>
        </div>
        <div class="landing-learn-subject landing-learn-subject-soon">
          <p class="landing-learn-label">Литература</p>
          <p class="landing-learn-soon">Материалов пока нет — раздел появится позже.</p>
          <a class="landing-learn-soon-link" href="#/literature">Открыть страницу раздела</a>
        </div>
      </div>
    </section>

    <section class="landing-contact" id="contact" aria-labelledby="contact-title">
      <div>
        <p class="eyebrow">Контакты</p>
        <h2 id="contact-title">Горно-Алтайск</h2>
        <p class="lede">пр. Коммунистический, 47 · вход со стороны ул. Головина</p>
        ${contactsBlock()}
        <p class="muted landing-contact-mail">
          <a href="mailto:${escapeHtml(STUDIO.applyEmail)}">${escapeHtml(STUDIO.applyEmail)}</a>
          ·
          <a href="https://t.me/${escapeHtml(STUDIO.telegram)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(STUDIO.telegram)}</a>
        </p>
        <div class="landing-cta home-actions">
          <a class="btn btn-lg secondary" href="https://go.2gis.com/lknNX" target="_blank" rel="noopener noreferrer">На карте</a>
          <a class="btn btn-lg secondary" href="#apply">Форма заявки</a>
        </div>
      </div>
    </section>
  `;
}

export function thanksPage() {
  return `
    <p class="eyebrow">Заявка</p>
    <h1>Спасибо, мы получили письмо</h1>
    <p class="lede">Скоро ответим. Если что-то срочное — напишите на <a href="mailto:pavel.alekseev.gasu@gmail.com">pavel.alekseev.gasu@gmail.com</a>.</p>
    <div class="home-actions">
      <a class="btn btn-lg" href="#/">На главную</a>
      <a class="btn btn-lg secondary" href="#/ege">К заданиям ЕГЭ</a>
    </div>
  `;
}

export function ogePage() {
  return `
    <p class="eyebrow">Русский язык · ОГЭ</p>
    <h1>ОГЭ по русскому</h1>
    <p class="lede">Этот раздел ещё наполняется. Пока можно заниматься заданиями ЕГЭ или открыть правила.</p>
    <div class="home-actions">
      <a class="btn btn-lg" href="#/ege">К заданиям ЕГЭ</a>
      <a class="btn btn-lg secondary" href="#/rules">К правилам</a>
      <a class="btn btn-lg secondary" href="#/">О студии</a>
    </div>
  `;
}

export function literaturePage() {
  return `
    <p class="eyebrow">Литература</p>
    <h1>Материалы по литературе</h1>
    <p class="lede">Раздел ещё пустой. Сейчас на сайте учебная часть только по русскому языку — правила и тренажёры ЕГЭ.</p>
    <div class="home-actions">
      <a class="btn btn-lg" href="#/rules">К правилам по русскому</a>
      <a class="btn btn-lg secondary" href="#/ege">К заданиям ЕГЭ</a>
      <a class="btn btn-lg secondary" href="#/">О студии</a>
    </div>
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
    <p class="eyebrow">Русский язык</p>
    <h1>Правила</h1>
    <p class="lede">Орфография, пунктуация, стилистика. Откройте главу, затем карточку — орфограмма в примерах выделена цветом.</p>
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
      <div class="print-sheet-header" aria-hidden="true">
        <span class="print-logo-mark">Л</span>
        <div class="print-logo-text">
          <strong>Студия Лексикон</strong>
          <span>Орфография · пунктуация · стилистика</span>
        </div>
      </div>
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
        <button type="button" class="btn secondary" id="rule-print" title="Откроет диалог печати — можно сохранить как PDF">Распечатать</button>
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
        <p>Откройте задание на проекторе или скиньте ссылку в чат. Для крупного шрифта нажмите «Крупный шрифт» в шапке. Дома ученик проходит тот же вариант — без регистрации.</p>
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
      <p class="eyebrow">Русский язык · ЕГЭ</p>
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
