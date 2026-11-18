// Расписание преподавателя из Google Календаря (или любого календаря с iCal-ссылкой).
// Ссылка («Секретный адрес в формате iCal») хранится в public.teacher_calendar, видна только самому преподавателю.
// События НЕ сохраняются в базе: функция читает календарь в момент запроса и отдаёт их только преподавателю.
//   POST {from, to}        — события в промежутке (повторяющиеся развёрнуты, переносы и отмены учтены)
//   POST {action:"test", url} — проверить ссылку, не сохраняя её
//   POST {action:"my"}      — УЧЕНИКУ: его ближайшие занятия (только время и название группы — без названий событий)
// Проверка JWT у функции ВКЛЮЧЕНА (по умолчанию); роль преподавателя проверяется здесь же.
import { createClient } from "jsr:@supabase/supabase-js@2";
import ICAL from "npm:ical.js@2.1.0";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function whoAmI(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: p } = await admin.from("profiles").select("role, status").eq("id", data.user.id).maybeSingle();
  return p ? { id: data.user.id, role: p.role as string, status: p.status as string } : null;
}

/** Ученику: занятия его групп и индивидуальные в ближайшие 2 недели — только время и подпись. */
async function myLessons(uid: string) {
  const { data: gm } = await admin.from("group_members").select("group_id, groups(title, archived)").eq("student_id", uid);
  // deno-lint-ignore no-explicit-any
  const label = new Map<string, string>([[`s:${uid}`, "Индивидуальное занятие"]]);
  // deno-lint-ignore no-explicit-any
  (gm || []).forEach((g: any) => !g.groups?.archived && label.set(`g:${g.group_id}`, g.groups?.title || "Занятие группы"));
  const { data: cals } = await admin.from("teacher_calendar").select("ics_url, map").not("ics_url", "is", null);
  const from = Date.now() - 3 * 3600000;
  const to = Date.now() + 15 * 86400000;
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (const c of cals || []) {
    const mine = Object.entries(c.map || {}).filter(([, v]) => label.has(String(v)));
    if (!mine.length) continue;
    try {
      const evs = expandIcs(ICAL, await fetchIcs(c.ics_url), from, to);
      for (const e of evs) {
        const key = String((c.map || {})[e.uid] || "");
        if (!label.has(key) || e.allDay) continue;
        out.push({ start: e.start, end: e.end, label: label.get(key) });
      }
    } catch (_) {
      /* календарь недоступен — просто без расписания */
    }
  }
  out.sort((a, b) => a.start.localeCompare(b.start));
  return out;
}

// ---- разбор календаря (чистая функция, без Deno — проверяется отдельно) ----
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
  const push = (ev: any, start: any, end: any, recurring: boolean) => {
    if (String(ev.component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED") return;
    const s = start.toJSDate().getTime();
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
    });
  };
  for (const ev of masters.values()) {
    if (!ev.isRecurring()) {
      push(ev, ev.startDate, ev.endDate, Boolean(ev.isRecurrenceException && ev.isRecurrenceException()));
      continue;
    }
    const it = ev.iterator();
    let next;
    let guard = 0;
    while ((next = it.next()) && guard++ < 3000) {
      const t = next.toJSDate().getTime();
      if (t > toMs) break;
      const d = ev.getOccurrenceDetails(next);
      push(d.item, d.startDate, d.endDate, true);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const me = await whoAmI(req);
  if (!me) return json({ error: "Нужно войти" }, 401);
  const b = await req.json().catch(() => ({}));
  if (b.action === "my") {
    if (me.status !== "active") return json({ lessons: [] });
    return json({ lessons: await myLessons(me.id) });
  }
  if (me.role !== "teacher") return json({ error: "Только для преподавателя" }, 403);
  const tid = me.id;
  try {
    let url = "";
    if (b.action === "test") url = String(b.url || "").trim();
    else {
      const { data } = await admin.from("teacher_calendar").select("ics_url").eq("teacher_id", tid).maybeSingle();
      url = data?.ics_url || "";
      if (!url) return json({ events: [], configured: false });
    }
    const from = Date.parse(b.from) || Date.now() - 7 * 86400000;
    const to = Math.min(Date.parse(b.to) || Date.now() + 28 * 86400000, from + 120 * 86400000);
    const text = await fetchIcs(url);
    const events = expandIcs(ICAL, text, from, to);
    return json({ events, configured: true });
  } catch (err) {
    return json({ error: (err as Error).message || "Не удалось прочитать календарь" }, 400);
  }
});
