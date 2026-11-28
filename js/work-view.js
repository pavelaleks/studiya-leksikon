/**
 * Проверенная письменная работа глазами ученика.
 *  - #/me/work/<id> — баллы, критерии, комментарий, текст и фото с пометками преподавателя;
 *    при открытии ставится «посмотрено» (seen_at), кнопкой — «в архив» (archived_at);
 *  - плашка «Работа проверена» вверху любой страницы, пока ученик не открыл проверку;
 *  - блок «Проверено» на главной: всё, что ещё не убрано в архив.
 */
import { escapeHtml } from "./ui.js";
import { downloadCanvas, markedTextHtml, marksListHtml, renderPhoto, studentReviewHtml } from "./review.js?v=land199";
import { accessState, currentUser, humanError, signedFileUrl, supa } from "./supa.js";

const SOURCE_TITLE = { "ege-rus": "ЕГЭ · русский", "oge-rus": "ОГЭ · русский", "vpr-rus": "ВПР · русский", "ege-lit": "ЕГЭ · литература", "oge-lit": "ОГЭ · литература", itog: "Итоговое сочинение" };
const SELECT = "id, status, score, max_score, reviewed_at, seen_at, archived_at, item_id, tasks(source, bank_file, source_ref, task_no), lesson_items(lesson_id, lessons(title, kind))";

/** Как назвать работу: «Сочинение к занятию „…“» или «ЕГЭ · русский, задание 27». */
export function workTitle(w) {
  const l = w.lesson_items?.lessons;
  if (l?.kind === "written" && l.title) return `«${l.title}»`;
  const t = w.tasks;
  if (t?.source === "itog") return "Итоговое сочинение";
  return `${SOURCE_TITLE[t?.source] || "Работа"}${t?.task_no != null ? `, задание ${t.task_no}` : ""}`;
}

/** Где работу можно исправить и сдать снова: занятие или страница задания. */
export function workTaskHref(w) {
  if (w.lesson_items?.lesson_id) return `#/lesson/${w.lesson_items.lesson_id}`;
  const t = w.tasks;
  if (!t) return "#/me";
  const ref = encodeURIComponent(t.source_ref);
  if (t.source === "ege-rus") return `#/ege/${t.task_no}/${ref}`;
  if (t.source === "oge-rus") return `#/oge/${t.task_no}/${ref}`;
  if (t.source === "vpr-rus") return `#/vpr/${t.task_no}/${ref}`;
  if (t.source === "oge-lit") return `#/literature/oge/${t.task_no}/${ref}`;
  if (t.source === "itog") return `#/itog/t/${ref}`;
  if (t.source === "ege-lit") return String(t.bank_file).startsWith("extra-") ? `#/literature/archive/${t.bank_file}/${ref}` : `#/literature/${t.task_no}/${ref}`;
  return "#/me";
}

const isChecked = (w) => w.status === "graded" || w.status === "returned";
/** Проверенные и не убранные в архив, свежие сверху. */
export const pendingChecked = (works = []) =>
  works.filter((w) => isChecked(w) && !w.archived_at).sort((a, b) => String(b.reviewed_at || "").localeCompare(String(a.reviewed_at || "")));

const scoreChip = (w) =>
  w.status === "returned"
    ? `<span class="chip is-hot">исправить</span>`
    : w.score != null
      ? `<span class="chip wv-chip-score${w.max_score && w.score / w.max_score < 0.5 ? " is-low" : ""}">${escapeHtml(String(w.score))}${w.max_score ? ` из ${escapeHtml(String(w.max_score))}` : ""}</span>`
      : "";

/** Блок на главной ученика — сразу под приветствием. */
export function checkedHomeHtml(works = []) {
  const list = pendingChecked(works);
  if (!list.length) return "";
  const fresh = list.filter((w) => !w.seen_at).length;
  return `<section class="me-section wv-home${fresh ? " has-new" : ""}" id="me-checked">
    <h2 class="me-label">${fresh ? `📬 Преподаватель проверил: ${fresh} — посмотри пометки` : "Проверено — посмотри и убери в архив"}</h2>
    <div class="me-rows card">${list
      .slice(0, 6)
      .map(
        (w) => `<a class="me-row${w.seen_at ? "" : " is-new"}" href="#/me/work/${w.id}">
          <span class="me-row-main"><strong>${w.seen_at ? "" : '<span class="wv-new">новое</span> '}${escapeHtml(workTitle(w))}</strong>
          <span class="muted">${w.status === "returned" ? "Вернули на доработку — посмотри пометки и исправь" : w.seen_at ? "Открывал(а). Если всё понятно — убери в архив" : "Красные пометки, баллы и комментарий — открой работу"}</span></span>
          ${scoreChip(w)}<span class="me-rec-go" aria-hidden="true">›</span>
        </a>`
      )
      .join("")}</div>
    <p class="wv-home-more"><a href="#/me/profile#works">Все работы и архив →</a></p>
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Плашка на любой странице                                             */
/* ------------------------------------------------------------------ */

let noteCache = { at: 0, uid: null, rows: [] };
export function dropCheckedCache() {
  noteCache = { at: 0, uid: null, rows: [] };
}

/** Непросмотренные проверки: показываем плашку вверху страницы, пока ученик их не открыл. */
export async function mountCheckedNote(app) {
  const uid = currentUser()?.id;
  if (!uid || accessState() === "teacher") return;
  const h = location.hash;
  if (/^#\/(me\/work|me\/?$|me\?|lesson|exam|login)/.test(h) || h === "#/me" || h === "") return;
  if (noteCache.uid !== uid || Date.now() - noteCache.at > 120000) {
    const { data, error } = await supa
      .from("written_works")
      .select(SELECT)
      .eq("student_id", uid)
      .in("status", ["graded", "returned"])
      .is("seen_at", null)
      .order("reviewed_at", { ascending: false })
      .limit(5);
    if (error) return;
    noteCache = { at: Date.now(), uid, rows: data || [] };
  }
  const rows = noteCache.rows;
  const main = app.querySelector("#main .wrap");
  if (!rows.length || !main || main.querySelector(".wv-note")) return;
  const w = rows[0];
  main.insertAdjacentHTML(
    "afterbegin",
    `<a class="wv-note" href="#/me/work/${w.id}">
      <span class="wv-note-icon" aria-hidden="true">📬</span>
      <span><strong>${w.status === "returned" ? "Работу вернули на доработку" : "Работа проверена"}${rows.length > 1 ? ` (и ещё ${rows.length - 1})` : ""}</strong>
      <span>${escapeHtml(workTitle(w))} — посмотри красные пометки и комментарий преподавателя</span></span>
      <span class="wv-note-go">Открыть ›</span>
    </a>`
  );
}

/* ------------------------------------------------------------------ */
/* #/me/work/<id>                                                       */
/* ------------------------------------------------------------------ */

export async function mountWorkView(host, id) {
  if (!host) return;
  const { data: w, error } = await supa.from("written_works").select("*, tasks(source, bank_file, source_ref, task_no), lesson_items(lesson_id, lessons(title, kind))").eq("id", id).maybeSingle();
  if (error || !w) {
    host.innerHTML = `<div class="empty">${error ? escapeHtml(humanError(error).message) : "Работа не найдена."} <a href="#/me">На главную</a></div>`;
    return;
  }
  const mine = w.student_id === currentUser()?.id;
  if (!isChecked(w)) {
    host.innerHTML = `<div class="empty">Эта работа ещё не проверена. <a href="${workTaskHref(w)}">Открыть задание</a></div>`;
    return;
  }
  if (mine && !w.seen_at) {
    supa.rpc("work_seen", { p_id: w.id }).then(({ error: e }) => e && console.warn(e));
    w.seen_at = new Date().toISOString();
    dropCheckedCache();
  }
  const returned = w.status === "returned";
  const marks = w.annotations?.text || [];
  const photos = w.files || [];
  const typed = w.annotations?.typed?.path;
  const pages = typed ? [typed, ...photos] : photos;
  const marked = (p) => {
    const l = w.annotations?.photos?.[p];
    return l && ((l.strokes || []).length || (l.labels || []).length);
  };
  host.innerHTML = `
    <p class="wv-back"><a href="#/me">← На главную</a></p>
    <header class="wv-head">
      <p class="eyebrow">${returned ? "Вернули на доработку" : "Работа проверена"}${w.reviewed_at ? ` · ${new Date(w.reviewed_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}` : ""}</p>
      <h1>${escapeHtml(workTitle(w))}</h1>
      ${w.archived_at ? `<p class="muted">В архиве. <a href="${workTaskHref(w)}">Открыть задание</a></p>` : ""}
    </header>
    <div class="pr-review card wv-review">
      ${w.score != null ? `<p class="pr-score"><strong>${escapeHtml(String(w.score))}</strong>${w.max_score ? ` из ${escapeHtml(String(w.max_score))}` : ""} баллов</p>` : ""}
      ${w.criteria || !returned ? studentReviewHtml(w) : ""}
      ${w.teacher_comment ? `<p class="wv-sub">Комментарий преподавателя</p><p class="pr-comment">${escapeHtml(w.teacher_comment).replace(/\n/g, "<br>")}</p>` : ""}
    </div>
    ${marks.length ? `<h2 class="wv-h2">Твой текст с пометками</h2><div class="card rv-body">${markedTextHtml(w.body, marks)}</div>${marksListHtml(marks)}` : ""}
    ${!marks.length && w.body && !typed ? `<h2 class="wv-h2">Твой текст</h2><div class="card rv-body">${escapeHtml(w.body).replace(/\n/g, "<br>")}</div>` : ""}
    ${
      pages.length
        ? `<h2 class="wv-h2">${pages.some(marked) ? "Страницы с пометками преподавателя" : "Страницы работы"}</h2>
           <p class="muted">Нажми на страницу, чтобы открыть её крупно.</p>
           <div class="pr-photos">${pages
             .map(
               (p, i) =>
                 /\.pdf$/i.test(p)
                   ? `<figure class="pr-photo pr-photo-pdf" data-pdf="${escapeHtml(p)}"><a class="pr-pdf" href="#" target="_blank" rel="noopener">PDF</a><figcaption>Страница ${i + 1}</figcaption></figure>`
                   : `<figure class="pr-photo${marked(p) ? " wv-marked" : ""}" data-path="${escapeHtml(p)}"><canvas></canvas>
                      <figcaption>${p === typed ? "Твой текст, пометки ручкой" : `Страница ${i + 1 - (typed ? 1 : 0)}`}${marked(p) ? " · <b>с пометками</b>" : ""}
                      <button type="button" class="linklike" data-dl>скачать</button></figcaption></figure>`
             )
             .join("")}</div>`
        : ""
    }
    ${
      mine
        ? `<div class="wv-done card">
        ${
          returned
            ? `<p><strong>Что дальше:</strong> исправь работу по пометкам и сдай её снова.</p>
               <p class="actions"><a class="btn" href="${workTaskHref(w)}">Исправить и сдать снова</a></p>`
            : w.archived_at
              ? `<p>Работа в архиве. Её всегда можно найти в профиле — «Письменные работы».</p><p class="actions"><a class="btn secondary" href="#/me">На главную</a></p>`
              : `<p><strong>Посмотрел(а) все пометки?</strong> Убери работу в архив — она пропадёт с главной, но останется в профиле.</p>
                 <p class="actions"><button type="button" class="btn" id="wv-archive">Всё понятно — в архив</button>
                 <a class="btn secondary" href="${workTaskHref(w)}">Открыть задание</a></p>
                 <p class="lit-result" id="wv-status"></p>`
        }
      </div>`
        : ""
    }`;

  host.querySelectorAll(".pr-photo[data-path]").forEach(async (fig) => {
    const p = fig.dataset.path;
    const canvas = fig.querySelector("canvas");
    try {
      await renderPhoto(canvas, await signedFileUrl(p), w.annotations?.photos?.[p]);
    } catch {
      canvas.replaceWith(Object.assign(document.createElement("p"), { className: "muted", textContent: "Фото не загрузилось" }));
      return;
    }
    fig.querySelector("[data-dl]")?.addEventListener("click", () => downloadCanvas(canvas, `stranica-${p.split("/").pop().replace(/\.[a-z]+$/i, "")}.jpg`));
    canvas.addEventListener("click", () => window.open(canvas.toDataURL("image/jpeg", 0.9), "_blank"));
  });
  host.querySelectorAll(".pr-photo[data-pdf]").forEach(async (fig) => {
    try {
      fig.querySelector("a").href = await signedFileUrl(fig.dataset.pdf);
    } catch {}
  });
  host.querySelector("#wv-archive")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    const { error: err } = await supa.rpc("work_seen", { p_id: w.id, p_archive: true });
    const st = host.querySelector("#wv-status");
    if (err) {
      e.target.disabled = false;
      st.className = "lit-result is-bad";
      st.textContent = humanError(err).message;
      return;
    }
    dropCheckedCache();
    location.hash = "#/me";
  });
}
