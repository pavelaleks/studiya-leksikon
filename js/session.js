// Ощущение прогресса: «+10» и серия «подряд» после верного ответа,
// следующий шаг тренировки дня и финальный экран после тренировки и занятия.
import { escapeHtml } from "./ui.js";
import { accessState, currentUser, supa } from "./supa.js";
import { DAILY_GOAL, barnaulDate, dailyKey, loadDashboard } from "./dashboard.js?v=land146";

const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k) || "null");
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

/* ---------- «+10» и «3 подряд» ---------- */

function pop(anchor, text, cls = "") {
  const el = document.createElement("span");
  el.className = `xp-pop ${cls}`;
  el.textContent = text;
  (anchor?.parentElement || document.body).append(el);
  setTimeout(() => el.remove(), 1600);
}

function comboStep(correct, firstTry) {
  let n = Number(sessionStorage.getItem("combo") || 0);
  n = correct && firstTry ? n + 1 : 0;
  try {
    sessionStorage.setItem("combo", String(n));
  } catch {}
  return n;
}

async function pointsFor(taskId) {
  // очки начисляет сервер; берём только что начисленные за это задание
  const { data } = await supa.from("xp_events").select("points, created_at").eq("kind", "solve").eq("ref", String(taskId)).maybeSingle();
  if (!data) return 0;
  return Date.now() - new Date(data.created_at).getTime() < 120000 ? data.points : 0;
}

/* ---------- Тренировка дня ---------- */

function dailyList() {
  return store.get(dailyKey()) || null;
}
const dailyDoneKey = () => `daily-done-${currentUser()?.id}-${barnaulDate()}`;

function dailyHref(t) {
  return t.source === "ege-rus" ? `#/ege/${t.task_no}/${t.source_ref}` : t.source === "oge-rus" ? `#/oge/${t.task_no}/${t.source_ref}` : t.source === "vpr-rus" ? `#/vpr/${t.task_no}/${t.source_ref}` : `#/literature/${t.task_no}/${t.source_ref}`;
}

function nextChip(anchor, list, done) {
  const next = list.find((t) => !done.includes(t.id));
  if (!next || !anchor) return;
  const box = document.createElement("p");
  box.className = "next-step";
  box.innerHTML = `<span>Тренировка дня · ${done.length} из ${list.length}</span><a class="btn" href="${dailyHref(next)}">Дальше →</a>`;
  anchor.after(box);
}

/* ---------- Финальный экран ---------- */

export function celebrate({ emoji = "🎉", title, text = "", stats = [], primary = null, secondary = null }) {
  document.querySelector(".celebrate")?.remove();
  const el = document.createElement("div");
  el.className = "celebrate";
  el.innerHTML = `
    <div class="cel-backdrop" data-cel-close></div>
    <div class="cel-panel" role="dialog" aria-label="${escapeHtml(title)}">
      <div class="cel-confetti" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>
      <div class="cel-emoji" aria-hidden="true">${emoji}</div>
      <h2>${escapeHtml(title)}</h2>
      ${text ? `<p class="muted">${escapeHtml(text)}</p>` : ""}
      ${stats.length ? `<div class="cel-stats">${stats.map(([v, l]) => `<div><strong>${escapeHtml(String(v))}</strong><span>${escapeHtml(l)}</span></div>`).join("")}</div>` : ""}
      <div class="cel-actions">
        ${primary ? `<a class="btn" href="${primary.href}" data-cel-close>${escapeHtml(primary.label)}</a>` : ""}
        ${secondary ? `<a class="btn secondary" href="${secondary.href}" data-cel-close>${escapeHtml(secondary.label)}</a>` : `<button type="button" class="btn secondary" data-cel-close>Закрыть</button>`}
      </div>
    </div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("is-open"));
  try {
    navigator.vibrate?.([30, 60, 30]);
  } catch {}
  const close = () => {
    el.classList.remove("is-open");
    setTimeout(() => el.remove(), 220);
    window.removeEventListener("hashchange", close);
  };
  el.querySelectorAll("[data-cel-close]").forEach((b) => b.addEventListener("click", close));
  window.addEventListener("hashchange", close);
}

async function celebrateDaily() {
  const flag = `daily-cel-${currentUser()?.id}-${barnaulDate()}`;
  if (store.get(flag)) return;
  store.set(flag, true);
  const d = await loadDashboard().catch(() => null);
  celebrate({
    emoji: "🏆",
    title: "Тренировка дня выполнена!",
    text: d?.streak > 1 ? `Серия: ${d.streak} дн. подряд — так держать.` : "Начало серии положено — завтра продолжим.",
    stats: d
      ? [
          [`+${d.todayXp}`, "очков сегодня"],
          [`🔥 ${d.streak}`, "дней подряд"],
          [`${d.todayCorrect}/${DAILY_GOAL}`, "цель дня"],
        ]
      : [],
    primary: { href: "#/me", label: "На главную" },
    secondary: { href: "#/me/profile", label: "Мой прогресс" },
  });
}

/* ---------- Занятие от преподавателя ---------- */

async function checkLesson(itemId) {
  const m = location.hash.match(/^#\/lesson\/([0-9a-f-]{36})/);
  if (!m) return;
  const lessonId = m[1];
  const flag = `lesson-cel-${lessonId}`;
  if (store.get(flag)) return;
  const uid = currentUser()?.id;
  const { data: lesson } = await supa.from("lessons").select("id, title, duration_minutes, lesson_items(id)").eq("id", lessonId).maybeSingle();
  if (!lesson || lesson.duration_minutes) return; // у работ на время свой итог
  const ids = (lesson.lesson_items || []).map((i) => i.id);
  if (!ids.length || !ids.includes(itemId)) return;
  const [{ data: att }, { data: works }] = await Promise.all([
    supa.from("attempts").select("item_id, is_correct").eq("student_id", uid).in("item_id", ids),
    supa.from("written_works").select("item_id, status").eq("student_id", uid).in("item_id", ids),
  ]);
  const done = (id) => (att || []).some((a) => a.item_id === id) || (works || []).some((w) => w.item_id === id && w.status !== "draft");
  if (!ids.every(done)) return;
  store.set(flag, true);
  const solved = ids.filter((id) => (att || []).some((a) => a.item_id === id && a.is_correct)).length;
  const written = ids.filter((id) => (works || []).some((w) => w.item_id === id && w.status !== "draft")).length;
  celebrate({
    emoji: "✅",
    title: "Занятие выполнено!",
    text: `«${lesson.title}» — всё сдано. Преподаватель увидит результат в кабинете.`,
    stats: [
      [ids.length, "заданий"],
      [solved, "решено верно"],
      ...(written ? [[written, "работ на проверке"]] : []),
    ],
    primary: { href: "#/me", label: "На главную" },
    secondary: { href: `#/lesson/${lessonId}`, label: "Итоги занятия" },
  });
}

/* ---------- обработчик ответов ---------- */

window.addEventListener("lx:answer", async (e) => {
  const { taskId, itemId, correct, firstTry, hidden, exam, written, anchor } = e.detail || {};
  if (accessState() !== "student") return;
  if (hidden && exam) return; // контрольные и экзамены не подсказывают правильность
  if (correct === false) {
    comboStep(false);
    return;
  }
  if (correct) {
    const n = comboStep(true, firstTry);
    const pts = await pointsFor(taskId).catch(() => 0);
    if (pts) pop(anchor, `+${pts}`);
    if (n >= 3) setTimeout(() => pop(anchor, `🔥 ${n} подряд`, "is-combo"), pts ? 450 : 0);
  }
  // тренировка дня
  const list = dailyList();
  if (list && (correct || written) && list.some((t) => t.id === taskId)) {
    const done = [...new Set([...(store.get(dailyDoneKey()) || []), taskId])];
    store.set(dailyDoneKey(), done);
    if (list.every((t) => done.includes(t.id))) celebrateDaily();
    else nextChip(anchor, list, done);
  }
  // занятие
  if (itemId && (correct || written || hidden)) checkLesson(itemId).catch(() => {});
});

/** Тренировка дня открыта, а всё уже решено — показать итог один раз. */
export function maybeCelebrateDaily(doneN, total) {
  if (total && doneN >= total) celebrateDaily();
}
