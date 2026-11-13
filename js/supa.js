/**
 * Supabase: вход, профиль, банк заданий, проверка ответов, письменные работы.
 * Публикуемый ключ безопасно держать в браузере — доступ ограничивают правила RLS в базе.
 */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.100.0/+esm";

export const SUPABASE_URL = "https://mhlpcwquvphrnpxsjzne.supabase.co";
export const SUPABASE_KEY = "sb_publishable_bPGGvWOilhwuzM0EzIPNzQ_LtyHfT9_";

export const supa = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

/* ------------------------------------------------------------------ */
/* Сессия и профиль                                                    */
/* ------------------------------------------------------------------ */

let session = null;
let profile = null;
const listeners = new Set();

async function loadProfile() {
  if (!session) {
    profile = null;
    return null;
  }
  const { data, error } = await supa.from("me").select("*").maybeSingle();
  if (error) console.warn("profile", error);
  profile = data || null;
  return profile;
}

export async function initAuth() {
  const { data } = await supa.auth.getSession();
  session = data.session;
  await loadProfile();
  supa.auth.onAuthStateChange(async (event, next) => {
    const changed = (next?.user?.id || null) !== (session?.user?.id || null);
    session = next;
    if (changed || event === "USER_UPDATED") {
      bankCache.clear();
      await loadProfile();
      listeners.forEach((fn) => fn(profile));
    }
  });
  return profile;
}

export const onAuthChange = (fn) => listeners.add(fn);
export const currentUser = () => session?.user || null;
export const currentProfile = () => profile;
export const isTeacher = () => profile?.role === "teacher";

/** Есть ли доступ к закрытому банку: одобренный ученик с действующим сроком или преподаватель. */
export function hasAccess() {
  if (!profile) return false;
  if (profile.role === "teacher") return true;
  if (profile.status !== "active") return false;
  if (!profile.access_until) return true;
  return profile.access_until >= new Date().toISOString().slice(0, 10);
}

/** 'guest' | 'pending' | 'paused' | 'expired' | 'student' | 'teacher' */
export function accessState() {
  if (!session) return "guest";
  if (!profile) return "pending";
  if (profile.role === "teacher") return "teacher";
  if (profile.status === "pending") return "pending";
  if (profile.status !== "active") return "paused";
  return hasAccess() ? "student" : "expired";
}

export async function refreshProfile() {
  await loadProfile();
  listeners.forEach((fn) => fn(profile));
  return profile;
}

export async function signIn(email, password) {
  const { error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw humanError(error);
}

export async function signUp({ email, password, meta }) {
  const { data, error } = await supa.auth.signUp({
    email,
    password,
    options: { data: meta, emailRedirectTo: location.origin + location.pathname + "#/me" },
  });
  if (error) throw humanError(error);
  return data;
}

export async function resetPassword(email) {
  const { error } = await supa.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + location.pathname + "#/me/password",
  });
  if (error) throw humanError(error);
}

export async function updatePassword(password) {
  const { error } = await supa.auth.updateUser({ password });
  if (error) throw humanError(error);
}

export async function signOut() {
  await supa.auth.signOut();
}

export function humanError(err) {
  const msg = String(err?.message || err || "");
  const map = [
    [/invalid login credentials/i, "Неверный e-mail или пароль."],
    [/email not confirmed/i, "E-mail ещё не подтверждён — откройте письмо со ссылкой."],
    [/user already registered/i, "Такой e-mail уже зарегистрирован. Войдите или восстановите пароль."],
    [/password should be at least/i, "Пароль слишком короткий — нужно не меньше 8 символов."],
    [/rate limit|too many/i, "Слишком много попыток. Подождите минуту и попробуйте снова."],
    [/no access/i, "Это задание доступно ученикам студии."],
    [/teacher only/i, "Действие доступно только преподавателю."],
    [/attempts exhausted/i, "Попытки на это задание закончились."],
    [/deadline passed/i, "Срок сдачи прошёл."],
    [/failed to fetch|network/i, "Нет связи с сервером. Проверьте интернет."],
  ];
  const hit = map.find(([re]) => re.test(msg));
  const e = new Error(hit ? hit[1] : msg || "Что-то пошло не так.");
  e.raw = err;
  return e;
}

/* ------------------------------------------------------------------ */
/* Банк заданий                                                        */
/* ------------------------------------------------------------------ */

const bankCache = new Map();
const PAGE = 1000;

async function cached(key, fn) {
  if (bankCache.has(key)) return bankCache.get(key);
  const p = fn().catch((err) => {
    bankCache.delete(key);
    throw err;
  });
  bankCache.set(key, p);
  return p;
}

async function selectAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw humanError(error);
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/** Карточки списка (без ответов) в порядке банка. Гость получает только демо. */
export function bankList(source, bankFile) {
  return cached(`list:${source}:${bankFile}`, async () => {
    const rows = await selectAll(() =>
      supa
        .from("tasks")
        .select("id, source_ref, list_item, is_demo")
        .eq("source", source)
        .eq("bank_file", bankFile)
        .order("position")
        .order("id")
    );
    return rows.map((r) => ({ ...r.list_item, id: r.list_item.id ?? r.source_ref, _tid: r.id, _demo: r.is_demo }));
  });
}

/** Полное задание и его текст (passage). null — нет доступа или не найдено. */
export function bankProblem(source, ref) {
  return cached(`problem:${source}:${ref}`, async () => {
    const { data, error } = await supa
      .from("tasks")
      .select("id, data, passage_id, is_demo, passages(id, html, data)")
      .eq("source", source)
      .eq("source_ref", String(ref))
      .maybeSingle();
    if (error) throw humanError(error);
    if (!data) return null;
    const problem = { ...data.data, _tid: data.id, _demo: data.is_demo };
    const passage = data.passages ? { ...(data.passages.data || {}), html: data.passages.html } : null;
    return { problem, passage };
  });
}

/** Полный банк одного файла (для литературы): {problems, passages}. */
export function bankFull(source, bankFile) {
  return cached(`full:${source}:${bankFile}`, async () => {
    const rows = await selectAll(() =>
      supa
        .from("tasks")
        .select("id, source_ref, data, passage_id, is_demo")
        .eq("source", source)
        .eq("bank_file", bankFile)
        .order("position")
        .order("id")
    );
    const passageIds = [...new Set(rows.map((r) => r.passage_id).filter(Boolean))];
    const passages = {};
    for (let i = 0; i < passageIds.length; i += 200) {
      const { data, error } = await supa.from("passages").select("id, html, data").in("id", passageIds.slice(i, i + 200));
      if (error) throw humanError(error);
      data.forEach((p) => {
        passages[p.id.split(":").slice(1).join(":")] = { ...(p.data || {}), html: p.html };
      });
    }
    const problems = rows.map((r) => ({ ...r.data, id: r.data.id ?? r.source_ref, _tid: r.id, _demo: r.is_demo }));
    return { problems, passages };
  });
}

export function clearBankCache() {
  bankCache.clear();
}

/* ------------------------------------------------------------------ */
/* Ответы                                                              */
/* ------------------------------------------------------------------ */

export async function submitAnswer(taskId, answer, { item = null, seconds = null } = {}) {
  const { data, error } = await supa.rpc("submit_answer", {
    p_task: taskId,
    p_answer: answer,
    p_item: item,
    p_seconds: seconds,
  });
  if (error) throw humanError(error);
  return data;
}

export async function showSolution(taskId, item = null) {
  const { data, error } = await supa.rpc("show_solution", { p_task: taskId, p_item: item });
  if (error) throw humanError(error);
  return data;
}

/** id решённых верно заданий: {source: {task_no: Set(ref)}} — для отметок «решено». */
export async function mySolved() {
  if (!session) return {};
  const rows = await selectAll(() =>
    supa.from("attempts").select("is_correct, tasks(source, task_no, source_ref)").eq("is_correct", true)
  );
  const out = {};
  rows.forEach((r) => {
    const t = r.tasks;
    if (!t) return;
    out[t.source] = out[t.source] || {};
    (out[t.source][t.task_no] = out[t.source][t.task_no] || new Set()).add(String(t.source_ref));
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Письменные работы                                                   */
/* ------------------------------------------------------------------ */

export async function myWorkFor(taskId) {
  if (!session) return null;
  const { data, error } = await supa
    .from("written_works")
    .select("*")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw humanError(error);
  return data;
}

export async function uploadWorkFile(file) {
  const uid = session?.user?.id;
  if (!uid) throw new Error("Нужно войти.");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supa.storage.from("works").upload(path, file, { contentType: file.type || undefined });
  if (error) throw humanError(error);
  return path;
}

export async function signedFileUrl(path) {
  const { data, error } = await supa.storage.from("works").createSignedUrl(path, 3600);
  if (error) throw humanError(error);
  return data.signedUrl;
}

/** Сохранить черновик или сдать работу (status: 'draft' | 'submitted'). */
export async function saveWork({ id = null, taskId, body, files = [], status }) {
  const uid = session?.user?.id;
  if (!uid) throw new Error("Нужно войти.");
  const row = { body, files, status };
  const q = id
    ? supa.from("written_works").update(row).eq("id", id)
    : supa.from("written_works").insert({ ...row, task_id: taskId, student_id: uid });
  const { data, error } = await q.select().single();
  if (error) throw humanError(error);
  return data;
}
