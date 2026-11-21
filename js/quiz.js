// «Проверь себя перед экзаменом» (#/check): класс → 5 заданий из банка с проверкой на сервере
// + 5 вопросов по правилам → результат по темам и запись на занятия с заполненной заявкой.
import { BASE } from "./config.js";
import { escapeHtml } from "./ui.js";
import { humanError, supa } from "./supa.js";
import { sanitizeFor } from "./lessons.js?v=land178";
import { RULE_QUESTIONS, TOPIC_TITLE } from "./quiz-rules.js?v=land178";

const EXAM_OF = { 8: "vpr-rus", 9: "oge-rus", 10: "ege-rus", 11: "ege-rus" };
const EXAM_TITLE = { "vpr-rus": "ВПР", "oge-rus": "ОГЭ", "ege-rus": "ЕГЭ" };
const MANIFEST = { "vpr-rus": "js/vpr-data/manifest.json", "oge-rus": "js/oge-data/manifest.json", "ege-rus": "js/russian-data/manifest.json" };

const goal = (name) => {
  try {
    window.ym?.(114257440, "reachGoal", name);
  } catch {}
};
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
const topicOfTitle = (t) => (/пунктуац|знак(и|ов) препинания/i.test(t) ? "punct" : /орфограф|правописан|написани|-Н-/i.test(t) ? "orfo" : "norm");

function pickRules(grade, n = 5) {
  const by = (lvl) => shuffle(RULE_QUESTIONS.filter((q) => q.level === lvl));
  // если заданий из банка меньше пяти (ВПР: до 4 на один текст), добавляем вопросы по правилам до 10
  const extra = n - 5;
  const plan = grade === 8 ? [[8, 5 + extra]] : grade === 9 ? [[8, 2], [9, 3 + extra]] : [[8, 1], [9, 1 + extra], [10, 3]];
  // варианты перемешиваем, чтобы верный ответ не стоял всегда на одном месте
  return plan.flatMap(([lvl, n]) => by(lvl).slice(0, n)).map((q) => {
    const order = shuffle(q.o.map((_, k) => k));
    return { ...q, o: order.map((k) => q.o[k]), a: order.indexOf(q.a) };
  });
}

async function taskTitles(exam) {
  try {
    const res = await fetch(new URL(MANIFEST[exam], new URL(BASE, location.href)));
    const m = await res.json();
    return Object.fromEntries((m.files || []).filter((f) => f.kind !== "extra").map((f) => [f.task, f.title]));
  } catch {
    return {};
  }
}

function startHtml() {
  return `
    <section class="qz">
      <p class="crumbs"><a href="#/">← Студия</a></p>
      <p class="eyebrow">Русский язык · 5–7 минут · без регистрации</p>
      <h1>Проверь себя перед экзаменом</h1>
      <p class="lede">10 вопросов: задания из настоящего банка ВПР, ОГЭ или ЕГЭ и вопросы по правилам. В конце — результат по темам и что подтянуть.</p>
      <p class="qz-q">В каком ты классе?</p>
      <div class="qz-grades">
        ${[8, 9, 10, 11].map((g) => `<button class="qz-grade" type="button" data-grade="${g}"><strong>${g} класс</strong><span>${EXAM_TITLE[EXAM_OF[g]]}</span></button>`).join("")}
      </div>
    </section>`;
}

export async function mountQuiz(host) {
  // ссылки «ВПР / ОГЭ / ЕГЭ» с главной сразу открывают тест нужного класса: #/check?g=9
  const g = Number(new URLSearchParams(location.hash.split("?")[1] || "").get("g"));
  if (EXAM_OF[g]) {
    history.replaceState(null, "", `${location.pathname}${location.search}#/check`);
    return run(host, g);
  }
  host.innerHTML = startHtml();
  host.querySelectorAll("[data-grade]").forEach((b) => b.addEventListener("click", () => run(host, Number(b.dataset.grade))));
}

async function run(host, grade) {
  const exam = EXAM_OF[grade];
  host.innerHTML = `<section class="qz"><p class="muted">Подбираем задания…</p></section>`;
  goal("quiz_start");
  let quiz;
  try {
    const { data, error } = await supa.rpc("quiz_start", { p_exam: exam });
    if (error) throw error;
    quiz = data;
  } catch (err) {
    host.innerHTML = `<section class="qz"><p class="lit-result is-bad">${escapeHtml(humanError(err).message || "Не удалось загрузить задания")}</p><p class="actions"><button class="btn" type="button" id="qz-retry">Попробовать ещё раз</button></p></section>`;
    host.querySelector("#qz-retry").addEventListener("click", () => run(host, grade));
    return;
  }
  const sanitize = sanitizeFor(exam);
  const titles = await taskTitles(exam);
  const rules = pickRules(grade, 10 - quiz.tasks.length);
  const steps = [...quiz.tasks.map((t) => ({ kind: "task", t })), ...rules.map((r) => ({ kind: "rule", r }))];
  const answers = {};
  const ruleAnswers = [];
  const total = steps.length;

  const show = (i) => {
    if (i >= total) return finish();
    const s = steps[i];
    const bar = `<div class="qz-top"><span class="eyebrow">${s.kind === "task" ? `${EXAM_TITLE[exam]} · задание ${s.t.task_no}` : "Правила"}</span><span class="muted">${i + 1} из ${total}</span></div>
      <div class="qz-bar"><span style="width:${Math.round((i / total) * 100)}%"></span></div>`;
    if (s.kind === "task") {
      const numeric = /digits|numbers/.test(s.t.mode || "");
      const hint = s.t.mode === "digits-fixed" ? "Цифры по порядку, например: 312" : numeric ? "Например: 24" : "Слово или словосочетание";
      host.innerHTML = `
        <section class="qz">
          ${bar}
          ${quiz.passage ? `<details class="qz-text card" ${i === 0 ? "open" : ""}><summary>Текст к заданиям</summary><div class="lit-html">${sanitize(quiz.passage.html)}</div></details>` : ""}
          <div class="lit-html qz-task">${sanitize(s.t.question || "")}</div>
          <form class="qz-form" autocomplete="off">
            <input class="search" name="a" ${numeric ? 'inputmode="numeric"' : ""} placeholder="${hint}" value="${escapeHtml(answers[s.t.id] || "")}" />
            <div class="actions"><button class="btn" type="submit">Дальше</button><button class="btn secondary" type="button" data-skip>Не знаю</button></div>
          </form>
        </section>`;
      const form = host.querySelector(".qz-form");
      form.a.focus({ preventScroll: true });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        answers[s.t.id] = form.a.value.trim();
        show(i + 1);
      });
      form.querySelector("[data-skip]").addEventListener("click", () => {
        answers[s.t.id] = "";
        show(i + 1);
      });
    } else {
      host.innerHTML = `
        <section class="qz">
          ${bar}
          <p class="qz-rule-q">${escapeHtml(s.r.q)}</p>
          <div class="qz-opts">${s.r.o.map((o, k) => `<button class="qz-opt" type="button" data-k="${k}">${escapeHtml(o)}</button>`).join("")}</div>
        </section>`;
      host.querySelectorAll("[data-k]").forEach((b) =>
        b.addEventListener("click", () => {
          ruleAnswers[i - quiz.tasks.length] = Number(b.dataset.k);
          show(i + 1);
        })
      );
    }
    window.scrollTo({ top: 0 });
  };

  const finish = async () => {
    host.innerHTML = `<section class="qz"><p class="muted">Проверяем ответы…</p></section>`;
    let checked;
    try {
      const { data, error } = await supa.rpc("quiz_check", { p_session: quiz.session, p_answers: answers });
      if (error) throw error;
      checked = data.results;
    } catch (err) {
      host.innerHTML = `<section class="qz"><p class="lit-result is-bad">${escapeHtml(humanError(err).message || "Не удалось проверить ответы")}</p><p class="actions"><a class="btn" href="#/check">Начать заново</a></p></section>`;
      return;
    }
    goal("quiz_finish");
    showResult(host, { grade, exam, checked, rules, ruleAnswers, answers, titles });
  };

  show(0);
}

function showResult(host, { grade, exam, checked, rules, ruleAnswers, answers, titles }) {
  const taskOk = checked.filter((r) => r.correct).length;
  const ruleOk = rules.filter((r, k) => ruleAnswers[k] === r.a).length;
  const score = taskOk + ruleOk;
  const total = checked.length + rules.length;
  const miss = { orfo: 0, punct: 0, norm: 0 };
  checked.forEach((r) => !r.correct && miss[topicOfTitle(titles[r.task_no] || "")]++);
  rules.forEach((r, k) => ruleAnswers[k] !== r.a && miss[r.topic]++);
  const weak = Object.entries(miss).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([t]) => TOPIC_TITLE[t]);
  const weakText = weak.length ? weak.slice(0, 2).join(" и ") : "";
  const advice =
    score >= total - 1
      ? `Отличная база! Дальше стоит сосредоточиться на самом трудном — письменной части ${EXAM_TITLE[exam]} и заданиях с подвохом. Этим мы и занимаемся на уроках.`
      : score >= Math.ceil(total * 0.6)
        ? `Хорошая основа, но есть пробелы${weakText ? `: ${weakText}` : ""}. Такие темы мы разбираем на занятиях на заданиях ${EXAM_TITLE[exam]} — до уверенного результата.`
        : `Есть над чем поработать${weakText ? `: ${weakText}` : ""}. Лучше начать сейчас, пока до экзамена есть время: на занятиях разберём правила на настоящих заданиях ${EXAM_TITLE[exam]} и отработаем их.`;
  const taskRows = checked
    .map(
      (r) => `<li class="${r.correct ? "is-ok" : "is-bad"}"><span>${r.correct ? "✓" : "✗"}</span><span>Задание ${r.task_no}${titles[r.task_no] ? ` · ${escapeHtml(titles[r.task_no])}` : ""}${
        r.correct ? "" : `<small>Ваш ответ: ${escapeHtml(answers[r.id] || "—")} · верно: ${escapeHtml(r.answer || "—")}</small>`
      }</span></li>`
    )
    .join("");
  const ruleRows = rules
    .map((r, k) => {
      const ok = ruleAnswers[k] === r.a;
      return `<li class="${ok ? "is-ok" : "is-bad"}"><span>${ok ? "✓" : "✗"}</span><span>${escapeHtml(r.q)}${
        ok ? "" : `<small>Верно: ${escapeHtml(r.o[r.a])}. ${escapeHtml(r.why)}${r.rule ? ` <a href="#/rule/${encodeURIComponent(r.rule)}">Правило →</a>` : ""}</small>`
      }</span></li>`;
    })
    .join("");
  host.innerHTML = `
    <section class="qz">
      <p class="eyebrow">Результат · ${grade} класс · ${EXAM_TITLE[exam]}</p>
      <h1>${score} из ${total}</h1>
      <div class="qz-score">
        <div><strong>${taskOk}/${checked.length}</strong><span>задания ${EXAM_TITLE[exam]}</span></div>
        <div><strong>${ruleOk}/${rules.length}</strong><span>правила</span></div>
      </div>
      <p class="lede">${escapeHtml(advice)}</p>
      <div class="qz-cta card">
        <p><strong>Хотите подготовиться к ${EXAM_TITLE[exam]} спокойно и уверенно?</strong></p>
        <p class="muted">Занятия в студии «Лексикон» — очно в Горно-Алтайске или онлайн, в группе до четырёх человек или индивидуально.</p>
        <p class="actions"><button class="btn btn-lg" type="button" data-apply>Записаться на занятия</button></p>
      </div>
      <h2>Задания</h2>
      <ul class="qz-list">${taskRows}</ul>
      <h2>Правила</h2>
      <ul class="qz-list">${ruleRows}</ul>
      <p class="actions"><a class="btn secondary" href="#/check" data-again>Пройти ещё раз</a> <a class="btn secondary" href="#/rules">Все правила</a></p>
    </section>`;
  window.scrollTo({ top: 0 });
  host.querySelector("[data-again]").addEventListener("click", (e) => {
    e.preventDefault();
    mountQuiz(host);
  });
  host.querySelector("[data-apply]").addEventListener("click", () => {
    goal("quiz_apply");
    try {
      sessionStorage.setItem(
        "applyPrefill",
        JSON.stringify({
          grade: String(grade),
          subject: "Русский язык",
          goal: EXAM_TITLE[exam],
          note: `Результат «Проверь себя» (${EXAM_TITLE[exam]}): ${score} из ${total} — задания ${taskOk}/${checked.length}, правила ${ruleOk}/${rules.length}${weakText ? `; подтянуть: ${weakText}` : ""}.`,
        })
      );
    } catch {}
    location.hash = "#apply";
  });
}
