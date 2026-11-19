/** Вход, регистрация и личный кабинет ученика (#/login, #/me). */
import { escapeHtml, themeSwitchHtml } from "./ui.js";
import { isPseudoEmail, loginOf, loginToEmail } from "./pseudo.js?v=land147";
import { mountTg, tgSlotHtml } from "./telegram.js?v=land147";
import { studentScheduleMount } from "./calendar.js?v=land147";
import { GRADES, SUBJECTS, TRACK_TITLE, courseLabel, currentTrack, setTrack, subjectsOf, tracksOf } from "./track.js?v=land147";
import {
  badges, badgesHtml, bindSelfExam, examCodeOf, heroHtml, howPointsHtml, loadDashboard, mountDaily, recommendations, recsHtml, selfExamHtml,
} from "./dashboard.js?v=land147";
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
const SOURCE_TITLE = { "ege-rus": "ЕГЭ · русский", "oge-rus": "ОГЭ · русский", "vpr-rus": "ВПР · русский", "ege-lit": "ЕГЭ · литература" };
const STATUS_TEXT = {
  pending: "ждёт подтверждения",
  active: "ученик студии",
  paused: "доступ приостановлен",
  archived: "в архиве",
};
const DAILY_GOAL_HOME = 10;
const WORK_STATUS = { draft: "черновик", submitted: "на проверке", returned: "вернули на доработку", graded: "проверена" };

/** Свежепроверенные работы: «Работа проверена: 18 из 22 — посмотреть пометки». Скрываются, когда ученик открыл. */
function checkedWorksHtml(d) {
  if (!d?.works?.length) return "";
  let seen = [];
  try {
    seen = JSON.parse(localStorage.getItem("seen-works") || "[]");
  } catch {}
  const fresh = d.works
    .filter((w) => (w.status === "graded" || w.status === "returned") && w.reviewed_at && Date.now() - new Date(w.reviewed_at) < 21 * 86400000 && !seen.includes(w.id))
    .slice(0, 3);
  if (!fresh.length) return "";
  return `<section class="me-section">${fresh
    .map(
      (w) => `<a class="me-checked card" href="${taskHref(w.tasks)}" data-seen-work="${w.id}">
        <span class="me-rec-icon" aria-hidden="true">${w.status === "graded" ? "✅" : "✏️"}</span>
        <span><strong>${w.status === "graded" ? `Работа проверена${w.score != null ? `: ${w.score}${w.max_score ? ` из ${w.max_score}` : ""}` : ""}` : "Работу вернули на доработку"}</strong>
        <span class="muted">${escapeHtml(SOURCE_TITLE[w.tasks?.source] || "")} · задание ${w.tasks?.task_no ?? ""} — посмотри пометки и комментарий преподавателя</span></span>
        <span class="me-rec-go" aria-hidden="true">›</span>
      </a>`
    )
    .join("")}</section>`;
}

/** Письменные работы — отдельный трек по желанию: проверяет преподаватель, награда — после проверки. */
const ESSAY_LINK = {
  "ege-rus": ["#/ege/27", "Сочинение ЕГЭ (задание 27)"],
  "oge-rus": ["#/oge/13", "Сочинение ОГЭ (задание 13)"],
  "vpr-rus": ["#/vpr/11", "Развёрнутый ответ ВПР (задание 11)"],
  "ege-lit": ["#/literature/11", "Сочинение ЕГЭ по литературе (задание 11)"],
};
function writtenTrackHtml(d, code) {
  const [href, title] = ESSAY_LINK[code] || ESSAY_LINK["ege-rus"];
  const works = d.works || [];
  const waiting = works.filter((w) => w.status === "submitted").length;
  const returned = works.filter((w) => w.status === "returned").length;
  const graded = works.filter((w) => w.status === "graded").length;
  const earned = d.events.filter((e) => e.kind === "work" || e.kind === "graded").reduce((a, e) => a + e.points, 0);
  const status = [
    waiting ? `на проверке: ${waiting}` : "",
    returned ? `вернули на доработку: ${returned}` : "",
    graded ? `проверено: ${graded}` : "",
  ].filter(Boolean);
  return `
    <section class="me-section">
      <h2>Письменная работа <span class="muted">· по желанию</span></h2>
      <a class="me-write card" href="${returned ? "#/me/profile#works" : href}">
        <span class="me-rec-icon" aria-hidden="true">✍️</span>
        <span>
          <strong>${returned ? "Доработай вернувшуюся работу" : escapeHtml(title)}</strong>
          <span class="muted">${status.length ? escapeHtml(status.join(" · ")) : "Напиши — преподаватель проверит по критериям ФИПИ."} До +55 очков: 15 за сдачу и до 40 после проверки${earned ? ` · уже ${earned}` : ""}.</span>
        </span>
        <span class="me-rec-go" aria-hidden="true">›</span>
      </a>
    </section>`;
}

/** Ссылка на задание по его месту в банке. */
export function taskHref(t) {
  if (!t) return "#/";
  if (t.source === "ege-rus") return `#/ege/${t.task_no}/${encodeURIComponent(t.source_ref)}`;
  if (t.source === "oge-rus") return `#/oge/${t.task_no}/${encodeURIComponent(t.source_ref)}`;
  if (t.source === "vpr-rus") return `#/vpr/${t.task_no}/${encodeURIComponent(t.source_ref)}`;
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
  return `
    <div class="auth-page">
      <p class="eyebrow">Студия Лексикон</p>
      <h1>Вход для учеников</h1>
      <div class="card auth-card">
        <form id="auth-form" class="stack" data-mode="login">
          <label>Логин<input name="login" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="например, ryzhiy-lis-47" /></label>
          <label>Пароль<input type="password" name="password" required autocomplete="current-password" /></label>
          <button class="btn" type="submit">Войти</button>
        </form>
        <p class="lit-result" id="auth-status" aria-live="polite"></p>
      </div>
      <div class="auth-help">
        <p><strong>Где взять логин?</strong> Логин и пароль выдаёт преподаватель, когда вы начинаете заниматься в студии. Регистрироваться самим не нужно.</p>
        <p><strong>Забыли пароль?</strong> Напишите преподавателю — он задаст новый.</p>
        <p class="muted">Ещё не занимаетесь? <a href="#apply">Оставьте заявку</a> — договоримся о занятиях.</p>
      </div>
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
      const email = loginToEmail(f.get("login") || f.get("email"));
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
        say("Если такой e-mail зарегистрирован, на него пришло письмо со ссылкой для нового пароля. Проверьте и папку «Спам». Ссылка действует около часа.", "is-ok");
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
  if (state === "teacher" && !location.hash.startsWith("#/me/")) {
    location.hash = "#/cabinet";
    return;
  }
  if (location.hash.startsWith("#/me/daily")) {
    if (state !== "student") {
      location.hash = "#/me";
      return;
    }
    await mountDaily(root, await loadDashboard(), p);
    return;
  }
  const isProfile = location.hash.startsWith("#/me/profile");
  // Все запросы кабинета — одной волной.
  const [dash, lessonsHtml, stats, mistakes, works, myGroups] = await Promise.all([
    state === "student" ? loadDashboard().catch(() => null) : null,
    import("./lessons.js?v=land147").then((m) => m.myLessonsHtml({ today: !isProfile })).catch(() => ""),
    isProfile ? supa.from("task_stats").select("*").eq("student_id", user.id) : { data: [] },
    isProfile ? supa.from("my_mistakes").select("*").order("last_try", { ascending: false }) : { data: [] },
    isProfile
      ? supa
          .from("written_works")
          .select("id, status, score, max_score, body, created_at, tasks(source, bank_file, source_ref, task_no)")
          .eq("student_id", user.id)
          .order("created_at", { ascending: false })
          .limit(50)
      : { data: [] },
    supa.from("group_members").select("groups(title)").eq("student_id", user.id),
  ]);
  const { data: courseReq } = isProfile ? await supa.from("course_requests").select("course, status, created_at").order("created_at", { ascending: false }) : { data: [] };
  const groupNames = (myGroups.data || []).map((g) => g.groups?.title).filter(Boolean);
  const err = stats.error || mistakes.error || works.error;
  if (err) console.warn(err);

  const pendingNote =
    state === "pending"
      ? `<div class="gate card"><p><strong>Регистрация прошла.</strong> Преподаватель подтвердит доступ — после этого откроется весь банк заданий. Пока можно решать демо-задания.</p></div>`
      : state === "paused" || state === "expired"
        ? `<div class="gate card"><p><strong>Доступ к банку приостановлен.</strong> Напишите преподавателю, чтобы продлить.</p></div>`
        : "";
  const code = examCodeOf(p);
  // псевдоним целиком («Снежная Выдра 92»); у старых учеников с именем — только имя
  const firstName = isPseudoEmail(p?.email) ? String(p?.full_name || "").trim() : String(p?.full_name || "").trim().split(/\s+/)[0] || "";
  // Код группы нужен редко: преподаватель обычно добавляет в группу сам. Поэтому поле спрятано.
  const joinHtml = `
    <section class="me-section">
      <details class="me-join card">
        <summary>Преподаватель дал код группы?</summary>
        <form id="me-join" class="t-filter">
          <p class="muted">Введите код — и вы окажетесь в группе: будете видеть её занятия и контрольные. Если кода нет, ничего делать не нужно.</p>
          <label>Код группы<input name="code" maxlength="12" autocomplete="off" placeholder="например, a1b2c3" /></label>
          <button class="btn secondary" type="submit">Вступить в группу</button>
          <p class="lit-result" id="me-join-status"></p>
        </form>
      </details>
    </section>`;

  if (!isProfile) {
    const recs = dash ? recommendations(dash, code).filter((r) => !/^Цель дня/.test(r.title)).slice(0, 2) : [];
    const lv = dash?.level;
    const pct = lv ? (lv.to ? Math.round(((dash.total - lv.from) / (lv.to - lv.from)) * 100) : 100) : 0;
    const goal = dash ? Math.min(100, Math.round((dash.todayCorrect / DAILY_GOAL_HOME) * 100)) : 0;
    const today = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    host.innerHTML = `
      <header class="me-hello">
        <div>
          <p class="eyebrow">${escapeHtml(today)}</p>
          <h1>${firstName ? `Привет, ${escapeHtml(firstName)}` : "Привет!"}</h1>
        </div>
        <span class="me-hello-side">
          <a class="me-profile-link btn secondary" href="#/me/profile">Прогресс и профиль</a>
          ${dash ? `<a class="me-streak" href="#/me/profile" aria-label="Серия дней: ${dash.streak}">🔥 ${dash.streak}</a>` : ""}
        </span>
      </header>
      ${pendingNote}
      ${
        tracksOf(p).length > 1
          ? `<nav class="me-tracks" aria-label="Курс">${tracksOf(p)
              .map((t) => `<button type="button" class="pill ${t === code ? "active" : ""}" data-track="${t}">${escapeHtml(TRACK_TITLE[t] || t)}</button>`)
              .join("")}</nav>`
          : ""
      }
      ${
        dash
          ? `<a class="me-level card" href="#/me/profile">
              <span class="me-level-n">${lv.n}</span>
              <span class="me-level-body">
                <span class="me-level-top"><strong>${escapeHtml(lv.name)}</strong><span class="muted">${dash.total} очков${dash.todayXp ? ` · +${dash.todayXp} сегодня` : ""}</span></span>
                <span class="today-bar"><span style="width:${pct}%"></span></span>
              </span>
            </a>`
          : ""
      }
      ${checkedWorksHtml(dash)}
      ${state === "student" ? '<section class="me-section me-schedule" id="me-schedule" hidden></section>' : ""}
      <section class="me-section me-today">
        <h2>Сегодня</h2>
        ${lessonsHtml || `<p class="muted me-empty">Новых заданий от преподавателя нет. Самое время для тренировки дня.</p>`}
        ${
          dash
            ? `<a class="today-cta" href="#/me/daily">
                <span><strong>Тренировка дня</strong><span>${dash.todayCorrect >= DAILY_GOAL_HOME ? "Цель выполнена — можно ещё" : "10 заданий: ошибки, слабые места и новое"}</span></span>
                <span class="today-cta-n">${dash.todayCorrect}/${DAILY_GOAL_HOME}<span class="today-ring" style="--p:${goal}"></span></span>
              </a>`
            : ""
        }
      </section>
      ${
        recs.length
          ? `<section class="me-section"><h2>Что дальше</h2><div class="me-recs">${recs
              .map(
                (r) => `<a class="me-rec" href="${r.href}"${r.scroll ? ` data-goto="${r.scroll}"` : ""}>
                  <span class="me-rec-icon" aria-hidden="true">${r.icon}</span>
                  <span><strong>${escapeHtml(r.title)}</strong><span class="muted">${escapeHtml(r.text)}</span></span>
                  <span class="me-rec-go" aria-hidden="true">›</span>
                </a>`
              )
              .join("")}</div></section>`
          : ""
      }
      ${state === "student" && dash ? writtenTrackHtml(dash, code) : ""}
      ${
        state === "student"
          ? `<section class="me-section"><div class="me-quick">
              <a href="#/me/profile#mistakes"><span aria-hidden="true">↺</span>Тетрадь ошибок${dash?.mistakes?.length ? ` <b>${dash.mistakes.length}</b>` : ""}</a>
              <a href="#/me/profile#self-exam"><span aria-hidden="true">⏱</span>Пробный экзамен</a>
              ${subjectsOf(p).lit ? `<a href="#/library/poems"><span aria-hidden="true">🎭</span>Стихи наизусть</a>
              <a href="#/library/read"><span aria-hidden="true">📖</span>Читать и отвечать</a>` : ""}
            </div></section>`
          : ""
      }
`;
  } else {
    host.innerHTML = `
      <header class="me-hello">
        <div>
          <p class="eyebrow">Мой профиль</p>
          <h1>${escapeHtml(p?.full_name || user.email)}</h1>
          <p class="muted">${escapeHtml(STATUS_TEXT[p?.status] || "")}${p?.grade ? ` · ${p.grade} класс` : ""}${p?.exam_target ? ` · ${escapeHtml(p.exam_target)}` : ""}${
            p?.access_until ? ` · доступ до ${new Date(p.access_until).toLocaleDateString("ru-RU")}` : ""
          }${groupNames.length ? ` · группа: ${escapeHtml(groupNames.join(", "))}` : ""}</p>
        </div>
      </header>
      ${pendingNote}
      ${dash ? heroHtml(dash, p) : ""}
      ${dash ? badgesHtml(badges(dash, code)) : ""}
      ${dash && subjectsOf(p).rus ? `<section class="me-section"><h2>Правила</h2><a class="me-write card" href="#/rules"><span class="me-rec-icon" aria-hidden="true">📘</span><span><strong>Закреплено глав: ${dash.events.filter((e) => e.kind === "rule").length}</strong><span class="muted">Открой правило и пройди «Проверь себя» внизу страницы: 4 из 5 — глава закреплена, +15 очков.</span></span><span class="me-rec-go" aria-hidden="true">›</span></a></section>` : ""}
      ${dash ? selfExamHtml(code) : ""}
      ${lessonsHtml}
      <section class="me-section"><h2>Прогресс по номерам</h2>${statsHtml(stats.data || [])}</section>
      <section class="me-section" id="mistakes"><h2>Тетрадь ошибок</h2>${mistakesHtml(mistakes.data || [])}</section>
      <section class="me-section" id="works"><h2>Письменные работы</h2>${worksHtml(works.data || [])}</section>
      <section class="me-section" id="courses">
        <h2>Мои курсы</h2>
        <div class="me-courses">${(p?.courses || []).map((c) => `<span class="chip">${escapeHtml(courseLabel(c))}</span>`).join("") || '<span class="muted">Пока не указаны — попросите преподавателя.</span>'}</div>
        ${(courseReq || [])
          .filter((r) => r.status !== "approved")
          .map((r) => `<p class="muted me-req">${escapeHtml(courseLabel(r.course))} — ${r.status === "pending" ? "запрос отправлен, ждёт преподавателя" : "преподаватель пока отказал"}</p>`)
          .join("")}
        <form id="me-course" class="t-filter card">
          <label>Предмет<select name="subject">${Object.entries(SUBJECTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
          <label>Класс<select name="grade">${GRADES.map((g) => `<option value="${g}" ${g === Number(p?.grade) ? "selected" : ""}>${g} класс${g === 9 ? " (ОГЭ)" : g >= 10 ? " (ЕГЭ)" : ""}</option>`).join("")}</select></label>
          <button class="btn secondary" type="submit">Попросить доступ к курсу</button>
          <p class="lit-result" id="me-course-status"></p>
        </form>
      </section>
      ${joinHtml}
      ${tgSlotHtml()}
      <section class="me-section">
        <h2>Оформление</h2>
        <p class="muted">«Авто» — как в настройках телефона: днём светлая, ночью тёмная.</p>
        ${themeSwitchHtml()}
      </section>
      ${dash ? howPointsHtml() : ""}
      <section class="me-section">
        <h2>Профиль</h2>
        <form id="me-form" class="stack card" style="padding:20px;max-width:560px">
          <p>Псевдоним: <strong>${escapeHtml(p?.full_name || "")}</strong>${isPseudoEmail(p?.email) ? ` · логин: <strong>${escapeHtml(loginOf(p.email))}</strong>` : ""}</p>
          <p class="muted">Псевдоним задаёт преподаватель — так на сайте нет настоящих имён.</p>
          <label>Новый пароль (если хотите сменить)<input type="password" name="password" minlength="8" autocomplete="new-password" /></label>
          <div class="actions"><button class="btn" type="submit">Сменить пароль</button><button class="btn secondary" type="button" id="me-logout">Выйти</button></div>
          <p class="lit-result" id="me-status" aria-live="polite"></p>
        </form>
      </section>`;
    const anchor = location.hash.split("#")[2];
    if (anchor) requestAnimationFrame(() => host.querySelector(`#${CSS.escape(anchor)}`)?.scrollIntoView({ block: "start" }));
  }
  host.querySelector("#me-join")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = host.querySelector("#me-join-status");
    const code = String(new FormData(e.target).get("code") || "").trim();
    if (!code) return;
    const { error } = await supa.rpc("join_group", { p_code: code });
    st.className = `lit-result ${error ? "is-bad" : "is-ok"}`;
    st.textContent = error ? (/invalid code/.test(error.message) ? "Такого кода нет — проверьте у преподавателя." : humanError(error).message) : "Готово, вы в группе.";
  });
  bindSelfExam(host);
  if (state === "student") mountTg(host, "student");
  if (state === "student" && !isProfile) studentScheduleMount(host, groupNames);
  host.querySelectorAll("[data-seen-work]").forEach((a) =>
    a.addEventListener("click", () => {
      try {
        const seen = JSON.parse(localStorage.getItem("seen-works") || "[]");
        localStorage.setItem("seen-works", JSON.stringify([...seen, a.dataset.seenWork].slice(-200)));
      } catch {}
    })
  );
  host.querySelectorAll("[data-track]").forEach((b) =>
    b.addEventListener("click", () => {
      setTrack(b.dataset.track);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    })
  );
  host.querySelector("#me-course")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const course = `${f.get("subject")}:${f.get("grade")}`;
    const st = host.querySelector("#me-course-status");
    const { data, error } = await supa.rpc("request_course", { p_course: course });
    st.className = `lit-result ${error ? "is-bad" : "is-ok"}`;
    st.textContent = error
      ? humanError(error).message
      : data === "already"
        ? `«${courseLabel(course)}» у вас уже есть.`
        : `Запрос на «${courseLabel(course)}» отправлен. Преподаватель увидит его в кабинете.`;
  });
  host.querySelectorAll("[data-goto]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = `#/me/profile#${a.dataset.goto}`;
    })
  );
  host.querySelectorAll("[data-scroll]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      host.querySelector(`#${a.dataset.scroll}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    })
  );
  host.querySelector("#me-logout")?.addEventListener("click", async () => {
    await signOut();
    location.hash = "#/";
  });
  host.querySelector("#me-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const status = host.querySelector("#me-status");
    try {
      const pw = String(f.get("password") || "");
      if (!pw) throw new Error("Введите новый пароль.");
      await updatePassword(pw);
      e.target.reset();
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
        <p class="muted" id="pw-who"></p>
        <label>Новый пароль (не меньше 8 символов)<input type="password" name="password" minlength="8" required autocomplete="new-password" /></label>
        <label>Повторите пароль<input type="password" name="password2" minlength="8" required autocomplete="new-password" /></label>
        <button class="btn" type="submit">Сохранить</button>
        <p class="lit-result" id="pw-status"></p>
      </form>
    </div>`;
}

/**
 * Ссылка из письма: #/me/password?token_hash=…&type=recovery.
 * Код проверяется на сервере (verifyOtp) — работает на любом устройстве, не только там, где просили письмо.
 */
export async function bindPassword(root) {
  const form = root.querySelector("#pw-form");
  const status = root.querySelector("#pw-status");
  const who = root.querySelector("#pw-who");
  const say = (t, cls = "") => {
    status.className = `lit-result ${cls}`;
    status.textContent = t;
  };
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  const tokenHash = q.get("token_hash");
  if (tokenHash) {
    form.querySelector("button").disabled = true;
    say("Проверяем ссылку…");
    const { error } = await supa.auth.verifyOtp({ token_hash: tokenHash, type: q.get("type") || "recovery" });
    // убираем одноразовый код из адресной строки
    history.replaceState(null, "", `${location.pathname}${location.search}#/me/password`);
    form.querySelector("button").disabled = false;
    if (error) {
      say("Ссылка устарела или уже использована. Запросите новую: «Войти» → «Забыли пароль?».", "is-bad");
      return;
    }
    say("");
  }
  const user = currentUser() || (await supa.auth.getUser()).data.user;
  if (!user) {
    say("Откройте страницу по ссылке из письма или войдите. Новую ссылку можно запросить: «Войти» → «Забыли пароль?».", "is-bad");
    form.querySelector("button").disabled = true;
    return;
  }
  who.textContent = `Учётная запись: ${user.email}`;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    if (f.get("password") !== f.get("password2")) {
      say("Пароли не совпадают.", "is-bad");
      return;
    }
    form.querySelector("button").disabled = true;
    try {
      await updatePassword(String(f.get("password")));
      say("Пароль обновлён. Открываем кабинет…", "is-ok");
      await refreshProfile();
      setTimeout(() => (location.hash = currentProfile()?.role === "teacher" ? "#/cabinet" : "#/me"), 900);
    } catch (err) {
      say(err.message, "is-bad");
      form.querySelector("button").disabled = false;
    }
  });
}
