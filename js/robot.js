// Робот-подсказчик «Лексик» в академической шапочке (левый нижний угол; правый занят «Пером»).
// Между подсказками выглядывает из-за края экрана (на телефоне — из-за нижнего меню).
// Сам выезжает с короткой подсказкой по разделу: правило или частая ошибка (русский), термин (литература),
// требование, критерий или совет (итоговое сочинение) — «… дня» при первом заходе, после ошибки и изредка в паузах.
// Нажали на него — меню: подсказка, «Проверь меня» (вопрос), интересный факт, «Поиграть» (трюки).
// Три подсказки подряд закрыли не читая — обижается и сидит в углу до завтра; нажали — радуется.
// Не заходили 3+ дня — встречает «Давно не виделись!».
// Никогда — в контрольных, занятиях, кабинете, во время написания сочинения и при вводе текста.
import { escapeHtml } from "./ui.js";
import { mark } from "./markup.js";
import { allRules } from "./content.js?v=land197";
import { BASE } from "./config.js";
import { currentProfile } from "./supa.js";
import { subjectsOf } from "./track.js?v=land197";

const KEY = "lx-robot";
const IDLE_GAP = 6 * 60e3; // не чаще раза в 6 минут сам по себе
const ERR_GAP = 4 * 60e3; // после ошибки — не чаще раза в 4 минуты
const DAY_MAX = 5; // и не больше 5 появлений в день
const IGNORE_MAX = 3; // три раза подряд закрыли или не стали читать — обижается до завтра
const MISSED_DAYS = 3; // столько дней не заходили — радуется встрече
const AUTO_HIDE = 30e3;

const HELLO_IDLE = ["Кстати!", "Минутка грамотности", "А вы знали?", "Небольшая подсказка", "Проверим себя?"];
const HELLO_ERR = ["Не беда! Вот что поможет", "Ошибка — это тоже шаг", "Давайте вспомним"];
const HELLO_MENU = ["Привет! Чем займёмся?", "Я тут! Что будем делать?", "О, вы меня нашли! Чем помочь?"];
const SAY_TAP = ["Ой!", "Хи-хи!", "Я тут!", "Ё-моё!", "Привет!", "Учимся!"];
const SAY_SULK = ["Хм…", "Ну и ладно…", "Не очень-то и хотелось…"];

const BOT = `<svg class="lr-svg" viewBox="0 0 72 92" aria-hidden="true">
  <g class="lr-body">
    <line x1="36" y1="22" x2="36" y2="26" class="lr-stroke"/>
    <rect x="13" y="24" width="46" height="32" rx="12" class="lr-shell"/>
    <rect x="19" y="30" width="34" height="20" rx="8" class="lr-screen"/>
    <g class="lr-eyes lr-eyes-on"><ellipse cx="29" cy="39" rx="3.2" ry="3.8"/><ellipse cx="43" cy="39" rx="3.2" ry="3.8"/></g>
    <g class="lr-eyes-alt lr-eyes-sad"><path d="M25 37 l7 3"/><path d="M47 37 l-7 3"/></g>
    <g class="lr-eyes-alt lr-eyes-joy"><path d="M25.5 40 q3.5 -5 7 0"/><path d="M39.5 40 q3.5 -5 7 0"/></g>
    <path d="M31 45 q5 3.5 10 0" class="lr-smile lr-mouth-on"/>
    <path d="M31 47 q5 -3.5 10 0" class="lr-smile lr-mouth-sad"/>
    <circle cx="11" cy="40" r="3.5" class="lr-shell"/><circle cx="61" cy="40" r="3.5" class="lr-shell"/>
    <g class="lr-capg">
      <path d="M36 4 L66 14 L36 24 L6 14 Z" class="lr-cap"/>
      <path d="M20 19 v6 q16 6 32 0 v-6" class="lr-cap"/>
      <g class="lr-tassel"><path d="M36 14 L58 18 L58 29" class="lr-cord"/><circle cx="58" cy="31" r="2.6" class="lr-bead"/></g>
    </g>
    <rect x="22" y="58" width="28" height="20" rx="7" class="lr-shell"/>
    <text x="36" y="73" text-anchor="middle" class="lr-letter">Ё</text>
    <path d="M22 63 q-8 2 -10 9" class="lr-arm lr-arm-l"/>
    <path d="M50 63 q8 2 10 9" class="lr-arm lr-arm-r"/>
    <path d="M21 64 q15 9 30 0 M51 64 q-15 9 -30 0" class="lr-arms-crossed"/>
  </g>
  <rect x="25" y="78" width="7" height="10" rx="3" class="lr-leg lr-leg-l"/>
  <rect x="40" y="78" width="7" height="10" rx="3" class="lr-leg lr-leg-r"/>
  <g class="lr-sparks"><path d="M4 10 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 z"/><path d="M64 30 l1.5 -4 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 z"/><path d="M8 52 l1 -3 l1 3 l3 1 l-3 1 l-1 3 l-1 -3 l-3 -1 z"/></g>
</svg>`;

// Интересные факты: только проверяемые, без спорных атрибуций.
const FACTS = {
  rus: [
    "Букву Ё предложила ввести княгиня Екатерина Дашкова, директор Петербургской академии наук, в 1783 году.",
    "Слово «спасибо» выросло из пожелания «спаси Бог».",
    "Слово «врач» родственно глаголу «врать», который в древности значил просто «говорить»: врач заговаривал болезнь.",
    "Слово «вокзал» пришло от названия Воксхолла — увеселительного сада под Лондоном.",
    "У глагола «победить» нет формы «я побежу» или «я победю». Говорят: «я одержу победу» или «я смогу победить».",
    "«А роза упала на лапу Азора» — палиндром: фраза одинаково читается слева направо и справа налево. Её Мальвина диктовала Буратино.",
    "После реформы 1917–1918 годов из алфавита ушли буквы «ять», «фита» и «и десятеричное».",
    "«Пальто», «кино», «метро» не склоняются: «в пальто», «без пальто» — и никакого «пальта».",
    "Слово «кофе» — мужского рода: «чёрный кофе». Средний род словари допускают только в разговорной речи.",
    "В слове «здравствуйте» есть непроизносимая В. Проверка — «здравие», «здравый».",
  ],
  lit: [
    "Пушкин писал «Евгения Онегина» больше семи лет — с 1823 по 1830 год.",
    "Гоголь сжёг рукопись второго тома «Мёртвых душ» незадолго до смерти, в 1852 году.",
    "Настоящая фамилия Максима Горького — Пешков.",
    "Ранние юмористические рассказы Чехов подписывал псевдонимом «Антоша Чехонте».",
    "Лермонтов был талантливым художником: он рисовал акварелью и маслом, в том числе виды Кавказа.",
    "Слово «нигилист» стало по-настоящему популярным после романа Тургенева «Отцы и дети».",
    "Достоевский надиктовал роман «Игрок» стенографистке Анне Сниткиной за 26 дней. Позже она стала его женой.",
  ],
};

// «Проверь меня» для итогового сочинения: верно или нет (по документам ФИПИ из раздела #/itog).
const ITOG_QUIZ = [
  { q: "Если в сочинении меньше 250 слов, его не проверяют и ставят «незачёт».", ok: true, why: "Это требование 1: меньше 250 слов — незачёт за всю работу. Рекомендуемый объём — от 350 слов." },
  { q: "Чтобы получить «зачёт», достаточно справиться с критериями К3, К4 и К5.", ok: false, why: "К1 (соответствие теме) и К2 (аргументация) обязательны, плюс зачёт хотя бы по одному из К3–К5." },
  { q: "Для аргументации достаточно одного литературного произведения.", ok: true, why: "По критерию К2 достаточно одного текста — важна глубина, а не количество." },
  { q: "Цифры при подсчёте слов тоже считаются.", ok: false, why: "Считаются все слова, включая предлоги и союзы, а цифры — нет." },
  { q: "Орфографическим словарём на итоговом сочинении пользоваться можно.", ok: true, why: "Да, это прямо разрешено (критерий К5 «Грамотность»)." },
  { q: "Можно выучить хорошее сочинение из интернета и воспроизвести его по памяти.", ok: false, why: "Требование 2 — самостоятельность: воспроизведение чужого текста по памяти — «незачёт» за всю работу." },
];

const store = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    } catch {
      return {};
    }
  },
  set(s) {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
  },
};
const today = () => new Date().toISOString().slice(0, 10);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let getContent = () => null;
let timer = null;
let hideTimer = null;
let observer = null;
let mountedOnce = false;
let state = null; // текущее содержимое облачка: { kind: "tip"|"menu"|"quiz"|"fact", spont, tip, ... }

// ——— Источники подсказок. Каждая подсказка: { id, topic, label, title, html, href, go } ———

const TOPIC = {
  rus: { day: "Правило дня", go: "Открыть правило" },
  lit: { day: "Термин дня", go: "В словарь" },
  itog: { day: "Совет дня к итоговому сочинению", go: "Подробнее" },
};
const cache = {};

function shortText(s, max = 210) {
  const parts = String(s || "").split(/(?<=[.!?])\s+/);
  let out = "";
  for (const p of parts) {
    if (out && (out + " " + p).length > max) break;
    out = out ? out + " " + p : p;
  }
  return out.length > max + 60 ? out.slice(0, max).replace(/\s+\S*$/, "") + "…" : out;
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

async function rusTips() {
  if (cache.rus) return cache.rus;
  const content = await getContent();
  if (!content) return [];
  const out = [];
  for (const r of allRules(content)) {
    const base = { topic: "rus", title: r.title, href: `#/rule/${encodeURIComponent(r.slug || r.id)}`, rule: r, go: TOPIC.rus.go };
    if (r.summary) out.push({ ...base, id: r.id, kind: "rule", label: "Правило", html: mark(shortText(r.summary)) });
    (r.typicalMistakes || []).forEach((m, i) => out.push({ ...base, id: `${r.id}#${i}`, kind: "trap", label: "Частая ошибка", html: mark(cap(m) + ".") }));
  }
  return (cache.rus = out);
}

async function litTips() {
  if (cache.lit) return cache.lit;
  try {
    const res = await fetch(new URL("js/literature-data/terms.json", new URL(BASE, location.href)));
    const data = await res.json();
    cache.lit = (data.terms || [])
      .filter((t) => t.definition && t.definition.length >= 25 && t.definition.length <= 320)
      .map((t) => {
        const def = t.definition.replace(/^это\s+/i, "").replace(/\.?\s*$/, ".");
        return {
          id: "lit:" + t.id,
          topic: "lit",
          kind: "term",
          label: "Термин" + (t.categoryTitle ? " · " + t.categoryTitle : ""),
          title: t.term,
          html: `<strong>${escapeHtml(t.term)}</strong> — ${escapeHtml(def)}`,
          href: `#/literature/terms/${encodeURIComponent(t.id)}`,
          go: TOPIC.lit.go,
        };
      });
  } catch {
    cache.lit = [];
  }
  return cache.lit;
}

async function itogTips() {
  if (cache.itog) return cache.itog;
  try {
    const d = await import("./itog-data.js?v=land197");
    const t = (id, label, title, text, href) => ({ id: "itog:" + id, topic: "itog", kind: "itog", label, title, html: escapeHtml(text), href, go: TOPIC.itog.go });
    cache.itog = [
      ...(d.REQUIREMENTS || []).flatMap((r, i) => [
        t(`req${i}`, r.code, r.name, r.text, "#/itog/criteria"),
        r.tip ? t(`reqtip${i}`, "Лайфхак", r.name, r.tip, "#/itog/criteria") : null,
      ]),
      ...(d.CRITERIA || []).flatMap((c) => [
        t(`${c.code}`, `Критерий ${c.code}${c.main ? " · обязательный" : ""}`, c.name, c.text, "#/itog/criteria"),
        c.fail ? { ...t(`${c.code}f`, `Ловушка · ${c.code}`, c.name, c.fail, "#/itog/criteria"), kind: "trap" } : null,
      ]),
      d.PASS_RULE ? t("pass", "Как получить зачёт", "Зачёт", d.PASS_RULE, "#/itog/criteria") : null,
      ...(d.PLAN || []).map(([head, text], i) => t(`plan${i}`, "План сочинения", head, text, "#/itog/how")),
      ...(d.CHECKLIST || []).map((text, i) => t(`check${i}`, "Проверьте себя", "Чек-лист перед сдачей", text, "#/itog/how")),
    ].filter(Boolean);
  } catch {
    cache.itog = [];
  }
  return cache.itog;
}
const SOURCES = { rus: rusTips, lit: litTips, itog: itogTips };

/** Какие темы доступны человеку: русский / литература по курсам, итоговое — 10–11 классам. */
function allowedTopics() {
  const p = currentProfile();
  const sub = subjectsOf(p);
  const c = p?.courses || [];
  const itog = !p || p.role === "teacher" || !c.length || c.some((x) => /:(10|11)$/.test(x));
  return ["rus", "lit", "itog"].filter((k) => (k === "itog" ? itog : sub[k]));
}

/** Тема по разделу сайта; на общих страницах (кабинет ученика и т. п.) — любая доступная. */
function pageTopics() {
  const h = location.hash || "";
  const ok = allowedTopics();
  let want = null;
  if (/^#\/(rules?|practice|exercise|trainer|ege|oge|vpr)\b/.test(h) && !/^#\/oge\/lit/.test(h)) want = "rus";
  else if (/^#\/(literature|library)\b/.test(h)) want = "lit";
  else if (/^#\/itog\b/.test(h)) want = "itog";
  if (want) return ok.includes(want) ? [want] : [];
  return ok;
}

/** Страницы, где робот не появляется: экзамен, занятия, кабинет, вход, лендинг, чтение. */
function quiet() {
  const h = location.hash || "#/";
  if (store.get().off) return true;
  if (document.body.classList.contains("is-landing") || document.body.classList.contains("is-reading")) return true;
  if (/^#\/?$|^#(about|prices|apply|learn|faq|teacher|reviews|contact|program-)/.test(h)) return true;
  if (/^#\/(lesson|check|cabinet|login|enter|me\/password|exam)/.test(h)) return true;
  if (/^#\/itog\/t\//.test(h)) return true; // пишет сочинение — не мешаем
  if (document.getElementById("exam-bar")) return true;
  return !pageTopics().length;
}

function typing() {
  const a = document.activeElement;
  return !!a && (a.matches("input:not([type=button]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable=true]") || !!a.closest("[contenteditable=true]"));
}

// Номер задания ЕГЭ → главы справочника (для подсказки по теме, когда рядом нет ссылки на правило)
const EGE_CHAPTERS = {
  5: ["stil-xxxv"], 6: ["stil-xxxv"],
  7: ["stil-xxxvi", "stil-xxxvii", "stil-xxxviii", "stil-xxxix", "stil-xl"],
  8: ["stil-xli", "stil-xlii", "stil-xliii", "stil-xliv", "stil-xlv", "stil-xlvi", "stil-xlvii", "stil-xlviii"],
  9: ["orfo-r1", "orfo-r2"], 10: ["ortho-v", "ortho-iv"], 11: ["ortho-vi", "ortho-vii", "ortho-viii", "ortho-xiv"],
  12: ["ortho-xii", "ortho-xiii"], 13: ["ortho-xvii"], 14: ["ortho-ix", "ortho-xiv", "ortho-xv", "ortho-xvi"],
  15: ["ortho-viii", "ortho-xiii"], 16: ["punct-xxii", "punct-xxviii"], 17: ["punct-xxiv", "punct-xxv"],
  18: ["punct-xxvi", "punct-xxvii"], 19: ["punct-xxix", "punct-xxx", "punct-xxxi"],
  20: ["punct-xxviii", "punct-xxix", "punct-xxxii"], 21: ["punct-xxi", "punct-xxxii", "punct-xxiv"],
};

/** Узкий пул по месту на странице: правило из ссылки рядом с заданием, глава по номеру ЕГЭ, текущий термин. */
function narrow(list, near) {
  const h = location.hash || "";
  // тренажёр терминов: объясняем термин, который ученик выбрал по ошибке, — с чем он спутал
  if (near?.matches?.(".lit-train-choice") && near.dataset.id) {
    const t = list.find((x) => x.id === "lit:" + near.dataset.id);
    if (t) return [{ ...t, label: "Вы выбрали этот термин — вот что он значит" }];
  }
  let m = h.match(/^#\/rule\/([^/?#]+)/);
  let slug = m ? decodeURIComponent(m[1]) : null;
  if (!slug) {
    const scope = near?.closest("section, article, .card, form") || document.querySelector("#main") || document;
    const a = scope.querySelector('a[href^="#/rule/"]') || (near ? null : document.querySelector('#main a[href^="#/rule/"]'));
    if (a) slug = decodeURIComponent(a.getAttribute("href").slice(7));
  }
  if (slug) {
    const hit = list.filter((t) => t.rule && (t.rule.slug === slug || t.rule.id === slug));
    if (hit.length) return hit;
  }
  m = h.match(/^#\/ege\/(\d+)/);
  const chapters = m && EGE_CHAPTERS[+m[1]];
  if (chapters) {
    const hit = list.filter((t) => t.rule && chapters.includes(t.rule.chapter.id));
    if (hit.length) return hit;
  }
  m = h.match(/^#\/literature\/terms\/(?!train)([^/?#]+)/);
  if (m) {
    const cur = list.find((t) => t.id === "lit:" + decodeURIComponent(m[1]));
    // на странице термина — соседний по теме, а не тот же самый
    const same = cur ? list.filter((t) => t.topic === "lit" && t.label === cur.label && t.id !== cur.id) : [];
    if (same.length) return same;
  }
  return null;
}

function dayHash(salt) {
  let h = 0;
  for (const c of today() + salt) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

async function chooseTip(reason, near) {
  const topics = pageTopics();
  if (!topics.length) return null;
  const s = store.get();
  const known = new Set(s.known || []);
  if (reason === "day") {
    // одно и то же «… дня» весь день, у всех; тема — раздел, где человек сейчас
    const topic = topics.length === 1 ? topics[0] : topics[dayHash("t") % topics.length];
    const list = (await SOURCES[topic]()).filter((t) => t.kind !== "trap");
    return list.length ? { ...list[dayHash(topic) % list.length], day: TOPIC[topic].day } : null;
  }
  const all = (await Promise.all(topics.map((k) => SOURCES[k]()))).flat();
  if (!all.length) return null;
  const pool = (reason !== "more" && narrow(all, near)) || all;
  const fresh = pool.filter((t) => !known.has(t.id) && t.id !== s.lastRule);
  return pick(fresh.length ? fresh : pool);
}

// ——— Робот на экране. Режимы корня: is-peek (выглядывает), is-sulk (обиделся), is-out (с облачком). ———

function el() {
  return document.getElementById("lr-root");
}

function sulking(s = store.get()) {
  return s.sulk === today();
}

/** Создаёт робота (если его нет) в режиме «выглядывает» или «обиделся». */
function park() {
  if (quiet()) return remove();
  let root = el();
  if (!root) {
    root = document.createElement("div");
    root.id = "lr-root";
    root.innerHTML = `<button class="lr-bot" type="button" aria-label="Робот Лексик">${BOT}</button><span class="lr-say" aria-hidden="true"></span><div class="lr-bubble" role="status" aria-live="polite" hidden></div>`;
    document.body.appendChild(root);
    bind(root);
  }
  clearTimeout(hideTimer);
  state = null;
  const sulk = sulking();
  root.className = "lr-root " + (sulk ? "is-sulk" : "is-peek");
  root.querySelector(".lr-bubble").hidden = true;
  root.querySelector(".lr-bot").title = sulk ? "Лексик обиделся. Может, поговорить с ним?" : "Лексик: нажмите, чтобы позвать";
  return root;
}

function remove() {
  clearTimeout(hideTimer);
  state = null;
  el()?.remove();
}

function say(text, ms = 1600) {
  const root = el();
  const b = root?.querySelector(".lr-say");
  if (!b) return;
  b.textContent = text;
  b.classList.remove("is-on");
  void b.offsetWidth;
  b.classList.add("is-on");
  clearTimeout(b._t);
  b._t = setTimeout(() => b.classList.remove("is-on"), ms);
}

/** Одноразовая анимация: jump, spin, hat, wave, shake, joy, nod. */
function act(name) {
  const root = el();
  if (!root || still()) return;
  root.classList.remove("do-jump", "do-spin", "do-hat", "do-wave", "do-shake", "do-joy", "do-nod");
  void root.offsetWidth;
  root.classList.add("do-" + name);
  clearTimeout(root._act);
  root._act = setTimeout(() => root.classList.remove("do-" + name), 1300);
}

/** Выйти из угла с облачком. html — содержимое облачка. */
function open(html, { spont = false } = {}) {
  const root = el() || park();
  if (!root) return;
  const bubble = root.querySelector(".lr-bubble");
  bubble.innerHTML = `<button class="lr-x" type="button" data-lr-close aria-label="Закрыть">×</button>${html}`;
  bubble.hidden = false;
  const wasOut = root.classList.contains("is-out");
  root.className = "lr-root is-out" + (wasOut || still() ? " is-talking" : " is-rising");
  if (!wasOut && !still())
    setTimeout(() => {
      if (!root.classList.contains("is-out")) return;
      root.classList.remove("is-rising");
      root.classList.add("is-talking");
    }, 650);
  root.querySelector(".lr-bot").title = "Нажмите — Лексик что-нибудь сделает";
  if (state) state.spont = spont;
  armAutoHide(root);
}

const FOOT = `<p class="lr-foot"><button type="button" data-lr-mute>Не сегодня</button> · <button type="button" data-lr-off>Выключить робота</button></p>`;

function tipHtml(tip, hello) {
  return `
      <p class="lr-hello">${escapeHtml(hello)}</p>
      <p class="lr-kicker">${escapeHtml(tip.label)}${tip.kind === "term" ? "" : " · " + escapeHtml(tip.title)}</p>
      <p class="lr-text">${tip.html}</p>
      <p class="lr-actions">
        <a class="btn" href="${tip.href}" data-lr-go>${escapeHtml(tip.go)}</a>
        <button class="btn secondary" type="button" data-lr-more>Ещё</button>
        <button class="btn secondary" type="button" data-lr-known>Знаю</button>
      </p>${FOOT}`;
}

function menuHtml(hello) {
  return `
      <p class="lr-hello">${escapeHtml(hello)}</p>
      <div class="lr-menu">
        <button type="button" data-lr-do="tip"><span aria-hidden="true">💡</span>Подсказка</button>
        <button type="button" data-lr-do="quiz"><span aria-hidden="true">❓</span>Проверь меня</button>
        <button type="button" data-lr-do="fact"><span aria-hidden="true">📜</span>Интересный факт</button>
        <button type="button" data-lr-do="play"><span aria-hidden="true">🎩</span>Поиграть</button>
      </div>${FOOT}`;
}

function helloFor(reason, tip) {
  if (reason === "day") return tip.day;
  if (reason === "error") return pick(HELLO_ERR);
  if (tip.topic === "itog") return pick(["Про итоговое сочинение", "Совет к сочинению", "Важно для зачёта"]);
  return pick(HELLO_IDLE);
}

async function showTip(reason = "idle", near = null, hello = null) {
  if (quiet()) return;
  const tip = await chooseTip(reason, near);
  if (!tip || quiet()) return;
  const spont = reason !== "ask";
  const s = store.get();
  if (spont) {
    const d = today();
    if (s.day !== d) Object.assign(s, { day: d, n: 0 });
    s.n = (s.n || 0) + 1;
    s.last = Date.now();
  }
  s.lastRule = tip.id;
  store.set(s);
  state = { kind: "tip", tip };
  open(tipHtml(tip, hello || (reason === "ask" ? pick(["Держите!", "Вот, пожалуйста", "Пожалуйста!"]) : helloFor(reason, tip))), { spont });
  act("wave");
}

/** Самостоятельное появление (по таймеру или после ошибки) — только из угла и без открытого облачка. */
async function show(reason = "idle", near = null) {
  const root = el();
  if (quiet() || root?.classList.contains("is-out")) return;
  if (sulking()) return;
  await showTip(reason, near);
}

// ——— «Проверь меня» ———

function gradeLevel() {
  const c = currentProfile()?.courses || [];
  const g = Math.max(0, ...c.map((x) => +(x.split(":")[1] || 0)));
  return g >= 10 || !g ? 10 : g >= 9 ? 9 : 8;
}

async function makeQuiz() {
  const topics = pageTopics();
  const topic = pick(topics.length ? topics : ["rus"]);
  if (topic === "itog") {
    const q = pick(ITOG_QUIZ);
    return { topic, q: q.q, o: ["Верно", "Неверно"], a: q.ok ? 0 : 1, why: q.why, href: "#/itog/criteria", go: "К критериям" };
  }
  if (topic === "lit") {
    const terms = (await litTips()).filter((t) => t.kind === "term");
    if (terms.length >= 3) {
      const right = pick(terms);
      const same = terms.filter((t) => t.id !== right.id && t.label === right.label);
      const pool = (same.length >= 2 ? same : terms.filter((t) => t.id !== right.id)).sort(() => Math.random() - 0.5).slice(0, 2);
      const opts = [right, ...pool].sort(() => Math.random() - 0.5);
      const def = right.html.split(" — ").slice(1).join(" — ");
      return { topic, q: "Какой термин подходит к определению?", sub: def, o: opts.map((t) => t.title), a: opts.indexOf(right), whyHtml: right.html, href: right.href, go: "В словарь", raw: true };
    }
  }
  const { RULE_QUESTIONS } = await import("./quiz-rules.js?v=land197");
  const lvl = gradeLevel();
  const s = store.get();
  const pool = RULE_QUESTIONS.filter((x) => x.level <= lvl && x.q + x.o.join() !== s.lastQuiz);
  const q = pick(pool.length ? pool : RULE_QUESTIONS);
  s.lastQuiz = q.q + q.o.join();
  store.set(s);
  return { topic: "rus", q: q.q, o: q.o, a: q.a, why: q.why, href: q.rule ? `#/rule/${encodeURIComponent(q.rule)}` : "", go: "К правилу" };
}

async function showQuiz() {
  const quiz = await makeQuiz();
  state = { kind: "quiz", quiz };
  open(`
      <p class="lr-hello">${pick(["Проверим?", "Вопрос на засыпку!", "А ну-ка!"])}</p>
      <p class="lr-q">${escapeHtml(quiz.q)}</p>
      ${quiz.sub ? `<p class="lr-text lr-def">${quiz.raw ? quiz.sub : escapeHtml(quiz.sub)}</p>` : ""}
      <div class="lr-opts">${quiz.o.map((o, i) => `<button type="button" data-lr-opt="${i}">${escapeHtml(o)}</button>`).join("")}</div>
      <div class="lr-why" hidden></div>`);
}

function answerQuiz(i) {
  const root = el();
  const quiz = state?.quiz;
  if (!root || !quiz || state.answered) return;
  state.answered = true;
  const ok = i === quiz.a;
  root.querySelectorAll("[data-lr-opt]").forEach((b) => {
    const k = +b.dataset.lrOpt;
    b.disabled = true;
    if (k === quiz.a) b.classList.add("is-ok");
    else if (k === i) b.classList.add("is-bad");
  });
  const why = root.querySelector(".lr-why");
  why.hidden = false;
  why.innerHTML = `<p><strong>${ok ? pick(["Верно! 🎉", "Точно!", "Браво!"]) : pick(["Почти! Смотрите:", "Не совсем.", "Ничего, запомним:"])}</strong> ${
    quiz.whyHtml || escapeHtml(quiz.why || "")
  }</p>
    <p class="lr-actions">${quiz.href ? `<a class="btn secondary" href="${quiz.href}" data-lr-go>${escapeHtml(quiz.go)}</a>` : ""}<button class="btn" type="button" data-lr-do="quiz">Ещё вопрос</button></p>`;
  const s = store.get();
  s.quizOk = (s.quizOk || 0) + (ok ? 1 : 0);
  store.set(s);
  if (ok) {
    act("joy");
    say(pick(["Ура!", "Умница!", "Так держать!"]));
  } else {
    act("nod");
    say(pick(["Бывает!", "Разберёмся!"]));
  }
}

// ——— Факт и игры ———

function showFact() {
  const topics = pageTopics().filter((t) => t !== "itog");
  const list = topics.length ? topics.flatMap((t) => FACTS[t] || []) : [...FACTS.rus, ...FACTS.lit];
  const s = store.get();
  const fresh = list.filter((f) => f !== s.lastFact);
  const fact = pick(fresh.length ? fresh : list);
  s.lastFact = fact;
  store.set(s);
  state = { kind: "fact" };
  open(`
      <p class="lr-hello">${pick(["А вы знали?", "Интересный факт", "Вот это да:"])}</p>
      <p class="lr-text">${escapeHtml(fact)}</p>
      <p class="lr-actions"><button class="btn" type="button" data-lr-do="fact">Ещё факт</button><button class="btn secondary" type="button" data-lr-do="menu">Назад</button></p>`);
  act("nod");
}

const TRICKS = [
  ["jump", "Хоп!"],
  ["spin", "Вжух!"],
  ["hat", "Шапочку — вверх!"],
  ["wave", "Привет-привет!"],
];
function trick() {
  const [name, text] = pick(TRICKS);
  act(name);
  say(text);
}

let taps = [];
function onBotTap() {
  const root = el();
  if (!root) return;
  const s = store.get();
  if (root.classList.contains("is-sulk")) {
    // обиделся — но рад, что на него обратили внимание
    delete s.sulk;
    s.ignored = 0;
    store.set(s);
    state = { kind: "menu" };
    open(menuHtml(pick(["Ой, вы со мной разговариваете? Ура! 🎉", "Я так и знал, что вы вернётесь! Чем займёмся?"])));
    act("joy");
    say("Ура!");
    return;
  }
  if (root.classList.contains("is-peek")) {
    state = { kind: "menu" };
    open(menuHtml(pick(HELLO_MENU)));
    act("wave");
    return;
  }
  // уже снаружи: трюк; три быстрых нажатия — щекотно
  const now = Date.now();
  taps = [...taps.filter((t) => now - t < 1200), now];
  if (taps.length >= 3) {
    taps = [];
    act("shake");
    say(pick(["Хи-хи, щекотно!", "Ай, щекотно!"]));
  } else trick();
  armAutoHide(root);
}

function close(byUser) {
  const root = el();
  if (!root) return;
  if (byUser && state?.kind === "tip" && state.spont) ignored();
  if (sulking()) {
    // обиделся: садится в угол
    park();
    act("nod");
    setTimeout(() => say(pick(SAY_SULK), 2600), 400);
    return;
  }
  park();
}

function ignored(s = store.get()) {
  s.ignored = (s.ignored || 0) + 1;
  if (s.ignored >= IGNORE_MAX) {
    s.sulk = today();
    s.ignored = 0;
  }
  store.set(s);
}

function armAutoHide(root) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!root.isConnected || !root.classList.contains("is-out")) return;
    if (root.matches(":hover") || root.contains(document.activeElement)) return armAutoHide(root);
    close(true); // не стал читать — это тоже «закрыл»
  }, AUTO_HIDE);
}

function bind(root) {
  root.addEventListener("mouseenter", () => root.classList.contains("is-out") && armAutoHide(root));
  root.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest(".lr-bot")) return onBotTap();
    const s = store.get();
    if (t.closest("[data-lr-close]")) return close(true);
    s.ignored = 0; // открыл, попросил ещё или ответил — общение ему нужно
    store.set(s);
    if (t.closest("[data-lr-go]")) return park();
    const opt = t.closest("[data-lr-opt]");
    if (opt) return answerQuiz(+opt.dataset.lrOpt);
    const d = t.closest("[data-lr-do]")?.dataset.lrDo;
    if (d === "tip") return showTip("ask");
    if (d === "quiz") return showQuiz();
    if (d === "fact") return showFact();
    if (d === "menu") {
      state = { kind: "menu" };
      return open(menuHtml(pick(HELLO_MENU)));
    }
    if (d === "play") return trick();
    if (t.closest("[data-lr-known]") && state?.tip) {
      s.known = [...new Set([...(s.known || []), state.tip.id])].slice(-600);
      store.set(s);
      say("Запомнил!");
      return park();
    }
    if (t.closest("[data-lr-mute]")) {
      s.mute = today();
      store.set(s);
      say("До завтра!");
      return park();
    }
    if (t.closest("[data-lr-off]")) {
      s.off = true;
      store.set(s);
      return remove();
    }
    if (t.closest("[data-lr-more]")) return showTip("more");
  });
}

function allowed(gap) {
  const s = store.get();
  if (s.off || s.mute === today() || sulking(s)) return false;
  if (s.day === today() && (s.n || 0) >= DAY_MAX) return false;
  return Date.now() - (s.last || 0) >= gap;
}

function tick() {
  if (quiet()) return remove();
  if (!el()) park();
  if (document.hidden || el()?.classList.contains("is-out") || typing()) return;
  const s = store.get();
  if (s.off) return;
  // давно не заходил — радуемся встрече (один раз), заодно «… дня»
  const d = today();
  if (s.seen && s.seen !== d && (Date.parse(d) - Date.parse(s.seen)) / 864e5 >= MISSED_DAYS && s.missedFor !== d) {
    s.missedFor = d;
    s.dayShown = d;
    s.seen = d;
    delete s.sulk;
    store.set(s);
    showTip("day", null, pick(["Давно не виделись! Я соскучился 🎉", "Ура, вы вернулись! Я скучал"])).then(() => {
      act("joy");
      say("Ура!");
    });
    return;
  }
  if (s.seen !== d) {
    s.seen = d;
    store.set(s);
  }
  if (s.mute === d || sulking(s)) return;
  if (s.dayShown !== d) {
    s.dayShown = d;
    store.set(s);
    show("day");
    return;
  }
  if (allowed(IDLE_GAP)) show("idle");
}

const BAD = ".bad, .wrong, .trainer-feedback.bad, .lit-train-choice.is-bad";
const isOut = () => !!el()?.classList.contains("is-out");
function watchErrors() {
  observer?.disconnect();
  observer = new MutationObserver((muts) => {
    if (isOut() || quiet() || !allowed(ERR_GAP)) return;
    for (const m of muts) {
      let hit = null;
      if (m.type === "attributes") {
        const t = m.target;
        if (t.matches?.(BAD) && !/\b(is-bad|bad|wrong)\b/.test(m.oldValue || "")) hit = t;
      } else {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1 || n.closest?.("#lr-root")) continue;
          hit = n.matches(BAD) ? n : n.querySelector(BAD);
          if (hit) break;
        }
      }
      if (hit) {
        // даём прочитать «Пока неверно» и разбор, потом выезжаем
        setTimeout(() => !isOut() && show("error", hit), 1800);
        return;
      }
    }
  });
  window.addEventListener("lx:answer", (e) => {
    if (e.detail?.correct !== false) return;
    if (isOut() || quiet() || !allowed(ERR_GAP)) return;
    setTimeout(() => !isOut() && !document.querySelector("#main .th-tip") && show("error"), 1800);
  });
  const app = document.getElementById("app") || document.body;
  observer.observe(app, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
}

/** Включить робота снова (из помощника «Перо»). */
export function robotOff() {
  return !!store.get().off;
}
export function enableRobot() {
  const s = store.get();
  delete s.off;
  delete s.mute;
  delete s.sulk;
  s.ignored = 0;
  store.set(s);
  setTimeout(() => {
    if (quiet()) return;
    park();
    state = { kind: "menu" };
    open(menuHtml("Ура, я снова с вами! Чем займёмся?"));
    act("joy");
  }, 400);
}

/** Вызывается после каждой отрисовки страницы. contentGetter — промис с содержимым справочника. */
export function mountRobot(contentGetter) {
  if (contentGetter) getContent = contentGetter;
  if (quiet()) remove();
  else if (!isOut()) park();
  if (mountedOnce) return;
  mountedOnce = true;
  watchErrors();
  window.addEventListener("hashchange", () => setTimeout(() => (quiet() ? remove() : !el() && park()), 0));
  clearInterval(timer);
  setTimeout(tick, 5000); // первое «… дня» — через несколько секунд после входа
  timer = setInterval(tick, 20e3);
  // для проверки вручную из консоли
  window.lxRobot = { show, tip: showTip, quiz: showQuiz, fact: showFact, trick, park, sulk: () => (ignored({ ...store.get(), ignored: IGNORE_MAX - 1 }), close(false)) };
}
