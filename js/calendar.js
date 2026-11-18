/**
 * Расписание преподавателя из Google Календаря в кабинете.
 *  #/cabinet/week — неделя: занятия из календаря + сроки работ с сайта, сопоставление «серия → группа/ученик»,
 *  перенос сроков (перетаскиванием или кнопкой), «задать к следующему занятию».
 *  На «Сегодня» — расписание дня (scheduleTodayMount).
 * События читает функция Supabase «calendar» по секретной iCal-ссылке; в базе хранятся только ссылка и сопоставление
 * по UID серии (без названий событий — в них могут быть настоящие имена).
 */
import { escapeHtml } from "./ui.js";
import { currentUser, humanError, supa } from "./supa.js";

const DAY = 86400000;
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayTitle = (d) => `${WD[d.getDay()]}, ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
const shortWhen = (iso) => {
  const d = new Date(iso);
  return `${WD[d.getDay()]} ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "numeric" })}, ${hm(d)}`;
};
const toLocalInput = (d) => {
  if (!d) return "";
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const mondayOf = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};

/* ---------------- настройки и события ---------------- */

let cfgCache = null;
export async function calConfig(force = false) {
  if (cfgCache && !force) return cfgCache;
  const { data } = await supa.from("teacher_calendar").select("ics_url, map").maybeSingle();
  cfgCache = { ics_url: data?.ics_url || null, map: data?.map || {} };
  return cfgCache;
}
async function saveConfig(patch) {
  const row = { teacher_id: currentUser().id, ...patch, updated_at: new Date().toISOString() };
  const { error } = await supa.from("teacher_calendar").upsert(row, { onConflict: "teacher_id" });
  if (error) throw humanError(error);
  cfgCache = { ...(cfgCache || { ics_url: null, map: {} }), ...patch };
  evCache.clear();
}

async function callFn(body) {
  const { data, error } = await supa.functions.invoke("calendar", { body });
  if (error) {
    let msg = error.message;
    try {
      msg = (await error.context.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  return data;
}

const evCache = new Map();
/** События календаря в промежутке (кэш 5 минут). */
export async function calEvents(from, to) {
  const key = `${from.toISOString()}|${to.toISOString()}`;
  const hit = evCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.data;
  const data = await callFn({ from: from.toISOString(), to: to.toISOString() });
  evCache.set(key, { at: Date.now(), data });
  return data;
}

/** Ближайшее занятие группы/ученика (ключ «g:id» или «s:id») после момента after. */
export async function nextLessonFor(targetKeys, after = new Date()) {
  const cfg = await calConfig();
  if (!cfg.ics_url || !targetKeys.length) return null;
  const { events } = await calEvents(mondayOf(after), new Date(mondayOf(after).getTime() + 35 * DAY));
  return (events || []).find((e) => !e.allDay && targetKeys.includes(cfg.map[e.uid]) && Date.parse(e.start) > after.getTime()) || null;
}

/* ---------------- работы с сайта на промежуток ---------------- */

async function loadWorks(from, to) {
  const [{ data: dueItems }, { data: opening }] = await Promise.all([
    supa
      .from("lesson_items")
      .select("id, lesson_id, due_at, lessons!inner(id, title, kind, status, group_id, student_id, self_made, starts_at)")
      .gte("due_at", from.toISOString())
      .lt("due_at", to.toISOString())
      .eq("lessons.self_made", false)
      .neq("lessons.status", "draft")
      .limit(2000),
    supa
      .from("lessons")
      .select("id, title, kind, status, group_id, student_id, starts_at")
      .eq("self_made", false)
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString()),
  ]);
  const byLesson = new Map();
  (dueItems || []).forEach((it) => {
    const l = it.lessons;
    const x = byLesson.get(l.id) || { l, items: [] };
    x.items.push({ id: it.id, due_at: it.due_at });
    byLesson.set(l.id, x);
  });
  const ids = [...byLesson.keys()];
  const [{ data: la }, { data: gm }] = await Promise.all([
    ids.length ? supa.from("lesson_assignees").select("lesson_id, student_id").in("lesson_id", ids) : { data: [] },
    supa.from("group_members").select("group_id, student_id"),
  ]);
  const itemIds = [...byLesson.values()].flatMap((x) => x.items.map((i) => i.id));
  const done = new Map();
  for (let i = 0; i < itemIds.length; i += 200) {
    const part = itemIds.slice(i, i + 200);
    const [{ data: at }, { data: wk }] = await Promise.all([
      supa.from("attempts").select("item_id, student_id").in("item_id", part).limit(20000),
      supa.from("written_works").select("item_id, student_id").in("item_id", part).neq("status", "draft"),
    ]);
    [...(at || []), ...(wk || [])].forEach((r) => (done.get(r.item_id) || done.set(r.item_id, new Set()).get(r.item_id)).add(r.student_id));
  }
  const works = [...byLesson.values()].map(({ l, items }) => {
    const roster = new Set([
      ...(l.student_id ? [l.student_id] : []),
      ...(gm || []).filter((m) => m.group_id === l.group_id).map((m) => m.student_id),
      ...(la || []).filter((a) => a.lesson_id === l.id).map((a) => a.student_id),
    ]);
    const targets = [
      ...(l.group_id ? [`g:${l.group_id}`] : []),
      ...(l.student_id ? [`s:${l.student_id}`] : []),
      ...(la || []).filter((a) => a.lesson_id === l.id).map((a) => `s:${a.student_id}`),
    ];
    const due = items.map((i) => i.due_at).sort()[0];
    const ok = [...roster].filter((sid) => items.every((it) => done.get(it.id)?.has(sid))).length;
    return { l, items, due, roster, targets, ok };
  });
  // «откроется» — только то, что ещё не открыто ученикам
  return { works, opening: (opening || []).filter((l) => Date.parse(l.starts_at) > Date.now()) };
}

/* ---------------- отрисовка ---------------- */

function suggest(title, groups, students) {
  const words = (s) => new Set(String(s || "").toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/).filter((w) => w.length > 1));
  const tw = words(title);
  let best = null;
  let score = 0;
  groups.forEach((g) => {
    const n = [...words(g.title)].filter((w) => tw.has(w)).length;
    if (n > score) [best, score] = [`g:${g.id}`, n];
  });
  students.forEach((st) => {
    const ws = [...words(st.full_name)].filter((w) => !/^\d+$/.test(w));
    if (ws.length && ws.every((w) => tw.has(w)) && ws.length + 1 > score) [best, score] = [`s:${st.id}`, ws.length + 1];
  });
  return score >= 2 ? best : null;
}

function chipHtml(w, names) {
  const who = w.targets.map((k) => names.get(k)).filter(Boolean).join(", ");
  const past = Date.parse(w.due) < Date.now();
  const all = w.roster.size;
  return `<details class="wk-chip${past && w.ok < all ? " is-late" : ""}${w.ok === all && all ? " is-done" : ""}" draggable="true" data-lesson="${w.l.id}">
    <summary><span class="wk-chip-t">${escapeHtml(w.l.title)}</span><span class="muted">${hm(new Date(w.due))}${who ? ` · ${escapeHtml(who)}` : ""} · ${w.ok} из ${all}</span></summary>
    <div class="wk-chip-body">
      <p><a href="#/cabinet/lesson/${w.l.id}">Открыть работу →</a></p>
      <label>Новый срок<input type="datetime-local" value="${toLocalInput(w.due)}" data-due-input /></label>
      <p class="wk-quick">
        <button type="button" class="chip-btn" data-shift="1">+1 день</button>
        <button type="button" class="chip-btn" data-shift="7">+1 неделя</button>
        <span data-next-slot></span>
      </p>
      <p class="actions"><button type="button" class="btn" data-move>Перенести срок</button> <span class="muted" data-move-status></span></p>
    </div>
  </details>`;
}

function eventHtml(e, ctx) {
  const key = ctx.cfg.map[e.uid];
  if (key === "-") return `<div class="wk-ev is-skip"><span class="muted">${e.allDay ? "весь день" : hm(new Date(e.start))} · ${escapeHtml(e.title)} — не урок</span> <button type="button" class="linklike" data-unskip="${escapeHtml(e.uid)}">вернуть</button></div>`;
  const time = e.allDay ? "весь день" : `${hm(new Date(e.start))}–${hm(new Date(e.end))}`;
  const attached = key ? ctx.worksOn(e).filter((w) => w.targets.includes(key)) : [];
  attached.forEach((w) => ctx.used.add(w.l.id));
  const sug = !key && !e.allDay ? suggest(e.title, ctx.groups, ctx.students) : null;
  const opts = (sel) =>
    `<option value="">— чьё это занятие? —</option>${ctx.groups
      .map((g) => `<option value="g:${g.id}" ${sel === `g:${g.id}` ? "selected" : ""}>группа «${escapeHtml(g.title)}»</option>`)
      .join("")}${ctx.students.map((st) => `<option value="s:${st.id}" ${sel === `s:${st.id}` ? "selected" : ""}>${escapeHtml(st.full_name || "ученик")}</option>`).join("")}<option value="-">не урок — не показывать</option>`;
  return `<div class="wk-ev${key ? " is-mapped" : ""}" data-uid="${escapeHtml(e.uid)}" data-start="${e.start}">
    <div class="wk-ev-head"><strong>${time}</strong> <span>${escapeHtml(e.title)}</span>${e.recurring ? ' <span class="muted" title="повторяется">↻</span>' : ""}</div>
    ${
      key
        ? `<div class="wk-ev-who"><span class="chip">${escapeHtml(ctx.names.get(key) || "?")}</span>
            <a class="linklike" href="#" data-assign="written">+ письменная к следующему занятию</a>
            <a class="linklike" href="#" data-assign="lesson">+ занятие</a>
            <button type="button" class="linklike muted" data-remap>изменить</button></div>
           ${attached.length ? `<div class="wk-ev-due"><span class="muted">Срок к этому дню:</span>${attached.map((w) => chipHtml(w, ctx.names)).join("")}</div>` : ""}`
        : e.allDay
          ? ""
          : `<div class="wk-map"><select data-map>${opts(sug)}</select> <button type="button" class="btn secondary" data-map-save>${sug ? "Да, это оно" : "Сохранить"}</button>
             ${e.recurring ? '<span class="muted">запомнится для всей серии</span>' : ""}</div>`
    }
  </div>`;
}

function dayHtml(date, ctx) {
  const key = ymd(date);
  const evs = ctx.events.filter((e) => (e.allDay ? e.date === key : ymd(new Date(e.start)) === key));
  const evHtml = evs.map((e) => eventHtml(e, ctx)).join("");
  const loose = ctx.works.filter((w) => ymd(new Date(w.due)) === key && !ctx.used.has(w.l.id));
  const opens = ctx.opening.filter((l) => ymd(new Date(l.starts_at)) === key);
  const isToday = key === ymd(new Date());
  return `<section class="wk-day${isToday ? " is-today" : ""}" data-date="${key}">
    <h3>${dayTitle(date)}${isToday ? ' <span class="chip is-hot">сегодня</span>' : ""}</h3>
    ${evHtml}
    ${loose.length ? `<div class="wk-loose"><span class="muted">Сроки сдачи:</span>${loose.map((w) => chipHtml(w, ctx.names)).join("")}</div>` : ""}
    ${opens.map((l) => `<p class="muted wk-open">${hm(new Date(l.starts_at))} откроется: <a href="#/cabinet/lesson/${l.id}">${escapeHtml(l.title)}</a></p>`).join("")}
    ${!evs.length && !loose.length && !opens.length ? '<p class="muted wk-empty">—</p>' : ""}
  </section>`;
}

async function buildCtx(from, to) {
  const [cfg, { data: groups }, { data: students }] = await Promise.all([
    calConfig(),
    supa.from("groups").select("id, title").eq("archived", false).order("title"),
    supa.from("profiles").select("id, full_name").neq("role", "teacher").eq("status", "active").order("full_name"),
  ]);
  const names = new Map([...(groups || []).map((g) => [`g:${g.id}`, g.title]), ...(students || []).map((s) => [`s:${s.id}`, s.full_name || "ученик"])]);
  let events = [];
  let calError = "";
  if (cfg.ics_url) {
    try {
      events = (await calEvents(from, to)).events || [];
    } catch (err) {
      calError = err.message;
    }
  }
  const { works, opening } = await loadWorks(from, to);
  const ctx = {
    cfg, groups: groups || [], students: students || [], names, events, calError, works, opening, used: new Set(),
    worksOn: (e) => works.filter((w) => ymd(new Date(w.due)) === ymd(new Date(e.start))),
  };
  return ctx;
}

const SETUP_HELP = `
  <ol class="wk-help">
    <li>Откройте Google Календарь на компьютере → слева у календаря с занятиями «⋮» → «Настройки и общий доступ».</li>
    <li>Внизу страницы найдите «Секретный адрес в формате iCal» и скопируйте его (ссылка заканчивается на <code>basic.ics</code>).</li>
    <li>Вставьте сюда и нажмите «Проверить и сохранить».</li>
  </ol>
  <p class="muted">Ссылку видите только вы. Сайт читает календарь, когда вы открываете эту страницу, и ничего в нём не меняет. Названия событий в базе не сохраняются. Если ссылка куда-то попадёт — в Google её можно сбросить кнопкой «Сбросить».</p>`;

function setupHtml(cfg) {
  return `<form id="wk-setup" class="card stack wk-setup">
    <h2>${cfg.ics_url ? "Ссылка на календарь" : "Подключить Google Календарь"}</h2>
    ${SETUP_HELP}
    <label>Секретный адрес в формате iCal<input name="url" type="url" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value="${escapeHtml(cfg.ics_url || "")}" /></label>
    <p class="actions"><button class="btn" type="submit">Проверить и сохранить</button>${cfg.ics_url ? ' <button type="button" class="btn secondary" data-cal-off>Отключить календарь</button>' : ""}</p>
    <p class="lit-result" id="wk-setup-status"></p>
  </form>`;
}

function bindSetup(host, reload) {
  const form = host.querySelector("#wk-setup");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = form.querySelector("#wk-setup-status");
    const url = form.url.value.trim();
    st.className = "lit-result";
    st.textContent = "Проверяем…";
    try {
      const r = await callFn({ action: "test", url, from: new Date().toISOString(), to: new Date(Date.now() + 14 * DAY).toISOString() });
      await saveConfig({ ics_url: url });
      st.className = "lit-result is-ok";
      st.textContent = `Готово: в ближайшие две недели событий — ${(r.events || []).length}.`;
      setTimeout(reload, 700);
    } catch (err) {
      st.className = "lit-result is-bad";
      st.textContent = err.message;
    }
  });
  form.querySelector("[data-cal-off]")?.addEventListener("click", async () => {
    if (!confirm("Отключить календарь? Сопоставления занятий с группами сохранятся.")) return;
    await saveConfig({ ics_url: null });
    reload();
  });
}

/** Привязать действия: сопоставление, перенос сроков, «задать к следующему занятию». */
function bindDays(host, ctx, reload) {
  const saveMap = async (uid, val) => {
    const map = { ...ctx.cfg.map };
    if (val) map[uid] = val;
    else delete map[uid];
    await saveConfig({ map });
    reload();
  };
  host.querySelectorAll("[data-map-save]").forEach((b) =>
    b.addEventListener("click", async () => {
      const ev = b.closest("[data-uid]");
      const val = ev.querySelector("[data-map]").value;
      if (!val) return alert("Выберите группу или ученика.");
      b.disabled = true;
      await saveMap(ev.dataset.uid, val).catch((err) => alert(err.message));
    })
  );
  host.querySelectorAll("[data-remap]").forEach((b) =>
    b.addEventListener("click", () => {
      if (confirm("Убрать сопоставление этого занятия (для всей серии)?")) saveMap(b.closest("[data-uid]").dataset.uid, null);
    })
  );
  host.querySelectorAll("[data-unskip]").forEach((b) => b.addEventListener("click", () => saveMap(b.dataset.unskip, null)));

  // «+ письменная к следующему занятию»: форма создания с выбранной группой/учеником и сроком на следующее занятие серии
  host.querySelectorAll("[data-assign]").forEach((a) =>
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const ev = a.closest("[data-uid]");
      const key = ctx.cfg.map[ev.dataset.uid];
      const after = new Date(Date.parse(ev.dataset.start) + 60000);
      let next = null;
      try {
        next = await nextLessonFor([key], after);
      } catch {}
      const q = new URLSearchParams({ new: a.dataset.assign === "written" ? "written" : "1", to: key });
      if (next) q.set("due", next.start);
      location.hash = `#/cabinet/lessons?${q.toString()}`;
    })
  );

  // Перенос срока: из карточки или перетаскиванием на другой день (время сохраняется)
  const moveLesson = async (lessonId, newDue) => {
    const w = ctx.works.find((x) => x.l.id === lessonId);
    if (!w) return;
    const delta = new Date(newDue).getTime() - Date.parse(w.due);
    for (const it of w.items) {
      const { error } = await supa.from("lesson_items").update({ due_at: new Date(Date.parse(it.due_at) + delta).toISOString() }).eq("id", it.id);
      if (error) throw humanError(error);
    }
  };
  host.querySelectorAll(".wk-chip").forEach((chip) => {
    const w = ctx.works.find((x) => x.l.id === chip.dataset.lesson);
    const input = chip.querySelector("[data-due-input]");
    chip.querySelectorAll("[data-shift]").forEach((b) =>
      b.addEventListener("click", () => {
        const d = new Date(input.value || w.due);
        d.setDate(d.getDate() + Number(b.dataset.shift));
        input.value = toLocalInput(d);
      })
    );
    chip.addEventListener("toggle", async () => {
      if (!chip.open || chip.dataset.nextDone) return;
      chip.dataset.nextDone = "1";
      try {
        const next = await nextLessonFor(w.targets, new Date(Math.max(Date.now(), Date.parse(w.due)) + 60000));
        if (next) {
          const slot = chip.querySelector("[data-next-slot]");
          slot.innerHTML = `<button type="button" class="chip-btn">к следующему занятию · ${escapeHtml(shortWhen(next.start))}</button>`;
          slot.querySelector("button").addEventListener("click", () => (input.value = toLocalInput(next.start)));
        }
      } catch {}
    });
    chip.querySelector("[data-move]").addEventListener("click", async () => {
      const st = chip.querySelector("[data-move-status]");
      if (!input.value) return;
      st.textContent = "переносим…";
      try {
        await moveLesson(w.l.id, new Date(input.value));
        reload();
      } catch (err) {
        st.textContent = err.message;
      }
    });
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", w.l.id);
      e.dataTransfer.effectAllowed = "move";
    });
  });
  host.querySelectorAll(".wk-day").forEach((day) => {
    day.addEventListener("dragover", (e) => {
      e.preventDefault();
      day.classList.add("is-drop");
    });
    day.addEventListener("dragleave", () => day.classList.remove("is-drop"));
    day.addEventListener("drop", async (e) => {
      e.preventDefault();
      day.classList.remove("is-drop");
      const id = e.dataTransfer.getData("text/plain");
      const w = ctx.works.find((x) => x.l.id === id);
      if (!w) return;
      const old = new Date(w.due);
      const [y, m, d] = day.dataset.date.split("-").map(Number);
      const nd = new Date(y, m - 1, d, old.getHours(), old.getMinutes());
      if (ymd(nd) === ymd(old)) return;
      if (!confirm(`Перенести срок «${w.l.title}» на ${dayTitle(nd)}, ${hm(nd)}?`)) return;
      try {
        await moveLesson(id, nd);
        reload();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

/** Страница «Неделя». */
export async function weekView(host, render, offset = 0) {
  const from = new Date(mondayOf().getTime() + Number(offset || 0) * 7 * DAY);
  const to = new Date(from.getTime() + 7 * DAY);
  const reload = () => weekView(host, render, offset);
  const ctx = await buildCtx(from, to);
  const days = Array.from({ length: 7 }, (_, i) => new Date(from.getTime() + i * DAY + 3600000)).map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  const range = `${from.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} — ${new Date(to.getTime() - DAY).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
  const unmapped = ctx.events.filter((e) => !e.allDay && !ctx.cfg.map[e.uid]).length;
  render(`
    <header class="tt-head">
      <div><p class="eyebrow">Расписание</p><h1>Неделя</h1></div>
      <nav class="wk-nav" aria-label="Недели">
        <a class="btn secondary" href="#/cabinet/week/${Number(offset) - 1}" aria-label="Предыдущая неделя">‹</a>
        <span>${range}</span>
        <a class="btn secondary" href="#/cabinet/week/${Number(offset) + 1}" aria-label="Следующая неделя">›</a>
        ${Number(offset) ? '<a class="btn secondary" href="#/cabinet/week">Эта неделя</a>' : ""}
      </nav>
    </header>
    ${!ctx.cfg.ics_url ? setupHtml(ctx.cfg) : ""}
    ${ctx.calError ? `<p class="lit-result is-bad">Календарь не прочитался: ${escapeHtml(ctx.calError)}</p>` : ""}
    ${unmapped ? `<p class="muted">Укажите у занятий, чьи они (группа или ученик), — один раз для каждой серии. Тогда здесь будет видно, что задано к уроку, а при создании работы появится срок «к следующему занятию».</p>` : ""}
    <p class="muted">Перенести срок: нажмите на работу или перетащите её на другой день.</p>
    <div class="wk-grid">${days.map((d) => dayHtml(d, ctx)).join("")}</div>
    ${ctx.cfg.ics_url ? `<details class="wk-settings"><summary>Настройки календаря</summary>${setupHtml(ctx.cfg)}</details>` : ""}`);
  bindSetup(host, () => {
    evCache.clear();
    reload();
  });
  bindDays(host, ctx, reload);
}

/** «Сегодня»: расписание дня (заполняется после основной страницы, чтобы не задерживать её). */
export async function scheduleTodayMount(host) {
  const box = host.querySelector("#tt-schedule");
  if (!box) return;
  try {
    const cfg = await calConfig();
    if (!cfg.ics_url) {
      box.innerHTML = `<p class="muted"><a href="#/cabinet/week">Подключить расписание из Google Календаря →</a> — будет видно, какие занятия сегодня и что к ним задано.</p>`;
      return;
    }
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + DAY);
    const ctx = await buildCtx(from, to);
    box.innerHTML = `<h2>Расписание на сегодня <a class="linklike" href="#/cabinet/week">неделя →</a></h2>${ctx.calError ? `<p class="lit-result is-bad">${escapeHtml(ctx.calError)}</p>` : ""}${dayHtml(from, ctx)}`;
    bindDays(box, ctx, () => scheduleTodayMount(host));
  } catch (err) {
    box.innerHTML = `<p class="muted">Расписание не загрузилось: ${escapeHtml(err.message)}</p>`;
  }
}

/* ---------------- ученик: группа и ближайшие занятия ---------------- */

const SCHED_KEY = "leksikon-my-schedule";
async function myLessonsCached() {
  try {
    const c = JSON.parse(sessionStorage.getItem(SCHED_KEY) || "null");
    if (c && Date.now() - c.at < 20 * 60000) return c.lessons;
  } catch {}
  const { data, error } = await supa.functions.invoke("calendar", { body: { action: "my" } });
  if (error) throw error;
  const lessons = data?.lessons || [];
  try {
    sessionStorage.setItem(SCHED_KEY, JSON.stringify({ at: Date.now(), lessons }));
  } catch {}
  return lessons;
}

/** Главная ученика: «Твоя группа», ближайшие занятия и что к каждому сделать. */
export async function studentScheduleMount(host, groupNames = []) {
  const box = host.querySelector("#me-schedule");
  if (!box) return;
  const uid = currentUser()?.id;
  let lessons = [];
  try {
    lessons = (await myLessonsCached()).filter((l) => Date.parse(l.end) > Date.now()).slice(0, 4);
  } catch {
    /* расписание недоступно — покажем только группу */
  }
  // несделанные работы со сроком — чтобы показать их под ближайшим занятием
  let open = [];
  if (lessons.length && uid) {
    const { data: ls } = await supa
      .from("lessons")
      .select("id, title, status, self_made, lesson_items(id, due_at, hidden)")
      .eq("status", "live")
      .eq("self_made", false)
      .limit(60);
    const items = (ls || []).flatMap((l) => (l.lesson_items || []).filter((i) => i.due_at && !i.hidden).map((i) => ({ ...i, l })));
    const ids = items.map((i) => i.id);
    if (ids.length) {
      const [{ data: at }, { data: wk }] = await Promise.all([
        supa.from("attempts").select("item_id").eq("student_id", uid).in("item_id", ids),
        supa.from("written_works").select("item_id").eq("student_id", uid).in("item_id", ids).neq("status", "draft"),
      ]);
      const done = new Set([...(at || []), ...(wk || [])].map((r) => r.item_id));
      const byLesson = new Map();
      items
        .filter((i) => !done.has(i.id) && Date.parse(i.due_at) > Date.now() - 7 * DAY)
        .forEach((i) => {
          const cur = byLesson.get(i.l.id);
          if (!cur || i.due_at < cur.due) byLesson.set(i.l.id, { id: i.l.id, title: i.l.title, due: i.due_at });
        });
      open = [...byLesson.values()].sort((a, b) => a.due.localeCompare(b.due));
    }
  }
  if (!lessons.length && !groupNames.length) {
    box.hidden = true;
    return;
  }
  const used = new Set();
  const rows = lessons
    .map((l) => {
      const s = new Date(l.start);
      const todo = open.filter((w) => !used.has(w.id) && Date.parse(w.due) <= Date.parse(l.start) + 3600000);
      todo.forEach((w) => used.add(w.id));
      const isToday = ymd(s) === ymd(new Date());
      const isTomorrow = ymd(s) === ymd(new Date(Date.now() + DAY));
      return `<div class="me-lesson${isToday ? " is-today" : ""}">
        <p class="me-lesson-when"><strong>${isToday ? "Сегодня" : isTomorrow ? "Завтра" : dayTitle(s)}, ${hm(s)}–${hm(new Date(l.end))}</strong> <span class="muted">${escapeHtml(l.label)}</span></p>
        ${
          todo.length
            ? `<p class="me-lesson-todo">К занятию: ${todo
                .map((w) => `<a href="#/lesson/${w.id}">«${escapeHtml(w.title)}»</a>${Date.parse(w.due) < Date.now() ? ' <span class="badge">срок прошёл</span>' : ""}`)
                .join(", ")}</p>`
            : ""
        }
      </div>`;
    })
    .join("");
  box.innerHTML = `
    <h2>Мои занятия</h2>
    ${groupNames.length ? `<p class="muted">Ты в группе: <strong>${escapeHtml(groupNames.join(", "))}</strong></p>` : ""}
    ${rows || '<p class="muted">Расписание появится здесь, когда преподаватель его подключит.</p>'}`;
  box.hidden = false;
}
