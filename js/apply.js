import { SITE, STUDIO, studioPhone } from "./config.js";

function val(form, name) {
  const el = form.elements.namedItem(name);
  if (!el) return "";
  if (el instanceof RadioNodeList) {
    const checked = [...el].find((x) => x.checked);
    return checked?.value || "";
  }
  return String(el.value || "").trim();
}

function buildBody(form) {
  const lines = [
    "Заявка в Студию Лексикон",
    "",
    `Имя: ${val(form, "name")}`,
    `Телефон: ${val(form, "phone")}`,
    `Класс: ${val(form, "grade")}`,
    `Предмет: ${val(form, "subject")}`,
    `Цель: ${val(form, "goal")}`,
    `Формат: ${val(form, "place")}`,
    `Занятия: ${val(form, "mode")}`,
  ];
  const note = val(form, "note");
  if (note) lines.push("", `Комментарий: ${note}`);
  return lines.join("\n");
}

function thanksUrl() {
  if (STUDIO.applyThanksUrl) return STUDIO.applyThanksUrl;
  const base =
    SITE.githubUser && SITE.repo
      ? `https://${SITE.githubUser}.github.io/${SITE.repo}/`
      : `${location.origin}${location.pathname.replace(/[^/]*$/, "")}`;
  return `${base}#/thanks`;
}

function telegramApplyUrl(form) {
  const nick = (STUDIO.telegram || "").replace(/^@/, "");
  if (!nick) return "";
  return `https://t.me/${nick}?text=${encodeURIComponent(buildBody(form))}`;
}

export function bindRevealPhone(root = document) {
  root.querySelectorAll("[data-reveal-phone]").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const { display, tel } = studioPhone();
      const a = document.createElement("a");
      a.className = btn.className;
      a.href = `tel:${tel}`;
      a.textContent = display;
      a.setAttribute("aria-label", `Позвонить ${display}`);
      btn.replaceWith(a);
      a.focus();
      if (/Mobi|Android/i.test(navigator.userAgent)) {
        location.href = a.href;
      }
    });
  });
}

/**
 * Как работает запись:
 * 1) «Отправить» — обычный POST на FormSubmit → письмо на STUDIO.applyEmail
 *    (при первом разе FormSubmit шлёт письмо активации — его нужно открыть и подтвердить).
 * 2) «Открыть в почте» — mailto с тем же текстом (всегда работает локально).
 * 3) «Telegram» — открывает чат с готовым текстом заявки.
 */
export function bindApplyForm(root = document) {
  bindRevealPhone(root);

  const form = root.querySelector("#apply-form");
  if (!form) return;

  const status = root.querySelector("#apply-status");
  const mailFallback = root.querySelector("#apply-mailto");
  const tgFallback = root.querySelector("#apply-telegram");
  const submitBtn = form.querySelector('[type="submit"]');

  form.action = `https://formsubmit.co/${encodeURIComponent(STUDIO.applyEmail)}`;
  form.method = "POST";
  form.acceptCharset = "UTF-8";

  const next = form.querySelector('input[name="_next"]');
  if (next) next.value = thanksUrl();

  const setStatus = (text, ok) => {
    if (!status) return;
    status.hidden = false;
    status.textContent = text;
    status.classList.toggle("ok", Boolean(ok));
    status.classList.toggle("bad", ok === false);
  };

  mailFallback?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const subject = encodeURIComponent("Заявка в Студию Лексикон");
    const body = encodeURIComponent(buildBody(form));
    location.href = `mailto:${STUDIO.applyEmail}?subject=${subject}&body=${body}`;
    setStatus(`Откроется почтовая программа. Адрес: ${STUDIO.applyEmail}`, true);
  });

  tgFallback?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const url = telegramApplyUrl(form);
    if (!url) {
      setStatus("Telegram не настроен.", false);
      return;
    }
    window.open(url, "_blank", "noopener");
    setStatus("Открыли Telegram с текстом заявки — нажмите «Отправить» в чате.", true);
  });

  form.addEventListener("submit", (e) => {
    const honey = form.querySelector('[name="_honey"]');
    if (honey && String(honey.value || "").trim()) {
      e.preventDefault();
      return;
    }
    if (!form.reportValidity()) {
      e.preventDefault();
      setStatus("Заполните обязательные поля.", false);
      return;
    }
    if (submitBtn) submitBtn.disabled = true;
    setStatus("Отправляем заявку на почту студии…", true);
    // дальше браузер сам POST на FormSubmit
  });
}
