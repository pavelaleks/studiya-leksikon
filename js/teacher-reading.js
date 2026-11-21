// Кабинет преподавателя → «Чтение»: кто что прочитал и выучил; тесты по статьям (добавить, изменить, скрыть).
import { BASE } from "./config.js";
import { escapeHtml } from "./ui.js";
import { humanError, supa } from "./supa.js";

const FORMAT = `Название: «Отцы и дети»
Ссылка: https://polka.academy/articles/509
Произведение: otcy
Очки: 20
Вступление: Сначала прочитай статью целиком.

? Кем был Евгений Базаров?
+ студентом-медиком
- студентом-юристом
- отставным офицером
- учителем словесности
# 989

? Следующий вопрос…
+ верный ответ (ровно один «+»)
- неверный`;

/** Разбор текстового формата теста. Строка «# N» — номер блока статьи «Полки» для подсказки. */
export function parseQuiz(text) {
  const quiz = { title: "", url: "", work_id: null, points: 20, intro: "", questions: [] };
  let cur = null;
  const errors = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const meta = line.match(/^(Название|Ссылка|Произведение|Очки|Вступление)\s*:\s*(.*)$/i);
    if (meta) {
      const [, k, v] = meta;
      const key = k.toLowerCase();
      if (key === "название") quiz.title = v.trim();
      if (key === "ссылка") quiz.url = v.trim();
      if (key === "произведение") quiz.work_id = v.trim() || null;
      if (key === "очки") quiz.points = Math.max(0, Math.min(100, parseInt(v, 10) || 20));
      if (key === "вступление") quiz.intro = v.trim();
      return;
    }
    if (line.startsWith("?")) {
      cur = { q: line.slice(1).trim(), o: [], right: -1, b: null };
      quiz.questions.push(cur);
      return;
    }
    if (!cur) return errors.push(`Строка ${i + 1}: сначала вопрос («? …»)`);
    if (line.startsWith("+") || line.startsWith("-")) {
      if (line.startsWith("+")) {
        if (cur.right >= 0) errors.push(`Вопрос «${cur.q}»: два верных ответа`);
        cur.right = cur.o.length;
      }
      cur.o.push(line.slice(1).trim());
      return;
    }
    if (line.startsWith("#")) {
      cur.b = parseInt(line.slice(1), 10) || null;
      return;
    }
    errors.push(`Строка ${i + 1}: непонятно «${line.slice(0, 40)}»`);
  });
  if (!quiz.title) errors.push("Нет строки «Название: …»");
  if (!quiz.questions.length) errors.push("Нет ни одного вопроса");
  quiz.questions.forEach((q) => {
    if (q.o.length < 2) errors.push(`Вопрос «${q.q}»: нужно хотя бы два варианта`);
    if (q.right < 0) errors.push(`Вопрос «${q.q}»: отметьте верный вариант знаком «+»`);
  });
  return { quiz, errors };
}

function toText(q, key) {
  const lines = [`Название: ${q.title}`];
  if (q.url) lines.push(`Ссылка: ${q.url}`);
  if (q.work_id) lines.push(`Произведение: ${q.work_id}`);
  lines.push(`Очки: ${q.points}`);
  if (q.intro) lines.push(`Вступление: ${q.intro}`);
  q.questions.forEach((it, i) => {
    lines.push("", `? ${it.q}`);
    it.o.forEach((o, k) => lines.push(`${key?.[i] === k ? "+" : "-"} ${o}`));
    if (it.b) lines.push(`# ${it.b}`);
  });
  return lines.join("\n");
}

function shuffled(q) {
  const questions = [];
  const answers = [];
  q.questions.forEach((it) => {
    const order = it.o.map((_, i) => i).sort(() => Math.random() - 0.5);
    questions.push({ q: it.q, o: order.map((i) => it.o[i]), b: it.b || undefined });
    answers.push(order.indexOf(it.right));
  });
  return { questions, answers };
}

export async function readingView(host, render, sub) {
  if (sub === "new" || /^\d+$/.test(sub || "")) return quizEditView(host, render, sub);
  const poemTitles = await fetch(new URL("js/library-data/poems.json?v=lib1", new URL(BASE, location.href)))
    .then((r) => r.json())
    .then((d) => new Map(d.poems.map((p) => [p.id, `${p.author.split(" ").pop()}. ${p.title}`])))
    .catch(() => new Map());
  const rl = await import("./reading-list.js?v=land179");
  const { examsOf } = await import("./reading-canon.js?v=land179");
  const [students, results, learned, quizzes, marks] = await Promise.all([
    supa.from("profiles").select("id, full_name, email, status, courses, exam_target").neq("role", "teacher").eq("status", "active").order("full_name"),
    supa.from("reading_results").select("student_id, quiz_id, passed, created_at"),
    supa.from("poems_learned").select("student_id, poem_id, learned_at"),
    supa.from("reading_quizzes").select("id, title, work_id, is_published, position, url").order("position"),
    rl.readCounts().catch(() => ({ counts: new Map(), totals: {} })),
  ]);
  const listCell = (p) => {
    const ex = examsOf(p);
    if (!ex.length) return "—";
    return ex
      .map((e) => {
        const n = marks.counts.get(p.id + ":" + e) || 0;
        return `<a href="#/cabinet/student/${p.id}/reading/${e}"><strong>${n}</strong>/${marks.totals[e]} ${e === "oge" ? "ОГЭ" : "ЕГЭ"}</a>`;
      })
      .join("<br>");
  };
  for (const r of [students, results, learned, quizzes]) if (r.error) throw r.error;
  const passedBy = new Map();
  const triedBy = new Map();
  (results.data || []).forEach((r) => {
    const m = r.passed ? passedBy : triedBy;
    if (!m.has(r.student_id)) m.set(r.student_id, new Set());
    m.get(r.student_id).add(r.quiz_id);
  });
  const poemsBy = new Map();
  (learned.data || []).forEach((r) => {
    if (!poemsBy.has(r.student_id)) poemsBy.set(r.student_id, []);
    poemsBy.get(r.student_id).push(r.poem_id);
  });
  const qTitle = new Map((quizzes.data || []).map((q) => [q.id, q.title]));
  // По умолчанию — только ученики с курсом литературы (или те, кто уже что-то сдавал).
  const showAll = /[?&]all=1/.test(location.hash);
  const isLit = (p) =>
    (p.courses || []).some((c) => c.startsWith("lit:")) || (!(p.courses || []).length && /литератур/i.test(p.exam_target || ""));
  const shown = (students.data || []).filter((p) => showAll || isLit(p) || passedBy.has(p.id) || triedBy.has(p.id) || poemsBy.has(p.id));
  const hiddenCount = (students.data || []).length - shown.length;
  const rows = shown
    .map((p) => {
      const passed = [...(passedBy.get(p.id) || [])];
      const poems = poemsBy.get(p.id) || [];
      const tried = [...(triedBy.get(p.id) || [])].filter((id) => !passed.includes(id));
      return `
      <tr>
        <td><a href="#/cabinet/student/${p.id}">${escapeHtml(p.full_name || p.email)}</a></td>
        <td>${listCell(p)}</td>
        <td>${passed.length ? `<strong>${passed.length}</strong> <small class="muted">${passed.map((id) => escapeHtml(qTitle.get(id) || "")).join(", ")}</small>` : "—"}
          ${tried.length ? `<br><small class="muted">не сдано: ${tried.map((id) => escapeHtml(qTitle.get(id) || "")).join(", ")}</small>` : ""}</td>
        <td>${poems.length ? `<strong>${poems.length}</strong> <small class="muted">${poems.map((id) => `<a href="#/library/poems/${id}">${escapeHtml(poemTitles.get(id) || id)}</a>`).join(", ")}</small>` : "—"}</td>
      </tr>`;
    })
    .join("");
  render(`
    <div class="t-head">
      <h1>Чтение</h1>
      <p class="muted">Тесты по статьям «Полки» и стихи наизусть. Ученики проходят их в <a href="#/library">библиотеке</a>; очки начисляются автоматически.</p>
    </div>
    <section class="card">
      <h2>Ученики</h2>
      <div class="t-table-wrap"><table class="t-table">
        <thead><tr><th>Ученик</th><th>Список чтения</th><th>Статьи (сдано)</th><th>Стихи наизусть</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="muted">Нет учеников с курсом литературы.</td></tr>`}</tbody>
      </table></div>
      <p class="muted">${showAll ? `Показаны все ученики. <a href="#/cabinet/reading">Только литература</a>` : `Показаны ученики с курсом литературы${hiddenCount ? ` · ещё ${hiddenCount} без него — <a href="#/cabinet/reading?all=1">показать всех</a>` : ""}.`}</p>
    </section>
    <section class="card">
      <div class="t-row-between"><h2>Тесты по статьям</h2><a class="btn" href="#/cabinet/reading/new">Добавить тест</a></div>
      <ul class="t-reading-list">${(quizzes.data || [])
        .map(
          (q) => `<li class="${q.is_published ? "" : "is-off"}"><a href="#/cabinet/reading/${q.id}">${escapeHtml(q.title)}</a>
            ${q.is_published ? "" : `<span class="lib-mark">скрыт</span>`}
            <small class="muted">${[...passedBy.values()].filter((s) => s.has(q.id)).length} сдали</small>
            <a class="muted" href="#/library/quiz/${q.id}">как видит ученик</a></li>`
        )
        .join("")}</ul>
    </section>`);
}

async function quizEditView(host, render, id) {
  let q = null;
  let key = null;
  if (id !== "new") {
    const [a, b] = await Promise.all([
      supa.from("reading_quizzes").select("*").eq("id", id).maybeSingle(),
      supa.from("reading_keys").select("answers").eq("quiz_id", id).maybeSingle(),
    ]);
    if (a.error) throw a.error;
    q = a.data;
    key = b.data?.answers || null;
    if (!q) return render(`<div class="empty">Тест не найден. <a href="#/cabinet/reading">Назад</a></div>`);
  }
  render(`
    <p class="crumbs"><a href="#/cabinet/reading">← Чтение</a></p>
    <h1>${q ? "Тест: " + escapeHtml(q.title) : "Новый тест по статье"}</h1>
    <p class="muted">Вопрос начинается с «?», верный вариант — с «+», неверные — с «-». Строка «# 989» — номер раздела статьи «Полки» (берётся из адреса раздела <code>?block=989</code>), ученик увидит ссылку «Где искать ответ». Варианты при сохранении перемешиваются.</p>
    <form id="rq-form" class="stack card">
      <textarea name="text" rows="22" spellcheck="false" class="t-mono">${escapeHtml(q ? toText(q, key) : FORMAT)}</textarea>
      ${q ? `<label class="lib-check"><input type="checkbox" name="published" ${q.is_published ? "checked" : ""}/> показывать ученикам</label>` : ""}
      <p class="actions"><button class="btn" type="submit">Сохранить</button>
        ${q ? `<button class="btn secondary" type="button" id="rq-delete">Удалить тест</button>` : ""}</p>
      <div id="rq-status" class="lit-result" aria-live="polite"></div>
    </form>`);
  const form = host.querySelector("#rq-form");
  const status = host.querySelector("#rq-status");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { quiz, errors } = parseQuiz(form.text.value);
    if (errors.length) {
      status.className = "lit-result is-bad";
      status.innerHTML = errors.map(escapeHtml).join("<br>");
      return;
    }
    const { questions, answers } = shuffled(quiz);
    const row = {
      title: quiz.title,
      url: quiz.url || null,
      work_id: quiz.work_id,
      points: quiz.points,
      intro: quiz.intro || null,
      kind: /polka\.academy/.test(quiz.url) ? "polka" : "other",
      questions,
      is_published: form.published ? form.published.checked : true,
    };
    try {
      let quizId = q?.id;
      if (q) {
        const r = await supa.from("reading_quizzes").update(row).eq("id", q.id);
        if (r.error) throw r.error;
      } else {
        const r = await supa.from("reading_quizzes").insert({ ...row, position: 1000 }).select("id").single();
        if (r.error) throw r.error;
        quizId = r.data.id;
      }
      const k = await supa.from("reading_keys").upsert({ quiz_id: quizId, answers }, { onConflict: "quiz_id" });
      if (k.error) throw k.error;
      status.className = "lit-result is-ok";
      status.textContent = "Сохранено.";
      if (!q) location.hash = `#/cabinet/reading/${quizId}`;
    } catch (err) {
      status.className = "lit-result is-bad";
      status.textContent = humanError(err);
    }
  });
  host.querySelector("#rq-delete")?.addEventListener("click", async () => {
    if (!confirm("Удалить тест? Результаты учеников по нему тоже удалятся (очки останутся).")) return;
    const r = await supa.from("reading_quizzes").delete().eq("id", q.id);
    if (r.error) {
      status.className = "lit-result is-bad";
      status.textContent = humanError(r.error);
      return;
    }
    location.hash = "#/cabinet/reading";
  });
}
