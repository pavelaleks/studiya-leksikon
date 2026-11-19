import { studioPhone, studioTelegram, studioWhatsApp } from "./config.js";

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
  const lines = ["Заявка в Студию Лексикон", ""];
  [
    ["Имя", "name"],
    ["Телефон", "phone"],
    ["Класс", "grade"],
    ["Предмет", "subject"],
    ["Цель", "goal"],
    ["Формат", "place"],
    ["Занятия", "mode"],
  ].forEach(([label, key]) => {
    const v = val(form, key);
    if (v) lines.push(`${label}: ${v}`);
  });
  const note = val(form, "note");
  if (note) lines.push("", `Комментарий: ${note}`);
  if (form.elements.namedItem("consent")?.checked) lines.push("", "Согласие на обработку персональных данных дано на сайте.");
  return lines.join("\n");
}

function applyUrl(channel, form) {
  const text = encodeURIComponent(buildBody(form));
  if (channel === "whatsapp") {
    const wa = studioWhatsApp();
    return wa.url ? `${wa.url}?text=${text}` : "";
  }
  const tg = studioTelegram();
  return tg.url ? `${tg.url}?text=${text}` : "";
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
 * Заявка: кнопка Telegram или WhatsApp открывает чат с текстом → #/thanks.
 * Почта в форме не используется (FormSubmit нестабилен; mailto на телефонах часто пустой).
 */
/** Заявка после «Проверь себя»: класс, предмет, цель и результат теста подставляются сами. */
export function applyPrefill(root = document) {
  const form = root.querySelector("#apply-form");
  if (!form) return;
  try {
    const pre = JSON.parse(sessionStorage.getItem("applyPrefill") || "null");
    if (!pre) return;
    sessionStorage.removeItem("applyPrefill");
    for (const [k, v] of Object.entries(pre)) {
      const el = form.elements.namedItem(k);
      if (el && "value" in el) el.value = v;
    }
    if (pre.note || pre.subject) form.querySelector(".lx-more")?.setAttribute("open", "");
  } catch {
    /* ignore */
  }
}

export function bindApplyForm(root = document) {
  bindRevealPhone(root);

  const form = root.querySelector("#apply-form");
  if (!form) return;

  const status = root.querySelector("#apply-status");
  form.removeAttribute("action");

  const setStatus = (text, ok) => {
    if (!status) return;
    status.hidden = false;
    status.textContent = text;
    status.classList.toggle("ok", Boolean(ok));
    status.classList.toggle("bad", ok === false);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) {
      setStatus("Заполните обязательные поля.", false);
      return;
    }
    const submitter = e.submitter;
    const channel = submitter?.value === "whatsapp" ? "whatsapp" : "telegram";
    const url = applyUrl(channel, form);
    if (!url) {
      setStatus("Мессенджер не настроен. Позвоните или напишите в контактах ниже.", false);
      return;
    }
    try {
      sessionStorage.setItem("applyChannel", channel);
    } catch {
      /* ignore */
    }
    form.querySelectorAll('button[type="submit"]').forEach((btn) => {
      btn.disabled = true;
    });
    setStatus(
      channel === "whatsapp"
        ? "Открываем WhatsApp с текстом заявки…"
        : "Открываем Telegram с текстом заявки…",
      true
    );
    window.open(url, "_blank", "noopener");
    form.closest("dialog")?.close();
    form.querySelectorAll('button[type="submit"]').forEach((btn) => (btn.disabled = false));
    location.hash = "#/thanks";
  });
}
