/**
 * #/cabinet/assign — «Найти и назначить»: поиск по всей базе заданий (любой экзамен, любой тип)
 * и назначение выбранных заданий группе и/или ученикам — новым заданием или в уже открытое занятие.
 * Выбранное копится в «корзине» (sessionStorage) между поисками: можно собрать задания из разных разделов.
 * #/cabinet/assign?add=<task id> — сразу положить задание в корзину (кнопка «Назначить» в банке).
 */
import { escapeHtml } from "./ui.js";
import { fromBzInput } from "./tz.js?v=land199";
import { humanError, supa } from "./supa.js";
import { taskHref } from "./account.js?v=land199";
import { SOURCES } from "./teacher.js?v=land199";
import {
  KIND, MODE_LABEL, TEACHER_CHECKED, bindDuePresets, bindPicker, duePresetsHtml, insertItems, pickedStudents, shortSource, snippet, targetPickerHtml,
} from "./lessons.js?v=land199";

const BASKET = "lx-assign-basket";
const FIELDS = "id, source, bank_file, source_ref, task_no, topic, answer_mode, list_item, is_published, is_own, passage_id";

const loadBasket = () => {
  try {
    return JSON.parse(sessionStorage.getItem(BASKET) || "[]");
  } catch {
    return [];
  }
};
const saveBasket = (b) => sessionStorage.setItem(BASKET, JSON.stringify(b));

/** «Лит. № 9 · А. П. Чехов «Вишнёвый сад» · № 1234» */
function label(t) {
  const li = t.list_item || {};
  const who = [li.author, li.work ? `«${li.work}»` : ""].filter(Boolean).join(" ");
  return `${shortSource(t.source)}${t.task_no != null && t.source !== "itog" ? ` № ${t.task_no}` : ""}${who ? ` · ${who}` : ""}`;
}

/** Слово для фильтра PostgREST: без запятых, скобок и звёздочек. */
const clean = (w) => w.replace(/[,()*%\\:"]/g, " ").trim();
const variants = (w) => [...new Set([w, w.replace(/ё/g, "е"), w.replace(/е/g, "ё")])].filter((x) => x.length);

async function search({ text, source, no, mode, own }) {
  const words = clean(text).split(/\s+/).filter((w) => w.length > 1).slice(0, 4);
  const base = () => {
    let q = supa.from("tasks").select(FIELDS).order("source").order("task_no").order("position").limit(150);
    if (source) q = q.eq("source", source);
    if (no) q = q.eq("task_no", Number(no));
    if (own) q = q.eq("is_own", true);
    if (mode === "written") q = q.in("answer_mode", [...TEACHER_CHECKED]);
    if (mode === "short") q = q.not("answer_mode", "in", `(${[...TEACHER_CHECKED].join(",")})`);
    return q;
  };
  // № задания в банке или внутренний id
  if (/^L?\d+$/.test(text.trim())) {
    const v = text.trim();
    const { data, error } = await base().or(`source_ref.eq.${v}${/^\d+$/.test(v) ? `,id.eq.${v}` : ""}`);
    if (error) throw humanError(error);
    return data || [];
  }
  let q = base();
  // каждое слово должно найтись хотя бы в одном поле: условие, автор, произведение, тема
  for (const w of words) {
    const ors = variants(w).flatMap((x) => [
      `list_item->>questionText.ilike.*${x}*`,
      `list_item->>author.ilike.*${x}*`,
      `list_item->>work.ilike.*${x}*`,
      `topic.ilike.*${x}*`,
    ]);
    q = q.or(ors.join(","));
  }
  // параллельно — по тексту, к которому относится задание (фамилия автора исходного текста, слова из текста)
  const byPassage = async () => {
    if (!words.length) return [];
    let pq = supa.from("passages").select("id").limit(150);
    for (const w of words) pq = pq.or(variants(w).map((x) => `html.ilike.*${x}*`).join(","));
    const { data: ps } = await pq;
    const ids = (ps || []).map((p) => p.id);
    return ids.length ? (await base().in("passage_id", ids)).data || [] : [];
  };
  const [main, more] = await Promise.all([q, byPassage()]);
  if (main.error) throw humanError(main.error);
  const tasks = main.data || [];
  const seen = new Set(tasks.map((t) => t.id));
  more.forEach((t) => !seen.has(t.id) && (seen.add(t.id), tasks.push(t)));
  return tasks;
}

export async function assignView(host, render) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  let basket = loadBasket();
  const addId = Number(params.get("add"));
  if (addId && !basket.some((b) => b.id === addId)) {
    const { data: t } = await supa.from("tasks").select(FIELDS).eq("id", addId).maybeSingle();
    if (t) {
      basket.push({ id: t.id, label: label(t), mode: t.answer_mode, ref: t.source_ref, href: taskHref(t) });
      saveBasket(basket);
    }
  }
  const [{ data: groups }, { data: students }, { data: lessons }] = await Promise.all([
    supa.from("groups").select("id, title").eq("archived", false).order("title"),
    supa.from("profiles").select("id, full_name, email").neq("role", "teacher").eq("status", "active").order("full_name"),
    supa.from("lessons").select("id, title, status, kind, created_at, groups(title)").neq("status", "done").eq("self_made", false).is("duration_minutes", null).order("created_at", { ascending: false }).limit(40),
  ]);
  const srcOpts = Object.entries(SOURCES)
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v.title)}</option>`)
    .join("");
  const saved = (() => {
    try {
      return JSON.parse(sessionStorage.getItem("lx-assign-q") || "{}");
    } catch {
      return {};
    }
  })();

  render(`
    <header class="tt-head"><div><p class="eyebrow">Кабинет</p><h1>Найти и назначить</h1>
      <p class="muted">Ищите по всей базе: автор, произведение, слова из условия или из текста, № задания. Отметьте нужные — они копятся в списке справа, можно искать дальше. Потом «Назначить» — группе или отдельным ученикам.</p></div></header>
    <div class="as-layout">
      <section>
        <form id="as-search" class="card t-filter as-search">
          <label class="as-q">Что ищем<input name="q" placeholder="например: Чехов, Вишнёвый сад, Паустовский, 40745" value="${escapeHtml(saved.q || "")}" autocomplete="off" /></label>
          <label>Экзамен<select name="source"><option value="">все</option>${srcOpts}</select></label>
          <label>№ задания<input name="no" type="number" min="1" max="30" style="width:80px" value="${escapeHtml(saved.no || "")}" /></label>
          <label>Ответ<select name="mode"><option value="">любой</option><option value="short">краткий (проверяет сайт)</option><option value="written">развёрнутый / сочинение</option></select></label>
          <label class="t-inline"><input type="checkbox" name="own" ${saved.own ? "checked" : ""}/> только мои</label>
          <button class="btn" type="submit">Найти</button>
        </form>
        <div id="as-results"><p class="muted">Введите запрос или выберите экзамен и номер.</p></div>
      </section>
      <aside class="card as-basket" id="as-basket"></aside>
    </div>`);

  const form = host.querySelector("#as-search");
  if (saved.source) form.source.value = saved.source;
  if (saved.mode) form.mode.value = saved.mode;
  const resultsBox = host.querySelector("#as-results");
  const basketBox = host.querySelector("#as-basket");
  let found = [];
  let facet = "";

  const inBasket = (id) => basket.some((b) => b.id === id);
  const drawResults = () => {
    if (!found.length) {
      resultsBox.innerHTML = `<p class="muted">Ничего не нашлось. Попробуйте одно слово (например, фамилию) или уберите фильтры.</p>`;
      return;
    }
    const facets = {};
    found.forEach((t) => {
      const k = `${t.source}|${t.task_no ?? ""}`;
      facets[k] = (facets[k] || 0) + 1;
    });
    const fkeys = Object.keys(facets);
    const shown = facet ? found.filter((t) => `${t.source}|${t.task_no ?? ""}` === facet) : found;
    resultsBox.innerHTML = `<p class="muted">Найдено: ${found.length}${found.length >= 150 ? " — это много, уточните запрос (например, добавьте название произведения или № задания)" : ""}.</p>
      ${
        fkeys.length > 1
          ? `<p class="as-facets"><button type="button" class="pill ${facet ? "" : "active"}" data-facet="">все · ${found.length}</button>${fkeys
              .map((k) => {
                const [src, no] = k.split("|");
                return `<button type="button" class="pill ${facet === k ? "active" : ""}" data-facet="${escapeHtml(k)}">${escapeHtml(shortSource(src))}${no && src !== "itog" ? ` № ${escapeHtml(no)}` : src === "itog" ? "" : " · доп."} · ${facets[k]}</button>`;
              })
              .join("")}</p>`
          : ""
      }
      <div class="lit-list as-list">${shown
        .map(
          (t) => `<div class="lit-item${inBasket(t.id) ? " is-picked" : ""}">
            <span class="lit-item-body">
              <strong>${escapeHtml(label(t))} · <a href="${taskHref(t)}" target="_blank" rel="noopener">№ ${escapeHtml(String(t.source_ref))}</a>${t.is_published ? "" : ' <span class="chip">черновик</span>'}</strong>
              <span>${escapeHtml(snippet(t, 260))}</span>
              <span class="muted">${escapeHtml(MODE_LABEL[t.answer_mode] || t.answer_mode)}${TEACHER_CHECKED.has(t.answer_mode) ? " · проверяете вы" : " · проверяет сайт"}</span>
            </span>
            <button type="button" class="btn ${inBasket(t.id) ? "secondary" : ""}" data-toggle="${t.id}">${inBasket(t.id) ? "✓ Выбрано" : "+ Выбрать"}</button>
          </div>`
        )
        .join("")}</div>`;
    resultsBox.querySelectorAll("[data-facet]").forEach((b) =>
      b.addEventListener("click", () => {
        facet = b.dataset.facet;
        drawResults();
      })
    );
    resultsBox.querySelectorAll("[data-toggle]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = Number(b.dataset.toggle);
        const t = found.find((x) => x.id === id);
        basket = inBasket(id) ? basket.filter((x) => x.id !== id) : [...basket, { id, label: label(t), mode: t.answer_mode, ref: t.source_ref, href: taskHref(t) }];
        saveBasket(basket);
        drawResults();
        drawBasket();
      })
    );
  };

  const drawBasket = () => {
    if (!basket.length) {
      basketBox.innerHTML = `<h2 class="me-label">Выбрано: 0</h2><p class="muted">Нажмите «+ Выбрать» у задания — оно появится здесь.</p>`;
      return;
    }
    const written = basket.filter((b) => TEACHER_CHECKED.has(b.mode)).length;
    basketBox.innerHTML = `
      <h2 class="me-label">Выбрано: ${basket.length}${written ? ` · письменных ${written}` : ""}</h2>
      <ol class="as-picked">${basket
        .map((b) => `<li><a href="${b.href}" target="_blank" rel="noopener">${escapeHtml(b.label)} · № ${escapeHtml(String(b.ref))}</a> <button type="button" class="linklike" data-drop="${b.id}" aria-label="Убрать">убрать</button></li>`)
        .join("")}</ol>
      <form id="as-assign" class="stack">
        <fieldset class="as-where"><legend class="l-label">Куда</legend>
          <label class="t-inline"><input type="radio" name="where" value="new" checked /> новое задание</label>
          <label class="t-inline"><input type="radio" name="where" value="old" ${lessons?.length ? "" : "disabled"} /> добавить в занятие</label>
        </fieldset>
        <div data-new>
          <label>Название<input name="title" placeholder="${escapeHtml(defaultTitle())}" /></label>
          ${targetPickerHtml(groups, students)}
        </div>
        <label data-old hidden>Занятие<select name="lesson_id">${(lessons || [])
          .map((l) => `<option value="${l.id}">${escapeHtml(l.title)}${l.groups?.title ? ` · ${escapeHtml(l.groups.title)}` : ""}${l.status === "draft" ? " · черновик" : ""}</option>`)
          .join("")}</select></label>
        <label>Как<select name="kind"><option value="homework">домашнее</option><option value="classwork">в классе</option></select></label>
        <label>Срок сдачи<input type="datetime-local" name="due" /></label>
        ${duePresetsHtml()}
        <label class="t-inline" data-new><input type="checkbox" name="open" checked /> открыть ученикам сразу</label>
        <button class="btn" type="submit">Назначить ${basket.length} ${basket.length === 1 ? "задание" : basket.length < 5 ? "задания" : "заданий"}</button>
        <button class="linklike" type="button" id="as-clear">очистить список</button>
        <p class="lit-result" id="as-status" aria-live="polite"></p>
      </form>`;
    basketBox.querySelectorAll("[data-drop]").forEach((b) =>
      b.addEventListener("click", () => {
        basket = basket.filter((x) => x.id !== Number(b.dataset.drop));
        saveBasket(basket);
        drawBasket();
        if (found.length) drawResults();
      })
    );
    basketBox.querySelector("#as-clear").addEventListener("click", () => {
      basket = [];
      saveBasket(basket);
      drawBasket();
      if (found.length) drawResults();
    });
    const af = basketBox.querySelector("#as-assign");
    bindPicker(af);
    // учеников много — быстрый поиск по псевдониму или настоящему имени
    const pickList = af.querySelector(".l-pick-list");
    if (pickList) {
      pickList.insertAdjacentHTML("beforebegin", `<input type="search" class="as-who" placeholder="найти ученика по имени" aria-label="Найти ученика" />`);
      af.querySelector(".as-who").addEventListener("input", (e) => {
        const v = e.target.value.trim().toLowerCase();
        pickList.querySelectorAll("label").forEach((l) => (l.hidden = Boolean(v) && !l.textContent.toLowerCase().includes(v)));
      });
    }
    bindDuePresets(af, af.due);
    af.querySelectorAll('[name="where"]').forEach((r) =>
      r.addEventListener("change", () => {
        const old = af.where.value === "old";
        af.querySelectorAll("[data-new]").forEach((x) => (x.hidden = old));
        af.querySelector("[data-old]").hidden = !old;
      })
    );
    af.addEventListener("submit", (e) => {
      e.preventDefault();
      assign(af);
    });
  };

  function defaultTitle() {
    const first = basket[0]?.label || "Задание";
    return basket.length === 1 ? first : `${first} и ещё ${basket.length - 1}`;
  }

  async function assign(af) {
    const st = af.querySelector("#as-status");
    const say = (t, bad = true) => {
      st.className = `lit-result ${bad ? "is-bad" : "is-ok"}`;
      st.textContent = t;
    };
    const f = new FormData(af);
    const due = f.get("due") ? fromBzInput(f.get("due")) : null;
    if (due && Date.parse(due) < Date.now()) return say("Срок уже прошёл — выберите время позже.");
    const kind = f.get("kind");
    const btn = af.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      // задания в порядке корзины
      const { data: rows, error } = await supa.from("tasks").select("id, answer_mode").in("id", basket.map((b) => b.id));
      if (error) throw humanError(error);
      const tasks = basket.map((b) => rows.find((r) => r.id === b.id)).filter(Boolean);
      let lessonId;
      let start = 0;
      if (f.get("where") === "old") {
        lessonId = f.get("lesson_id");
        const { data: its } = await supa.from("lesson_items").select("task_id, position").eq("lesson_id", lessonId);
        start = Math.max(0, ...(its || []).map((i) => i.position || 0));
        const had = new Set((its || []).map((i) => i.task_id));
        const dup = tasks.filter((t) => had.has(t.id)).length;
        if (dup === tasks.length) throw new Error("Все выбранные задания уже есть в этом занятии.");
        tasks.splice(0, tasks.length, ...tasks.filter((t) => !had.has(t.id)));
      } else {
        const groupId = f.get("group_id") || null;
        const picked = pickedStudents(af);
        if (!groupId && !picked.length) throw new Error("Выберите группу и/или учеников.");
        // одно сочинение/развёрнутый ответ — это «письменная работа»: так её видно и в очереди проверки
        const single = tasks.length === 1 && TEACHER_CHECKED.has(tasks[0].answer_mode);
        if (single && !due) throw new Error("Для письменной работы укажите срок сдачи.");
        const { data: lesson, error: e1 } = await supa
          .from("lessons")
          .insert({
            title: String(f.get("title") || "").trim() || defaultTitle(),
            kind: single ? "written" : "lesson",
            status: f.get("open") ? "live" : "draft",
            starts_at: new Date().toISOString(),
            show_results: "manual",
            group_id: groupId,
          })
          .select("id")
          .single();
        if (e1) throw humanError(e1);
        lessonId = lesson.id;
        if (picked.length) {
          const { error: e2 } = await supa.from("lesson_assignees").insert(picked.map((sid) => ({ lesson_id: lessonId, student_id: sid })));
          if (e2) throw humanError(e2);
        }
      }
      await insertItems(lessonId, tasks, { kind, reveal: "after_correct", attempts: null, due, hidden: false }, start);
      basket = [];
      saveBasket(basket);
      say("Назначено. Открываем занятие…", false);
      location.hash = `#/cabinet/lesson/${lessonId}`;
    } catch (err) {
      say(err.message);
      btn.disabled = false;
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const opts = { text: String(f.get("q") || ""), source: f.get("source"), no: f.get("no"), mode: f.get("mode"), own: !!f.get("own") };
    sessionStorage.setItem("lx-assign-q", JSON.stringify({ q: opts.text, source: opts.source, no: opts.no, mode: opts.mode, own: opts.own }));
    if (!opts.text.trim() && !opts.source && !opts.no) {
      resultsBox.innerHTML = `<p class="muted">Введите запрос или выберите экзамен и номер.</p>`;
      return;
    }
    resultsBox.innerHTML = `<p class="muted">Ищем…</p>`;
    try {
      found = await search(opts);
      facet = "";
      drawResults();
    } catch (err) {
      resultsBox.innerHTML = `<p class="lit-result is-bad">${escapeHtml(err.message)}</p>`;
    }
  });
  drawBasket();
  if (saved.q || saved.source || saved.no) form.requestSubmit();
}
