import { escapeHtml } from "./ui.js";

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

function stimulusHtml(ex) {
  if (ex.text) {
    return `<div class="ege-text">${escapeHtml(ex.text).replaceAll("\n", "<br>")}</div>`;
  }
  const lines = ex.lines || [];
  if (!lines.length) return ex.stimulus ? `<div class="ege-stimulus">${escapeHtml(ex.stimulus).replaceAll("\n", "<br>")}</div>` : "";
  return `<ol class="ege-lines">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>`;
}

function matchHtml(ex) {
  const left = ex.left || [];
  const right = ex.right || [];
  return `
    <div class="ege-match">
      <ul class="ege-match-left">${left.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
      <ul class="ege-match-right">${right.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
    </div>
  `;
}

export function renderEgeExercise(ex) {
  const root = document.createElement("div");
  root.className = "card ex-card ege-card";
  const mode = ex.answerMode || "word";
  const hint =
    mode === "digits-any" || mode === "digits-fixed"
      ? "Ответ — цифры, без пробелов и запятых."
      : mode === "stress"
        ? "Выпишите слово, ударный гласный — заглавной буквой: звонИт."
        : "Выпишите слово или форму без кавычек.";
  root.innerHTML = `
    <p class="kicker">ЕГЭ · задание ${ex.egeTask}</p>
    <h2>${escapeHtml(ex.title || "Задание " + ex.egeTask)}</h2>
    <p class="ege-instruction">${escapeHtml(ex.instruction || "")}</p>
    ${ex.type === "ege-match" ? matchHtml(ex) : stimulusHtml(ex)}
    <label class="home-search-label" for="ege-answer">Ответ</label>
    <p class="muted">${hint}</p>
    <input class="search ege-answer" id="ege-answer" autocomplete="off" spellcheck="false" />
    <div class="actions"><button class="btn" data-check type="button">Проверить</button></div>
    <div class="result"></div>
    <p class="muted explain" hidden></p>
  `;
  const input = root.querySelector("#ege-answer");
  const result = root.querySelector(".result");
  const explain = root.querySelector(".explain");
  const finish = () => {
    const ok = checkEgeAnswer(input.value, ex);
    input.classList.toggle("ok", ok);
    input.classList.toggle("bad", !ok);
    result.textContent = ok ? "Верно." : "Пока неверно. Посмотрите пояснение и правило.";
    explain.hidden = false;
    explain.textContent = ex.explanation || "";
  };
  root.querySelector("[data-check]").onclick = finish;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish();
    }
  });
  return root;
}
