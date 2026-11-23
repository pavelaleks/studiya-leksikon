// Учётные записи учеников под псевдонимами (без настоящей почты). Вызывает только преподаватель.
//   {action:"create", login, name, password, grade, courses}  — новый ученик (сразу с доступом)
//   {action:"reset", student, password}                       — новый пароль ученику
//   {action:"convert", student, login, name, password?}       — перевести старого ученика на псевдоним
//   {action:"link", student, days?}                            — личная ссылка для входа (новая заменяет прежнюю)
//   {action:"enter", token}                                    — ВСЕМ: вход по личной ссылке → token_hash для verifyOtp
// Почта ученика — служебная: <логин>@<DOMAIN>, писем на неё не бывает.
// Проверка JWT у этой функции ВКЛЮЧЕНА (по умолчанию); роль преподавателя проверяется здесь же.
import { createClient } from "jsr:@supabase/supabase-js@2";

export const DOMAIN = "students.lexicon.local";
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

const LOGIN = /^[a-z0-9][a-z0-9-]{2,30}[a-z0-9]$/;
const cleanName = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
const COURSE = /^(rus|lit):([5-9]|1[01])$/;

async function isTeacher(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data } = await admin.auth.getUser(jwt);
  if (!data?.user) return false;
  const { data: p } = await admin.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return p?.role === "teacher";
}

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Вход по личной ссылке: проверяем токен и выдаём одноразовый код входа (как в письме «волшебная ссылка»). */
async function enterByLink(token: string) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return json({ error: "Ссылка недействительна." }, 400);
  const { data: l } = await admin
    .from("student_enter_links")
    .select("student_id, expires_at, used_count")
    .eq("token_hash", await sha256(token))
    .maybeSingle();
  if (!l) return json({ error: "Ссылка недействительна или её заменили новой. Войдите по логину и паролю или попросите у преподавателя новую ссылку." }, 404);
  if (Date.parse(l.expires_at) < Date.now())
    return json({ error: "Срок ссылки истёк. Войдите по логину и паролю или попросите у преподавателя новую ссылку." }, 410);
  const { data: p } = await admin.from("profiles").select("email, role").eq("id", l.student_id).maybeSingle();
  if (!p?.email || p.role === "teacher") return json({ error: "Ссылка недействительна." }, 400);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: p.email });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) return json({ error: error?.message || "Не удалось войти" }, 400);
  await admin
    .from("student_enter_links")
    .update({ used_count: (l.used_count || 0) + 1, last_used_at: new Date().toISOString() })
    .eq("student_id", l.student_id);
  return json({ token_hash: hashed });
}

async function student(id: unknown) {
  const { data } = await admin.from("profiles").select("id, role").eq("id", String(id)).maybeSingle();
  return data && data.role !== "teacher" ? data : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const b = await req.json().catch(() => ({}));
  // вход по ссылке — для ученика, который ещё не вошёл; остальное — только преподавателю
  if (b.action === "enter") return await enterByLink(String(b.token || ""));
  if (!(await isTeacher(req))) return json({ error: "Только для преподавателя" }, 403);

  if (b.action === "link") {
    const s = await student(b.student);
    if (!s) return json({ error: "Ученик не найден" }, 404);
    const days = Math.min(60, Math.max(1, Number(b.days) || 14));
    const token = newToken();
    const expires_at = new Date(Date.now() + days * 86400000).toISOString();
    const { error } = await admin
      .from("student_enter_links")
      .upsert({ student_id: s.id, token_hash: await sha256(token), expires_at, created_at: new Date().toISOString(), used_count: 0, last_used_at: null });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, token, expires_at });
  }

  if (b.action === "create" || b.action === "convert") {
    const login = String(b.login || "").toLowerCase().trim();
    const name = cleanName(b.name);
    if (!LOGIN.test(login)) return json({ error: "Логин: 4–32 латинские буквы, цифры и дефис" }, 400);
    if (name.length < 3) return json({ error: "Псевдоним слишком короткий" }, 400);
    if (b.password != null && String(b.password).length < 8) return json({ error: "Пароль — не короче 8 символов" }, 400);
    const email = `${login}@${DOMAIN}`;
    const { data: taken } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();

    if (b.action === "create") {
      if (taken) return json({ error: "Такой логин уже есть" }, 409);
      const grade = Number(b.grade) || null;
      const courses = (Array.isArray(b.courses) ? b.courses : []).map(String).filter((c: string) => COURSE.test(c));
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: String(b.password || ""),
        email_confirm: true,
        user_metadata: { full_name: name, grade },
      });
      if (error || !data?.user) return json({ error: error?.message || "Не удалось создать" }, 400);
      const { error: e2 } = await admin
        .from("profiles")
        .update({ full_name: name, status: "active", approved_at: new Date().toISOString(), courses, contact: null, note: null })
        .eq("id", data.user.id);
      if (e2) return json({ error: e2.message }, 400);
      if (b.group) await admin.from("group_members").insert({ group_id: String(b.group), student_id: data.user.id });
      return json({ ok: true, id: data.user.id, login });
    }

    const s = await student(b.student);
    if (!s) return json({ error: "Ученик не найден" }, 404);
    if (taken && taken.id !== s.id) return json({ error: "Такой логин уже есть" }, 409);
    const upd: Record<string, unknown> = { email, email_confirm: true, user_metadata: { full_name: name } };
    if (b.password) upd.password = String(b.password);
    const { error } = await admin.auth.admin.updateUserById(s.id, upd);
    if (error) return json({ error: error.message }, 400);
    const { error: e2 } = await admin
      .from("profiles")
      .update({ full_name: name, email, contact: null, note: null, tg_chat_id: null, tg_code: null })
      .eq("id", s.id);
    if (e2) return json({ error: e2.message }, 400);
    return json({ ok: true, login });
  }

  if (b.action === "reset") {
    const s = await student(b.student);
    if (!s) return json({ error: "Ученик не найден" }, 404);
    if (String(b.password || "").length < 8) return json({ error: "Пароль — не короче 8 символов" }, 400);
    const { error } = await admin.auth.admin.updateUserById(s.id, { password: String(b.password) });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
});
