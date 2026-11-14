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

const PROFILE_KEY = "leksikon-profile";

function cachedProfile(uid) {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    return p && p.id === uid ? p : null;
  } catch {
    return null;
  }
}

async function loadProfile() {
  if (!session) {
    profile = null;
    try {
      localStorage.removeItem(PROFILE_KEY);
    } catch {}
    return null;
  }
  const { data, error } = await supa.from("me").select("*").maybeSingle();
  if (error) {
    console.warn("profile", error);
    return profile;
  }
  profile = data || null;
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {}
  return profile;
}

export async function initAuth() {
  const { data } = await supa.auth.getSession();
  session = data.session;
  // Профиль с прошлого раза — страница открывается сразу; свежий подтягиваем фоном.
  // Доступ к данным всё равно проверяет база (RLS), кэш влияет только на вид страницы.
  const cached = session ? cachedProfile(session.user.id) : null;
  if (cached) {
    profile = cached;
    const before = JSON.stringify(cached);
    loadProfile().then((p) => {
      if (JSON.stringify(p) !== before) listeners.forEach((fn) => fn(p));
    });
  } else {
    await loadProfile();
  }
  // Внутри обработчика нельзя ждать других запросов к Supabase: они делят блокировку сессии
  // (иначе «Lock … was released because another request stole it»). Поэтому работа — после него.
  supa.auth.onAuthStateChange((event, next) => {
    const changed = (next?.user?.id || null) !== (session?.user?.id || null);
    session = next;
    if (event === "PASSWORD_RECOVERY" && !location.hash.startsWith("#/me/password")) {
      location.hash = "#/me/password";
    }
    if (changed || event === "USER_UPDATED") {
      setTimeout(async () => {
        bankCache.clear();
        await loadProfile();
        listeners.forEach((fn) => fn(profile));
      }, 0);
    }
  });
  return profile;
}

export const onAuthChange = (fn) => listeners.add(fn);

// Ученик ждёт подтверждения — как только вернётся на вкладку, проверим статус ещё раз.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !session || !profile) return;
  if (profile.role === "teacher") return;
  const before = `${profile.status}|${profile.access_until}`;
  await loadProfile();
  if (`${profile?.status}|${profile?.access_until}` !== before) {
    bankCache.clear();
    listeners.forEach((fn) => fn(profile));
  }
});
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
  for (let i = 0; i < 3; i += 1) {
    let error = null;
    try {
      ({ error } = await supa.auth.updateUser({ password }));
    } catch (err) {
      error = err;
    }
    if (!error) return;
    if (!/lock/i.test(error.message || "") || i === 2) throw humanError(error);
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
}

export async function signOut() {
  await supa.auth.signOut();
}

export function humanError(err) {
  const msg = String(err?.message || err || "");
  const map = [
    [/invalid login credentials/i, "Неверный логин или пароль."],
    [/email not confirmed/i, "E-mail ещё не подтверждён — откройте письмо со ссылкой."],
    [/user already registered/i, "Такой e-mail уже зарегистрирован. Войдите или восстановите пароль."],
    [/password should be at least/i, "Пароль слишком короткий — нужно не меньше 8 символов."],
    [/rate limit|too many/i, "Слишком много попыток. Подождите минуту и попробуйте снова."],
    [/no access/i, "Это задание доступно ученикам студии."],
    [/teacher only/i, "Действие доступно только преподавателю."],
    [/attempts exhausted/i, "Попытки на это задание закончились."],
    [/deadline passed/i, "Срок сдачи прошёл."],
    [/failed to fetch|network/i, "Нет связи с сервером. Проверьте интернет."],
    [/lock .*stole|lock .*released/i, "Сайт был занят другим запросом. Нажмите «Сохранить» ещё раз."],
    [/auth session missing|session.*expired|jwt expired/i, "Ссылка из письма устарела. Запросите новую: «Войти» → «Забыли пароль?»."],
    [/should be different from the old password/i, "Новый пароль совпадает со старым — придумайте другой."],
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

export async function myWorkFor(taskId, itemId = null) {
  if (!session) return null;
  let q = supa.from("written_works").select("*").eq("task_id", taskId);
  q = itemId ? q.eq("item_id", itemId) : q.is("item_id", null);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw humanError(error);
  return data;
}

/**
 * Фото страницы работы: до 1600 px по длинной стороне, JPEG ≈ 85%.
 * Снимок телефона 3–5 МБ превращается в 200–400 КБ, текст читается так же.
 * Если браузер не может открыть файл (например, HEIC не в Safari) — грузим как есть.
 */
export async function shrinkImage(file, max = 1600) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || "") || file.size < 350 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k);
    const h = Math.round(bmp.height * k);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export async function uploadWorkFile(original) {
  const uid = session?.user?.id;
  if (!uid) throw new Error("Нужно войти.");
  const file = await shrinkImage(original);
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
export async function saveWork({ id = null, taskId, itemId = null, body, files = [], status, choice = undefined }) {
  const uid = session?.user?.id;
  if (!uid) throw new Error("Нужно войти.");
  const row = { body, files, status };
  if (choice !== undefined) row.choice = choice;
  const q = id
    ? supa.from("written_works").update(row).eq("id", id)
    : supa.from("written_works").insert({ ...row, task_id: taskId, item_id: itemId, student_id: uid });
  const { data, error } = await q.select().single();
  if (error) throw humanError(error);
  return data;
}
