// «Проверь себя» после правила: 5 заданий ЕГЭ по главе, проверка на сервере.
// 4 из 5 с первой попытки — глава закреплена (+15 очков, ✓ у всех её правил).
import { escapeHtml } from "./ui.js";
import { accessState, currentUser, humanError, submitAnswer, supa } from "./supa.js";
import { sanitizeFor } from "./lessons.js?v=land125";

const QUIZ_SIZE = 5;
let chaptersCache = null;

async function chapters() {
  if (!chaptersCache) {
    const { data } = await supa.from("rule_chapters").select("chapter_id, source, task_nos");
    chaptersCache = new Map((data || []).map((c) => [c.chapter_id, c]));
  }
  return chaptersCache;
}

export async function myMastered() {
  if (!currentUser()) return new Map();
  const { data } = await supa.from("rules_mastered").select("chapter_id, score, total, mastered_at");
  return new Map((data || []).map((r) => [r.chapter_id, r]));
}

/** Список правил: ✓ у правил закреплённых глав. */
export async function markRulesIndex(root) {
  if (accessState() !== "student") return;
  const done = await myMastered();
  root.querySelectorAll("details[data-chapter]").forEach((d) => {
    if (!done.has(d.dataset.chapter)) return;
    d.classList.add("is-mastered");
    const sum = d.querySelector("summary span");
    if (sum && !sum.querySelector(".rq-badge")) sum.insertAdjacentHTML("beforeend", ` <span class="rq-badge">✓ закреплено</span>`);
  });
}

async function pickTasks(ch) {
  const uid = currentUser().id;
  const { data } = await supa
    .from("tasks")
    .select("id, task_no, answer_mode, data")
    .eq("source", ch.source)
    .in("task_no", ch.task_nos)
    .eq("is_published", true)
    .not("answer_mode", "in", "(open,essay)")
    .limit(600);
  const pool = data || [];
  const { data: tried } = await supa.from("attempts").select("task_id").eq("student_id", uid).in("task_id", pool.map((t) => t.id).slice(0, 600));
  const seen = new Set((tried || []).map((a) => a.task_id));
  const fresh = pool.filter((t) => !seen.has(t.id) && t.data?.questionHtml);
  const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  // поровну по номерам главы (например, 11 и 15)
  const byNo = ch.task_nos.map((n) => shuffle(fresh.filter((t) => t.task_no === n)));
  const out = [];
  for (let i = 0; out.length < QUIZ_SIZE && byNo.some((l) => l.length); i++) {
    const l = byNo[i % byNo.length];
    if (l.length) out.push(l.pop());
  }
  return out;
}

function introHtml(title, ch, done) {
  const nos = ch.task_nos.join(" и ");
  return `
    <div class="rq-card card">
      <p class="eyebrow">Проверь себя</p>
      <h2>${done ? "Глава закреплена ✓" : "Закрепи главу заданиями"}</h2>
      <p class="muted">${done ? `«${escapeHtml(title)}»: ${done.score} из ${done.total} верно ${new Date(done.mastered_at).toLocaleDateString("ru-RU")}. Через неделю задание по этой главе придёт в тренировку дня — на повторение.` : `${QUIZ_SIZE} заданий ЕГЭ № ${nos} по главе «${escapeHtml(title)}». Ответ засчитывается с первой попытки. ${QUIZ_SIZE - 1} из ${QUIZ_SIZE} — глава закреплена, +15 очков.`}</p>
      <p class="actions"><button class="btn${done ? " secondary" : ""}" type="button" data-rq-start>${done ? "Проверить ещё раз" : "Начать: 5 заданий"}</button></p>
    </div>`;
}

export async function mountRuleQuiz(root) {
  const host = root.querySelector("#rule-quiz");
  if (!host) return;
  const chapterId = host.dataset.chapter;
  const title = host.dataset.chapterTitle || "";
  const ch = (await chapters()).get(chapterId);
  if (!ch) return;
  const state = accessState();
  if (state !== "student" && state !== "teacher") {
    host.innerHTML = `
      <div class="rq-card card">
        <p class="eyebrow">Проверь себя</p>
        <h2>Закрепи главу заданиями ЕГЭ</h2>
        <p class="muted">${QUIZ_SIZE} заданий № ${ch.task_nos.join(" и ")} с проверкой и очками — для учеников студии.</p>
        ${state === "guest" ? `<p class="actions"><a class="btn secondary" href="#/login">Войти</a></p>` : ""}
      </div>`;
    return;
  }
  const done = state === "student" ? (await myMastered()).get(chapterId) : null;
  host.innerHTML = introHtml(title, ch, done);
  host.querySelector("[data-rq-start]").addEventListener("click", () => run(host, ch, chapterId, title));
}

async function run(host, ch, chapterId, title) {
  host.innerHTML = `<div class="rq-card card"><p class="muted">Подбираем задания…</p></div>`;
  const tasks = await pickTasks(ch);
  if (tasks.length < 3) {
    host.innerHTML = `<div class="rq-card card"><p>По этой главе ты уже решил почти все задания банка — отличная работа! Повторить их можно в разделе ЕГЭ.</p></div>`;
    return;
  }
  const sanitize = sanitizeFor(ch.source);
  const results = [];
  const teacher = accessState() === "teacher";
  host.scrollIntoView({ behavior: "smooth", block: "start" });
  const show = (i) => {
    const t = tasks[i];
    const numeric = /digits|numbers/.test(t.answer_mode || "");
    host.innerHTML = `
      <div class="rq-card card">
        <div class="rq-top"><span class="eyebrow">Проверь себя · ${escapeHtml(title)}</span><span class="muted">${i + 1} из ${tasks.length}</span></div>
        <div class="rq-dots">${tasks.map((_, k) => `<span class="${k < i ? (results[k] ? "is-ok" : "is-bad") : k === i ? "is-now" : ""}"></span>`).join("")}</div>
        <p class="muted rq-no">Задание ${t.task_no}</p>
        <div class="lit-html rq-q">${sanitize(t.data.questionHtml)}</div>
        <form class="lit-check-row rq-form" data-tid="${t.id}">
          <input class="search" name="a" autocomplete="off" ${numeric ? 'inputmode="numeric"' : ""} placeholder="${numeric ? "Например: 24" : "Ответ"}" />
          <button class="btn" type="submit">Ответить</button>
        </form>
        <p class="lit-result" id="rq-res" aria-live="polite"></p>
      </div>`;
    const form = host.querySelector(".rq-form");
    form.a.focus({ preventScroll: true });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const value = form.a.value.trim();
      const res = host.querySelector("#rq-res");
      if (!value) return (res.textContent = "Введите ответ.");
      form.querySelector("button").disabled = true;
      try {
        const r = await submitAnswer(t.id, value);
        results[i] = !!r.correct;
        res.className = `lit-result ${r.correct ? "is-ok" : "is-bad"}`;
        res.textContent = r.correct ? "Верно!" : "Неверно. Разбор этого задания — в разделе ЕГЭ после проверки.";
        if (r.correct) window.dispatchEvent(new CustomEvent("lx:answer", { detail: { taskId: t.id, correct: true, firstTry: true, anchor: res } }));
        else window.dispatchEvent(new CustomEvent("lx:answer", { detail: { taskId: t.id, correct: false } }));
        setTimeout(() => (i + 1 < tasks.length ? show(i + 1) : finish()), r.correct ? 900 : 1600);
      } catch (err) {
        res.className = "lit-result is-bad";
        res.textContent = humanError(err).message || String(err);
        form.querySelector("button").disabled = false;
      }
    });
  };
  const finish = async () => {
    host.innerHTML = `<div class="rq-card card"><p class="muted">Подводим итог…</p></div>`;
    const ok = results.filter(Boolean).length;
    let r = { correct: ok, total: tasks.length, passed: ok >= Math.ceil(tasks.length * 0.8), points: 0 };
    if (!teacher) {
      const { data, error } = await supa.rpc("rule_quiz_finish", { p_chapter: chapterId, p_tasks: tasks.map((t) => t.id) });
      if (error) {
        host.innerHTML = `<div class="rq-card card"><p class="lit-result is-bad">${escapeHtml(humanError(error).message)}</p></div>`;
        return;
      }
      r = data;
    }
    host.innerHTML = `
      <div class="rq-card card">
        <p class="eyebrow">Проверь себя · итог</p>
        <h2>${r.passed ? "Глава закреплена ✓" : `Верно ${r.correct} из ${r.total}`}</h2>
        <p class="muted">${r.passed ? `Отлично: ${r.correct} из ${r.total} с первой попытки.${r.points ? ` +${r.points} очков.` : ""} Через неделю пришлём задание на повторение.` : `Нужно ${Math.ceil(r.total * 0.8)} из ${r.total}. Перечитай правило выше — особенно примеры и «типичные ошибки» — и попробуй снова: задания будут другие.`}</p>
        <p class="actions"><button class="btn${r.passed ? " secondary" : ""}" type="button" data-rq-again>${r.passed ? "Ещё раз" : "Попробовать снова"}</button> <a class="btn secondary" href="#/rules">К правилам</a></p>
      </div>`;
    host.querySelector("[data-rq-again]").addEventListener("click", () => run(host, ch, chapterId, title));
    if (r.passed && !teacher) {
      import("./session.js?v=land125").then((m) =>
        m.celebrate({
          emoji: "📘",
          title: "Глава закреплена!",
          text: `«${title}» — ${r.correct} из ${r.total} с первой попытки.`,
          stats: [[`${r.correct}/${r.total}`, "верно"], ...(r.points ? [[`+${r.points}`, "очков"]] : [])],
          primary: { href: "#/rules", label: "К правилам" },
        })
      );
    }
  };
  show(0);
}
