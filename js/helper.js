// Помощник «Перо»: кнопка в углу открывает подсказки «Чем помочь?» под ситуацию человека
// (гость, ждёт подтверждения, ученик) и раздел сайта. При первом визите один раз предлагает помощь сам.
import { escapeHtml } from "./ui.js";
import { accessState } from "./supa.js";

const SEEN = "lx-helper-seen";
const FEATHER = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 3.8a6 6 0 0 0-8.5 0L5 10.5V19h8.5l6.7-6.7a6 6 0 0 0 0-8.5z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></svg>`;

const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

const tip = (q, a, link) => ({ q, a, link });

function tipsFor(state, hash) {
  const route = (hash.match(/^#\/([a-z]+)/) || [])[1] || "";
  const onTask = /^#\/(ege|oge|literature|literature\/oge)\/\d+\/./.test(hash);
  const out = [];
  if (onTask)
    out.push(
      tip(
        "Как ответить на задание?",
        "Впишите ответ в поле под заданием и нажмите «Проверить». Цифры пишите подряд, без пробелов и запятых (например, 245); если написано «Номера в любом порядке» — порядок не важен. Не получилось — можно попробовать ещё раз или открыть разбор."
      )
    );
  if (state === "guest") {
    if (route === "login")
      out.push(
        tip(
          "Где взять логин и пароль?",
          "Их выдаёт преподаватель, когда вы начинаете заниматься в студии: логин вида ryzhiy-lis-47 и пароль. Регистрироваться самим не нужно. Забыли пароль — напишите преподавателю, он задаст новый."
        )
      );
    out.push(
      tip("Я ученик студии — где мой кабинет?", "Нажмите «Войти» (на телефоне — внизу экрана, на компьютере — вверху) и введите логин и пароль, которые дал преподаватель.", ["#/login", "Войти"]),
      tip("Как записаться на занятия?", "Оставьте заявку в форме «Записаться» на главной или напишите нам в Telegram или WhatsApp — договоримся о времени и формате: очно или онлайн, в группе или индивидуально.", ["#apply", "К форме записи"]),
      tip("Что можно без регистрации?", "Читать правила русского языка, решать демо-задания ОГЭ и ЕГЭ (они помечены «демо») и читать книги в разделе «Читать».", ["#/rules", "Открыть правила"])
    );
  } else if (state === "pending") {
    out.push(
      tip("Почему открыты не все задания?", "Регистрация прошла, но доступ ещё не подтвердил преподаватель. Обычно это занимает немного времени. Как только подтвердит — страница обновится сама."),
      tip("Что можно делать сейчас?", "Решать демо-задания, читать правила и книги в разделе «Читать».", ["#/rules", "Открыть правила"])
    );
  } else if (state === "student" || state === "expired" || state === "paused") {
    out.push(
      tip("Где задания от преподавателя?", "На «Главной» — блок «Сегодня» и список занятий. Если занятия там нет, значит, преподаватель его ещё не открыл.", ["#/me", "На главную"]),
      tip("С чего начать сегодня?", "С «Тренировки дня»: 10 заданий по вашим слабым местам. Каждый день подряд — это серия, за неё растут очки.", ["#/me/daily", "Тренировка дня"]),
      tip("Как сдать сочинение или изложение?", "Откройте задание с письменным ответом, напишите текст или прикрепите фото страниц и нажмите «Отправить на проверку». Оценка и пометки преподавателя появятся в разделе «Я» → «Письменные работы».", ["#/me/profile#works", "Мои работы"]),
      tip("Как узнать о новых занятиях и проверенных работах?", "Всё появляется на «Главной»: блок «Сегодня» — занятия и сроки, «Работа проверена» — оценка и пометки преподавателя. А чтобы новые задания, напоминания о сроках и проверенные работы приходили в Telegram, в разделе «Я» нажмите «Подключить Telegram».", ["#/me/profile#tg-block", "Подключить Telegram"]),
      tip("Как начисляются очки?", "За верные ответы (больше — с первой попытки), закреплённые правила, прочитанные книги, выученные стихи и проверенные работы. Подробно — в разделе «Я».", ["#/me/profile", "Раздел «Я»"])
    );
  }
  return out;
}

function sheetHtml(state) {
  const tips = tipsFor(state, location.hash || "#/");
  return `
    <div class="lh-backdrop" data-lh-close></div>
    <div class="lh-panel" role="dialog" aria-label="Помощник">
      <div class="lh-head"><span class="lh-face" aria-hidden="true">${FEATHER}</span><div><strong>Перо</strong><span class="muted">Чем помочь?</span></div><button class="lh-x" type="button" data-lh-close aria-label="Закрыть">×</button></div>
      <div class="lh-list">
        ${tips
          .map(
            (t, i) => `<details class="lh-item"${i === 0 ? " open" : ""}><summary>${escapeHtml(t.q)}</summary><p>${escapeHtml(t.a)}</p>${
              t.link ? `<p><a class="btn secondary" href="${t.link[0]}" data-lh-close>${escapeHtml(t.link[1])}</a></p>` : ""
            }</details>`
          )
          .join("")}
      </div>
      <p class="muted lh-foot">Не нашли ответ? <a href="#contact" data-lh-close>Напишите преподавателю в Telegram или WhatsApp</a>.</p>
    </div>`;
}

function openSheet() {
  closeBubble();
  store.set(SEEN, "1");
  let sheet = document.getElementById("lh-sheet");
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "lh-sheet";
    sheet.className = "lh-sheet";
    document.body.appendChild(sheet);
    sheet.addEventListener("click", (e) => {
      if (e.target.closest("[data-lh-close]")) closeSheet();
    });
  }
  sheet.innerHTML = sheetHtml(accessState());
  sheet.hidden = false;
  document.body.classList.add("is-sheet");
  requestAnimationFrame(() => sheet.classList.add("is-open"));
}

function closeSheet() {
  const sheet = document.getElementById("lh-sheet");
  if (!sheet) return;
  sheet.classList.remove("is-open");
  document.body.classList.remove("is-sheet");
  setTimeout(() => (sheet.hidden = true), 200);
}

function closeBubble() {
  document.getElementById("lh-bubble")?.remove();
}

function showBubble() {
  if (document.getElementById("lh-bubble") || store.get(SEEN)) return;
  const b = document.createElement("div");
  b.id = "lh-bubble";
  b.className = "lh-bubble";
  b.setAttribute("role", "status");
  b.innerHTML = `<p><strong>Привет! Я Перо.</strong> Подскажу, где вход в кабинет, как записаться и с чего начать.</p>
    <p class="actions"><button class="btn" type="button" data-lh-yes>Подсказать</button><button class="btn secondary" type="button" data-lh-no>Не надо</button></p>`;
  document.body.appendChild(b);
  b.querySelector("[data-lh-yes]").addEventListener("click", openSheet);
  b.querySelector("[data-lh-no]").addEventListener("click", () => {
    store.set(SEEN, "1");
    closeBubble();
  });
}

/** Вызывается после каждой отрисовки страницы. */
export function mountHelper() {
  const state = accessState();
  if (["student", "pending", "expired", "paused"].includes(state)) store.set("lx-was-student", "1");
  let btn = document.getElementById("lh-btn");
  if (state !== "guest") closeBubble();
  if (state === "teacher") {
    btn?.remove();
    return;
  }
  const hashNow = location.hash || "#/";
  const onHome = hashNow === "#/" || hashNow === "#" || hashNow === "" || /^#(about|prices|apply|learn|faq|teacher|reviews|contact|program-)/.test(hashNow);
  // на главной всё и так разведено блоком «Что вы хотите сделать?» — кнопка там не нужна и мешала бы тексту
  if (onHome) {
    btn?.remove();
    closeBubble();
    return;
  }
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "lh-btn";
    btn.type = "button";
    btn.className = "lh-btn";
    btn.setAttribute("aria-label", "Помощник: чем помочь?");
    btn.title = "Помощник";
    btn.innerHTML = FEATHER;
    btn.addEventListener("click", openSheet);
    document.body.appendChild(btn);
  }
  const hash = location.hash || "#/";
  const home = hash === "#/" || hash === "#" || hash === "";
  if (!home) closeBubble();
  if (state === "guest" && home && !store.get(SEEN)) setTimeout(() => (location.hash || "#/") === hash && accessState() === "guest" && showBubble(), 2500);
}
