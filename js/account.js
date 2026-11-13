/** Вход, регистрация и личный кабинет ученика (#/login, #/me). */
import { escapeHtml } from "./ui.js";
import {
  accessState,
  currentProfile,
  currentUser,
  refreshProfile,
  resetPassword,
  signIn,
  signOut,
  signUp,
  supa,
  updatePassword,
  humanError,
} from "./supa.js";

const EXAMS = ["ЕГЭ по русскому", "ОГЭ по русскому", "ЕГЭ по литературе", "ВПР", "Олимпиада", "Другое"];
const SOURCE_TITLE = { "ege-rus": "ЕГЭ · русский", "oge-rus": "ОГЭ · русский", "ege-lit": "ЕГЭ · литература" };
const STATUS_TEXT = {
  pending: "ждёт подтверждения",
  active: "ученик студии",
  paused: "доступ приостановлен",
  archived: "в архиве",
};
const WORK_STATUS = { draft: "черновик", submitted: "на проверке", returned: "вернули на доработку", graded: "проверена" };

/** Ссылка на задание по его месту в банке. */
export function taskHref(t) {
  if (!t) return "#/";
  if (t.source === "ege-rus") return `#/ege/${t.task_no}/${encodeURIComponent(t.source_ref)}`;
  if (t.source === "oge-rus") return `#/oge/${t.task_no}/${encodeURIComponent(t.source_ref)}`;
  if (t.source === "ege-lit") {
    if (String(t.bank_file).startsWith("extra-")) return `#/literature/archive/${t.bank_file}/${encodeURIComponent(t.source_ref)}`;
    return `#/literature/${t.task_no}/${encodeURIComponent(t.source_ref)}`;
  }
  return "#/";
}

function nextHref() {
  const q = new URLSearchParams((location.hash.split("?")[1] || ""));
  const next = q.get("next") || "#/me";
  return next.startsWith("#/") && !next.startsWith("#/login") ? next : "#/me";
}

/* ------------------------------------------------------------------ */
/* #/login                                                              */
/* ------------------------------------------------------------------ */

export function loginPage() {
  const q = new URLSearchParams((location.hash.split("?")[1] || ""));
  const mode = q.get("mode") === "signup" ? "signup" : q.get("mode") === "reset" ? "reset" : "login";
  const tab = (id, title) =>
    `<a class="pill ${mode === id ? "active" : ""}" href="#/login?mode=${id}&next=${encodeURIComponent(nextHref())}">${title}</a>`;
  const forms = {
    login: `
      <form id="auth-form" class="stack" data-mode="login">
        <label>E-mail<input type="email" name="email" required autocomplete="email" /></label>
        <label>Пароль<input type="password" name="password" required autocomplete="current-password" /></label>
        <button class="btn" type="submit">Войти</button>
        <p class="muted"><a href="#/login?mode=reset">Забыли пароль?</a></p>
      </form>`,
    signup: `
      <form id="auth-form" class="stack" data-mode="signup">
        <label>Имя и фамилия<input name="full_name" required maxlength="120" autocomplete="name" /></label>
        <label>E-mail<input type="email" name="email" required autocomplete="email" /></label>
        <label>Пароль (не меньше 8 символов)<input type="password" name="password" required minlength="8" autocomplete="new-password" /></label>
        <div class="grid-2">
          <label>Класс
            <select name="grade">
              <option value="">не указан</option>
              ${[5, 6, 7, 8, 9, 10, 11].map((g) => `<option value="${g}">${g}</option>`).join("")}
            </select>
          </label>
          <label>Формат
            <select name="study_format">
              <option value="offline">Очно, в студии</option>
              <option value="online">Онлайн</option>
              <option value="mixed">Очно и онлайн</option>
            </select>
          </label>
        </div>
        <label>Цель
          <select name="exam_target">${EXAMS.map((e) => `<option>${e}</option>`).join("")}</select>
        </label>
        <label>Telegram или телефон для связи (по желанию)<input name="contact" maxlength="120" /></label>
        <label>Комментарий для преподавателя (по желанию)<textarea name="note" maxlength="1000" placeholder="Например: занимаюсь в группе по вторникам"></textarea></label>
        <label class="check"><input type="checkbox" name="consent" required />
          <span>Согласен(на) на обработку персональных данных для занятий в студии. Если мне нет 18 лет — регистрирую с согласия родителя.</span>
        </label>
        <button class="btn" type="submit">Зарегистрироваться</button>
        <p class="muted">После регистрации преподаватель подтвердит доступ — тогда откроется весь банк заданий.</p>
      </form>`,
    reset: `
      <form id="auth-form" class="stack" data-mode="reset">
        <label>E-mail<input type="email" name="email" required autocomplete="email" /></label>
        <button class="btn" type="submit">Прислать ссылку для нового пароля</button>
      </form>`,
  };
  return `
    <div class="auth-page">
      <p class="eyebrow">Студия Лексикон</p>
      <h1>${mode === "signup" ? "Регистрация ученика" : mode === "reset" ? "Восстановление пароля" : "Вход для учеников"}</h1>
      <div class="filter-bar">${tab("login", "Вход")}${tab("signup", "Регистрация")}</div>
      <div class="card auth-card">${forms[mode]}<p class="lit-result" id="auth-status" aria-live="polite"></p></div>
    </div>`;
}

export function bindLogin(root) {
  const form = root.querySelector("#auth-form");
  const status = root.querySelector("#auth-status");
  if (!form) return;
  const say = (t, cls = "") => {
    status.className = `lit-result ${cls}`;
    status.textContent = t;
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const mode = form.dataset.mode;
      const email = String(f.get("email") || "").trim();
      if (mode === "login") {
        say("Входим…");
        await signIn(email, String(f.get("password")));
        location.hash = nextHref();
      } else if (mode === "signup") {
        say("Регистрируем…");
        const res = await signUp({
          email,
          password: String(f.get("password")),
          meta: {
            full_name: String(f.get("full_name") || "").trim(),
            grade: String(f.get("grade") || ""),
            exam_target: String(f.get("exam_target") || ""),
            study_format: String(f.get("study_format") || ""),
            contact: String(f.get("contact") || "").trim(),
            note: String(f.get("note") || "").trim(),
          },
        });
        if (res.session) location.hash = "#/me";
        else say("Почти готово: откройте письмо, которое пришло на почту, и подтвердите адрес.", "is-ok");
      } else {
        await resetPassword(email);
        say("Если такой e-mail зарегистрирован, на него пришла ссылка для смены пароля.", "is-ok");
      }
    } catch (err) {
      say(err.message, "is-bad");
    } finally {
      btn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* #/me                                                                 */
/* ------------------------------------------------------------------ */

export function mePage() {
  return `<div id="me-root"><p class="lede muted">Загружаем кабинет…</p></div>`;
}

function statsHtml(rows) {
  if (!rows.length) return `<p class="muted">Пока нет решённых заданий. Начните с любого номера — статистика появится здесь.</p>`;
  const bySource = {};
  rows.forEach((r) => (bySource[r.source] = bySource[r.source] || []).push(r));
  return Object.entries(bySource)
    .map(([source, list]) => {
      const cells = list
        .sort((a, b) => a.task_no - b.task_no)
        .map((r) => {
          const pct = Number(r.pct_correct || 0);
          const tone = pct >= 80 ? "good" : pct >= 50 ? "mid" : "low";
          return `<div class="stat-cell stat-${tone}" title="Попыток: ${r.tries}">
            <span class="stat-n">№ ${r.task_no}</span>
            <strong>${pct}%</strong>
            <small>${r.tasks_solved} из ${r.tasks_seen}</small>
          </div>`;
        })
        .join("");
      return `<h3>${escapeHtml(SOURCE_TITLE[source] || source)}</h3><div class="stat-grid">${cells}</div>`;
    })
    .join("");
}

function mistakesHtml(rows) {
  if (!rows.length) return `<p class="muted">Ошибок нет — или вы ещё не начали. Неверно решённые задания и задания, где вы открыли разбор, попадают сюда.</p>`;
  return `<div class="lit-list">${rows
    .slice(0, 60)
    .map(
      (m) => `
      <a class="lit-item" href="${taskHref(m)}">
        <span class="lit-item-n">${m.task_no ?? "·"}</span>
        <span class="lit-item-body">
          <strong>${escapeHtml(SOURCE_TITLE[m.source] || "")} · № ${escapeHtml(String(m.source_ref))}</strong>
          <span>${m.last_answer ? `ваш ответ: ${escapeHtml(m.last_answer)}` : ""}${m.viewed_solution ? " · смотрели разбор" : ""}</span>
        </span>
      </a>`
    )
    .join("")}</div>${rows.length > 60 ? `<p class="muted">Показаны 60 из ${rows.length}.</p>` : ""}`;
}

function worksHtml(rows) {
  if (!rows.length) return `<p class="muted">Письменных работ пока нет. Сочинения и развёрнутые ответы сдаются со страницы задания.</p>`;
  return `<div class="lit-list">${rows
    .map(
      (w) => `
      <a class="lit-item" href="${taskHref(w.tasks)}">
        <span class="lit-item-n">${w.tasks?.task_no ?? "·"}</span>
        <span class="lit-item-body">
          <strong>${escapeHtml(SOURCE_TITLE[w.tasks?.source] || "Работа")} · ${escapeHtml(WORK_STATUS[w.status] || w.status)}${
            w.score != null ? ` · ${escapeHtml(String(w.score))}${w.max_score ? `/${escapeHtml(String(w.max_score))}` : ""}` : ""
          }</strong>
          <span>${escapeHtml((w.body || "").slice(0, 140) || "фото работы")}</span>
        </span>
      </a>`
    )
    .join("")}</div>`;
}

export async function mountMe(root) {
  const host = root.querySelector("#me-root");
  if (!host) return;
  const user = currentUser();
  if (!user) {
    location.hash = "#/login?next=%23%2Fme";
    return;
  }
  const p = currentProfile() || (await refreshProfile());
  const state = accessState();
  const [stats, mistakes, works] = await Promise.all([
    supa.from("task_stats").select("*").eq("student_id", user.id),
    supa.from("my_mistakes").select("*").order("last_try", { ascending: false }),
    supa
      .from("written_works")
      .select("id, status, score, max_score, body, created_at, tasks(source, bank_file, source_ref, task_no)")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const err = stats.error || mistakes.error || works.error;
  if (err) console.warn(err);

  const pendingNote =
    state === "pending"
      ? `<div class="gate card"><p><strong>Регистрация прошла.</strong> Преподаватель подтвердит доступ — после этого откроется весь банк заданий. Пока можно решать демо-задания.</p></div>`
      : state === "paused" || state === "expired"
        ? `<div class="gate card"><p><strong>Доступ к банку приостановлен.</strong> Напишите преподавателю, чтобы продлить.</p></div>`
        : "";

  host.innerHTML = `
    <p class="eyebrow">Личный кабинет</p>
    <h1>${escapeHtml(p?.full_name || user.email)}</h1>
    <p class="lede">${p?.role === "teacher" ? "преподаватель" : escapeHtml(STATUS_TEXT[p?.status] || "")}${p?.grade && p?.role !== "teacher" ? ` · ${p.grade} класс` : ""}${p?.exam_target ? ` · ${escapeHtml(p.exam_target)}` : ""}${
      p?.access_until ? ` · доступ до ${new Date(p.access_until).toLocaleDateString("ru-RU")}` : ""
    }</p>
    ${p?.role === "teacher" ? `<p class="actions"><a class="btn" href="#/cabinet">Кабинет преподавателя</a></p>` : ""}
    ${pendingNote}
    ${p?.role !== "teacher" ? `
    <section class="me-section">
      <form id="me-join" class="t-filter card">
        <label>Код группы от преподавателя<input name="code" maxlength="12" autocomplete="off" placeholder="например, a1b2c3" /></label>
        <button class="btn secondary" type="submit">Вступить в группу</button>
        <p class="lit-result" id="me-join-status"></p>
      </form>
    </section>` : ""}
    ${await (await import("./lessons.js?v=land72")).myLessonsHtml().catch(() => "")}
    <section class="me-section"><h2>Прогресс по номерам</h2>${statsHtml(stats.data || [])}</section>
    <section class="me-section"><h2>Тетрадь ошибок</h2>${mistakesHtml(mistakes.data || [])}</section>
    <section class="me-section"><h2>Письменные работы</h2>${worksHtml(works.data || [])}</section>
    <section class="me-section">
      <h2>Профиль</h2>
      <form id="me-form" class="stack card" style="padding:20px;max-width:560px">
        <label>Имя и фамилия<input name="full_name" value="${escapeHtml(p?.full_name || "")}" maxlength="120" /></label>
        <label>Telegram или телефон<input name="contact" value="${escapeHtml(p?.contact || "")}" maxlength="120" /></label>
        <label>Новый пароль (если хотите сменить)<input type="password" name="password" minlength="8" autocomplete="new-password" /></label>
        <div class="actions"><button class="btn" type="submit">Сохранить</button><button class="btn secondary" type="button" id="me-logout">Выйти</button></div>
        <p class="lit-result" id="me-status" aria-live="polite"></p>
      </form>
    </section>`;

  host.querySelector("#me-join")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = host.querySelector("#me-join-status");
    const code = String(new FormData(e.target).get("code") || "").trim();
    if (!code) return;
    const { error } = await supa.rpc("join_group", { p_code: code });
    st.className = `lit-result ${error ? "is-bad" : "is-ok"}`;
    st.textContent = error ? (/invalid code/.test(error.message) ? "Такого кода нет — проверьте у преподавателя." : humanError(error).message) : "Готово, вы в группе.";
  });
  host.querySelector("#me-logout")?.addEventListener("click", async () => {
    await signOut();
    location.hash = "#/";
  });
  host.querySelector("#me-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const status = host.querySelector("#me-status");
    try {
      const { error } = await supa
        .from("profiles")
        .update({ full_name: String(f.get("full_name") || "").trim(), contact: String(f.get("contact") || "").trim() })
        .eq("id", user.id);
      if (error) throw humanError(error);
      const pw = String(f.get("password") || "");
      if (pw) await updatePassword(pw);
      await refreshProfile();
      status.className = "lit-result is-ok";
      status.textContent = "Сохранено.";
    } catch (err) {
      status.className = "lit-result is-bad";
      status.textContent = err.message;
    }
  });
}

/** #/me/password — после ссылки из письма о сбросе пароля. */
export function passwordPage() {
  return `
    <div class="auth-page">
      <h1>Новый пароль</h1>
      <form id="pw-form" class="stack card auth-card">
        <label>Новый пароль<input type="password" name="password" minlength="8" required autocomplete="new-password" /></label>
        <button class="btn" type="submit">Сохранить</button>
        <p class="lit-result" id="pw-status"></p>
      </form>
    </div>`;
}

export function bindPassword(root) {
  root.querySelector("#pw-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = root.querySelector("#pw-status");
    try {
      await updatePassword(String(new FormData(e.target).get("password")));
      status.className = "lit-result is-ok";
      status.textContent = "Пароль обновлён.";
      setTimeout(() => (location.hash = "#/me"), 800);
    } catch (err) {
      status.className = "lit-result is-bad";
      status.textContent = err.message;
    }
  });
}
