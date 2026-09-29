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

/** Payload for FormSubmit — ключи по-русски, чтобы письмо читалось сразу. */
function buildPayload(form) {
  const payload = {
    _subject: "Заявка в Студию Лексикон",
    _template: "table",
    _captcha: "false",
    Имя: val(form, "name"),
    Телефон: val(form, "phone"),
    Класс: val(form, "grade"),
    Предмет: val(form, "subject"),
    Цель: val(form, "goal"),
    Формат: val(form, "place"),
    Занятия: val(form, "mode"),
  };
  const note = val(form, "note");
  if (note) payload.Комментарий = note;
  return payload;
}

function buildBody(form) {
  const p = buildPayload(form);
  const lines = ["Заявка в Студию Лексикон", ""];
  for (const [k, v] of Object.entries(p)) {
    if (k.startsWith("_")) continue;
    lines.push(`${k}: ${v}`);
  }
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

export function bindApplyForm(root = document) {
  bindRevealPhone(root);

  const form = root.querySelector("#apply-form");
  if (!form) return;

  const status = root.querySelector("#apply-status");
  const mailFallback = root.querySelector("#apply-mailto");
  const submitBtn = form.querySelector('[type="submit"]');
  const endpoint = `https://formsubmit.co/ajax/${encodeURIComponent(STUDIO.applyEmail)}`;

  // Классический POST на случай отключения JS
  form.action = `https://formsubmit.co/${encodeURIComponent(STUDIO.applyEmail)}`;
  form.method = "POST";
  const next = form.querySelector('input[name="_next"]');
  if (next) next.value = thanksUrl();

  const setStatus = (text, ok) => {
    if (!status) return;
    status.hidden = false;
    status.textContent = text;
    status.classList.toggle("ok", ok === true);
    status.classList.toggle("bad", ok === false);
  };

  mailFallback?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const subject = encodeURIComponent("Заявка в Студию Лексикон");
    const body = encodeURIComponent(buildBody(form));
    location.href = `mailto:${STUDIO.applyEmail}?subject=${subject}&body=${body}`;
    setStatus(
      `Сейчас откроется письмо. Если нет — напишите на ${STUDIO.applyEmail}`,
      null
    );
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    // honeypot
    if (val(form, "_honey")) return;

    if (submitBtn) submitBtn.disabled = true;
    setStatus("Отправляем заявку…", null);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(buildPayload(form)),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || data.error || `Ошибка ${res.status}`);
      }

      // FormSubmit: первое письмо — только активация ящика
      const msg = String(data.message || "").toLowerCase();
      if (msg.includes("confirm") || msg.includes("activation") || msg.includes("activate")) {
        setStatus(
          `На ${STUDIO.applyEmail} ушло письмо активации FormSubmit. Откройте почту и подтвердите адрес — после этого заявки начнут приходить.`,
          true
        );
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      location.hash = "#/thanks";
    } catch (err) {
      setStatus(
        `Не удалось отправить через сервис. Нажмите «Открыть в почте» или напишите на ${STUDIO.applyEmail}. (${err.message || "сеть"})`,
        false
      );
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}
