// Окно «Записаться»: открывается по любой ссылке #apply. На телефоне выезжает снизу.
import { applyFormHtml } from "./pages.js?v=land162";
import { bindApplyForm, applyPrefill } from "./apply.js?v=land162";
import { studioTelegram, studioWhatsApp } from "./config.js";

let dlg = null;

function build() {
  const tg = studioTelegram();
  const wa = studioWhatsApp();
  dlg = document.createElement("dialog");
  dlg.className = "lx-dialog";
  dlg.setAttribute("aria-labelledby", "lx-apply-title");
  dlg.innerHTML = `
    <div class="lx-dialog-box">
      <button type="button" class="lx-dialog-x" data-close aria-label="Закрыть">×</button>
      <h2 id="lx-apply-title">Записаться на занятия</h2>
      <p class="lx-dialog-lede">Ответим в течение дня — в мессенджере или по телефону.</p>
      ${applyFormHtml()}
      <p class="lx-dialog-alt muted">Удобнее написать самим?
        ${tg.url ? `<a href="${tg.url}" target="_blank" rel="noopener noreferrer">Telegram</a>` : ""}
        ${wa.url ? ` · <a href="${wa.url}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ""}
        · <button type="button" class="link-btn" data-reveal-phone>Позвонить</button></p>
    </div>`;
  document.body.appendChild(dlg);
  bindApplyForm(dlg);
  dlg.addEventListener("click", (e) => {
    // клик по затемнению вокруг окна или по крестику
    if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
  });
  dlg.addEventListener("close", () => document.documentElement.classList.remove("lx-noscroll"));
}

export function openApply() {
  if (!dlg) build();
  applyPrefill(dlg);
  if (!dlg.open) {
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  }
  document.documentElement.classList.add("lx-noscroll");
  requestAnimationFrame(() => dlg.querySelector('[name="name"]')?.focus({ preventScroll: true }));
  try {
    window.ym?.(114257440, "reachGoal", "apply_open");
  } catch {}
}
