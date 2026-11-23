// Бот студии «Лексикон» в Telegram.
//   POST {"action":"dispatch"} — разослать очередь notify_queue (зовёт база при новых сообщениях);
//   POST {"action":"setup"}    — один раз после вставки токена: запомнить имя бота и включить webhook;
//   POST {"action":"remind"}   — напоминания ученикам о занятиях из Google Календаря (зовёт база по расписанию,
//                                каждые 30 минут): вечером накануне и за ~2 часа, со списком несделанного к занятию.
//                                Повторный вызов ничего не дублирует (у каждого напоминания свой ключ в очереди).
//   POST от Telegram (webhook)  — /start <код> привязывает чат к аккаунту, /stop отключает.
// Секрет TELEGRAM_BOT_TOKEN задаётся в Supabase → Edge Functions → Secrets.
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
// Проверку JWT у функции нужно выключить: Telegram ходит без ключа (защита — секрет webhook).
import { createClient } from "jsr:@supabase/supabase-js@2";
import ICAL from "npm:ical.js@2.1.0";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SITE = "https://lexicon-school.ru/#/";
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
        : `Готово${name ? ", " + name : ""}! Сюда будут приходить новые задания, напоминания о занятиях и сроках, проверенные работы и вечернее напоминание о серии. Отключить: /stop`,
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

/* ---------- напоминания о занятиях из календаря ---------- */
// Разбор календаря — копия из supabase/functions/calendar/index.ts (менять в обоих местах).
// BEGIN expand
// deno-lint-ignore no-explicit-any
function expandIcs(ICAL: any, text: string, fromMs: number, toMs: number) {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const tz of comp.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch (_) {
      /* уже есть */
    }
  }
  const vevents = comp.getAllSubcomponents("vevent");
  // deno-lint-ignore no-explicit-any
  const masters = new Map<string, any>();
  // deno-lint-ignore no-explicit-any
  const exceptions: any[] = [];
  for (const ve of vevents) {
    const ev = new ICAL.Event(ve);
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) {
    const m = masters.get(ex.uid);
    if (m) m.relateException(ex);
    else masters.set(`${ex.uid}#${ex.recurrenceId}`, ex);
  }
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  // deno-lint-ignore no-explicit-any
  // deno-lint-ignore no-explicit-any
  const push = (ev: any, start: any, end: any, recurring: boolean, rid: any = null) => {
    if (String(ev.component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED") return;
    const s = start.toJSDate().getTime();
    // Перенесённое занятие: исключение серии, у которого время не совпадает с исходным (RECURRENCE-ID).
    const orig = rid ? rid.toJSDate().getTime() : null;
    const e = end ? end.toJSDate().getTime() : s;
    if (e < fromMs || s > toMs) return;
    out.push({
      uid: ev.uid,
      title: String(ev.summary || "").slice(0, 200),
      start: new Date(s).toISOString(),
      end: new Date(e).toISOString(),
      allDay: Boolean(start.isDate),
      // у события «на весь день» — просто дата (без часового пояса), например 2026-11-21
      date: start.isDate ? start.toString().slice(0, 10) : null,
      recurring,
      // id серии без хвоста «_R20261127T100000», который Google добавляет при «Это и последующие»
      base: String(ev.uid || "").replace(/_R\d{8}(T\d{6}Z?)?(?=@|$)/, ""),
      moved_from: orig && Math.abs(orig - s) > 60000 ? new Date(orig).toISOString() : null,
    });
  };
  for (const ev of masters.values()) {
    if (!ev.isRecurring()) {
      const exc = Boolean(ev.isRecurrenceException && ev.isRecurrenceException());
      push(ev, ev.startDate, ev.endDate, exc, exc ? ev.recurrenceId : null);
      continue;
    }
    const it = ev.iterator();
    let next;
    let guard = 0;
    while ((next = it.next()) && guard++ < 3000) {
      const t = next.toJSDate().getTime();
      if (t > toMs) break;
      const d = ev.getOccurrenceDetails(next);
      push(d.item, d.startDate, d.endDate, true, d.item !== ev ? d.recurrenceId : null);
    }
  }
  out.sort((a, b) => a.start.localeCompare(b.start));
  return out;
}
// END expand

async function fetchIcs(url: string) {
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw new Error("Нужна ссылка, начинающаяся с https://");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: "text/calendar" } });
    if (!r.ok) throw new Error(`Календарь не открылся (код ${r.status}). Проверьте ссылку.`);
    const text = await r.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("По ссылке не календарь. Нужен «Секретный адрес в формате iCal».");
    return text;
  } finally {
    clearTimeout(timer);
  }
}


const TZ = "Asia/Barnaul";
const tzFmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, ...o });
const timeOf = (iso: string) => tzFmt({ hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dueOf = (iso: string) => tzFmt({ day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dateOf = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));
const hourNow = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));

type Work = { lesson: string; title: string; due: string };

/** Несделанные работы учеников со сроком от недели назад до трёх дней вперёд. */
async function openWorks(ids: string[]) {
  const res = new Map<string, Work[]>();
  const now = Date.now();
  const { data: items } = await db
    .from("lesson_items")
    .select("id, lesson_id, due_at, lessons!inner(id, title, status, self_made, group_id, student_id, starts_at)")
    .eq("lessons.status", "live")
    .eq("lessons.self_made", false)
    .eq("hidden", false)
    .gte("due_at", new Date(now - 7 * 86400000).toISOString())
    .lte("due_at", new Date(now + 3 * 86400000).toISOString())
    .limit(3000);
  // deno-lint-ignore no-explicit-any
  const list = ((items || []) as any[]).filter((it) => !it.lessons.starts_at || Date.parse(it.lessons.starts_at) <= now);
  if (!list.length) return res;
  const itemIds = list.map((i) => i.id);
  const [{ data: la }, { data: gm }, { data: at }, { data: wk }] = await Promise.all([
    db.from("lesson_assignees").select("lesson_id, student_id").in("lesson_id", [...new Set(list.map((i) => i.lesson_id))]),
    db.from("group_members").select("group_id, student_id").in("student_id", ids),
    db.from("attempts").select("item_id, student_id").in("item_id", itemIds).in("student_id", ids).limit(20000),
    db.from("written_works").select("item_id, student_id").in("item_id", itemIds).in("student_id", ids).neq("status", "draft"),
  ]);
  const done = new Set([...(at || []), ...(wk || [])].map((r) => `${r.item_id}|${r.student_id}`));
  for (const sid of ids) {
    const groups = new Set((gm || []).filter((m) => m.student_id === sid).map((m) => m.group_id));
    const byLesson = new Map<string, Work>();
    for (const it of list) {
      const l = it.lessons;
      const mine = l.student_id === sid || (l.group_id && groups.has(l.group_id)) || (la || []).some((a) => a.lesson_id === l.id && a.student_id === sid);
      if (!mine || done.has(`${it.id}|${sid}`)) continue;
      const cur = byLesson.get(l.id);
      if (!cur || it.due_at < cur.due) byLesson.set(l.id, { lesson: l.id, title: l.title, due: it.due_at });
    }
    res.set(sid, [...byLesson.values()].sort((a, b) => a.due.localeCompare(b.due)));
  }
  return res;
}

async function remind() {
  const { data: cals } = await db.from("teacher_calendar").select("ics_url, map").not("ics_url", "is", null);
  if (!cals?.length) return { queued: 0, note: "календарь не подключён" };
  const { data: subs } = await db.from("profiles").select("id").eq("role", "student").eq("status", "active").not("tg_chat_id", "is", null);
  const subIds = new Set((subs || []).map((p) => p.id));
  if (!subIds.size) return { queued: 0, note: "никто из учеников не подключил Telegram" };
  const { data: gm } = await db.from("group_members").select("group_id, student_id, groups(title, archived)");
  const now = Date.now();
  const hour = hourNow();
  const tomorrow = dateOf(now + 86400000);
  const jobs: { id: string; uid: string; start: string; kind: string; label: string }[] = [];
  for (const c of cals) {
    // deno-lint-ignore no-explicit-any
    let evs: any[] = [];
    try {
      evs = expandIcs(ICAL, await fetchIcs(c.ics_url), now, now + 36 * 3600000);
    } catch (e) {
      console.error("calendar", (e as Error).message);
      continue;
    }
    for (const e of evs) {
      if (e.allDay) continue;
      const key = String((c.map || {})[e.uid] || (c.map || {})[e.base] || "");
      if (!key || key === "-") continue;
      const mins = (Date.parse(e.start) - now) / 60000;
      const kind = mins > 0 && mins <= 150 ? "soon" : hour >= 19 && hour < 23 && dateOf(Date.parse(e.start)) === tomorrow ? "eve" : "";
      if (!kind) continue;
      // deno-lint-ignore no-explicit-any
      const grp = (gm || []).find((m: any) => m.group_id === key.slice(2)) as any;
      if (key.startsWith("g:") && grp?.groups?.archived) continue;
      const label = key.startsWith("g:") ? `занятие группы «${grp?.groups?.title || ""}»` : "индивидуальное занятие";
      const students = key.startsWith("s:") ? [key.slice(2)] : (gm || []).filter((m) => m.group_id === key.slice(2)).map((m) => m.student_id);
      students.filter((id) => subIds.has(id)).forEach((id) => jobs.push({ id, uid: e.uid, start: e.start, kind, label }));
    }
  }
  if (!jobs.length) return { queued: 0 };
  const works = await openWorks([...new Set(jobs.map((j) => j.id))]);
  const rows = jobs.map((j) => {
    const todo = (works.get(j.id) || []).filter((w) => Date.parse(w.due) <= Date.parse(j.start) + 3600000);
    const when = j.kind === "soon" ? `Сегодня в ${timeOf(j.start)}` : `Завтра в ${timeOf(j.start)}`;
    let text = `${j.kind === "soon" ? "⏰" : "📅"} ${when} — ${j.label}.`;
    if (todo.length) {
      text += "\nК занятию нужно сделать:\n" +
        todo.slice(0, 5).map((w) => `• «${w.title}» — до ${dueOf(w.due)}${Date.parse(w.due) < now ? " (срок уже прошёл)" : ""}`).join("\n");
    }
    return { profile_id: j.id, kind: `cal-${j.kind}`, ref: `${j.uid}|${j.start}`, text, url: todo.length === 1 ? `lesson/${todo[0].lesson}` : "me" };
  });
  const { error } = await db.from("notify_queue").upsert(rows, { onConflict: "profile_id,kind,ref", ignoreDuplicates: true });
  if (error) return { error: error.message };
  return { queued: rows.length, ...(await dispatch()) };
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
  if (body.action === "remind") return json(await remind());
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
