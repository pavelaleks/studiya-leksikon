// «Подключить Telegram»: ссылка t.me/<бот>?start=<код> привязывает чат к аккаунту.
// Блок появляется, только когда бот настроен (app_settings.tg_bot).
import { escapeHtml } from "./ui.js";
import { supa } from "./supa.js";

export const tgSlotHtml = () => `<section class="me-section tg-block" id="tg-block" hidden></section>`;

export async function mountTg(host, role = "student") {
  const slot = host.querySelector("#tg-block");
  if (!slot) return;
  const [{ data: bot }, { data: me }] = await Promise.all([
    supa.from("app_settings").select("value").eq("key", "tg_bot").maybeSingle(),
    supa.from("me").select("tg_linked").maybeSingle(),
  ]);
  if (!bot?.value || !me) return;
  const what =
    role === "teacher"
      ? "новые работы на проверку, заявки и запросы на курсы"
      : "новые занятия и письменные работы, напоминания о занятиях по расписанию и о сроках, проверенные работы, вечернее напоминание о серии";
  if (me.tg_linked) {
    slot.innerHTML = `
      <h2>Уведомления в Telegram</h2>
      <div class="tg-card card">
        <p><strong>✓ Подключено.</strong> <span class="muted">Приходят: ${what}.</span></p>
        <p class="actions"><button class="btn secondary" type="button" data-tg-off>Отключить</button></p>
      </div>`;
    slot.querySelector("[data-tg-off]").addEventListener("click", async () => {
      await supa.rpc("tg_unlink");
      slot.hidden = true;
      mountTg(host, role);
    });
  } else {
    const { data: code } = await supa.rpc("tg_link");
    if (!code) return;
    const href = `https://t.me/${encodeURIComponent(bot.value)}?start=${encodeURIComponent(code)}`;
    slot.innerHTML = `
      <h2>Уведомления в Telegram</h2>
      <div class="tg-card card">
        <p class="muted">Бот @${escapeHtml(bot.value)} пришлёт: ${what}. Нажмите кнопку, в Telegram — «Запустить».</p>
        <p class="actions"><a class="btn" href="${href}" target="_blank" rel="noopener" data-tg-on>Подключить Telegram</a>
        <button class="btn secondary" type="button" data-tg-check hidden>Я подключил</button></p>
      </div>`;
    slot.querySelector("[data-tg-on]").addEventListener("click", () => {
      slot.querySelector("[data-tg-check]").hidden = false;
    });
    slot.querySelector("[data-tg-check]").addEventListener("click", () => mountTg(host, role));
  }
  slot.hidden = false;
}
