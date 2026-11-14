// Бот студии «Лексикон» в Telegram.
//   POST {"action":"dispatch"} — разослать очередь notify_queue (зовёт база при новых сообщениях);
//   POST {"action":"setup"}    — один раз после вставки токена: запомнить имя бота и включить webhook;
//   POST от Telegram (webhook)  — /start <код> привязывает чат к аккаунту, /stop отключает.
// Секрет TELEGRAM_BOT_TOKEN задаётся в Supabase → Edge Functions → Secrets.
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
// Проверку JWT у функции нужно выключить: Telegram ходит без ключа (защита — секрет webhook).
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SITE = "https://pavelaleks.github.io/studiya-leksikon/#/";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function tg(method: string, payload: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// Секрет webhook выводится из токена: ничего лишнего хранить не нужно.
async function hookSecret() {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("leksikon-hook:" + TOKEN));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

async function dispatch() {
  let sent = 0, failed = 0;
  for (let round = 0; round < 5; round++) {
    const { data, error } = await db.rpc("tg_claim");
    if (error) return { error: error.message, sent, failed };
    if (!data?.length) break;
    for (const m of data as { id: number; profile_id: string; chat_id: number; text: string; url: string | null }[]) {
      const r = await tg("sendMessage", {
        chat_id: m.chat_id,
        text: m.text,
        disable_web_page_preview: true,
        ...(m.url ? { reply_markup: { inline_keyboard: [[{ text: "Открыть на сайте", url: SITE + m.url }]] } } : {}),
      });
      if (r.status === 200) { sent++; continue; }
      failed++;
      await db.from("notify_queue").update({ error: String(r.body?.description ?? r.status).slice(0, 300) }).eq("id", m.id);
      // ученик заблокировал бота или удалил чат — больше не пишем
      if (r.status === 403 || (r.status === 400 && /chat not found/i.test(r.body?.description ?? ""))) {
        await db.from("profiles").update({ tg_chat_id: null }).eq("id", m.profile_id);
      }
      if (r.status === 429) await new Promise((res) => setTimeout(res, 1500));
    }
  }
  return { sent, failed };
}

async function onUpdate(u: any) {
  const msg = u.message;
  const chat = msg?.chat?.id;
  const text: string = msg?.text ?? "";
  if (!chat || msg.chat.type !== "private") return;
  const [cmd, arg] = text.trim().split(/\s+/, 2);
  if (cmd === "/start" && arg && /^[0-9a-f]{12}$/.test(arg)) {
    const { data } = await db.from("profiles").update({ tg_chat_id: chat, tg_code: null }).eq("tg_code", arg).select("full_name, role").maybeSingle();
    if (!data) {
      await tg("sendMessage", { chat_id: chat, text: "Ссылка устарела. Откройте сайт студии и нажмите «Подключить Telegram» ещё раз." });
      return;
    }
    const name = (data.full_name || "").trim().split(/\s+/)[0] || "";
    await tg("sendMessage", {
      chat_id: chat,
      text: data.role === "teacher"
        ? `Готово${name ? ", " + name : ""}! Сюда будут приходить новые работы на проверку, заявки и запросы на курсы.`
        : `Готово${name ? ", " + name : ""}! Сюда будут приходить новые занятия и сроки, проверенные работы и вечернее напоминание о серии. Отключить: /stop`,
    });
    return;
  }
  if (cmd === "/stop") {
    await db.from("profiles").update({ tg_chat_id: null }).eq("tg_chat_id", chat);
    await tg("sendMessage", { chat_id: chat, text: "Уведомления отключены. Включить снова — кнопкой «Подключить Telegram» на сайте." });
    return;
  }
  await tg("sendMessage", {
    chat_id: chat,
    text: "Это бот уведомлений студии «Лексикон». Чтобы подключить его, войдите на сайт и нажмите «Подключить Telegram» в своём профиле.",
    reply_markup: { inline_keyboard: [[{ text: "Открыть сайт", url: SITE + "me/profile" }]] },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true });
  if (!TOKEN) return json({ error: "TELEGRAM_BOT_TOKEN is not set" }, 500);
  const hdr = req.headers.get("x-telegram-bot-api-secret-token");
  const body = await req.json().catch(() => ({}));
  if (hdr !== null) {
    if (hdr !== (await hookSecret())) return json({ error: "bad secret" }, 401);
    await onUpdate(body).catch((e) => console.error(e));
    return json({ ok: true });
  }
  if (body.action === "dispatch") return json(await dispatch());
  if (body.action === "status") {
    const info = (await tg("getWebhookInfo", {})).body?.result ?? {};
    return json({ pending: info.pending_update_count, last_error: info.last_error_message, last_error_at: info.last_error_date });
  }
  if (body.action === "setup") {
    const me = await tg("getMe", {});
    if (me.status !== 200) return json({ error: "Telegram не принял токен", details: me.body }, 400);
    await db.from("app_settings").upsert({ key: "tg_bot", value: me.body.result.username });
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/tg`;
    const hook = await tg("setWebhook", { url, secret_token: await hookSecret(), allowed_updates: ["message"] });
    await tg("setMyCommands", { commands: [{ command: "stop", description: "Отключить уведомления" }] });
    return json({ bot: me.body.result.username, webhook: hook.body });
  }
  return json({ error: "unknown action" }, 400);
});
