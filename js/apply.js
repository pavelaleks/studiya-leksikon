import { STUDIO, studioPhone, studioTelegram, studioWhatsApp } from "./config.js";
import { iconTelegram, iconWhatsApp } from "./icons.js";

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

function channelOf(form) {
  return val(form, "channel") === "whatsapp" ? "whatsapp" : "telegram";
}

function applyUrl(form) {
  const text = encodeURIComponent(buildBody(form));
  if (channelOf(form) === "whatsapp") {
    const wa = studioWhatsApp();
    return wa.url ? `${wa.url}?text=${text}` : "";
  }
  const tg = studioTelegram();
  return tg.url ? `${tg.url}?text=${text}` : "";
}

function syncSubmitLabel(form, submitBtn) {
  if (!submitBtn) return;
  const wa = channelOf(form) === "whatsapp";
  submitBtn.innerHTML = wa
    ? `${iconWhatsApp()} Отправить в WhatsApp`
    : `${iconTelegram()} Отправить в Telegram`;
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
 * Запись без FormSubmit:
 * выбор Telegram / WhatsApp → открыть чат с текстом заявки → #/thanks.
 * «На почту» → mailto.
 */
export function bindApplyForm(root = document) {
  bindRevealPhone(root);

  const form = root.querySelector("#apply-form");
  if (!form) return;

  const status = root.querySelector("#apply-status");
  const mailFallback = root.querySelector("#apply-mailto");
  const submitBtn = form.querySelector("#apply-submit") || form.querySelector('[type="submit"]');

  form.removeAttribute("action");
  syncSubmitLabel(form, submitBtn);

  form.querySelectorAll('input[name="channel"]').forEach((input) => {
    input.addEventListener("change", () => syncSubmitLabel(form, submitBtn));
  });

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

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) {
      setStatus("Заполните обязательные поля.", false);
      return;
    }
    const channel = channelOf(form);
    const url = applyUrl(form);
    if (!url) {
      setStatus("Мессенджер не настроен. Напишите на почту или позвоните.", false);
      return;
    }
    try {
      sessionStorage.setItem("applyChannel", channel);
    } catch {
      /* ignore */
    }
    if (submitBtn) submitBtn.disabled = true;
    setStatus(
      channel === "whatsapp"
        ? "Открываем WhatsApp с текстом заявки…"
        : "Открываем Telegram с текстом заявки…",
      true
    );
    window.open(url, "_blank", "noopener");
    location.hash = "#/thanks";
  });
}
