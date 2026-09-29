import { BASE } from "./config.js";
import { escapeHtml } from "./ui.js";

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadTrainer(slug) {
  const url = new URL(`js/trainers-data/${encodeURIComponent(slug)}.json`, new URL(BASE, location.href)).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось загрузить тренажёр ${slug}`);
  return res.json();
}

function sameCommas(user, correct) {
  const a = (user || []).slice().sort((x, y) => x - y);
  const b = (correct || []).slice().sort((x, y) => x - y);
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function sameIds(user, correct) {
  const a = [...new Set(user || [])].map(String).sort();
  const b = [...new Set(correct || [])].map(String).sort();
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function findPhraseWordIndices(words, phrase) {
  if (!phrase || !words?.length) return [];
  const phraseWords = phrase.trim().split(/\s+/);
  if (!phraseWords.length) return [];
  for (let start = 0; start <= words.length - phraseWords.length; start++) {
    if (words.slice(start, start + phraseWords.length).join(" ") === phrase.trim()) {
      return Array.from({ length: phraseWords.length }, (_, i) => start + i);
    }
  }
  return [];
}

function sentenceWithCommas(words, commas) {
  const set = new Set(commas || []);
  return words.map((w, i) => (set.has(i) ? `${w},` : w)).join(" ");
}

function typeLabel(type) {
  if (type === "spelling.nn") return "Орфография";
  if (type === "punctuation.commas") return "Пунктуация";
  if (type === "syntax.basis") return "Синтаксис";
  return "Тренажёр";
}

function gradeFromPct(pct) {
  if (pct >= 85) return 5;
  if (pct >= 70) return 4;
  if (pct >= 50) return 3;
  return 2;
}

function isPunct(tok) {
  return /^[^\p{L}\p{N}—–-]+$/u.test(tok);
}

function renderSentenceTokens(words, marks) {
  const subject = new Set(marks?.subject || []);
  const predicate = new Set(marks?.predicate || []);
  const nullAfter = marks?.nullCopulaAfter;
  const show = Boolean(marks);

  return words
    .map((word, i) => {
      const classes = ["basis-tok"];
      if (show && subject.has(i)) classes.push("is-subject");
      if (show && predicate.has(i)) classes.push("is-predicate");
      if (isPunct(word)) classes.push("is-punct");
      let html = `<span class="${classes.join(" ")}">${escapeHtml(word)}</span>`;
      if (show && nullAfter === i) {
        html += `<span class="basis-null" title="Нулевая связка (есть)">∅</span>`;
      }
      const next = words[i + 1];
      const space = next && !isPunct(next) && !isPunct(word) ? " " : next && isPunct(next) ? "" : next ? " " : "";
      return html + space;
    })
    .join("");
}

function renderBasisReveal(exercise) {
  const correctOpts = (exercise.options || []).filter((o) => o.correct && o.visual);
  if (!correctOpts.length) return "";

  const cards = correctOpts
    .map((o) => {
      const v = o.visual;
      const sentHtml = renderSentenceTokens(v.words || [], v);
      const nullRow = v.nullCopula
        ? `<li><span class="basis-pill null">∅ нулевая связка</span> вместо глагола «есть» — именное сказуемое</li>`
        : "";
      return `
        <article class="basis-reveal-card">
          <p class="basis-reveal-head">Вариант ${escapeHtml(o.id)} · предложение ${escapeHtml(String(o.sentence))} · <strong>${escapeHtml(
            o.label
          )}</strong></p>
          <p class="basis-sentence">${sentHtml}</p>
          <ul class="basis-how">
            <li><span class="basis-pill subject">подлежащее</span> ${escapeHtml(v.subjectHow || "—")}</li>
            <li><span class="basis-pill predicate">сказуемое</span> ${escapeHtml(v.predicateHow || "—")}</li>
            ${nullRow}
          </ul>
        </article>`;
    })
    .join("");

  return `
    <div class="basis-reveal">
      <p class="kicker">Разбор верных основ</p>
      <p class="trainer-legend muted">
        <span class="leg-subject">подлежащее</span>
        <span class="leg-predicate">сказуемое</span>
        <span class="leg-null">∅ нулевая связка</span>
      </p>
      ${cards}
    </div>`;
}

function renderNN(exercise, state) {
  const parts = String(exercise.phrase || "").split("___");
  const gap = state.chosen
    ? `<span class="trainer-gap filled">${escapeHtml(state.chosen)}</span>`
    : `<span class="trainer-gap">___</span>`;
  return `
    <p class="trainer-prompt">${escapeHtml(parts[0] || "")}${gap}${escapeHtml(parts[1] || "")}</p>
    <div class="trainer-nn-toggle" role="group" aria-label="Выберите Н или НН">
      <button type="button" class="trainer-nn-btn ${state.chosen === "н" ? "active" : ""}" data-nn="н">Н</button>
      <button type="button" class="trainer-nn-btn ${state.chosen === "нн" ? "active" : ""}" data-nn="нн">НН</button>
    </div>
    ${
      state.checked
        ? `
      <div class="trainer-feedback ${state.ok ? "ok" : "bad"}">${state.ok ? "Верно" : "Ошибка"}</div>
      ${
        !state.ok
          ? `<div class="note"><p class="kicker">Правильно</p><p><strong>${escapeHtml(exercise.word || "")}</strong></p></div>`
          : ""
      }
      ${
        exercise.comment
          ? `<div class="exceptions"><p><strong>${escapeHtml(exercise.word || "")}</strong>. ${escapeHtml(exercise.comment)}</p></div>`
          : ""
      }`
        : ""
    }`;
}

function renderPunctuation(exercise, state) {
  const words = exercise.words || [];
  const correct = new Set(exercise.commas || []);
  const user = new Set(state.userCommas || []);
  const p1 = findPhraseWordIndices(words, exercise.phrase || "");
  const p2 = findPhraseWordIndices(words, exercise.phrase2 || "");
  const participle = new Set();
  const gerund = new Set();
  if (exercise.phraseType === "participle") p1.forEach((i) => participle.add(i));
  if (exercise.phraseType2 === "participle") p2.forEach((i) => participle.add(i));
  if (exercise.phraseType === "gerund") p1.forEach((i) => gerund.add(i));
  if (exercise.phraseType2 === "gerund") p2.forEach((i) => gerund.add(i));

  const sentence = words
    .map((word, i) => {
      let cls = "trainer-word";
      if (state.checked && participle.has(i)) cls += " is-participle";
      if (state.checked && gerund.has(i)) cls += " is-gerund";
      const wordHtml = `<span class="${cls}">${escapeHtml(word)}</span>`;
      if (i >= words.length - 1) return wordHtml;
      const on = user.has(i);
      let slotCls = "trainer-comma-slot";
      if (on) slotCls += " on";
      if (state.checked && correct.has(i) && !on) slotCls += " miss";
      if (state.checked && on && !correct.has(i)) slotCls += " wrong";
      return `${wordHtml}<button type="button" class="${slotCls}" data-slot="${i}" aria-label="${
        on ? "Убрать запятую" : "Поставить запятую"
      }">${on ? "," : "&nbsp;"}</button>`;
    })
    .join("");

  const legend =
    state.checked && (participle.size || gerund.size)
      ? `<p class="trainer-legend muted">
          ${participle.size ? `<span class="leg-participle">причастный оборот</span>` : ""}
          ${gerund.size ? `<span class="leg-gerund">деепричастный оборот</span>` : ""}
        </p>`
      : "";

  return `
    <p class="trainer-prompt trainer-prompt-punct">${sentence}</p>
    ${legend}
    ${
      !state.checked
        ? `<div class="actions"><button type="button" class="btn secondary" data-reset-commas>Сбросить запятые</button></div>`
        : ""
    }
    ${
      state.checked
        ? `
      <div class="trainer-feedback ${state.ok ? "ok" : "bad"}">${
          state.ok ? "Верно" : "Ошибка. Смотрите правильный вариант ниже."
        }</div>
      <div class="trainer-compare">
        <div class="note">
          <p class="kicker">Ваш ответ</p>
          <p>${escapeHtml(
            state.userCommas?.length ? sentenceWithCommas(words, state.userCommas) : "—"
          )}</p>
        </div>
        <div class="exceptions">
          <p class="kicker">Правильно</p>
          <p>${escapeHtml(sentenceWithCommas(words, exercise.commas || []))}</p>
        </div>
      </div>
      ${exercise.comment ? `<div class="exceptions"><p>${escapeHtml(exercise.comment)}</p></div>` : ""}`
        : ""
    }`;
}

function renderBasis(exercise, state) {
  const selected = new Set(state.selected || []);
  const correctIds = (exercise.options || []).filter((o) => o.correct).map((o) => String(o.id));

  const textHtml = (exercise.sentences || [])
    .map((s, i) => `<p class="basis-passage-sent"><span class="basis-num">(${i + 1})</span> ${escapeHtml(s)}</p>`)
    .join("");

  const optionsHtml = (exercise.options || [])
    .map((o) => {
      const id = String(o.id);
      const on = selected.has(id);
      let cls = "basis-option";
      if (on) cls += " on";
      if (state.checked) {
        if (o.correct && on) cls += " ok";
        else if (o.correct && !on) cls += " miss";
        else if (!o.correct && on) cls += " wrong";
      }
      const mark = state.checked
        ? o.correct
          ? `<span class="basis-mark ok" aria-hidden="true">✓</span>`
          : on
            ? `<span class="basis-mark bad" aria-hidden="true">✗</span>`
            : ""
        : "";
      const why =
        state.checked && !o.correct && on && o.whyWrong
          ? `<p class="basis-why muted">${escapeHtml(o.whyWrong)}</p>`
          : "";
      return `
        <button type="button" class="${cls}" data-opt="${escapeHtml(id)}" ${state.checked ? "disabled" : ""}>
          <span class="basis-opt-id">${escapeHtml(id)}</span>
          <span class="basis-opt-body">
            <span class="basis-opt-label">${escapeHtml(o.label)}</span>
            <span class="basis-opt-sent muted">предложение ${escapeHtml(String(o.sentence))}</span>
            ${why}
          </span>
          ${mark}
        </button>`;
    })
    .join("");

  return `
    <div class="basis-passage">${textHtml}</div>
    <p class="basis-task muted">Выберите все варианты, в которых грамматическая основа указана верно. Может быть несколько ответов.</p>
    <div class="basis-options" role="group" aria-label="Варианты основ">${optionsHtml}</div>
    ${
      state.checked
        ? `
      <div class="trainer-feedback ${state.ok ? "ok" : "bad"}">${
          state.ok
            ? "Верно"
            : `Ошибка. Правильный ответ: ${escapeHtml(exercise.answer || correctIds.join(""))}`
        }</div>
      ${renderBasisReveal(exercise)}
      ${
        exercise.comment
          ? `<details class="basis-comment"><summary>Полный комментарий</summary><p>${escapeHtml(
              exercise.comment
            )}</p></details>`
          : ""
      }`
        : ""
    }`;
}

/**
 * Mount interactive OGE trainer into a container element.
 * Returns a cleanup function.
 */
export async function mountTrainer(root, slug) {
  root.innerHTML = `<div class="card"><p class="muted">Загружаем тренажёр…</p></div>`;
  let data;
  try {
    data = await loadTrainer(slug);
  } catch (err) {
    root.innerHTML = `<div class="empty">Не удалось открыть тренажёр.<br>${escapeHtml(
      err.message
    )}<br><a href="#/oge">К разделу ОГЭ</a></div>`;
    return () => {};
  }

  const exercises = shuffle(data.exercises || []);
  const state = {
    phase: "start",
    index: 0,
    correct: 0,
    checked: false,
    chosen: null,
    userCommas: [],
    selected: [],
  };

  const kind = () => {
    if (data.type === "spelling.nn") return "nn";
    if (data.type === "punctuation.commas") return "punct";
    if (data.type === "syntax.basis") return "basis";
    return "punct";
  };

  const hintFor = (k) => {
    if (k === "nn") return "Выберите Н или НН на месте пропуска.";
    if (k === "punct") return "Нажмите между словами, чтобы поставить или убрать запятую.";
    return "Отметьте все верные варианты грамматической основы — как в задании 2 ОГЭ.";
  };

  const paint = () => {
    if (state.phase === "start") {
      root.innerHTML = `
        <div class="crumbs"><a href="#/oge">← ОГЭ</a></div>
        <div class="card trainer-start">
          <p class="landing-exams"><span>${escapeHtml(typeLabel(data.type))}</span><span>${
            data.count || exercises.length
          } заданий</span></p>
          <h1>${escapeHtml(data.name)}</h1>
          <p class="lede">${escapeHtml(data.description || "")}</p>
          <div class="actions"><button type="button" class="btn btn-lg" data-start>Начать</button></div>
        </div>`;
      root.querySelector("[data-start]").onclick = () => {
        state.phase = "exercise";
        state.index = 0;
        state.correct = 0;
        state.checked = false;
        state.chosen = null;
        state.userCommas = [];
        state.selected = [];
        paint();
      };
      return;
    }

    if (state.phase === "result") {
      const pct = exercises.length ? Math.round((state.correct / exercises.length) * 100) : 0;
      root.innerHTML = `
        <div class="crumbs"><a href="#/oge">← ОГЭ</a></div>
        <div class="card trainer-result">
          <p class="eyebrow">Итог</p>
          <h1>${escapeHtml(data.name)}</h1>
          <p class="lede">Верно ${state.correct} из ${exercises.length} (${pct}%). Оценка: ${gradeFromPct(pct)}.</p>
          <div class="home-actions">
            <button type="button" class="btn btn-lg" data-again>Ещё раз</button>
            <a class="btn btn-lg secondary" href="#/oge">К разделу ОГЭ</a>
          </div>
        </div>`;
      root.querySelector("[data-again]").onclick = () => {
        state.phase = "start";
        paint();
      };
      return;
    }

    const ex = exercises[state.index];
    const k = kind();
    const correctIds = (ex.options || []).filter((o) => o.correct).map((o) => String(o.id));
    const ok =
      k === "nn"
        ? state.chosen === ex.answer
        : k === "basis"
          ? sameIds(state.selected, correctIds)
          : sameCommas(state.userCommas, ex.commas || []);
    if (state.checked) state.ok = ok;

    const body =
      k === "nn"
        ? renderNN(ex, { chosen: state.chosen, checked: state.checked, ok })
        : k === "basis"
          ? renderBasis(ex, { selected: state.selected, checked: state.checked, ok })
          : renderPunctuation(ex, {
              userCommas: state.userCommas,
              checked: state.checked,
              ok,
            });

    const canCheck = k === "nn" ? state.chosen !== null : k === "basis" ? state.selected.length > 0 : true;
    const progress = exercises.length ? Math.round((state.index / exercises.length) * 100) : 0;

    root.innerHTML = `
      <div class="crumbs"><a href="#/oge">← ОГЭ</a></div>
      <div class="card trainer-card">
        <div class="trainer-progress" aria-hidden="true"><span style="width:${progress}%"></span></div>
        <p class="kicker">Задание ${state.index + 1} из ${exercises.length}</p>
        <h2 class="trainer-title">${escapeHtml(data.name)}</h2>
        <p class="muted">${hintFor(k)}</p>
        <div class="trainer-body">${body}</div>
        <div class="actions trainer-actions">
          ${
            state.checked
              ? `<button type="button" class="btn btn-lg" data-next>${
                  state.index + 1 >= exercises.length ? "Итог" : "Дальше"
                }</button>`
              : `<button type="button" class="btn btn-lg" data-check ${canCheck ? "" : "disabled"}>Проверить</button>`
          }
        </div>
      </div>`;

    root.querySelectorAll("[data-nn]").forEach((btn) => {
      btn.onclick = () => {
        if (state.checked) return;
        state.chosen = btn.getAttribute("data-nn");
        paint();
      };
    });

    root.querySelectorAll("[data-slot]").forEach((btn) => {
      btn.onclick = () => {
        if (state.checked) return;
        const i = Number(btn.getAttribute("data-slot"));
        const set = new Set(state.userCommas);
        if (set.has(i)) set.delete(i);
        else set.add(i);
        state.userCommas = [...set].sort((a, b) => a - b);
        paint();
      };
    });

    root.querySelectorAll("[data-opt]").forEach((btn) => {
      btn.onclick = () => {
        if (state.checked) return;
        const id = btn.getAttribute("data-opt");
        const set = new Set(state.selected);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        state.selected = [...set].sort();
        paint();
      };
    });

    root.querySelector("[data-reset-commas]")?.addEventListener("click", () => {
      if (state.checked) return;
      state.userCommas = [];
      paint();
    });

    root.querySelector("[data-check]")?.addEventListener("click", () => {
      if (state.checked) return;
      if (k === "nn" && state.chosen === null) return;
      if (k === "basis" && !state.selected.length) return;
      const good =
        k === "nn"
          ? state.chosen === ex.answer
          : k === "basis"
            ? sameIds(state.selected, correctIds)
            : sameCommas(state.userCommas, ex.commas || []);
      state.checked = true;
      if (good) state.correct += 1;
      paint();
    });

    root.querySelector("[data-next]")?.addEventListener("click", () => {
      if (state.index + 1 >= exercises.length) {
        state.phase = "result";
        paint();
        return;
      }
      state.index += 1;
      state.checked = false;
      state.chosen = null;
      state.userCommas = [];
      state.selected = [];
      paint();
    });
  };

  paint();
  return () => {
    root.innerHTML = "";
  };
}
