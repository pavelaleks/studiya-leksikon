import { STUDIO, studioPhone } from "./config.js";

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
    `Экзамен / цель: ${val(form, "goal")}`,
    `Формат: ${val(form, "place")}`,
    `Занятия: ${val(form, "mode")}`,
  ];
  const note = val(form, "note");
  if (note) lines.push("", `Комментарий: ${note}`);
  return lines.join("\n");
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
      // На телефоне сразу открыть набор
      if (/Mobi|Android/i.test(navigator.userAgent)) {
        location.href = a.href;
      }
    });
  });
}

export function bindApplyForm(root = document) {
  bindRevealPhone(root);

  const form = root.querySelector("#apply-form");
  if (!form) return;

  const status = root.querySelector("#apply-status");
  const mailFallback = root.querySelector("#apply-mailto");

  form.action = `https://formsubmit.co/${encodeURIComponent(STUDIO.applyEmail)}`;
  form.method = "POST";

  const next = form.querySelector('input[name="_next"]');
  if (next) {
    next.value =
      STUDIO.applyThanksUrl ||
      `${location.origin}${location.pathname}${location.search}#/thanks`;
  }

  mailFallback?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const subject = encodeURIComponent("Заявка в Студию Лексикон");
    const body = encodeURIComponent(buildBody(form));
    location.href = `mailto:${STUDIO.applyEmail}?subject=${subject}&body=${body}`;
    if (status) {
      status.hidden = false;
      status.textContent = "Откроется письмо с заявкой. Если не открылось — напишите на " + STUDIO.applyEmail;
    }
  });

  form.addEventListener("submit", () => {
    if (status) {
      status.hidden = false;
      status.textContent = "Отправляем…";
    }
  });
}
