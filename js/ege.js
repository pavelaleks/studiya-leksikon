import { escapeHtml } from "./ui.js";
import { mark } from "./markup.js";
import { markEgeDone } from "./progress.js";

const VOWELS = "аеёиоуыэюя";

export const EGE_TITLES = {
  4: "Ударение",
  5: "Паронимы",
  6: "Лексические нормы",
  7: "Морфологические нормы",
  8: "Синтаксические нормы",
  9: "Гласные и согласные в корне",
  10: "Приставки, ъ и ь, ы/и",
  11: "Суффиксы",
  12: "Личные окончания и суффиксы причастий",
  13: "НЕ и НИ",
  14: "Слитно, дефис, раздельно",
  15: "Н и НН",
  16: "Однородные и ССП",
  17: "Обособление",
  18: "Вводные и обращения",
  19: "Сложноподчинённое предложение",
  20: "Сложное с разными видами связи",
  21: "Пунктуационный анализ",
  22: "Средства выразительности",
};

export function egeTasks(content) {
  return (content.ege || []).slice().sort((a, b) => a.egeTask - b.egeTask || String(a.id).localeCompare(b.id));
}

export function egeByNumber(content, n) {
  const num = Number(n);
  return egeTasks(content).filter((ex) => ex.egeTask === num);
}

function digitsOnly(s) {
  return String(s ?? "").replace(/\D/g, "");
}

function normWord(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/\s+/g, "");
}

function stressSignature(s) {
  const chars = [...String(s ?? "").trim()];
  const pos = [];
  chars.forEach((ch, i) => {
    const low = ch.toLowerCase();
    if (VOWELS.includes(low) && ch !== low) pos.push(i);
    if (ch === "\u0301" && i > 0) pos.push(i - 1);
  });
  const base = chars
    .filter((ch) => ch !== "\u0301")
    .join("")
    .toLowerCase()
    .replaceAll("ё", "е");
  return { base, pos: pos.join(",") };
}

export function checkEgeAnswer(input, ex) {
  const raw = String(input ?? "").trim();
  if (!raw) return false;
  const keys = [ex.answer, ...(ex.answers || [])].filter((k) => k != null && String(k).trim() !== "");
  const mode = ex.answerMode || "word";
  if (mode === "digits-any") {
    const got = [...digitsOnly(raw)].sort().join("");
    return keys.some((k) => [...digitsOnly(k)].sort().join("") === got && got.length > 0);
  }
  if (mode === "digits-fixed") {
    const got = digitsOnly(raw);
    return keys.some((k) => digitsOnly(k) === got && got.length > 0);
  }
  if (mode === "stress") {
    const got = stressSignature(raw);
    if (!got.pos) return false;
    return keys.some((k) => {
      const key = stressSignature(k);
      return key.base === got.base && key.pos === got.pos;
    });
  }
  return keys.some((k) => normWord(k) === normWord(raw));
}

function stripEnum(s) {
  return String(s ?? "").replace(/^\s*(?:\d+|[А-ДA-Ea-e])[).]\s*/, "");
}

function plainLine(s) {
  return stripEnum(s).replace(/\{([^{}|]+)(?:\|[prseoxzmf])?\}/g, "$1");
}

function stimulusHtml(ex) {
  if (ex.text) {
    return `<div class="ege-text">${mark(ex.text).replaceAll("\n", "<br>")}</div>`;
  }
  const lines = ex.lines || [];
  if (!lines.length) {
    return ex.stimulus ? `<div class="ege-stimulus">${mark(ex.stimulus).replaceAll("\n", "<br>")}</div>` : "";
  }
  const n = Number(ex.egeTask);
  if (n >= 9 && n <= 16) {
    return `<ul class="ege-lines">${lines
      .map(
        (line, i) =>
          `<li><button type="button" class="ege-line-btn" data-digit="${i + 1}"><span class="ege-idx">${i + 1})</span> ${mark(stripEnum(line))}</button></li>`
      )
      .join("")}</ul>`;
  }
  return `<ul class="ege-words">${lines
    .map((line) => {
      const raw = stripEnum(line);
      return `<li><button type="button" class="ege-word-btn" data-insert="${escapeHtml(plainLine(line))}">${mark(raw)}</button></li>`;
    })
    .join("")}</ul>`;
}

function matchHtml(ex) {
  const left = ex.left || [];
  const right = ex.right || [];
  const letters = ["А", "Б", "В", "Г", "Д"];
  const kind = ex.egeTask === 22 ? "ege-match ege-match-22" : "ege-match";
  return `
    <div class="${kind}">
      <ul class="ege-match-left">${left
        .map((x, i) => `<li><span class="ege-idx">${letters[i] || i + 1})</span> ${mark(stripEnum(x))}</li>`)
        .join("")}</ul>
      <ul class="ege-match-right">${right
        .map(
          (x, i) =>
            `<li><button type="button" class="ege-line-btn" data-digit="${i + 1}"><span class="ege-idx">${i + 1})</span> ${mark(stripEnum(x))}</button></li>`
        )
        .join("")}</ul>
    </div>
  `;
}

function answerFieldHtml(mode) {
  if (mode === "digits-fixed") {
    const letters = ["А", "Б", "В", "Г", "Д"];
    return `
      <div class="ege-slots" id="ege-slots">
        ${letters
          .map(
            (L, i) => `
          <label class="ege-slot">
            <span>${L}</span>
            <input inputmode="numeric" maxlength="1" data-slot="${i}" class="ege-answer-slot" autocomplete="off" aria-label="Ответ ${L}">
          </label>`
          )
          .join("")}
      </div>
      ${digitPadHtml()}
    `;
  }
  if (mode === "digits-any") {
    return `
      <input class="ege-answer ege-answer-digits" id="ege-answer" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Ответ" />
      ${digitPadHtml()}
    `;
  }
  const extra = mode === "stress" ? "ege-answer-stress" : "";
  return `<input class="ege-answer ege-answer-word ${extra}" id="ege-answer" autocomplete="off" spellcheck="false" aria-label="Ответ" />`;
}

function digitPadHtml() {
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return `
    <div class="ege-pad" role="group" aria-label="Цифры">
      ${keys.map((d) => `<button type="button" data-pad="${d}">${d}</button>`).join("")}
      <button type="button" data-pad="bs">Стереть</button>
    </div>
  `;
}

function readAnswer(root) {
  const slots = [...root.querySelectorAll("[data-slot]")];
  if (slots.length) return slots.map((s) => s.value).join("");
  return root.querySelector("#ege-answer")?.value || "";
}

function markAnswerFields(root, ok) {
  const slots = [...root.querySelectorAll("[data-slot]")];
  const input = root.querySelector("#ege-answer");
  const nodes = slots.length ? slots : input ? [input] : [];
  nodes.forEach((node) => {
    node.classList.toggle("ok", ok);
    node.classList.toggle("bad", !ok);
  });
}

function fillSlots(root, digit) {
  const slots = [...root.querySelectorAll("[data-slot]")];
  if (!slots.length) return;
  const active = slots.find((s) => s === document.activeElement);
  const target = (active && !active.value ? active : null) || slots.find((s) => !s.value) || active || slots[slots.length - 1];
  target.value = digit;
  const i = slots.indexOf(target);
  slots[Math.min(i + 1, slots.length - 1)].focus();
}

function toggleDigitInput(input, digit) {
  const set = new Set([...digitsOnly(input.value)]);
  const s = String(digit);
  if (set.has(s)) set.delete(s);
  else set.add(s);
  input.value = [...set].sort().join("");
  input.focus();
}

function applyDigit(root, mode, digit) {
  if (mode === "digits-fixed") fillSlots(root, digit);
  else {
    const input = root.querySelector("#ege-answer");
    if (input) toggleDigitInput(input, digit);
  }
}

function backspaceAnswer(root, mode) {
  if (mode === "digits-fixed") {
    const slots = [...root.querySelectorAll("[data-slot]")];
    const filled = [...slots].reverse().find((s) => s.value);
    if (filled) {
      filled.value = "";
      filled.focus();
    }
    return;
  }
  const input = root.querySelector("#ege-answer");
  if (input) input.value = digitsOnly(input.value).slice(0, -1);
}

export function renderEgeExercise(ex, ctx = {}) {
  const root = document.createElement("div");
  root.className = "card ex-card ege-card";
  const mode = ex.answerMode || "word";
  const hint =
    mode === "digits-any"
      ? "Нажмите номер ряда — или цифры внизу. Порядок не важен."
      : mode === "digits-fixed"
        ? "Пять цифр по порядку А–Д. Можно нажать номер в правом столбце."
        : mode === "stress"
          ? "Нажмите слово, затем поправьте ударную гласную на заглавную: звонИт."
          : "Нажмите слово в списке или впишите форму без кавычек.";
  const index = Number.isInteger(ctx.index) ? ctx.index : 0;
  const total = ctx.total || 0;
  const counter = total ? ` · вариант ${index + 1} из ${total}` : "";
  const title = EGE_TITLES[ex.egeTask] || ex.title || "Задание " + ex.egeTask;
  const nextHref = ctx.nextId ? `#/ege-item/${encodeURIComponent(ctx.nextId)}` : "";
  const ruleLinks = (ctx.rules || [])
    .map((r) => `<a href="#/rule/${encodeURIComponent(r.slug || r.id)}">${escapeHtml(r.title)}</a>`)
    .join(" · ");
  root.innerHTML = `
    <p class="kicker">ЕГЭ · задание ${ex.egeTask}${counter}</p>
    <h2>${escapeHtml(title)}</h2>
    <p class="ege-instruction">${escapeHtml(ex.instruction || "")}</p>
    ${ex.type === "ege-match" ? matchHtml(ex) : stimulusHtml(ex)}
    ${
      ex.egeTask === 22
        ? `<p class="muted">Выделенный фрагмент — то, что нужно квалифицировать. Аллитерация, ассонанс и метонимия на экзамене всегда маркируются.</p>`
        : ""
    }
    <p class="home-search-label" id="ege-answer-label">Ответ</p>
    <p class="muted">${hint}</p>
    ${answerFieldHtml(mode)}
    <div class="actions">
      <button class="btn" data-check type="button">Проверить</button>
    </div>
    <div class="explain-box" data-explain hidden>
      <p class="result"></p>
      <p class="explain-text"></p>
      ${ruleLinks ? `<p class="explain-rules">К правилам: ${ruleLinks}</p>` : ""}
    </div>
  `;
  const input = root.querySelector("#ege-answer");
  const slots = [...root.querySelectorAll("[data-slot]")];
  const explain = root.querySelector("[data-explain]");
  const result = root.querySelector(".result");
  const explainText = root.querySelector(".explain-text");
  const finish = () => {
    const ok = checkEgeAnswer(readAnswer(root), ex);
    markAnswerFields(root, ok);
    if (ok) markEgeDone(ex);
    explain.hidden = false;
    explain.classList.toggle("ok", ok);
    explain.classList.toggle("bad", !ok);
    result.textContent = ok ? "Верно." : "Пока неверно.";
    explainText.textContent = ex.explanation || "";
    const actions = root.querySelector(".actions");
    if (nextHref && !root.querySelector("[data-next]")) {
      const a = document.createElement("a");
      a.className = ok ? "btn" : "btn secondary";
      a.setAttribute("data-next", "");
      a.href = nextHref;
      a.textContent = "Следующий вариант";
      actions.appendChild(a);
    } else if (ok) {
      root.querySelector("[data-next]")?.classList.remove("secondary");
    }
  };
  root.querySelector("[data-check]").onclick = finish;
  const onEnter = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish();
    }
  };
  input?.addEventListener("keydown", onEnter);
  slots.forEach((slot) => {
    slot.addEventListener("keydown", onEnter);
    slot.addEventListener("input", () => {
      slot.value = digitsOnly(slot.value).slice(-1);
      if (slot.value) {
        const i = Number(slot.dataset.slot);
        slots[Math.min(i + 1, slots.length - 1)]?.focus();
      }
    });
  });
  if (slots[0]) {
    slots[0].addEventListener("paste", (e) => {
      const t = digitsOnly(e.clipboardData.getData("text"));
      if (t.length < 2) return;
      e.preventDefault();
      slots.forEach((s, i) => {
        s.value = t[i] || "";
      });
    });
  }
  root.addEventListener("click", (e) => {
    const pad = e.target.closest("[data-pad]");
    if (pad) {
      const key = pad.getAttribute("data-pad");
      if (key === "bs") backspaceAnswer(root, mode);
      else applyDigit(root, mode, key);
      return;
    }
    const digitBtn = e.target.closest("[data-digit]");
    if (digitBtn && (mode === "digits-any" || mode === "digits-fixed")) {
      applyDigit(root, mode, digitBtn.getAttribute("data-digit"));
      return;
    }
    const wordBtn = e.target.closest("[data-insert]");
    if (wordBtn && input) {
      input.value = wordBtn.getAttribute("data-insert") || "";
      input.focus();
    }
  });
  return root;
}
