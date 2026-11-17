/**
 * Контрольные и пробные экзамены: состав варианта, время, таймер и сдача у ученика.
 *
 * Продолжительность — по расписанию ГИА (приказы Минпросвещения и Рособрнадзора):
 *   ЕГЭ по русскому языку — 3 ч 30 мин; ЕГЭ по литературе — 3 ч 55 мин;
 *   ОГЭ по русскому языку — 3 ч 55 мин, но изложения (задание 1) у нас нет — минус 1 час: 2 ч 55 мин.
 * Время можно поменять в каждой работе: если расписание изменится, поправьте EXAMS ниже.
 */
import { escapeHtml } from "./ui.js";
import { humanError, saveWork, supa, myWorkFor } from "./supa.js";

export const EXAMS = {
  "ege-rus": {
    title: "ЕГЭ по русскому языку",
    minutes: 210,
    note: "как на экзамене",
    numbers: range(1, 27),
    // задания по общему тексту: 1–3; 23–26 и сочинение 27
    groups: [[1, 2, 3], [23, 24, 25, 26, 27]],
    written: [27],
    writtenDefault: false,
    minutesNoWriting: 90,
    bank: (n) => `ege-${String(n).padStart(2, "0")}`,
  },
  "oge-rus": {
    title: "ОГЭ по русскому языку (без изложения)",
    minutes: 175,
    note: "по расписанию 3 ч 55 мин, без изложения — на час меньше",
    numbers: range(2, 13),
    groups: [[2, 3], [10, 11, 12, 13]],
    written: [13],
    writtenDefault: false,
    minutesNoWriting: 90,
    bank: (n) => `oge-${String(n).padStart(2, "0")}`,
  },
  "vpr-rus": {
    title: "ВПР по русскому языку, 8 класс",
    minutes: 90,
    note: "как на проверочной работе — 90 минут",
    numbers: range(1, 12),
    // все задания ВПР — по одному тексту
    groups: [range(1, 12)],
    written: [1, 6, 7, 11, 12],
    writtenDefault: true,
    minutesNoWriting: 45,
    bank: (n) => `vpr-${String(n).padStart(2, "0")}`,
  },
  "ege-lit": {
    title: "ЕГЭ по литературе",
    minutes: 235,
    note: "как на экзамене",
    numbers: range(1, 11),
    groups: [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]],
    written: [4, 5, 9, 10, 11],
    writtenDefault: true,
    minutesNoWriting: 60,
    bank: (n) => `ege-${String(n).padStart(2, "0")}`,
  },
};

/** Номера с автопроверкой — по ним строится самостоятельный трек (письменные — отдельно, по желанию). */
export function autoNumbers(code) {
  const ex = EXAMS[code];
  return ex ? ex.numbers.filter((n) => !(ex.written || []).includes(n)) : [];
}

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export function durationText(min) {
  if (!min) return "без ограничения времени";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} ч` : "", m ? `${m} мин` : ""].filter(Boolean).join(" ");
}

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Собрать вариант: по одному заданию на номер; номера с общим текстом — из одного исходного варианта.
 * Предпочитаем задания, которые никто из учеников ещё не решал. Возвращает [{id, task_no}].
 */
export async function composeVariant(code, studentIds = []) {
  const ex = EXAMS[code];
  const files = ex.numbers.map(ex.bank);
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa
      .from("tasks")
      .select("id, task_no, passage_id")
      .eq("source", code)
      .in("bank_file", files)
      .eq("is_published", true)
      .range(from, from + 999);
    if (error) throw humanError(error);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  let seen = new Set();
  if (studentIds.length) {
    const { data } = await supa.from("attempts").select("task_id").in("student_id", studentIds).limit(20000);
    seen = new Set((data || []).map((r) => r.task_id));
  }
  const byNo = new Map(ex.numbers.map((n) => [n, rows.filter((r) => r.task_no === n)]));
  const pick = (list) => {
    const fresh = list.filter((r) => !seen.has(r.id));
    const pool = fresh.length ? fresh : list;
    return pool[Math.floor(Math.random() * pool.length)];
  };
  const chosen = new Map();
  for (const group of ex.groups) {
    const passages = new Map();
    rows
      .filter((r) => group.includes(r.task_no) && r.passage_id)
      .forEach((r) => {
        if (!passages.has(r.passage_id)) passages.set(r.passage_id, new Map());
        const m = passages.get(r.passage_id);
        if (!m.has(r.task_no)) m.set(r.task_no, []);
        m.get(r.task_no).push(r);
      });
    const full = [...passages.entries()].filter(([, m]) => group.every((n) => m.has(n)));
    // если полного набора нет (например, 23–26 без 27) — берём самый полный
    const best = full.length
      ? full
      : [...passages.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 20);
    const freshFirst = shuffle(best).sort(
      (a, b) =>
        [...a[1].values()].flat().filter((r) => seen.has(r.id)).length -
        [...b[1].values()].flat().filter((r) => seen.has(r.id)).length
    );
    const [, m] = freshFirst[0] || [null, new Map()];
    group.forEach((n) => {
      if (m.has(n)) chosen.set(n, pick(m.get(n)));
    });
  }
  ex.numbers.forEach((n) => {
    if (!chosen.has(n) && byNo.get(n)?.length) chosen.set(n, pick(byNo.get(n)));
  });
  return ex.numbers.filter((n) => chosen.has(n)).map((n) => ({ id: chosen.get(n).id, task_no: n }));
}

/** Заменить одно задание варианта на другое того же номера (с тем же текстом, если он общий). */
export async function alternativeTask(code, taskNo, passageId, excludeIds) {
  let q = supa.from("tasks").select("id, passage_id").eq("source", code).eq("task_no", taskNo).eq("is_published", true).limit(500);
  const ex = EXAMS[code];
  const shared = ex?.groups.some((g) => g.includes(taskNo));
  if (shared && passageId) q = q.eq("passage_id", passageId);
  if (ex) q = q.eq("bank_file", ex.bank(taskNo));
  const { data, error } = await q;
  if (error) throw humanError(error);
  const pool = (data || []).filter((r) => !excludeIds.includes(r.id));
  return pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
}

/* ------------------------------------------------------------------ */
/* Ученик: работа на время                                              */
/* ------------------------------------------------------------------ */

let tick = null;
let clockOffset = 0; // серверное время − время устройства
window.addEventListener("hashchange", () => {
  if (!location.hash.startsWith("#/lesson/")) stopTimer();
});

function stopTimer() {
  if (tick) clearInterval(tick);
  tick = null;
}

export async function examState(lessonId) {
  const { data, error } = await supa.rpc("exam_state", { p_lesson: lessonId });
  if (error) throw humanError(error);
  clockOffset = new Date(data.now).getTime() - Date.now();
  return data;
}

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

/** Экран «Начать работу». */
export function introHtml(lesson, itemsCount) {
  const now = Date.now() + clockOffset;
  const notYet = lesson.starts_at && new Date(lesson.starts_at).getTime() > now;
  const closed = lesson.closes_at && new Date(lesson.closes_at).getTime() < now;
  const kind = lesson.kind === "exam" ? "Пробный экзамен" : "Контрольная работа";
  return `
    <p class="crumbs"><a href="#/me">← Личный кабинет</a></p>
    <p class="eyebrow">${kind}</p>
    <h1>${escapeHtml(lesson.title)}</h1>
    ${lesson.notes ? `<p class="lede">${escapeHtml(lesson.notes)}</p>` : ""}
    <div class="card exam-intro">
      <p><strong>Время: ${durationText(lesson.duration_minutes)}</strong>${lesson.exam_code && EXAMS[lesson.exam_code] ? ` · ${escapeHtml(EXAMS[lesson.exam_code].note)}` : ""}</p>
      <p>Заданий: ${itemsCount}.</p>
      <ul>
        <li>Таймер запускается, когда вы нажмёте «Начать», и не останавливается — даже если закрыть страницу.</li>
        <li>Ответы можно менять до конца времени. Результат — после завершения работы${lesson.show_results === "after_finish" ? "" : " и проверки преподавателем"}.</li>
        <li>Письменные ответы сохраняйте кнопкой «Сохранить» — при завершении они сдаются автоматически.</li>
        <li>Когда время выйдет, работа завершится сама.</li>
      </ul>
      ${lesson.starts_at ? `<p class="muted">Начать можно с ${new Date(lesson.starts_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}${lesson.closes_at ? ` до ${new Date(lesson.closes_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}` : ""}.</p>` : lesson.closes_at ? `<p class="muted">Начать можно до ${new Date(lesson.closes_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}.</p>` : ""}
      ${
        notYet
          ? `<p class="lit-result">Работа ещё не открыта.</p>`
          : closed
            ? `<p class="lit-result is-bad">Время для начала работы закончилось. Напишите преподавателю.</p>`
            : `<p class="actions"><button class="btn btn-lg" id="exam-start">Начать</button></p>`
      }
      <p class="lit-result" id="exam-status"></p>
    </div>`;
}

export function bindIntro(host, lesson, onStarted) {
  host.querySelector("#exam-start")?.addEventListener("click", async (e) => {
    if (!confirm(`Начать «${lesson.title}»? У вас будет ${durationText(lesson.duration_minutes)}, таймер не останавливается.`)) return;
    e.target.disabled = true;
    const { data, error } = await supa.rpc("start_exam", { p_lesson: lesson.id });
    if (error) {
      const msg = /not started yet/.test(error.message)
        ? "Работа ещё не открыта."
        : /window closed/.test(error.message)
          ? "Время для начала работы закончилось."
          : humanError(error).message;
      host.querySelector("#exam-status").textContent = msg;
      e.target.disabled = false;
      return;
    }
    clockOffset = new Date(data.now).getTime() - Date.now();
    onStarted();
  });
}

/** Сдать все письменные ответы урока (черновики на сервере и в браузере). */
async function submitWrittenDrafts(items) {
  for (const it of items) {
    if (!["open", "essay"].includes(it.tasks?.answer_mode)) continue;
    const key = `work-draft-${it.task_id}-${it.id}`;
    let local = "";
    try {
      local = localStorage.getItem(key) || "";
    } catch {
      /* ignore */
    }
    try {
      const work = await myWorkFor(it.task_id, it.id);
      if (work && work.status !== "draft") continue;
      const body = (local || work?.body || "").trim();
      if (!body && !(work?.files || []).length) continue;
      await saveWork({ id: work?.id, taskId: it.task_id, itemId: it.id, body, files: work?.files || [], status: "submitted" });
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.warn("draft submit", err);
    }
  }
}

export async function finishExam(lesson, items) {
  await submitWrittenDrafts(items);
  const { error } = await supa.rpc("finish_exam", { p_lesson: lesson.id });
  if (error && !/not started/.test(error.message)) throw humanError(error);
}

/** Полоса с таймером; по нулю — автосдача. */
export function timerHtml(lesson) {
  return `
    <div class="exam-bar" id="exam-bar" role="timer">
      <span class="exam-bar-kind">${lesson.kind === "exam" ? "Пробный экзамен" : "Контрольная"}</span>
      <strong id="exam-left">—</strong>
      <button class="btn secondary" id="exam-finish" type="button">Сдать<span class="exam-bar-long"> работу</span></button>
    </div>`;
}

export function bindTimer(host, lesson, items, state, onOver) {
  stopTimer();
  const ends = new Date(state.ends_at).getTime();
  const el = host.querySelector("#exam-left");
  const bar = host.querySelector("#exam-bar");
  let done = false;
  const over = async () => {
    if (done) return;
    done = true;
    stopTimer();
    if (el) el.textContent = "Время вышло — сдаём работу…";
    try {
      await finishExam(lesson, items);
    } catch (err) {
      console.warn(err);
    }
    onOver();
  };
  const update = () => {
    const left = ends - (Date.now() + clockOffset);
    if (el) el.textContent = `Осталось ${fmt(left)}`;
    bar?.classList.toggle("is-low", left < 10 * 60 * 1000);
    if (left <= 0) over();
  };
  update();
  tick = setInterval(update, 1000);
  host.querySelector("#exam-finish")?.addEventListener("click", async () => {
    if (!confirm("Завершить работу? Изменить ответы после этого будет нельзя.")) return;
    await over();
  });
}

/** Итог для ученика после завершения. */
export function resultsHtml(lesson, items, att, works, visible) {
  const auto = items.filter((it) => !["open", "essay"].includes(it.tasks?.answer_mode));
  const last = (it) => att.filter((a) => a.item_id === it.id).slice(-1)[0];
  const correct = auto.filter((it) => last(it)?.is_correct).length;
  const rows = items
    .map((it, i) => {
      const written = ["open", "essay"].includes(it.tasks?.answer_mode);
      let st;
      if (written) {
        const w = works.find((x) => x.item_id === it.id);
        st = !w || w.status === "draft" ? "не сдано" : w.status === "graded" ? `оценено${w.score != null ? `: ${w.score}${w.max_score ? `/${w.max_score}` : ""}` : ""}` : "на проверке";
      } else {
        const a = last(it);
        st = !a ? "нет ответа" : visible ? (a.is_correct ? "верно" : "неверно") : "ответ сохранён";
      }
      const cls = st === "верно" || st.startsWith("оценено") ? "is-ok" : st === "неверно" || st === "нет ответа" || st === "не сдано" ? "is-bad" : "is-wait";
      return `
        <a class="lit-item" href="#/lesson/${lesson.id}/${it.id}">
          <span class="lit-item-n">${it.tasks?.task_no ?? i + 1}</span>
          <span class="lit-item-body"><strong>Задание ${it.tasks?.task_no ?? i + 1}</strong><span class="l-st ${cls}">${escapeHtml(st)}</span></span>
        </a>`;
    })
    .join("");
  return `
    <p class="crumbs"><a href="#/me">← Личный кабинет</a></p>
    <p class="eyebrow">${lesson.kind === "exam" ? "Пробный экзамен" : "Контрольная работа"} · работа сдана</p>
    <h1>${escapeHtml(lesson.title)}</h1>
    ${
      visible
        ? `<p class="lede">Задания с кратким ответом: верно <strong>${correct} из ${auto.length}</strong>.${items.length > auto.length ? " Письменные ответы проверит преподаватель." : ""}</p>`
        : `<p class="lede">Работа сдана. Результаты появятся, когда преподаватель их откроет.</p>`
    }
    <div class="lit-list">${rows}</div>`;
}
