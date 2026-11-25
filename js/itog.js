/**
 * Итоговое сочинение (декабрьское) — #/itog.
 *  #/itog            — о сочинении, сроки, структура банка тем
 *  #/itog/criteria   — требования и критерии
 *  #/itog/how        — как писать + два разобранных сочинения
 *  #/itog/texts      — рекомендованные тексты по подразделам (#/itog/texts?s=1.2)
 *  #/itog/topics     — темы: образец ФИПИ и темы для тренировки
 *  #/itog/t/<id>     — написать тренировочное сочинение и сдать преподавателю
 * Открыто всем; сдать сочинение могут ученики (задания source «itog» в базе).
 */
import { escapeHtml } from "./ui.js";
import { currentUser, supa } from "./supa.js";
import { bindWritten, writtenBlockHtml } from "./practice.js?v=land195";
import { bzDayStart } from "./tz.js?v=land195";
import {
  CHECKLIST, CRITERIA, EXAMPLES, NEW_LIT_TOPICS, PASS_RULE, PLAN, REQUIREMENTS, SAMPLE_SET, SECTIONS, SUB_TITLE, TEXTS, TRAINING_TOPICS, itogDates,
} from "./itog-data.js?v=land195";

const ROOT = "#/itog";
const TABS = [
  ["", "Что это"],
  ["criteria", "Критерии"],
  ["how", "Как писать"],
  ["texts", "Тексты по темам"],
  ["topics", "Темы и тренировка"],
];

function ru(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
const fmtDay = (d) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" });
const countWords = (t) => (String(t || "").match(/[A-Za-zА-Яа-яЁё]+(?:-[A-Za-zА-Яа-яЁё]+)*/g) || []).length;

/** Ближайший срок и сколько дней до него. */
export function nextItog(now = new Date()) {
  const today = bzDayStart(now).getTime();
  const next = itogDates(now).find((d) => bzDayStart(d.when).getTime() >= today);
  if (!next) return null;
  const days = Math.round((bzDayStart(next.when).getTime() - today) / 86400000);
  return { ...next, days };
}

function shell(active, body) {
  const nx = nextItog();
  return `
    <header class="lib-head is-head">
      <p class="eyebrow">11 класс · допуск к ЕГЭ</p>
      <h1>Итоговое сочинение</h1>
      <p class="lede">Всё для подготовки в одном месте: как устроены темы, по каким критериям ставят «зачёт», как писать, какие тексты закрывают какие темы — и тренировочные сочинения с проверкой преподавателем.</p>
      ${nx ? `<p class="is-count"><strong>${nx.days ? `${nx.days} ${ru(nx.days, "день", "дня", "дней")}` : "Сегодня"}</strong> ${nx.days ? "до" : ""} ${nx.label === "основной срок" ? "основного срока" : "дополнительного срока"} — ${escapeHtml(fmtDay(nx.when))}</p>` : ""}
    </header>
    <nav class="filter-bar lib-tabs" aria-label="Разделы">${TABS.map(
      ([id, t]) => `<a class="pill ${active === id ? "active" : ""}" href="${ROOT}${id ? "/" + id : ""}">${t}</a>`
    ).join("")}</nav>
    ${body}`;
}

/* ---------------- Что это ---------------- */
function aboutHtml() {
  const dates = itogDates();
  return `
    <section class="me-section is-facts">
      <div class="is-fact"><strong>Зачёт / незачёт</strong><span>Без зачёта не допускают к ЕГЭ. Для 10 класса — тренировка заранее.</span></div>
      <div class="is-fact"><strong>3 ч 55 мин</strong><span>Можно пользоваться орфографическим словарём.</span></div>
      <div class="is-fact"><strong>от 350 слов</strong><span>Меньше 250 — сразу незачёт.</span></div>
      <div class="is-fact"><strong>6 тем на выбор</strong><span>По две из каждого раздела банка; пишете одну.</span></div>
    </section>
    <section class="me-section">
      <h2>Сроки</h2>
      <ul class="is-dates">${dates.map((d) => `<li><strong>${escapeHtml(fmtDay(d.when))}</strong> — ${d.label}</li>`).join("")}</ul>
      <p class="muted">По традиции: первая среда декабря, первая среда февраля и вторая среда апреля. Точные даты — в расписании Рособрнадзора. Пересдать в дополнительный срок можно, если получен «незачёт».</p>
    </section>
    <section class="me-section">
      <h2>Откуда берутся темы</h2>
      <p>Закрытый банк — более 2000 тем. В комплекте шесть тем: <b>1–2</b> из первого раздела, <b>3–4</b> из второго, <b>5–6</b> из третьего. Конкретные темы заранее не известны, поэтому готовиться нужно по разделам: подобрать к каждому подразделу 2–3 хорошо знакомых текста.</p>
      ${SECTIONS.map(
        (s) => `
        <details class="card is-sec" ${s.n === 1 ? "open" : ""}>
          <summary><b>Раздел ${s.n}.</b> ${escapeHtml(s.title)} <span class="muted">· темы ${s.n * 2 - 1}–${s.n * 2}</span></summary>
          <ul class="is-subs">${s.subs.map(([c, t]) => `<li><a href="${ROOT}/texts?s=${c}"><b>${c}</b> ${escapeHtml(t)}</a></li>`).join("")}</ul>
          <p class="muted">Темы раздела:</p>
          <ul class="is-about">${s.about.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
        </details>`
      ).join("")}
    </section>
    <section class="me-section">
      <h2>С чего начать</h2>
      <ol class="is-steps">
        <li>Прочитайте <a href="${ROOT}/criteria">критерии</a>: главное — ответить на вопрос темы (К1) и доказать ответ литературой (К2).</li>
        <li>Посмотрите <a href="${ROOT}/how">план и два разобранных сочинения</a> — зачётное и незачётное на одну тему.</li>
        <li>Соберите свой «запас» в <a href="${ROOT}/texts">текстах по темам</a>: небольшие произведения можно прочитать за вечер.</li>
        <li>Напишите <a href="${ROOT}/topics">тренировочное сочинение</a> — преподаватель проверит по критериям итогового.</li>
      </ol>
    </section>`;
}

/* ---------------- Критерии ---------------- */
function criteriaHtml() {
  return `
    <section class="me-section">
      <h2>Сначала — два требования</h2>
      <p class="muted">Работа, не выполнившая хотя бы одно, получает «незачёт» и по критериям не проверяется.</p>
      ${REQUIREMENTS.map((r) => `<div class="card is-crit"><p class="is-crit-h"><b>${r.code}.</b> ${escapeHtml(r.name)}</p><p>${escapeHtml(r.text)}</p><p class="muted">${escapeHtml(r.tip)}</p></div>`).join("")}
    </section>
    <section class="me-section">
      <h2>Пять критериев</h2>
      <p class="is-rule">${escapeHtml(PASS_RULE)}</p>
      ${CRITERIA.map(
        (c) => `<div class="card is-crit ${c.main ? "is-main" : ""}">
          <p class="is-crit-h"><b>${c.code}.</b> ${escapeHtml(c.name)} ${c.main ? '<span class="chip is-hot">основной</span>' : ""}</p>
          <p>${escapeHtml(c.text)}</p>
          <p class="muted">${escapeHtml(c.fail)}</p>
        </div>`
      ).join("")}
    </section>
    <section class="me-section">
      <h2>Что можно привлекать</h2>
      <p>Опубликованные произведения: художественную литературу, устное народное творчество (кроме малых жанров — пословиц, загадок), документальную, мемуарную, публицистическую, научную и научно-популярную литературу, дневники, очерки, критику — отечественную и мировую. <b>Достаточно одного текста</b>: важна глубина раскрытия темы, а не количество.</p>
      <p class="muted">Фильмы, сериалы, игры и «случаи из жизни» литературным материалом не считаются — их можно добавить к аргументу, но опора должна быть на текст.</p>
    </section>`;
}

/* ---------------- Как писать ---------------- */
function essayHtml(ex, cls) {
  return `
    <article class="card is-essay ${cls}">
      <p class="is-essay-h"><span class="chip ${cls === "is-good" ? "is-ok" : "is-hot"}">${escapeHtml(ex.verdict)}</span> <span class="muted">${countWords(ex.text)} слов</span></p>
      <div class="is-essay-text">${ex.text.split(/\n\s*\n/).map((p) => `<p>${escapeHtml(p.trim())}</p>`).join("")}</div>
      <div class="is-notes">${ex.notes.map(([k, t]) => `<p><b>${escapeHtml(k)}.</b> ${escapeHtml(t)}</p>`).join("")}</div>
    </article>`;
}
function howHtml() {
  return `
    <section class="me-section">
      <h2>План на 350–400 слов</h2>
      <ol class="is-plan">${PLAN.map(([h, t]) => `<li><b>${escapeHtml(h)}.</b> ${escapeHtml(t)}</li>`).join("")}</ol>
    </section>
    <section class="me-section">
      <h2>Проверьте себя перед сдачей</h2>
      <ul class="is-check">${CHECKLIST.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
    </section>
    <section class="me-section">
      <h2>Одна тема — два сочинения</h2>
      <p class="is-topic">«${escapeHtml(EXAMPLES.topic)}»</p>
      <p class="muted">Оба сочинения написаны грамотно и по одному роману. Разница — в том, отвечает ли автор на вопрос темы и доказывает ли ответ эпизодами.</p>
      <div class="is-pair">${essayHtml(EXAMPLES.good, "is-good")}${essayHtml(EXAMPLES.bad, "is-bad")}</div>
    </section>`;
}

/* ---------------- Тексты ---------------- */
function textHref(x) {
  if (x.w) return `#/library/w/${x.w}${x.ch ? "/" + x.ch : ""}`;
  return x.href || "";
}
/** Где читать: на сайте / онлайн по ссылке / только рекомендация (описание). */
function availability(x) {
  const href = textHref(x);
  if (href.startsWith("#")) return "site";
  if (href && !href.includes("wikipedia")) return "online";
  return "info";
}
const AV = {
  site: ["На сайте", "текст в библиотеке студии"],
  online: ["Онлайн", "читать на другом сайте"],
  info: ["Рекомендуем", "текста онлайн нет — только описание"],
};
function linkLabel(href) {
  if (href.includes("lib.ru")) return "Читать в библиотеке Мошкова ↗";
  if (href.includes("books.yandex")) return "Читать в Яндекс Книгах ↗";
  return "Читать текст ↗";
}
function readTime(min) {
  if (min <= 60) return `≈ ${min} мин`;
  if (min <= 300) return `≈ ${Math.round(min / 60)} ч`;
  return "большой роман";
}
function textCard(x, active) {
  const href = textHref(x);
  const av = availability(x);
  // закладка читалки (lib:pos:<id>): для сборников — только если остановились в той же главе
  let bm = null;
  try {
    bm = x.w ? JSON.parse(localStorage.getItem("lib:pos:" + x.w) || "null") : null;
  } catch {}
  const cont = bm?.ch && (!x.ch || bm.ch === x.ch) && (bm.p > 0 || bm.pct > 0) ? bm : null;
  const action =
    av === "site"
      ? cont
        ? `<a class="btn" href="#/library/w/${x.w}/${cont.ch}" data-return>Продолжить чтение${cont.pct ? ` · ${cont.pct}%` : ""}</a>`
        : `<a class="btn" href="${escapeHtml(href)}" data-return>Читать на сайте</a>`
      : av === "online"
        ? `<a class="btn secondary" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${linkLabel(href)}</a>`
        : href
          ? `<a class="linklike muted" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">О произведении ↗</a>`
          : "";
  return `<article class="card is-text is-av-${av}" data-av="${av}" data-min="${x.min}" data-n="${x.subs.length}" data-a="${escapeHtml(x.a.split(" ").pop())}" data-t="${escapeHtml(x.t)}">
    <p class="is-text-h"><span class="is-av" title="${escapeHtml(AV[av][1])}">${AV[av][0]}</span><span class="muted">${escapeHtml(x.a)}</span> <strong>«${escapeHtml(x.t)}»</strong></p>
    <p class="is-text-meta"><span class="lib-mark">${escapeHtml(x.size)}</span> <span class="lib-mark">${readTime(x.min)}</span>
      ${x.subs.map((s) => `<a class="lib-mark ${s === active ? "is-focus" : ""}" href="${ROOT}/texts?s=${s}" title="${escapeHtml(SUB_TITLE[s] || "")}">${s}</a>`).join("")}</p>
    <p><b>Что доказывает:</b> ${escapeHtml(x.idea)}</p>
    <p class="muted"><b>Как использовать:</b> ${escapeHtml(x.use)}</p>
    ${action ? `<p class="actions">${action}</p>` : ""}
  </article>`;
}

const SORTS = [
  ["len", "Сначала короткие"],
  ["topics", "Больше тем — выше"],
  ["author", "По автору"],
  ["title", "По названию"],
];
function textsState() {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  return { s: q.get("s") || "", av: q.get("av") || "", sort: q.get("sort") || "len", small: q.get("small") === "1" };
}
function stateHash(st) {
  const q = new URLSearchParams();
  if (st.s) q.set("s", st.s);
  if (st.av) q.set("av", st.av);
  if (st.sort && st.sort !== "len") q.set("sort", st.sort);
  if (st.small) q.set("small", "1");
  const qs = q.toString();
  return `${ROOT}/texts${qs ? "?" + qs : ""}`;
}
function textsList(st) {
  const cmp = {
    len: (a, b) => a.min - b.min,
    topics: (a, b) => b.subs.length - a.subs.length || a.min - b.min,
    author: (a, b) => a.a.split(" ").pop().localeCompare(b.a.split(" ").pop(), "ru") || a.t.localeCompare(b.t, "ru"),
    title: (a, b) => a.t.localeCompare(b.t, "ru"),
  }[st.sort] || ((a, b) => a.min - b.min);
  const bySub = TEXTS.filter((x) => !st.s || x.subs.includes(st.s));
  const shown = bySub.filter((x) => (!st.av || availability(x) === st.av) && (!st.small || x.min <= 120)).sort(cmp);
  const counts = { site: 0, online: 0, info: 0 };
  bySub.forEach((x) => counts[availability(x)]++);
  return { bySub, shown, counts };
}
function textsHtml(st) {
  const subChips = SECTIONS.map(
    (s) => `<div class="is-subpick"><span class="muted">Раздел ${s.n}:</span> ${s.subs
      .map(([c, t]) => `<a class="pill ${c === st.s ? "active" : ""}" href="${stateHash({ ...st, s: c })}" title="${escapeHtml(t)}">${c} ${escapeHtml(t.split(/[,;(]/)[0])}</a>`)
      .join("")}</div>`
  ).join("");
  return `
    <section class="me-section">
      <p>Один хорошо знакомый текст закрывает несколько тем: «Судьба человека» подойдёт и к достоинству (1.1), и к милосердию (1.2), и к семье (2.1), и к Родине (2.3). Выберите подраздел — останутся подходящие тексты.</p>
      ${subChips}
      ${st.s ? `<p class="is-active"><b>${st.s}</b> ${escapeHtml(SUB_TITLE[st.s] || "")} · <a href="${stateHash({ ...st, s: "" })}">все подразделы</a></p>` : ""}
      <div class="is-controls" id="is-controls"></div>
      <div class="is-texts" id="is-texts"></div>
      <p class="muted is-legend"><span class="is-av is-av-site">На сайте</span> — текст в <a href="#/library">библиотеке</a> студии (общественное достояние).
        <span class="is-av is-av-online">Онлайн</span> — бесплатно на другом сайте: библиотека Мошкова или Яндекс Книги (текст защищён авторским правом, поэтому не у нас).
        <span class="is-av is-av-info">Рекомендуем</span> — текста онлайн нет, есть описание; книга — в любой библиотеке.</p>
    </section>`;
}
function bindTexts(host) {
  const draw = () => {
    const st = textsState();
    const { bySub, shown, counts } = textsList(st);
    const pill = (av, label, n) => `<button type="button" class="pill ${st.av === av ? "active" : ""}" data-av="${av}">${label}${n != null ? ` <span class="muted">${n}</span>` : ""}</button>`;
    host.querySelector("#is-controls").innerHTML = `
      <div class="is-avpick" role="group" aria-label="Где читать">${pill("", "Все", bySub.length)}${pill("site", "На сайте", counts.site)}${pill("online", "Онлайн", counts.online)}${pill("info", "Рекомендуем", counts.info)}</div>
      <label class="is-sort">Порядок <select id="is-sort">${SORTS.map(([v, t]) => `<option value="${v}" ${st.sort === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="lib-check"><input type="checkbox" id="is-small" ${st.small ? "checked" : ""} /> до 2 часов чтения</label>
      <span class="muted">${shown.length} ${ru(shown.length, "текст", "текста", "текстов")}</span>`;
    host.querySelector("#is-texts").innerHTML = shown.map((x) => textCard(x, st.s)).join("") || '<p class="empty">Под эти условия текстов нет — снимите какой-нибудь фильтр.</p>';
  };
  const set = (patch) => {
    history.replaceState(null, "", location.pathname + location.search + stateHash({ ...textsState(), ...patch }));
    draw();
  };
  host.addEventListener("click", (e) => {
    const b = e.target.closest("#is-controls [data-av]");
    if (b) set({ av: b.dataset.av });
    // уходим читать на сайте — запоминаем, куда вернуться (библиотека покажет ссылку «← Итоговое сочинение»)
    if (e.target.closest("[data-return]")) {
      try {
        sessionStorage.setItem("lx-return", JSON.stringify({ href: location.hash, label: "Итоговое сочинение · тексты", at: Date.now() }));
      } catch {}
    }
  });
  host.addEventListener("change", (e) => {
    if (e.target.id === "is-sort") set({ sort: e.target.value });
    if (e.target.id === "is-small") set({ small: e.target.checked });
  });
  draw();
}

/* ---------------- Темы ---------------- */
async function topicsTasks() {
  if (!currentUser()) return [];
  const { data } = await supa.from("tasks").select("id, source_ref, task_no, topic, data").eq("source", "itog").order("position");
  return data || [];
}
async function topicsHtml() {
  const tasks = await topicsTasks().catch(() => []);
  const canWrite = tasks.length > 0;
  const byText = new Map(tasks.map((t) => [String(t.data?.questionText || "").trim(), t]));
  const row = (text, extra = "") => {
    const t = byText.get(text.trim());
    return `<li class="is-topic-row"><span>${extra}${escapeHtml(text)}</span>${t ? `<a class="btn secondary" href="${ROOT}/t/${t.id}">Написать</a>` : ""}</li>`;
  };
  const training = (n) => tasks.filter((t) => t.task_no === n && String(t.source_ref).startsWith("is-t"));
  return `
    ${!canWrite ? `<div class="gate card"><p>${currentUser() ? "Тренировочные сочинения появятся здесь, когда преподаватель откроет доступ." : `Чтобы написать тренировочное сочинение и сдать его на проверку, <a href="#/login?next=${encodeURIComponent(ROOT + "/topics")}">войдите</a>.`}</p></div>` : ""}
    <section class="me-section">
      <h2>Образец комплекта ФИПИ (2025/26)</h2>
      <p class="muted">Так выглядит лист с темами на самом сочинении: шесть тем, по две из каждого раздела.</p>
      <ol class="is-topics">${SAMPLE_SET.map(([no, , text]) => row(text, `<span class="muted">${no}</span> `)).join("")}</ol>
    </section>
    <section class="me-section">
      <h2>Новые литературные формулировки (3.3)</h2>
      <ul class="is-topics">${NEW_LIT_TOPICS.map((text) => row(text)).join("")}</ul>
    </section>
    ${SECTIONS.map(
      (s) => `<section class="me-section">
        <h2>Тренировка · раздел ${s.n}</h2>
        <p class="muted">${escapeHtml(s.title)} · <a href="${ROOT}/texts?s=${s.subs[0][0]}">тексты к разделу</a></p>
        <ul class="is-topics">${
          canWrite
            ? training(s.n).map((t) => row(String(t.data?.questionText || ""))).join("")
            : TRAINING_TOPICS.filter(([n]) => n === s.n).map(([, text]) => row(text)).join("")
        }</ul>
      </section>`
    ).join("")}`;
}

/* ---------------- Написать сочинение ---------------- */
async function writeView(host, id) {
  // адрес — id задания или его source_ref (is-t-01…): так ссылки из кабинета и уроков ведут сюда же
  const q = supa.from("tasks").select("id, source, task_no, topic, data").eq("source", "itog");
  const { data: t } = await (/^\d+$/.test(String(id)) ? q.eq("id", Number(id)) : q.eq("source_ref", decodeURIComponent(String(id)))).maybeSingle();
  if (!t || t.source !== "itog") {
    host.innerHTML = shell("topics", `<div class="empty">Тема не найдена или недоступна. <a href="${ROOT}/topics">К темам</a></div>`);
    return;
  }
  const sec = SECTIONS.find((s) => s.n === t.task_no);
  const problem = { _tid: t.id, questionHtml: t.data?.questionHtml || `<p>${escapeHtml(t.data?.questionText || "")}</p>`, answerKind: "essay" };
  host.innerHTML = `
    <p class="crumbs"><a href="${ROOT}/topics">← Темы итогового сочинения</a></p>
    <p class="eyebrow">Итоговое сочинение · ${sec ? `раздел ${sec.n}` : "тренировка"}</p>
    <h1 class="is-write-topic">${escapeHtml(t.data?.questionText || t.topic || "")}</h1>
    <div class="is-write">
      <div>
        <p class="is-words" id="is-words" aria-live="polite"></p>
        ${writtenBlockHtml({ label: "Сочинение" })}
      </div>
      <aside class="card is-aside">
        <p><b>Перед сдачей</b></p>
        <ul class="is-check">${CHECKLIST.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
        ${sec ? `<p><a href="${ROOT}/texts?s=${sec.subs[0][0]}">Тексты к разделу ${sec.n} →</a></p>` : ""}
        <p class="muted">Преподаватель проверит по критериям итогового: К1–К5, «зачёт» / «незачёт».</p>
      </aside>
    </div>`;
  bindWritten(host, problem, { label: "Сочинение", solutionTitle: "Пояснение" });
  // счётчик слов по правилам итогового: меньше 250 — незачёт, рекомендуется от 350
  const out = host.querySelector("#is-words");
  const upd = () => {
    const ta = host.querySelector("#pr-essay");
    if (!ta || !out) return;
    const n = countWords(ta.value);
    out.className = `is-words ${n >= 350 ? "is-ok" : n >= 250 ? "is-mid" : "is-low"}`;
    out.textContent = n ? `${n} ${ru(n, "слово", "слова", "слов")} · ${n >= 350 ? "объём в норме" : n >= 250 ? `зачёт по объёму есть, до рекомендуемых 350 — ещё ${350 - n}` : `меньше 250 — это незачёт; ещё ${250 - n}`}` : "Рекомендуемый объём — от 350 слов, меньше 250 — незачёт.";
  };
  host.addEventListener("input", (e) => e.target.id === "pr-essay" && upd());
  new MutationObserver(upd).observe(host.querySelector("#pr-work"), { childList: true, subtree: true });
  upd();
}

export function itogPage() {
  return `<div class="is-page" id="is-root"><p class="muted">Загружаем…</p></div>`;
}

/** parts — части адреса после #/itog */
export async function mountItog(root, parts = []) {
  const host = root.querySelector("#is-root");
  if (!host) return;
  const [tab = "", arg] = parts;
  const q = new URLSearchParams((location.hash.split("?")[1] || ""));
  let title = "Итоговое сочинение";
  if (tab === "t" && arg) {
    await writeView(host, arg);
    title = "Итоговое сочинение · тренировка";
  } else if (tab === "criteria") host.innerHTML = shell(tab, criteriaHtml());
  else if (tab === "how") host.innerHTML = shell(tab, howHtml());
  else if (tab === "texts") {
    host.innerHTML = shell(tab, textsHtml(textsState()));
    bindTexts(host);
  } else if (tab === "topics") host.innerHTML = shell(tab, await topicsHtml());
  else host.innerHTML = shell("", aboutHtml());
  document.title = `${title} — Студия Лексикон`;
  window.scrollTo(0, 0);
}

/** Для главной ученика: показывать ли раздел (10–11 класс по курсам или классу). */
export function itogFor(profile) {
  if (!profile) return false;
  if (profile.role === "teacher") return true;
  const g = (profile.courses || []).map((c) => Number(String(c).split(":")[1]));
  return g.some((n) => n >= 10) || Number(profile.grade) >= 10;
}
