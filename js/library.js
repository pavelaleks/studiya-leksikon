// Библиотека: произведения кодификатора ЕГЭ (тексты из Викитеки), читалка для телефона,
// стихи для задания 10 и заучивания наизусть, тесты по статьям «Полки».
import { BASE } from "./config.js";
import { escapeHtml } from "./ui.js";
import { accessState, currentUser, humanError, supa } from "./supa.js";

const DATA_VER = "lib2";
const ROOT = new URL("js/library-data/", new URL(BASE, location.href));
const cache = new Map();

function load(path) {
  if (!cache.has(path)) {
    const p = fetch(new URL(path + "?v=" + DATA_VER, ROOT)).then((r) => {
      if (!r.ok) throw new Error("Не удалось загрузить " + path);
      return r.json();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path);
}

const catalog = () => load("catalog.json");
const workTasks = () => load("work-tasks.json").catch(() => ({}));

const TASK_INFO = {
  1: ["Краткий ответ", false],
  2: ["Соответствие", false],
  3: ["Термины", false],
  4: ["Развёрнутый ответ", true],
  5: ["Анализ и сопоставление", true],
};

/** Задания ЕГЭ к фрагменту главы — под текстом в читалке. */
function chapterTasksHtml(list) {
  if (!list.length) return "";
  return `
    <aside class="reader-tasks">
      <p class="reader-tasks-h">Проверь себя по этому фрагменту</p>
      <p class="reader-tasks-sub">Задания ЕГЭ по литературе, построенные на тексте этой главы</p>
      <div class="reader-tasks-list">${list
        .map(
          ([id, n]) => `<a class="rt-chip${TASK_INFO[n]?.[1] ? " is-written" : ""}" href="#/literature/${n}/${id}">
            <b>${n}</b><span>${escapeHtml(TASK_INFO[n]?.[0] || "Задание")}${TASK_INFO[n]?.[1] ? " · письменно" : ""}</span></a>`
        )
        .join("")}</div>
    </aside>`;
}

/** Блок на странице произведения: задания 1–5 по номерам и сочинение (задание 11). */
function workTasksHtml(w, wt) {
  if (!wt || (!wt.tasks.length && !wt.essays.length)) return "";
  const byNo = {};
  wt.tasks.forEach(([id, n, ch]) => (byNo[n] = byNo[n] || []).push([id, ch]));
  const tasksBlock = wt.tasks.length
    ? `
      <section class="me-section" id="tasks">
        <h2>Задания ЕГЭ по тексту <span class="muted">${wt.tasks.length}</span></h2>
        <p class="muted">Каждое задание построено на фрагменте произведения. ${w.toc ? "Номер главы — откуда фрагмент: можно сначала прочитать её." : ""} Задания 4 и 5 — развёрнутый ответ, его проверит преподаватель.</p>
        ${Object.entries(byNo)
          .map(
            ([n, list]) => `
          <details class="wt-group card" ${n === "1" ? "open" : ""}>
            <summary><b>Задание ${n}</b> · ${escapeHtml(TASK_INFO[n]?.[0] || "")} <span class="muted">${list.length}</span></summary>
            <div class="wt-chips">${list
              .map(([id, ch], k) => `<a class="rt-chip" href="#/literature/${n}/${id}"><b>${k + 1}</b><span>${ch != null && w.toc?.[ch] ? escapeHtml(w.toc[ch].t.length <= 6 ? `гл. ${w.toc[ch].t}` : w.toc[ch].t) : "фрагмент"}</span></a>`)
              .join("")}</div>
          </details>`
          )
          .join("")}
      </section>`
    : "";
  const essayBlock = wt.essays.length
    ? `
      <section class="me-section" id="essay">
        <h2>Сочинение по произведению <span class="muted">· по желанию</span></h2>
        ${wt.topics.length ? `<ul class="wt-topics">${wt.topics.slice(0, 6).map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : ""}
        <p class="muted">В задании 11 пять тем — выбери ту, что про «${escapeHtml(w.title)}». Сочинение проверит преподаватель по критериям ФИПИ: 15 очков за сдачу и до 40 после проверки.</p>
        <p class="actions"><a class="btn" href="#/literature/11/${wt.essays[Math.floor(Math.random() * wt.essays.length)]}">Написать сочинение</a></p>
      </section>`
    : "";
  return tasksBlock + essayBlock;
}
const poemsData = () => load("poems.json");
const textPart = (id, n) => load(`texts/${id}-${n}.json`);

function ru(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem("lib:" + key) || "null");
    localStorage.setItem("lib:" + key, JSON.stringify(value));
  } catch {
    return null;
  }
  return value;
}

const polkaUrl = (n, block) => `https://polka.academy/articles/${n}${block ? `?block=${block}` : ""}`;
const wikiUrl = (t) => `https://ru.wikipedia.org/wiki/${encodeURIComponent(t.replaceAll(" ", "_"))}`;
const ext = (href, text, cls = "lib-link") =>
  `<a class="${cls}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;

/* ---------- данные ученика: сданные тесты и выученные стихи ---------- */

async function myReading() {
  if (!currentUser() || accessState() === "teacher") return { passed: new Set(), tried: new Set(), learned: new Set() };
  const [r, p] = await Promise.all([
    supa.from("reading_results").select("quiz_id, passed"),
    supa.from("poems_learned").select("poem_id"),
  ]);
  const passed = new Set((r.data || []).filter((x) => x.passed).map((x) => x.quiz_id));
  const tried = new Set((r.data || []).map((x) => x.quiz_id));
  return { passed, tried, learned: new Set((p.data || []).map((x) => x.poem_id)) };
}

async function quizzes() {
  const { data, error } = await supa
    .from("reading_quizzes")
    .select("id, work_id, title, kind, url, intro, questions, points, position")
    .eq("is_published", true)
    .order("position");
  if (error) throw error;
  return data || [];
}

/* ---------- общий каркас ---------- */

function tabs(active) {
  const t = [
    ["works", "#/library", "Произведения"],
    ["poems", "#/library/poems", "Стихи наизусть"],
    ["read", "#/library/read", "Читать и отвечать"],
    ...(currentUser() && accessState() !== "teacher" ? [["list", "#/me/reading", "Мой список к экзамену"]] : []),
  ];
  return `<nav class="filter-bar lib-tabs">${t
    .map(([id, href, title]) => `<a class="pill ${active === id ? "active" : ""}" href="${href}">${title}</a>`)
    .join("")}</nav>`;
}

function head(active, title, lede) {
  return `
    <header class="lib-head">
      <p class="crumbs"><a href="#/literature">← Литература</a></p>
      <p class="eyebrow">Библиотека</p>
      <h1>${title}</h1>
      ${lede ? `<p class="lede">${lede}</p>` : ""}
    </header>
    ${tabs(active)}`;
}

/* ---------- каталог произведений ---------- */

function workCard(w, quizByWork, done) {
  const marks = [];
  if (w.focus) marks.push(`<span class="lib-mark is-focus" title="Фрагменты бывают в части 1 (задания 1–5)">часть 1</span>`);
  if (w.toc) marks.push(`<span class="lib-mark">текст</span>`);
  if (w.polka) marks.push(`<span class="lib-mark">«Полка»</span>`);
  const q = quizByWork.get(w.id);
  if (q) marks.push(`<span class="lib-mark ${done.has(q.id) ? "is-done" : "is-quiz"}">${done.has(q.id) ? "тест ✓" : "тест"}</span>`);
  const progress = w.toc ? readShare(w) : 0;
  return `
    <a class="lib-card" href="#/library/w/${w.id}" data-search="${escapeHtml((w.author + " " + w.title).toLowerCase())}">
      <span class="lib-card-author">${escapeHtml(w.author || "Древнерусская литература")}</span>
      <strong>${escapeHtml(w.title)}</strong>
      <span class="lib-marks">${marks.join("")}</span>
      ${progress ? `<span class="lib-progress"><span style="width:${progress}%"></span></span>` : ""}
    </a>`;
}

function readShare(w) {
  const read = store("read:" + w.id) || [];
  return w.toc?.length ? Math.round((100 * read.length) / w.toc.length) : 0;
}

async function worksView(host) {
  const [cat, qs, me] = await Promise.all([catalog(), quizzes().catch(() => []), myReading()]);
  const quizByWork = new Map(qs.map((q) => [q.work_id, q]));
  const groups = cat.periods
    .map((p) => {
      const works = cat.works.filter((w) => w.period === p.id);
      if (!works.length) return "";
      return `
        <section class="lib-period">
          <h2>${escapeHtml(p.title)}</h2>
          <div class="lib-grid">${works.map((w) => workCard(w, quizByWork, me.passed)).join("")}</div>
        </section>`;
    })
    .join("");
  const withText = cat.works.filter((w) => w.toc).length;
  host.innerHTML = `
    ${head("works", "Произведения кодификатора ЕГЭ", `${cat.works.length} произведений из кодификатора 2027 года. ${withText} можно читать прямо здесь — с телефона, с закладками и примечаниями. К остальным — статьи «Полки» и Википедии.`)}
    <div class="lib-tools">
      <input class="search" id="lib-search" placeholder="Автор или название…" autocomplete="off" />
      <label class="lib-check"><input type="checkbox" id="lib-focus" /> только «часть 1»</label>
    </div>
    <p class="muted lib-legend"><span class="lib-mark is-focus">часть 1</span> — фрагменты этих произведений бывают в заданиях 1–5.</p>
    ${groups}
    <p class="lib-source muted">Тексты — из <a href="https://ru.wikisource.org/" target="_blank" rel="noopener">Викитеки</a> (общественное достояние). Статьи о книгах — на «<a href="https://polka.academy/about" target="_blank" rel="noopener">Полке</a>».</p>`;
  const input = host.querySelector("#lib-search");
  const focus = host.querySelector("#lib-focus");
  const filter = () => {
    const q = input.value.trim().toLowerCase();
    const cards = [...host.querySelectorAll(".lib-card")];
    cards.forEach((c) => {
      const w = cat.works.find((x) => c.getAttribute("href").endsWith("/" + x.id));
      const ok = (!q || c.dataset.search.includes(q)) && (!focus.checked || w?.focus);
      c.hidden = !ok;
    });
    host.querySelectorAll(".lib-period").forEach((s) => (s.hidden = !s.querySelector(".lib-card:not([hidden])")));
  };
  input.addEventListener("input", filter);
  focus.addEventListener("change", filter);
}

/* ---------- карточка произведения ---------- */

async function workView(host, id) {
  const [cat, qs, me, wtAll] = await Promise.all([catalog(), quizzes().catch(() => []), myReading(), workTasks()]);
  const wt = wtAll[id];
  const perChapter = {};
  (wt?.tasks || []).forEach(([, , ch]) => ch != null && (perChapter[ch] = (perChapter[ch] || 0) + 1));
  const w = cat.works.find((x) => x.id === id);
  if (!w) {
    host.innerHTML = `<div class="empty">Произведение не найдено. <a href="#/library">К библиотеке</a></div>`;
    return;
  }
  const quiz = qs.find((q) => q.work_id === w.id);
  const read = new Set(store("read:" + w.id) || []);
  const last = store("pos:" + w.id);
  const tocHtml = w.toc
    ? `
      <section class="lib-toc card">
        <h2>Оглавление <span class="muted">${read.size} из ${w.toc.length}</span></h2>
        <ol>${w.toc
          .map((t, i) => `<li class="${read.has(i) ? "is-read" : ""}"><a href="#/library/w/${w.id}/${i + 1}">${escapeHtml(t.t)}</a>${perChapter[i] ? ` <span class="lib-mark is-quiz" title="Заданий ЕГЭ к фрагменту этой главы">${perChapter[i]} ЕГЭ</span>` : ""}</li>`)
          .join("")}</ol>
      </section>`
    : `
      <section class="card lib-notext">
        <h2>Текста здесь нет</h2>
        <p>Произведение ещё охраняется авторским правом или его нет в Викитеке в надёжной редакции. Возьмите книгу в библиотеке или в электронном магазине, а подготовиться к разговору о ней помогут статьи по ссылкам выше.</p>
      </section>`;
  const startHref = w.toc ? `#/library/w/${w.id}/${last?.ch ? last.ch : 1}` : "";
  host.innerHTML = `
    <p class="crumbs"><a href="#/library">← Библиотека</a></p>
    <header class="lib-work-head">
      <p class="eyebrow">${escapeHtml(w.author || "Древнерусская литература")}</p>
      <h1>${escapeHtml(w.title)}</h1>
      <p class="lib-marks">
        <span class="lib-mark">кодификатор: ${escapeHtml(w.code)}</span>
        ${w.focus ? `<span class="lib-mark is-focus">фрагменты в части 1</span>` : ""}
        ${w.school ? `<span class="lib-mark">задания 2, 5 и сочинение</span>` : ""}
        ${w.chars ? `<span class="lib-mark">≈ ${Math.max(1, Math.round(w.chars / 1800 / 30))} ч чтения</span>` : ""}
      </p>
      ${w.note ? `<p class="muted">${escapeHtml(w.note)}</p>` : ""}
    </header>
    <div class="lib-actions">
      ${w.toc ? `<a class="btn" href="${startHref}">${last?.ch ? "Продолжить чтение" : "Читать"}</a>` : ""}
      ${quiz ? `<a class="btn secondary" href="#/library/quiz/${quiz.id}">${me.passed.has(quiz.id) ? "Тест по статье ✓" : `Тест по статье · +${quiz.points}`}</a>` : ""}
      ${w.polka ? ext(polkaUrl(w.polka), "Статья на «Полке» ↗", "btn secondary") : ""}
      ${w.wiki ? ext(wikiUrl(w.wiki), "Википедия ↗", "btn secondary") : ""}
    </div>
    ${wt?.tasks?.length || wt?.essays?.length ? `<p class="lib-actions"><a class="btn secondary" href="#/library/w/${w.id}" data-goto-tasks>Задания ЕГЭ${wt.tasks.length ? ` · ${wt.tasks.length}` : ""}</a>${wt.essays.length ? ` <a class="btn secondary" href="#/library/w/${w.id}" data-goto-essay>Сочинение</a>` : ""}</p>` : ""}
    ${w.polka ? `<p class="muted lib-hint">«Полка» отвечает на главные вопросы о книге: о чём она, как написана, как её приняли. Прочитай статью, потом пройди тест — за него начисляются очки.</p>` : ""}
    ${tocHtml}
    ${workTasksHtml(w, wt)}
    ${w.src ? `<p class="lib-source muted">Текст: ${w.src.map((u, i) => ext(u, w.src.length > 1 ? `Викитека (${i + 1})` : "Викитека")).join(", ")}. Общественное достояние.</p>` : ""}`;
  host.querySelector("[data-goto-tasks]")?.addEventListener("click", (e) => {
    e.preventDefault();
    host.querySelector(wt?.tasks?.length ? "#tasks" : "#essay")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  host.querySelector("[data-goto-essay]")?.addEventListener("click", (e) => {
    e.preventDefault();
    host.querySelector("#essay")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/* ---------- читалка ---------- */

const THEMES = ["paper", "sepia", "night"];

function readerPrefs() {
  const t = document.documentElement.getAttribute("data-theme");
  const dark = t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches);
  return { size: 19, theme: dark ? "night" : "paper", ...(store("prefs") || {}) };
}

async function readerView(host, id, n) {
  const [cat, wtAll] = await Promise.all([catalog(), workTasks()]);
  const w = cat.works.find((x) => x.id === id);
  if (!w || !w.toc) {
    host.innerHTML = `<div class="empty">Текст не найден. <a href="#/library">К библиотеке</a></div>`;
    return;
  }
  const idx = Math.min(Math.max(1, Number(n) || 1), w.toc.length) - 1;
  const t = w.toc[idx];
  const part = await textPart(w.id, t.p);
  const ch = part[t.i];
  const prefs = readerPrefs();
  const notes = (ch.n || []).map(([num, text]) => `<li id="fn-${num}" data-n="${num}">${escapeHtml(text)}</li>`).join("");
  host.innerHTML = `
    <div class="reader theme-${prefs.theme}" style="--reader-size:${prefs.size}px">
      <div class="reader-bar">
        <a class="reader-back" href="#/library/w/${w.id}" aria-label="К оглавлению">←</a>
        <span class="reader-title"><strong>${escapeHtml(w.title)}</strong><span>${escapeHtml(t.t)}</span></span>
        <button type="button" class="reader-btn" data-act="smaller" aria-label="Мельче">A−</button>
        <button type="button" class="reader-btn" data-act="bigger" aria-label="Крупнее">A+</button>
        <button type="button" class="reader-btn" data-act="theme" aria-label="Цвет страницы">◐</button>
      </div>
      <div class="reader-progress"><span style="width:${Math.round((100 * (idx + 1)) / w.toc.length)}%"></span></div>
      <article class="reader-text">
        <h2 class="reader-ch">${escapeHtml(t.t)}</h2>
        ${ch.h}
        ${chapterTasksHtml((wtAll[w.id]?.tasks || []).filter(([, , ch]) => ch === idx))}
        ${notes ? `<aside class="reader-notes"><h3>Примечания</h3><ol>${notes}</ol></aside>` : ""}
        <div class="reader-end" aria-hidden="true"></div>
      </article>
      <nav class="reader-nav">
        ${idx > 0 ? `<a class="btn secondary" href="#/library/w/${w.id}/${idx}">← Назад</a>` : `<span></span>`}
        <span class="muted">${idx + 1} / ${w.toc.length}</span>
        ${idx + 1 < w.toc.length ? `<a class="btn" href="#/library/w/${w.id}/${idx + 2}">Дальше →</a>` : `<a class="btn" href="#/library/w/${w.id}">Готово</a>`}
      </nav>
    </div>`;
  const reader = host.querySelector(".reader");
  const apply = () => {
    reader.style.setProperty("--reader-size", prefs.size + "px");
    THEMES.forEach((x) => reader.classList.toggle("theme-" + x, x === prefs.theme));
    store("prefs", prefs);
  };
  host.querySelector(".reader-bar").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "smaller") prefs.size = Math.max(15, prefs.size - 1);
    if (act === "bigger") prefs.size = Math.min(28, prefs.size + 1);
    if (act === "theme") prefs.theme = THEMES[(THEMES.indexOf(prefs.theme) + 1) % THEMES.length];
    if (act) apply();
  });
  // сноски: по нажатию показываем текст примечания прямо под строкой
  host.querySelector(".reader-text").addEventListener("click", (e) => {
    const sup = e.target.closest("sup.fn");
    if (!sup) return;
    const next = sup.nextElementSibling;
    if (next?.classList.contains("fn-pop")) return next.remove();
    const note = host.querySelector(`#fn-${sup.dataset.n}`);
    if (!note) return;
    const pop = document.createElement("span");
    pop.className = "fn-pop";
    pop.textContent = note.textContent;
    sup.after(pop);
  });
  // закладка: глава и место в ней; глава прочитана, когда дочитали до конца
  const pos = store("pos:" + w.id);
  if (pos?.ch === idx + 1 && pos.y > 0) {
    requestAnimationFrame(() => window.scrollTo(0, pos.y * (document.documentElement.scrollHeight - innerHeight)));
  } else window.scrollTo(0, 0);
  let timer = null;
  const save = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    store("pos:" + w.id, { ch: idx + 1, y: h > 0 ? Math.round((scrollY / h) * 1000) / 1000 : 0 });
  };
  const onScroll = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  save();
  window.addEventListener("scroll", onScroll, { passive: true });
  const end = host.querySelector(".reader-end");
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((x) => x.isIntersecting)) return;
    const read = new Set(store("read:" + w.id) || []);
    read.add(idx);
    store("read:" + w.id, [...read]);
    io.disconnect();
  });
  io.observe(end);
  const cleanup = () => {
    window.removeEventListener("scroll", onScroll);
    io.disconnect();
    window.removeEventListener("hashchange", cleanup);
  };
  window.addEventListener("hashchange", cleanup);
}

/* ---------- стихи ---------- */

function poemLines(text) {
  return text.split("\n\n").map((st) => st.split("\n"));
}

function poemHtml(text, mode = "read") {
  return poemLines(text)
    .map(
      (st) =>
        `<p class="poem-st">${st
          .map((line, li) => {
            if (mode === "letters") {
              return escapeHtml(line).replace(/([А-Яа-яЁёA-Za-z])([А-Яа-яЁёA-Za-z-]*)/g, (_, a, rest) => a + rest.replace(/[^-]/g, "·"));
            }
            if (mode === "half") return li % 2 ? `<span class="poem-hidden">${escapeHtml(line)}</span>` : escapeHtml(line);
            return escapeHtml(line);
          })
          .join("<br>")}</p>`
    )
    .join("");
}

async function poemsView(host, theme = "") {
  const [data, me] = await Promise.all([poemsData(), myReading()]);
  const themes = data.themes;
  const list = theme ? data.poems.filter((p) => p.themes.includes(theme)) : data.poems;
  const byAuthor = new Map();
  list.forEach((p) => {
    if (!byAuthor.has(p.author)) byAuthor.set(p.author, []);
    byAuthor.get(p.author).push(p);
  });
  const learned = data.poems.filter((p) => me.learned.has(p.id)).length;
  host.innerHTML = `
    ${head("poems", "Стихи наизусть и задание 10", "В задании 10 ЕГЭ нужно сопоставить стихотворение с другим — того же мотива или темы. Чем больше стихов ты знаешь (лучше наизусть), тем легче найти пару. Выбирай тему, читай и учи: за каждое выученное — очки.")}
    ${learned ? `<p class="lib-learned">Выучено: <strong>${learned}</strong> ${ru(learned, "стихотворение", "стихотворения", "стихотворений")}</p>` : ""}
    <div class="filter-bar lib-themes">
      <a class="pill ${!theme ? "active" : ""}" href="#/library/poems">Все</a>
      ${themes.map((t) => `<a class="pill ${theme === t.id ? "active" : ""}" href="#/library/poems/t/${t.id}">${escapeHtml(t.title)}</a>`).join("")}
    </div>
    <input class="search" id="poem-search" placeholder="Автор, название или строка…" autocomplete="off" />
    <div class="poem-list">
      ${[...byAuthor.entries()]
        .map(
          ([author, ps]) => `
        <section class="poem-author">
          <h2>${escapeHtml(author)}</h2>
          <ul>${ps
            .map(
              (p) => `
            <li data-search="${escapeHtml((p.author + " " + p.title + " " + (p.text || "").slice(0, 300)).toLowerCase())}">
              <a href="#/library/poems/${p.id}">${escapeHtml(p.title)}</a>
              ${me.learned.has(p.id) ? `<span class="lib-mark is-done">наизусть ✓</span>` : ""}
              ${p.text ? "" : `<span class="lib-mark">по ссылке</span>`}
            </li>`
            )
            .join("")}</ul>
        </section>`
        )
        .join("")}
    </div>
    <p class="lib-source muted">Тексты — из <a href="https://ru.wikisource.org/" target="_blank" rel="noopener">Викитеки</a>. Стихи поэтов, чьи тексты ещё охраняются авторским правом (Ахматова, Пастернак, Твардовский и др.), даны названием — найдите их в сборнике.</p>`;
  const input = host.querySelector("#poem-search");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    host.querySelectorAll(".poem-list li").forEach((li) => (li.hidden = q && !li.dataset.search.includes(q)));
    host.querySelectorAll(".poem-author").forEach((s) => (s.hidden = !s.querySelector("li:not([hidden])")));
  });
}

function words(s) {
  return s
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^а-яa-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Разметка проверки: какие слова оригинала пропущены (по наибольшей общей подпоследовательности). */
function diffHtml(original, typed) {
  const lines = poemLines(original);
  const flat = [];
  lines.forEach((st, si) =>
    st.forEach((line, li) => line.split(/\s+/).forEach((tok) => flat.push({ tok, si, li, w: words(tok)[0] || null })))
  );
  const a = flat.filter((x) => x.w);
  const b = words(typed);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].w === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i].w === b[j]) {
      a[i].ok = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  let html = "", si = 0, li = 0;
  html += `<p class="poem-st">`;
  flat.forEach((x, k) => {
    if (x.si !== si) {
      html += `</p><p class="poem-st">`;
      si = x.si;
      li = x.li;
    } else if (x.li !== li) {
      html += "<br>";
      li = x.li;
    } else if (k) html += " ";
    html += x.w && !x.ok ? `<mark class="poem-miss">${escapeHtml(x.tok)}</mark>` : escapeHtml(x.tok);
  });
  return html + "</p>";
}

async function poemView(host, id) {
  const [data, me] = await Promise.all([poemsData(), myReading()]);
  const p = data.poems.find((x) => x.id === id);
  if (!p) {
    host.innerHTML = `<div class="empty">Стихотворение не найдено. <a href="#/library/poems">К списку</a></div>`;
    return;
  }
  const themeTitle = Object.fromEntries(data.themes.map((t) => [t.id, t.title]));
  const pairs = data.poems
    .filter((x) => x.id !== p.id && x.author !== p.author && x.themes.some((t) => p.themes.includes(t)))
    .slice(0, 8);
  const learned = me.learned.has(p.id);
  const state = accessState();
  const canCheck = state === "student" || state === "teacher";
  host.innerHTML = `
    <p class="crumbs"><a href="#/library/poems">← Стихи наизусть</a></p>
    <header class="poem-head">
      <p class="eyebrow">${escapeHtml(p.author)}</p>
      <h1>${escapeHtml(p.title)}</h1>
      <p class="lib-marks">${p.themes.map((t) => `<a class="lib-mark" href="#/library/poems/t/${t}">${escapeHtml(themeTitle[t] || t)}</a>`).join("")}
        ${learned ? `<span class="lib-mark is-done">выучено ✓</span>` : ""}</p>
    </header>
    ${
      p.text
        ? `
      <div class="filter-bar poem-modes" role="tablist">
        <button type="button" class="pill active" data-mode="read">Читать</button>
        <button type="button" class="pill" data-mode="letters">Первые буквы</button>
        <button type="button" class="pill" data-mode="half">Через строку</button>
        <button type="button" class="pill" data-mode="check">Проверить себя</button>
      </div>
      <div class="poem-body card" id="poem-body">${poemHtml(p.text)}</div>
      ${p.date ? `<p class="muted poem-date">${escapeHtml(p.date)}</p>` : ""}
      <div class="poem-check card" id="poem-check" hidden>
        ${
          canCheck
            ? `<p>Напиши стихотворение по памяти. Знаки препинания и заглавные буквы не важны. Засчитывается, если совпало от 95% слов.</p>
               <textarea id="poem-input" rows="10" placeholder="Начни с первой строки…" autocomplete="off" autocapitalize="sentences" spellcheck="false"></textarea>
               <p class="actions"><button class="btn" type="button" id="poem-go">Проверить</button></p>
               <div id="poem-result" aria-live="polite"></div>`
            : `<p>Проверка наизусть с очками — для учеников студии. <a href="#/login">Войти</a></p>`
        }
      </div>
      <p class="lib-source muted">Текст: ${ext(p.src, "Викитека")}.</p>`
        : `
      <div class="card lib-notext">
        <p>Текст этого стихотворения охраняется авторским правом, поэтому здесь его нет. Найдите его в сборнике поэта${p.wiki ? ` или прочитайте о нём: ${ext(wikiUrl(p.wiki), "Википедия ↗")}` : ""}.</p>
      </div>`
    }
    ${
      pairs.length
        ? `<section class="poem-pairs">
        <h2>Для сопоставления в задании 10</h2>
        <p class="muted">Стихи других поэтов на ту же тему. Подумай, что их сближает и чем они различаются.</p>
        <ul>${pairs.map((x) => `<li><a href="#/library/poems/${x.id}">${escapeHtml(x.author)} — ${escapeHtml(x.title)}</a></li>`).join("")}</ul>
      </section>`
        : ""
    }`;
  if (!p.text) return;
  const body = host.querySelector("#poem-body");
  const check = host.querySelector("#poem-check");
  host.querySelector(".poem-modes").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    host.querySelectorAll(".poem-modes .pill").forEach((b) => b.classList.toggle("active", b === btn));
    const mode = btn.dataset.mode;
    body.hidden = mode === "check";
    check.hidden = mode !== "check";
    if (mode !== "check") body.innerHTML = poemHtml(p.text, mode);
    else host.querySelector("#poem-input")?.focus();
  });
  body.addEventListener("click", (e) => e.target.closest(".poem-hidden")?.classList.toggle("is-open"));
  const go = host.querySelector("#poem-go");
  if (!go) return;
  const input = host.querySelector("#poem-input");
  const draftKey = "poem:" + p.id;
  input.value = store(draftKey) || "";
  input.addEventListener("input", () => store(draftKey, input.value));
  go.addEventListener("click", async () => {
    const out = host.querySelector("#poem-result");
    if (!input.value.trim()) return;
    go.disabled = true;
    out.innerHTML = `<p class="muted">Проверяем…</p>`;
    try {
      let res;
      if (state === "teacher") {
        // преподаватель проверяет без очков — тем же способом на устройстве
        const a = words(p.text), b = words(input.value);
        const lcs = (() => {
          let prev = new Uint16Array(b.length + 1);
          for (let i = 0; i < a.length; i++) {
            const cur = new Uint16Array(b.length + 1);
            for (let j = 0; j < b.length; j++) cur[j + 1] = a[i] === b[j] ? prev[j] + 1 : Math.max(prev[j + 1], cur[j]);
            prev = cur;
          }
          return prev[b.length];
        })();
        const acc = lcs / Math.max(a.length, b.length);
        res = { accuracy: acc, passed: acc >= 0.95, points: 0 };
      } else {
        const { data: r, error } = await supa.rpc("check_poem", { p_poem: p.id, p_text: input.value });
        if (error) throw error;
        res = r;
      }
      const pct = Math.round(res.accuracy * 100);
      out.innerHTML = `
        <p class="poem-score ${res.passed ? "is-ok" : ""}">${res.passed ? "Выучено! " : ""}Совпало ${pct}% слов${res.points ? ` · +${res.points} очков` : ""}</p>
        ${res.passed ? "" : `<p class="muted">Пропущенные или неверные слова выделены. Повтори их и попробуй ещё раз.</p>`}
        <div class="poem-diff">${diffHtml(p.text, input.value)}</div>`;
      if (res.passed) store(draftKey, "");
    } catch (err) {
      out.innerHTML = `<p class="lit-result is-bad">${escapeHtml(humanError(err))}</p>`;
    } finally {
      go.disabled = false;
    }
  });
}

/* ---------- тесты по статьям ---------- */

async function readListView(host) {
  const [qs, cat, me] = await Promise.all([quizzes(), catalog(), myReading()]);
  const works = new Map(cat.works.map((w) => [w.id, w]));
  const done = qs.filter((q) => me.passed.has(q.id)).length;
  host.innerHTML = `
    ${head("read", "Читать и отвечать", "Прочитай статью о книге на «Полке» — там коротко и интересно: о чём книга, как она написана, как её приняли. Потом ответь на вопросы. Засчитывается от 80% верных ответов, очки — один раз за статью.")}
    ${done ? `<p class="lib-learned">Пройдено: <strong>${done}</strong> из ${qs.length}</p>` : ""}
    <div class="lib-grid">
      ${qs
        .map((q) => {
          const w = works.get(q.work_id);
          return `
          <a class="lib-card" href="#/library/quiz/${q.id}">
            <span class="lib-card-author">${escapeHtml(w?.author || "")}</span>
            <strong>${escapeHtml(q.title)}</strong>
            <span class="lib-marks">
              <span class="lib-mark">${q.questions.length} ${ru(q.questions.length, "вопрос", "вопроса", "вопросов")}</span>
              ${me.passed.has(q.id) ? `<span class="lib-mark is-done">пройдено ✓</span>` : `<span class="lib-mark is-quiz">+${q.points}</span>`}
            </span>
          </a>`;
        })
        .join("")}
    </div>`;
}

function quizGate() {
  const state = accessState();
  if (state === "student" || state === "teacher") return "";
  if (state === "guest")
    return `<div class="gate card"><p class="eyebrow">Для учеников студии</p><h2>Ответы и очки — в личном кабинете</h2><p>Статью можно прочитать всем. Чтобы ответить на вопросы и получить очки, войдите как ученик студии.</p><p class="actions"><a class="btn" href="#/login">Войти</a></p></div>`;
  return `<div class="gate card"><p class="eyebrow">Почти готово</p><h2>Ждём подтверждения преподавателя</h2><p>Как только доступ откроется, здесь можно будет отвечать на вопросы и получать очки.</p></div>`;
}

async function quizView(host, id) {
  const [qs, cat, me] = await Promise.all([quizzes(), catalog(), myReading()]);
  const q = qs.find((x) => String(x.id) === String(id));
  if (!q) {
    host.innerHTML = `<div class="empty">Тест не найден. <a href="#/library/read">К списку</a></div>`;
    return;
  }
  const w = cat.works.find((x) => x.id === q.work_id);
  const polkaN = (q.url || "").match(/articles\/(\d+)/)?.[1];
  const gate = quizGate();
  const passed = me.passed.has(q.id);
  host.innerHTML = `
    <p class="crumbs"><a href="#/library/read">← Читать и отвечать</a>${w ? ` · <a href="#/library/w/${w.id}">${escapeHtml(w.title)}</a>` : ""}</p>
    <header class="lib-work-head">
      <p class="eyebrow">${escapeHtml(w?.author || "Тест по статье")}</p>
      <h1>${escapeHtml(q.title)}</h1>
      <p class="lede">${escapeHtml(q.intro || "Сначала прочитай статью целиком, потом отвечай. Под каждым вопросом есть ссылка на нужный раздел статьи.")}</p>
    </header>
    <p class="lib-actions">${q.url ? ext(q.url, "Открыть статью на «Полке» ↗", "btn") : ""}
      ${passed ? `<span class="lib-mark is-done">пройдено ✓</span>` : `<span class="lib-mark is-quiz">+${q.points} очков</span>`}</p>
    ${
      gate ||
      `<form class="quiz card" id="quiz">
        ${q.questions
          .map(
            (it, i) => `
          <fieldset class="quiz-q" data-i="${i}">
            <legend><span class="quiz-n">${i + 1}</span> ${escapeHtml(it.q)}</legend>
            ${it.o
              .map(
                (o, k) => `<label class="quiz-o"><input type="radio" name="q${i}" value="${k}" /> <span>${escapeHtml(o)}</span></label>`
              )
              .join("")}
            ${polkaN && it.b ? `<p class="quiz-hint">${ext(polkaUrl(polkaN, it.b), "Где искать ответ ↗")}</p>` : ""}
          </fieldset>`
          )
          .join("")}
        <p class="actions"><button class="btn" type="submit">Проверить</button></p>
        <div id="quiz-result" aria-live="polite"></div>
      </form>`
    }`;
  const form = host.querySelector("#quiz");
  if (!form) return;
  const draftKey = "quiz:" + q.id;
  const draft = store(draftKey) || {};
  Object.entries(draft).forEach(([i, v]) => {
    const el = form.querySelector(`input[name="q${i}"][value="${v}"]`);
    if (el) el.checked = true;
  });
  form.addEventListener("change", () => {
    const d = {};
    q.questions.forEach((_, i) => {
      const v = form.querySelector(`input[name="q${i}"]:checked`)?.value;
      if (v != null) d[i] = Number(v);
    });
    store(draftKey, d);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = form.querySelector("#quiz-result");
    const answers = q.questions.map((_, i) => {
      const v = form.querySelector(`input[name="q${i}"]:checked`)?.value;
      return v == null ? null : Number(v);
    });
    const empty = answers.findIndex((x) => x == null);
    if (empty >= 0) {
      out.innerHTML = `<p class="lit-result is-bad">Ответь на все вопросы — пропущен вопрос ${empty + 1}.</p>`;
      form.querySelector(`[data-i="${empty}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (accessState() === "teacher") {
      out.innerHTML = `<p class="muted">Преподаватель видит тест как ученик; ответы сохраняются только у учеников.</p>`;
      return;
    }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const { data: r, error } = await supa.rpc("submit_reading", { p_quiz: q.id, p_answers: answers });
      if (error) throw error;
      form.querySelectorAll(".quiz-o").forEach((l) => l.classList.remove("is-right", "is-wrong"));
      if (r.passed) {
        r.answers.forEach((k, i) => {
          form.querySelectorAll(`[data-i="${i}"] .quiz-o`).forEach((l, j) => {
            if (j === k) l.classList.add("is-right");
            else if (answers[i] === j) l.classList.add("is-wrong");
          });
        });
        store(draftKey, null);
        out.innerHTML = `<p class="lit-result is-ok">Засчитано: ${r.score} из ${r.total}${r.points ? ` · +${r.points} очков` : ""}.</p>`;
      } else {
        out.innerHTML = `<p class="lit-result is-bad">Верно ${r.score} из ${r.total}. Нужно не меньше ${Math.ceil(r.total * 0.8)}. Перечитай разделы статьи по ссылкам «Где искать ответ» и попробуй ещё раз.</p>`;
      }
    } catch (err) {
      out.innerHTML = `<p class="lit-result is-bad">${escapeHtml(humanError(err))}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- маршруты ---------- */

export function libraryPage() {
  return `<div class="lib-page" id="lib-root"><p class="lede muted">Открываем библиотеку…</p></div>`;
}

export async function mountLibrary(root, parts = []) {
  const host = root.querySelector("#lib-root");
  if (!host) return;
  const [a, b, c] = parts;
  document.body.classList.toggle("is-reading", a === "w" && !!c);
  try {
    if (!a) return await worksView(host);
    if (a === "w" && c) return await readerView(host, b, c);
    if (a === "w") return await workView(host, b);
    if (a === "poems" && b === "t") return await poemsView(host, c);
    if (a === "poems" && b) return await poemView(host, b);
    if (a === "poems") return await poemsView(host);
    if (a === "read") return await readListView(host);
    if (a === "quiz") return await quizView(host, b);
    host.innerHTML = `<div class="empty">Раздел не найден. <a href="#/library">К библиотеке</a></div>`;
  } catch (err) {
    console.error(err);
    host.innerHTML = `<div class="empty">Не удалось открыть библиотеку: ${escapeHtml(err.message)}</div>`;
  }
}

export const libraryTitle = (parts) =>
  parts[0] === "poems" ? "Стихи наизусть" : parts[0] === "read" || parts[0] === "quiz" ? "Читать и отвечать" : "Библиотека";
