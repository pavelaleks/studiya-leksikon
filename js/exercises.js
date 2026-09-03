import { escapeHtml } from "./ui.js";
import { renderEgeExercise } from "./ege.js";

function sameGap(input, answer) {
  const dash = /[\u2014\u2013\u2212\u2012\u2010-]/g;
  const a = String(input ?? "").trim().replace(dash, "—");
  const b = String(answer ?? "").trim().replace(dash, "—");
  return a === b || a.toLowerCase() === b.toLowerCase();
}

function scoreBox(ok, total) {
  return `<div class="result">Результат: ${ok} из ${total}</div>`;
}

export function renderExercise(ex, onDone, ctx) {
  if (ex.type === "choice") return renderChoice(ex, onDone);
  if (ex.type === "insert") return renderInsert(ex, onDone);
  if (ex.type === "copy") return renderCopy(ex, onDone);
  if (ex.type === "ege-short" || ex.type === "ege-match") return renderEgeExercise(ex, ctx);
  return `<div class="empty">Неизвестный тип задания.</div>`;
}

function renderChoice(ex, onDone) {
  const items = ex.items || [];
  let current = 0;
  let ok = 0;
  const root = document.createElement("div");
  root.className = "card ex-card";

  const paint = () => {
    const item = items[current];
    if (!item) {
      root.innerHTML = `<h2>${escapeHtml(ex.title)}</h2>${scoreBox(ok, items.length)}<div class="actions"><a class="btn" href="#/practice">К заданиям</a></div>`;
      onDone?.({ ok, total: items.length });
      return;
    }
    root.innerHTML = `
      <p class="kicker">Вопрос ${current + 1} из ${items.length}</p>
      <h2>${escapeHtml(ex.title)}</h2>
      <p>${escapeHtml(item.prompt)}</p>
      <div class="choices"></div>
      <p class="muted explain"></p>
    `;
    const box = root.querySelector(".choices");
    item.choices.forEach((choice, idx) => {
      const b = document.createElement("button");
      b.className = "choice";
      b.textContent = choice;
      b.onclick = () => {
        const correct = idx === item.answer;
        if (correct) ok += 1;
        [...box.children].forEach((el, i) => {
          el.disabled = true;
          if (i === item.answer) el.classList.add("correct");
          if (i === idx && !correct) el.classList.add("wrong");
        });
        root.querySelector(".explain").textContent = item.explanation || (correct ? "Верно." : "Посмотрите правило ещё раз.");
        const next = document.createElement("button");
        next.className = "btn";
        next.textContent = current + 1 === items.length ? "Итог" : "Дальше";
        next.onclick = () => {
          current += 1;
          paint();
        };
        root.appendChild(next);
      };
      box.appendChild(b);
    });
  };
  paint();
  return root;
}

function fieldHtml(i, width = 2) {
  const w = Math.max(width, 2);
  return `<input class="gap" data-i="${i}" maxlength="${w}" style="width:${w + 1}ch" aria-label="Пропуск ${i + 1}" />`;
}

function renderGaps(ex, variant) {
  const root = document.createElement("div");
  root.className = "card ex-card";
  const gaps = [];
  const html = (ex.template || "").replaceAll(/\{\{(.*?)\}\}/g, (_, answer) => {
    const i = gaps.length;
    gaps.push(answer);
    return fieldHtml(i, String(answer).length);
  });
  root.innerHTML = `
    <p class="kicker">${variant === "copy" ? "Списывание" : "Вставьте орфограмму"}</p>
    <h2>${escapeHtml(ex.title)}</h2>
    ${ex.lead ? `<p class="muted">${escapeHtml(ex.lead)}</p>` : ""}
    <div class="${variant === "copy" ? "copy-text" : ""}">${html}</div>
    <div class="actions"><button class="btn" data-check>Проверить</button></div>
    <div class="result"></div>
  `;
  root.querySelector("[data-check]").onclick = () => {
    const inputs = [...root.querySelectorAll(".gap")];
    let ok = 0;
    inputs.forEach((input, i) => {
      const good = sameGap(input.value, gaps[i]);
      input.classList.toggle("ok", good);
      input.classList.toggle("bad", !good);
      let hint = input.nextElementSibling;
      if (!hint || !hint.classList.contains("gap-hint")) {
        hint = document.createElement("span");
        hint.className = "gap-hint";
        input.after(hint);
      }
      hint.textContent = good ? "" : `верно: ${gaps[i]}`;
      if (good) ok += 1;
    });
    root.querySelector(".result").textContent = `Верно ${ok} из ${gaps.length}`;
  };
  return root;
}

function renderInsert(ex) {
  return renderGaps(ex, "insert");
}

function renderCopy(ex) {
  return renderGaps(ex, "copy");
}
