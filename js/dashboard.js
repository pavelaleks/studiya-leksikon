/**
 * Кабинет ученика как место, куда хочется возвращаться:
 * уровень и очки, серия дней, цель дня, «что дальше», тренировка дня, свой пробный экзамен, значки.
 * Очки начисляет сервер (таблица xp_events), здесь — только показ и подсказки.
 */
import { escapeHtml } from "./ui.js";
import { currentTrack } from "./track.js?v=land196";
import { EXAMS, autoNumbers, composeVariant, durationText } from "./exams.js?v=land196";
import { currentUser, humanError, supa } from "./supa.js";

const LEVELS = [
  [0, "Новичок"],
  [100, "Ученик"],
  [300, "Знаток"],
  [700, "Мастер"],
  [1500, "Эксперт"],
  [3000, "Отличник"],
  [6000, "Легенда"],
];
export const DAILY_GOAL = 10;

// Правило к номеру ЕГЭ — через поиск по каталогу правил студии
const EGE_RULE_QUERY = {
  8: "согласован", 9: "корн", 10: "приставк", 11: "суффикс", 12: "окончан", 13: "частица не", 14: "дефис",
  15: "н и нн", 16: "однородн", 17: "обособ", 18: "вводн", 19: "сложноподчин", 20: "бессоюз", 21: "тире",
};
// Тренажёры студии к номерам ОГЭ
const OGE_TRAINER = { 2: "trenazher-osnova-leksikon", 3: "trenazher-oborotov-leksikon", 5: "trenazher-n-nn-leksikon" };

const SECTION = { "ege-rus": "ege", "oge-rus": "oge", "vpr-rus": "vpr", "ege-lit": "literature", "oge-lit": "literature/oge", itog: "itog" };

export function examCodeOf(profile) {
  return currentTrack(profile);
}

export function levelOf(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i += 1;
  const [from, name] = LEVELS[i];
  const next = LEVELS[i + 1];
  return { n: i + 1, name, from, to: next?.[0] ?? null, nextName: next?.[1] ?? null };
}

/** Дата в Горно-Алтайске (YYYY-MM-DD). */
export function barnaulDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Barnaul" }).format(d);
}

function streakOf(days) {
  const set = new Set(days.map((x) => x.d));
  const day = new Date();
  let streak = 0;
  // серия не обрывается, если сегодня ещё не занимались
  if (!set.has(barnaulDate(day))) day.setDate(day.getDate() - 1);
  while (set.has(barnaulDate(day))) {
    streak += 1;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

export async function loadDashboard() {
  const uid = currentUser()?.id;
  const [xp, days, stats, mistakes, works, selfExams] = await Promise.all([
    supa.from("xp_events").select("kind, points, created_at").eq("student_id", uid).limit(5000),
    supa.from("my_days").select("*").order("d", { ascending: false }).limit(120),
    supa.from("task_stats").select("*").eq("student_id", uid),
    supa.from("my_mistakes").select("task_id, source, bank_file, source_ref, task_no").limit(500),
    supa.from("written_works").select("id, status, score, max_score, reviewed_at, seen_at, archived_at, item_id, tasks(source, bank_file, source_ref, task_no), lesson_items(lesson_id, lessons(title, kind))").eq("student_id", uid),
    supa.from("lessons").select("id, created_at").eq("self_made", true).order("created_at", { ascending: false }).limit(5),
  ]);
  const events = xp.data || [];
  const today = barnaulDate();
  const total = events.reduce((a, e) => a + e.points, 0);
  const todayXp = events.filter((e) => barnaulDate(new Date(e.created_at)) === today).reduce((a, e) => a + e.points, 0);
  const dayRows = days.data || [];
  const todayRow = dayRows.find((r) => r.d === today);
  return {
    total,
    todayXp,
    level: levelOf(total),
    streak: streakOf(dayRows),
    bestDays: dayRows.length,
    todayCorrect: todayRow?.correct || 0,
    todayActions: todayRow?.actions || 0,
    stats: stats.data || [],
    mistakes: mistakes.data || [],
    works: works.data || [],
    selfExams: selfExams.data || [],
    events,
  };
}

/* ------------------------------------------------------------------ */
/* «Что дальше»                                                         */
/* ------------------------------------------------------------------ */

export function recommendations(d, code) {
  const out = [];
  const ex = EXAMS[code];
  const sec = SECTION[code];
  const mine = d.stats.filter((s) => s.source === code);
  const tried = new Set(mine.map((s) => s.task_no));
  if (d.mistakes.length) {
    out.push({
      icon: "↺",
      title: `Вернись к ошибкам: ${d.mistakes.length}`,
      text: "Задания, где был неверный ответ или ты смотрел разбор. Реши их сам — так тема запоминается лучше всего.",
      href: `#/me/daily`,
      cta: "Тренировка дня",
    });
  }
  const weak = mine
    .filter((s) => s.tasks_seen >= 2 && Number(s.pct_correct) < 60)
    .sort((a, b) => Number(a.pct_correct) - Number(b.pct_correct));
  weak.slice(0, 2).forEach((s) => {
    const n = s.task_no;
    const rule = code === "ege-rus" && EGE_RULE_QUERY[n];
    const trainer = code === "oge-rus" && OGE_TRAINER[n];
    out.push({
      icon: "📘",
      title: `Задание ${n}: точность ${s.pct_correct}%`,
      text: rule
        ? "Повтори правило, а потом реши ещё несколько заданий этого номера."
        : trainer
          ? "Пройди тренажёр студии — он как раз про это задание."
          : code === "ege-lit" && n <= 8
            ? "Повтори термины в тренажёре — без них задания 1–8 не даются."
            : "Перечитай разборы решённых заданий и попробуй ещё.",
      href: rule ? `#/rules?q=${encodeURIComponent(rule)}` : trainer ? `#/trainer/${trainer}` : code === "ege-lit" && n <= 8 ? "#/literature/terms/train" : `#/${sec}/${n}`,
      cta: rule ? "Правило" : trainer ? "Тренажёр" : code === "ege-lit" && n <= 8 ? "Тренажёр терминов" : "К заданиям",
      extra: rule || trainer ? { href: `#/${sec}/${n}`, cta: `Задание ${n}` } : null,
    });
  });
  const auto = autoNumbers(code);
  const untried = auto.filter((n) => !tried.has(n));
  if (untried.length) {
    const n = untried[Math.floor(Math.random() * Math.min(untried.length, 5))];
    out.push({
      icon: "✦",
      title: `Попробуй задание ${n}`,
      text: `Ты его ещё не решал. Из ${auto.length} номеров с автопроверкой освоено ${auto.length - untried.length}.`,
      href: `#/${sec}/${n}`,
      cta: "Начать",
    });
  }
  const lastSelf = d.selfExams[0] ? new Date(d.selfExams[0].created_at) : null;
  const daysSince = lastSelf ? Math.floor((Date.now() - lastSelf) / 86400000) : null;
  if (mine.length >= 5 && (daysSince === null || daysSince > 14)) {
    out.push({
      icon: "⏱",
      title: "Пора написать пробный экзамен",
      text: daysSince === null ? "Проверь себя в условиях экзамена — с таймером и всеми заданиями." : `Последний был ${daysSince} дн. назад.`,
      href: "#/me",
      scroll: "self-exam",
      cta: "К пробному",
    });
  }
  const readDone = d.events.filter((e) => e.kind === "reading").length;
  const poemsDone = d.events.filter((e) => e.kind === "poem").length;
  if (code === "ege-lit" || code === "oge-lit") {
    out.push({
      icon: "📖",
      title: readDone ? `Статьи «Полки»: пройдено ${readDone}` : "Прочитай статью о книге и ответь на вопросы",
      text: "Короткие статьи «Полки» о главных книгах: о чём, как написано, как приняли. Потом 6 вопросов — и +20 очков.",
      href: "#/library/read",
      cta: "Читать и отвечать",
    });
    out.push({
      icon: "🎭",
      title: poemsDone ? `Выучено стихов: ${poemsDone}` : "Выучи стихотворение для задания 10",
      text: "В задании 10 нужно сопоставить стихи. Выбери тему, выучи стихотворение и проверь себя на сайте.",
      href: "#/library/poems",
      cta: "Стихи наизусть",
    });
  }
  if (d.todayCorrect < DAILY_GOAL) {
    out.push({
      icon: "🎯",
      title: `Цель дня: ${d.todayCorrect} из ${DAILY_GOAL}`,
      text: d.streak ? `Серия: ${d.streak} дн. подряд — не прерывай её!` : "Реши 10 заданий сегодня — начнётся серия дней.",
      href: "#/me/daily",
      cta: "Тренировка дня",
    });
  }
  return out.slice(0, 5);
}

/* ------------------------------------------------------------------ */
/* Значки                                                              */
/* ------------------------------------------------------------------ */

export function badges(d, code) {
  const solve = d.events.filter((e) => e.kind === "solve");
  const firstTry = solve.filter((e) => e.points === 10).length;
  const fixed = solve.filter((e) => e.points === 5).length;
  const mine = d.stats.filter((s) => s.source === code);
  const ex = EXAMS[code];
  const list = [
    ["🌱", "Первый шаг", "Решить первое задание", solve.length >= 1],
    ["🔟", "Десятка", "10 решённых заданий", solve.length >= 10],
    ["📚", "Полсотни", "50 решённых заданий", solve.length >= 50],
    ["💯", "Сотня", "100 решённых заданий", solve.length >= 100],
    ["🎯", "Снайпер", "20 заданий с первой попытки", firstTry >= 20],
    ["↺", "Работа над ошибками", "5 заданий решено после ошибки", fixed >= 5],
    ["🔥", "Три дня подряд", "Заниматься 3 дня подряд", d.streak >= 3],
    ["🏔", "Неделя", "Заниматься 7 дней подряд", d.streak >= 7],
    ["✍️", "Перо", "Сдать письменную работу", d.works.some((w) => w.status !== "draft")],
    ["⏱", "Как на экзамене", "Завершить пробный экзамен", d.events.some((e) => e.kind === "exam")],
    ["📖", "Читатель", "Пройти 3 теста по статьям «Полки»", d.events.filter((e) => e.kind === "reading").length >= 3],
    ["🎭", "Наизусть", "Выучить 3 стихотворения", d.events.filter((e) => e.kind === "poem").length >= 3],
    ["🖋", "Писатель", "5 проверенных письменных работ", d.events.filter((e) => e.kind === "graded").length >= 5],
    ["🏅", "Мастер слова", "Письменная работа на 80% баллов и выше", d.events.some((e) => e.kind === "graded" && e.points >= 32)],
    ["📘", "Знаток правил", "Закрепить 5 глав правил", d.events.filter((e) => e.kind === "rule").length >= 5],
    ["🧭", "Все номера", `Решать все ${autoNumbers(code).length} номеров с автопроверкой`, autoNumbers(code).every((n) => mine.some((s) => s.task_no === n))],
  ];
  return list.map(([icon, name, hint, got]) => ({ icon, name, hint, got }));
}

/* ------------------------------------------------------------------ */
/* Разметка кабинета                                                   */
/* ------------------------------------------------------------------ */

export function heroHtml(d, profile) {
  const lv = d.level;
  const pct = lv.to ? Math.round(((d.total - lv.from) / (lv.to - lv.from)) * 100) : 100;
  const goalPct = Math.min(100, Math.round((d.todayCorrect / DAILY_GOAL) * 100));
  return `
    <section class="dash-hero card">
      <div class="dash-level">
        <span class="dash-level-n">${lv.n}</span>
        <div>
          <p class="eyebrow">Уровень ${lv.n}</p>
          <strong>${escapeHtml(lv.name)}</strong>
          <div class="dash-bar"><span style="width:${pct}%"></span></div>
          <small class="muted">${d.total} очков${lv.to ? ` · до уровня «${escapeHtml(lv.nextName)}» ${lv.to - d.total}` : ""}${d.todayXp ? ` · сегодня +${d.todayXp}` : ""}</small>
        </div>
      </div>
      <div class="dash-stats">
        <div><strong>🔥 ${d.streak}</strong><small>${d.streak === 1 ? "день" : d.streak >= 2 && d.streak <= 4 ? "дня" : "дней"} подряд</small></div>
        <div><strong>${d.todayCorrect}/${DAILY_GOAL}</strong><small>цель дня</small><div class="dash-bar dash-bar-goal"><span style="width:${goalPct}%"></span></div></div>
        <div><strong>${d.events.filter((e) => e.kind === "solve").length}</strong><small>решено заданий</small></div>
      </div>
    </section>`;
}

export function recsHtml(recs) {
  if (!recs.length) return "";
  return `
    <section class="me-section">
      <h2>Что дальше</h2>
      <div class="dash-recs">${recs
        .map(
          (r) => `
        <article class="dash-rec card">
          <span class="dash-rec-icon" aria-hidden="true">${r.icon}</span>
          <div>
            <strong>${escapeHtml(r.title)}</strong>
            <p class="muted">${escapeHtml(r.text)}</p>
            <p class="actions"><a class="btn" href="${r.href}"${r.scroll ? ` data-scroll="${r.scroll}"` : ""}>${escapeHtml(r.cta)}</a>${r.extra ? ` <a class="btn secondary" href="${r.extra.href}">${escapeHtml(r.extra.cta)}</a>` : ""}</p>
          </div>
        </article>`
        )
        .join("")}</div>
    </section>`;
}

export function selfExamHtml(code) {
  const opts = Object.entries(EXAMS)
    .map(([k, v]) => `<option value="${k}" ${k === code ? "selected" : ""}>${escapeHtml(v.title)}</option>`)
    .join("");
  return `
    <section class="me-section" id="self-exam">
      <h2>Пробный экзамен самостоятельно</h2>
      <form class="card t-filter" id="dash-self">
        <label>Экзамен<select name="code">${opts}</select></label>
        <label class="t-inline"><input type="checkbox" name="written" ${EXAMS[code]?.writtenDefault ? "checked" : ""} /> с письменной частью — её проверит преподаватель</label>
        <p class="muted" id="dash-self-time"></p>
        <button class="btn" type="submit">Собрать вариант и начать</button>
        <p class="muted">Вариант собирается из заданий, которые ты ещё не решал, тексты — как на экзамене. Результат заданий с автопроверкой увидишь сразу после сдачи. Очки: 30 за завершение и по 3 за каждый верный ответ; за письменную часть — отдельно, после проверки.</p>
        <p class="lit-result" id="dash-self-status"></p>
      </form>
    </section>`;
}

const selfMinutes = (code, written) => (written ? EXAMS[code].minutes : EXAMS[code].minutesNoWriting || EXAMS[code].minutes);

export function badgesHtml(list) {
  const got = list.filter((b) => b.got).length;
  return `
    <section class="me-section">
      <h2>Значки <small class="muted">${got} из ${list.length}</small></h2>
      <div class="dash-badges">${list
        .map(
          (b) => `<div class="dash-badge ${b.got ? "is-got" : ""}" title="${escapeHtml(b.hint)}">
            <span>${b.icon}</span><strong>${escapeHtml(b.name)}</strong><small>${escapeHtml(b.hint)}</small></div>`
        )
        .join("")}</div>
    </section>`;
}

export function howPointsHtml() {
  return `
    <details class="card dash-how">
      <summary>Как начисляются очки</summary>
      <ul>
        <li>Верно с первой попытки — <b>10</b>, после ошибки — <b>5</b>, после разбора — <b>2</b> (за каждое задание один раз).</li>
        <li>Письменные работы — по желанию, отдельная награда: за сдачу <b>15</b>, после проверки преподавателем — ещё до <b>40</b> по итогу баллов. На цель дня и серию не влияют.</li>
        <li>Завершил пробный экзамен — <b>30</b> и по <b>3</b> за каждый верный ответ; контрольная — <b>15</b>.</li>
        <li>Прочитал статью на «Полке» и ответил на вопросы — <b>20</b>; выучил стихотворение наизусть — от <b>10</b> до <b>40</b> (чем длиннее, тем больше).</li>
        <li>«Проверь себя» после правила: 4 из 5 верно — глава закреплена, <b>15</b> очков.</li>
        <li>Цель дня — ${DAILY_GOAL} верных заданий. Каждый день с занятиями продлевает серию 🔥.</li>
      </ul>
    </details>`;
}

export function bindSelfExam(root) {
  const form = root.querySelector("#dash-self");
  if (!form) return;
  const codeSel = form.querySelector('[name="code"]');
  const wr = form.querySelector('[name="written"]');
  const timeText = () => {
    const code = codeSel.value;
    const ex = EXAMS[code];
    // ОГЭ по литературе — только письменные задания: без письменной части варианта нет
    const allWritten = ex.numbers.every((n) => ex.written.includes(n));
    if (allWritten) wr.checked = true;
    wr.disabled = allWritten;
    form.querySelector("#dash-self-time").textContent = wr.checked
      ? `Время: ${durationText(ex.minutes)} (${ex.note}), задания ${ex.numbers[0]}–${ex.numbers.at(-1)}.`
      : `Время: ${durationText(selfMinutes(code, false))} — только задания с автопроверкой, без ${ex.written.length > 1 ? `заданий ${ex.written.join(", ")}` : `задания ${ex.written[0]}`}.`;
  };
  codeSel.addEventListener("change", () => {
    wr.checked = Boolean(EXAMS[codeSel.value].writtenDefault);
    timeText();
  });
  wr.addEventListener("change", timeText);
  timeText();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = codeSel.value;
    const written = wr.checked;
    const st = form.querySelector("#dash-self-status");
    const btn = form.querySelector('button[type="submit"]');
    if (!confirm(`Начать «${EXAMS[code].title}»${written ? "" : " без письменной части"}? После старта пойдёт таймер на ${durationText(selfMinutes(code, written))}.`)) return;
    btn.disabled = true;
    st.className = "lit-result";
    st.textContent = "Собираем вариант…";
    try {
      let tasks = await composeVariant(code, [currentUser().id]);
      if (!written) tasks = tasks.filter((t) => !EXAMS[code].written.includes(t.task_no));
      const { data: id, error } = await supa.rpc("create_self_exam", { p_code: code, p_tasks: tasks.map((t) => t.id), p_written: written });
      if (error) {
        if (/too many/.test(error.message)) throw new Error("Сегодня уже три пробных экзамена — хватит на сегодня 🙂");
        throw humanError(error);
      }
      location.hash = `#/lesson/${id}`;
    } catch (err) {
      st.className = "lit-result is-bad";
      st.textContent = err.message;
      btn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Тренировка дня: 10 заданий по ошибкам, слабым и новым номерам        */
/* ------------------------------------------------------------------ */

export const dailyKey = () => `daily-${currentUser()?.id}-${barnaulDate()}`;

async function buildDaily(code, d) {
  const ex = EXAMS[code];
  const autoNos = autoNumbers(code);
  const picked = [];
  const take = (t) => {
    if (t && !picked.some((p) => p.id === t.id)) picked.push(t);
  };
  // 0) повторение правила: глава закреплена неделю назад и раньше — одно задание по ней
  if (code === "ege-rus") {
    try {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: old } = await supa.from("rules_mastered").select("chapter_id").lt("mastered_at", weekAgo);
      if (old?.length) {
        const pickCh = old[Math.floor(Math.random() * old.length)].chapter_id;
        const { data: chRow } = await supa.from("rule_chapters").select("task_nos").eq("chapter_id", pickCh).maybeSingle();
        if (chRow) {
          const { data: pool } = await supa
            .from("tasks")
            .select("id, source, bank_file, source_ref, task_no")
            .eq("source", "ege-rus")
            .in("task_no", chRow.task_nos)
            .not("answer_mode", "in", "(open,essay)")
            .limit(200);
          if (pool?.length) take({ ...pool[Math.floor(Math.random() * pool.length)], why: "повторение закреплённого правила" });
        }
      }
    } catch {}
  }
  // 1) ошибки этого экзамена
  d.mistakes.filter((m) => m.source === code).slice(0, 4).forEach((m) =>
    take({ id: m.task_id, source: m.source, bank_file: m.bank_file, source_ref: m.source_ref, task_no: m.task_no, why: "работа над ошибкой" })
  );
  // 2) слабые и 3) новые номера
  const mine = d.stats.filter((s) => s.source === code);
  const weak = mine.filter((s) => Number(s.pct_correct) < 70).sort((a, b) => Number(a.pct_correct) - Number(b.pct_correct)).map((s) => s.task_no);
  const untried = autoNos.filter((n) => !mine.some((s) => s.task_no === n));
  const plan = [...weak.slice(0, 3).map((n) => [n, "слабое место"]), ...untried.slice(0, 3).map((n) => [n, "новый номер"])];
  const rest = autoNos.filter((n) => !plan.some(([p]) => p === n));
  // берём с запасом: у части номеров (сочинения) нет заданий с автопроверкой
  while (plan.length + picked.length < 15 && rest.length) {
    const i = Math.floor(Math.random() * rest.length);
    plan.push([rest.splice(i, 1)[0], "для разнообразия"]);
  }
  const { data: solved } = await supa.from("attempts").select("task_id").eq("student_id", currentUser().id).eq("is_correct", true).limit(5000);
  const done = new Set((solved || []).map((r) => r.task_id));
  for (const [n, why] of plan) {
    if (picked.length >= 10) break;
    const { data } = await supa
      .from("tasks")
      .select("id, source, bank_file, source_ref, task_no, answer_mode")
      .eq("source", code)
      .eq("bank_file", ex.bank(n))
      .not("answer_mode", "in", "(open,essay)")
      .limit(300);
    const pool = (data || []).filter((t) => !done.has(t.id));
    if (pool.length) take({ ...pool[Math.floor(Math.random() * pool.length)], why });
  }
  return picked.slice(0, 10);
}

export async function mountDaily(root, d, profile) {
  const host = root.querySelector("#me-root");
  const code = examCodeOf(profile);
  let list = null;
  try {
    list = JSON.parse(localStorage.getItem(dailyKey()) || "null");
  } catch {
    /* ignore */
  }
  if (!list) {
    host.innerHTML = `<p class="lede muted">Собираем тренировку дня…</p>`;
    list = await buildDaily(code, d);
    try {
      localStorage.setItem(dailyKey(), JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }
  const ids = list.map((t) => t.id);
  const { data: att } = ids.length
    ? await supa.from("attempts").select("task_id, is_correct, created_at").eq("student_id", currentUser().id).in("task_id", ids)
    : { data: [] };
  const today = barnaulDate();
  const solvedToday = (id) => (att || []).some((a) => a.task_id === id && a.is_correct && barnaulDate(new Date(a.created_at)) === today);
  const doneN = list.filter((t) => solvedToday(t.id)).length;
  const href = (t) =>
    t.source === "ege-rus" ? `#/ege/${t.task_no}/${t.source_ref}` : t.source === "oge-rus" ? `#/oge/${t.task_no}/${t.source_ref}` : t.source === "vpr-rus" ? `#/vpr/${t.task_no}/${t.source_ref}` : t.source === "oge-lit" ? `#/literature/oge/${t.task_no}/${t.source_ref}` : `#/literature/${t.task_no}/${t.source_ref}`;
  host.innerHTML = `
    <p class="crumbs"><a href="#/me">← Главная</a></p>
    <p class="eyebrow">Тренировка дня · ${escapeHtml(EXAMS[code].title)}</p>
    <h1>${doneN === list.length && list.length ? "Тренировка выполнена! 🎉" : `Решено ${doneN} из ${list.length}`}</h1>
    <p class="lede">Подборка на сегодня: ошибки, слабые места и новые номера. Открой задание, реши и возвращайся сюда.</p>
    <div class="dash-bar dash-bar-goal"><span style="width:${list.length ? Math.round((doneN / list.length) * 100) : 0}%"></span></div>
    <div class="lit-list">${list
      .map(
        (t, i) => `
      <a class="lit-item ${solvedToday(t.id) ? "is-done" : ""}" href="${href(t)}">
        <span class="lit-item-n">${solvedToday(t.id) ? "✓" : i + 1}</span>
        <span class="lit-item-body"><strong>Задание ${t.task_no}</strong><span class="muted">${escapeHtml(t.why)}</span></span>
      </a>`
      )
      .join("")}</div>
    <p class="actions"><button class="btn secondary" id="daily-new" type="button">Собрать новую подборку</button></p>`;
  // отметки «решено» для перехода «Дальше →» с экрана задания
  try {
    localStorage.setItem(`daily-done-${currentUser()?.id}-${today}`, JSON.stringify(list.filter((t) => solvedToday(t.id)).map((t) => t.id)));
  } catch {}
  import("./session.js?v=land196").then((m) => m.maybeCelebrateDaily(doneN, list.length)).catch(() => {});
  host.querySelector("#daily-new").addEventListener("click", () => {
    try {
      localStorage.removeItem(dailyKey());
    } catch {
      /* ignore */
    }
    mountDaily(root, d, profile);
  });
}

