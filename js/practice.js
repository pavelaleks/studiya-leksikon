/**
 * Общие блоки страниц заданий (ЕГЭ, ОГЭ, литература):
 *  - «закрыто для гостей» и плашка демо-режима;
 *  - проверка краткого ответа на сервере, разбор только после попытки;
 *  - письменная работа: черновик, фото, сдача на проверку, оценка.
 */
import { escapeHtml } from "./ui.js";
import {
  accessState,
  currentUser,
  myWorkFor,
  saveWork,
  showSolution,
  signedFileUrl,
  submitAnswer,
  uploadWorkFile,
} from "./supa.js";

const STATUS_TEXT = {
  draft: "Черновик",
  submitted: "На проверке",
  returned: "Возвращена на доработку",
  graded: "Проверена",
};

/* ------------------------------------------------------------------ */
/* Доступ                                                              */
/* ------------------------------------------------------------------ */

function loginLinks() {
  const back = encodeURIComponent(location.hash || "#/");
  return `
    <div class="actions">
      <a class="btn" href="#/login?next=${back}">Войти</a>
      <a class="btn secondary" href="#/login?mode=signup&next=${back}">Зарегистрироваться</a>
      <a class="btn secondary" href="#/apply">Записаться на занятия</a>
    </div>`;
}

/** Блок вместо закрытого задания. */
export function gateHtml(backHref = "#/") {
  const state = accessState();
  if (state === "pending") {
    return `
      <div class="gate card">
        <p class="eyebrow">Заявка принята</p>
        <h2>Ждём подтверждения преподавателя</h2>
        <p>Вы зарегистрированы. Как только Павел Викторович подтвердит доступ, здесь откроется весь банк заданий с разборами. Обычно это занимает не больше суток.</p>
        <p class="actions"><a class="btn secondary" href="#/me">Личный кабинет</a> <a class="btn secondary" href="${backHref}">Назад</a></p>
      </div>`;
  }
  if (state === "paused" || state === "expired") {
    return `
      <div class="gate card">
        <p class="eyebrow">Доступ приостановлен</p>
        <h2>Доступ к банку заданий сейчас закрыт</h2>
        <p>Срок доступа истёк или занятия приостановлены. Напишите преподавателю, чтобы продлить.</p>
        <p class="actions"><a class="btn secondary" href="#/me">Личный кабинет</a></p>
      </div>`;
  }
  return `
    <div class="gate card">
      <p class="eyebrow">Для учеников студии</p>
      <h2>Это задание доступно ученикам «Лексикона»</h2>
      <p>Полный банк — тысячи заданий с проверкой и разборами — открыт ученикам студии. Ученик сначала решает сам, потом видит разбор, а ошибки собираются в личную тетрадь для повторения.</p>
      <p class="muted">Попробовать можно на демо-заданиях — они отмечены в списке.</p>
      ${loginLinks()}
    </div>`;
}

/** Плашка над списком, когда пользователь видит только демо. */
export function demoBannerHtml(total, shown) {
  const state = accessState();
  if (state === "student" || state === "teacher") return "";
  const head =
    state === "pending"
      ? "Доступ ждёт подтверждения преподавателя"
      : "Открыты демо-задания";
  return `
    <div class="gate gate-inline card">
      <p><strong>${escapeHtml(head)}.</strong> Сейчас видно ${shown} из ${total}. Весь банк с разборами открыт ученикам студии.</p>
      ${state === "guest" ? loginLinks() : `<p class="actions"><a class="btn secondary" href="#/me">Личный кабинет</a></p>`}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Краткий ответ                                                       */
/* ------------------------------------------------------------------ */

export function checkBlockHtml({ label, placeholder = "Введите ответ", numeric = false }) {
  return `
    <section class="lit-check" data-practice="check">
      <label for="pr-answer">${escapeHtml(label)}</label>
      <div class="lit-check-row">
        <input id="pr-answer" class="search" type="text" autocomplete="off" ${numeric ? 'inputmode="numeric"' : ""} placeholder="${escapeHtml(placeholder)}" />
        <button type="button" class="btn" id="pr-check">Проверить</button>
      </div>
      <p class="lit-result" id="pr-result" aria-live="polite"></p>
      <p class="pr-reveal" id="pr-reveal-row" hidden>
        <button type="button" class="btn secondary" id="pr-reveal">Показать разбор</button>
        <small class="muted">Задание попадёт в тетрадь ошибок — к нему стоит вернуться.</small>
      </p>
    </section>
    <div id="pr-solution"></div>`;
}

function solutionHtml(sanitize, res, title = "Разбор") {
  if (!res || res.locked) return "";
  // Строку «Ответ» показываем, только если разбора нет: в разборах ответ уже записан по-человечески.
  const answer = res.answer && !res.solution ? `<p class="pr-answer-key"><strong>Ответ:</strong> ${escapeHtml(String(res.answer).replace(/\|/g, " или "))}</p>` : "";
  const body = res.solution ? `<div class="lit-html">${sanitize(res.solution)}</div>` : "";
  if (!answer && !body) return "";
  return `<details class="lit-solution" open><summary>${escapeHtml(title)}</summary>${answer}${body}</details>`;
}

/**
 * Привязать проверку. problem._tid — id задания в базе.
 * onCorrect() — отметить «решено» локально.
 */
const REVEAL_HINT = {
  after_attempt: "Разбор откроется после попытки.",
  after_correct: "Разбор откроется после верного ответа или когда закончатся попытки.",
  after_due: "Разбор откроется после срока сдачи.",
  after_review: "Разбор откроется после проверки преподавателем.",
  manual: "Разбор откроет преподаватель.",
};

export function bindCheck(root, problem, { sanitize, onCorrect, item = null } = {}) {
  const input = root.querySelector("#pr-answer");
  const result = root.querySelector("#pr-result");
  const btn = root.querySelector("#pr-check");
  const revealRow = root.querySelector("#pr-reveal-row");
  const reveal = root.querySelector("#pr-reveal");
  const solution = root.querySelector("#pr-solution");
  if (!input || !btn) return;
  const started = Date.now();
  let tries = 0;

  const setResult = (text, cls = "") => {
    result.className = `lit-result ${cls}`;
    result.textContent = text;
  };

  const run = async () => {
    const value = input.value.trim();
    if (!value) {
      setResult("Введите ответ.");
      return;
    }
    btn.disabled = true;
    setResult("Проверяем…");
    try {
      const res = await submitAnswer(problem._tid, value, {
        item: item?.id || null,
        seconds: Math.round((Date.now() - started) / 1000),
      });
      tries += 1;
      const left = res.attempts_left != null ? ` Осталось попыток: ${res.attempts_left}.` : "";
      if (res.hidden) {
        setResult(`Ответ принят. Результат и разбор появятся после проверки контрольной.${left}`, "");
        revealRow.hidden = true;
        if (res.attempts_left === 0) (input.disabled = true), (btn.disabled = true);
        onCorrect?.("submitted");
        return;
      }
      if (res.correct) {
        setResult("Верно!", "is-ok");
        revealRow.hidden = true;
        solution.innerHTML = solutionHtml(sanitize, res);
        onCorrect?.();
      } else {
        const exhausted = res.attempts_left === 0;
        setResult(
          exhausted
            ? "Не совпало, попытки закончились."
            : (tries === 1
                ? "Пока не совпало. Перечитайте задание и попробуйте ещё раз."
                : "Снова не совпало. Можно попробовать ещё или открыть разбор.") + left,
          "is-bad"
        );
        if (exhausted) input.disabled = true;
        revealRow.hidden = !res.can_reveal;
        if (!res.can_reveal && item) {
          const hint = REVEAL_HINT[item.reveal];
          if (hint) result.textContent += ` ${hint}`;
        }
      }
    } catch (err) {
      setResult(err.message, "is-bad");
    } finally {
      if (!input.disabled) btn.disabled = false;
    }
  };

  btn.addEventListener("click", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });
  reveal?.addEventListener("click", async () => {
    reveal.disabled = true;
    try {
      const res = await showSolution(problem._tid, item?.id || null);
      if (res.locked) {
        setResult((item && REVEAL_HINT[item.reveal]) || "Разбор откроется после попытки.", "");
      } else {
        solution.innerHTML = solutionHtml(sanitize, res);
        revealRow.hidden = true;
      }
    } catch (err) {
      setResult(err.message, "is-bad");
    } finally {
      reveal.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Письменная работа                                                   */
/* ------------------------------------------------------------------ */

export function writtenBlockHtml({ label = "Ваш ответ" } = {}) {
  return `
    <section class="lit-write" data-practice="written" id="pr-work">
      <p class="muted">Загружаем…</p>
    </section>
    <div id="pr-solution"></div>`;
}

function criteriaHtml(criteria) {
  if (!criteria || typeof criteria !== "object") return "";
  const rows = Object.entries(criteria)
    .map(([k, v]) => `<span class="pr-crit"><b>${escapeHtml(k)}</b> ${escapeHtml(String(v))}</span>`)
    .join("");
  return rows ? `<p class="pr-crits">${rows}</p>` : "";
}

export function bindWritten(root, problem, { sanitize, label = "Ваш ответ", solutionTitle = "Пояснение и образец", item = null } = {}) {
  const box = root.querySelector("#pr-work");
  const solution = root.querySelector("#pr-solution");
  if (!box) return;
  const state = accessState();
  if (!currentUser() || (state !== "student" && state !== "teacher")) {
    box.innerHTML = `
      <p><strong>Письменные работы сдаются в личный кабинет.</strong> Преподаватель проверит и поставит оценку по критериям.</p>
      ${state === "guest" ? `<p class="actions"><a class="btn" href="#/login?next=${encodeURIComponent(location.hash)}">Войти</a></p>` : ""}`;
    return;
  }

  const draftKey = `work-draft-${problem._tid}${item ? `-${item.id}` : ""}`;
  let work = null;
  let files = [];

  const loadSolution = async () => {
    try {
      const res = await showSolution(problem._tid, item?.id || null);
      solution.innerHTML = solutionHtml(sanitize, res, solutionTitle);
    } catch {
      /* разбор не обязателен */
    }
  };

  const filesHtml = async (paths) => {
    if (!paths.length) return "";
    const links = await Promise.all(
      paths.map(async (p, i) => {
        try {
          const url = await signedFileUrl(p);
          return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Фото ${i + 1}</a>`;
        } catch {
          return `<span>Фото ${i + 1}</span>`;
        }
      })
    );
    return `<p class="pr-files">${links.join(" · ")}</p>`;
  };

  const render = async () => {
    const status = work?.status || "draft";
    const editable = status === "draft" || status === "returned";
    files = work?.files || files;
    let saved = "";
    try {
      saved = localStorage.getItem(draftKey) || "";
    } catch {
      /* ignore */
    }
    const text = work?.body || saved || "";
    const review =
      work && (status === "graded" || status === "returned")
        ? `
        <div class="pr-review card">
          <p class="eyebrow">${escapeHtml(STATUS_TEXT[status])}${work.reviewed_at ? ` · ${new Date(work.reviewed_at).toLocaleDateString("ru-RU")}` : ""}</p>
          ${work.score != null ? `<p class="pr-score"><strong>${escapeHtml(String(work.score))}</strong>${work.max_score ? ` из ${escapeHtml(String(work.max_score))}` : ""} баллов</p>` : ""}
          ${criteriaHtml(work.criteria)}
          ${work.teacher_comment ? `<p class="pr-comment">${escapeHtml(work.teacher_comment).replace(/\n/g, "<br>")}</p>` : ""}
        </div>`
        : "";
    box.innerHTML = `
      ${review}
      ${work && status !== "draft" ? `<p class="pr-status pr-status-${status}">${escapeHtml(STATUS_TEXT[status])}${work.submitted_at ? ` · сдано ${new Date(work.submitted_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}` : ""}</p>` : ""}
      <label for="pr-essay">${escapeHtml(label)}</label>
      <textarea id="pr-essay" class="lit-essay" ${editable ? "" : "readonly"} placeholder="Напишите ответ здесь. Можно также приложить фото тетради.">${escapeHtml(text)}</textarea>
      <div id="pr-files">${await filesHtml(files)}</div>
      ${
        editable
          ? `
        <div class="pr-work-actions">
          <label class="btn secondary pr-file-btn">Приложить фото<input type="file" id="pr-file" accept="image/*,application/pdf" multiple hidden /></label>
          <button type="button" class="btn secondary" id="pr-save">Сохранить черновик</button>
          <button type="button" class="btn" id="pr-submit">Сдать на проверку</button>
        </div>`
          : ""
      }
      <p class="lit-send-status muted" id="pr-status" aria-live="polite"></p>`;

    const area = box.querySelector("#pr-essay");
    const statusEl = box.querySelector("#pr-status");
    const say = (t) => (statusEl.textContent = t);
    area?.addEventListener("input", () => {
      try {
        localStorage.setItem(draftKey, area.value);
      } catch {
        /* ignore */
      }
    });
    box.querySelector("#pr-file")?.addEventListener("change", async (e) => {
      const list = [...(e.target.files || [])].slice(0, 6);
      for (const f of list) {
        if (f.size > 10 * 1024 * 1024) {
          say(`Файл «${f.name}» больше 10 МБ.`);
          continue;
        }
        say(`Загружаем «${f.name}»…`);
        try {
          files = [...files, await uploadWorkFile(f)];
        } catch (err) {
          say(err.message);
          return;
        }
      }
      box.querySelector("#pr-files").innerHTML = await filesHtml(files);
      say("Фото прикреплены. Не забудьте сохранить или сдать работу.");
    });
    const persist = async (next) => {
      const body = area.value.trim();
      if (next === "submitted" && !body && !files.length) {
        say("Напишите ответ или приложите фото.");
        return;
      }
      say(next === "submitted" ? "Сдаём…" : "Сохраняем…");
      try {
        work = await saveWork({ id: work?.id, taskId: problem._tid, itemId: item?.id || null, body, files, status: next });
        if (next === "submitted") {
          try {
            localStorage.removeItem(draftKey);
          } catch {
            /* ignore */
          }
        }
        await render();
        box.querySelector("#pr-status").textContent =
          next === "submitted" ? "Работа сдана. Преподаватель проверит её в кабинете." : "Черновик сохранён.";
        if (next === "submitted") loadSolution();
      } catch (err) {
        say(err.message);
      }
    };
    box.querySelector("#pr-save")?.addEventListener("click", () => persist("draft"));
    box.querySelector("#pr-submit")?.addEventListener("click", () => persist("submitted"));
  };

  myWorkFor(problem._tid, item?.id || null)
    .then(async (w) => {
      work = w;
      await render();
      if (work && work.status !== "draft") loadSolution();
    })
    .catch((err) => {
      box.innerHTML = `<p class="lit-result is-bad">${escapeHtml(err.message)}</p>`;
    });
}
