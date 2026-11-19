/**
 * Проверка письменных работ.
 *  Преподаватель: пометки в тексте (тип ошибки + комментарий), красная ручка и надписи на фото,
 *  оценивание по критериям ФИПИ 2027 с автоматическими правилами.
 *  Ученик: та же работа с пометками (только просмотр), баллы по критериям, комментарий.
 *
 * annotations = { text: [{start, end, type, note}], photos: { "<путь>": { strokes: [...], labels: [...] } } }
 * Координаты на фото — доли ширины/высоты (0…1), чтобы не зависеть от размера экрана.
 */
import { escapeHtml } from "./ui.js";
import { MARKS, RUBRICS, applyRules, countWords, rubricFor } from "./rubrics.js?v=land161";

/* ------------------------------------------------------------------ */
/* Текст с пометками                                                    */
/* ------------------------------------------------------------------ */

export function markedTextHtml(body, marks = []) {
  const text = String(body || "");
  const list = [...marks].map((m, i) => ({ ...m, i })).sort((a, b) => a.start - b.start);
  let pos = 0;
  let out = "";
  list.forEach((m) => {
    if (m.start < pos || m.end > text.length || m.end <= m.start) return;
    out += escapeHtml(text.slice(pos, m.start));
    const t = MARKS[m.type] || MARKS.note;
    out += `<mark class="rv-m rv-${escapeHtml(m.type)}" data-i="${m.i}" title="${escapeHtml(t.title + (m.note ? `: ${m.note}` : ""))}">${escapeHtml(
      text.slice(m.start, m.end)
    )}<sup class="rv-tag">${escapeHtml(t.label)}</sup></mark>`;
    pos = m.end;
  });
  out += escapeHtml(text.slice(pos));
  return out;
}

export function marksListHtml(marks = [], { editable = false } = {}) {
  if (!marks.length) return "";
  return `<ol class="rv-notes">${marks
    .map((m, i) => ({ ...m, i }))
    .sort((a, b) => a.start - b.start)
    .map((m) => {
      const t = MARKS[m.type] || MARKS.note;
      return `<li data-i="${m.i}"><span class="rv-chip rv-${escapeHtml(m.type)}">${escapeHtml(t.label)}</span> «${escapeHtml(m.quote || "")}»${
        m.note ? ` — ${escapeHtml(m.note)}` : ""
      }${editable ? ` <button type="button" class="linklike" data-del="${m.i}">убрать</button>` : ""}</li>`;
    })
    .join("")}</ol>`;
}

export function countMarks(marks = []) {
  const c = {};
  marks.forEach((m) => (c[m.type] = (c[m.type] || 0) + 1));
  return c;
}

/* ------------------------------------------------------------------ */
/* Фото с пометками                                                    */
/* ------------------------------------------------------------------ */

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось загрузить фото"));
    img.src = url;
  });
}

function drawOverlay(ctx, w, h, layer = {}) {
  const base = Math.max(w, h) / 1000;
  (layer.strokes || []).forEach((s) => {
    if (!s.pts?.length) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = s.tool === "marker" ? "rgba(255, 214, 0, 0.38)" : "#d0021b";
    ctx.lineWidth = (s.tool === "marker" ? 18 : 3.2) * base;
    // перо с нажимом: у точки третье число — сила нажатия (0…1), толщина меняется по ходу линии
    if (s.tool !== "marker" && s.pts.length > 1 && s.pts[0].length === 3) {
      for (let i = 1; i < s.pts.length; i += 1) {
        const [x0, y0, p0] = s.pts[i - 1];
        const [x1, y1, p1] = s.pts[i];
        ctx.lineWidth = 3.2 * base * (0.45 + 1.1 * ((p0 + p1) / 2));
        ctx.beginPath();
        ctx.moveTo(x0 * w, y0 * h);
        ctx.lineTo(x1 * w, y1 * h);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * w + 0.5, s.pts[0][1] * h + 0.5);
    ctx.stroke();
    ctx.restore();
  });
  (layer.labels || []).forEach((l) => {
    const size = 26 * base;
    ctx.save();
    ctx.font = `bold ${size}px Manrope, Arial, sans-serif`;
    ctx.textBaseline = "top";
    const lines = String(l.text || "").split("\n");
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    // надпись у правого края сдвигаем внутрь страницы
    const x0 = Math.max(4 * base, Math.min(l.x * w, w - widest - 8 * base));
    lines.forEach((line, k) => {
      const x = x0;
      const y = l.y * h + k * size * 1.2;
      ctx.lineWidth = 5 * base;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeText(line, x, y);
      ctx.fillStyle = "#d0021b";
      ctx.fillText(line, x, y);
    });
    ctx.restore();
  });
}

/** Нарисовать фото с пометками в canvas (только просмотр). */
export async function renderPhoto(canvas, url, layer) {
  const img = await loadImage(url);
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  drawOverlay(ctx, canvas.width, canvas.height, layer);
  return canvas;
}

/**
 * Напечатанный текст ученика — страницей «как в тетради» (JPEG), чтобы проверять его пером так же, как фото.
 * Страницу рисуем один раз и сохраняем файлом: пометки привязаны к картинке и не съедут на другом экране.
 */
export async function textPageBlob(body, heading = "") {
  const W = 1240;
  const pad = 110;
  const font = 'Georgia, "PT Serif", "Times New Roman", serif';
  const size = 32;
  const lh = 54;
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = `${size}px ${font}`;
  const lines = [];
  String(body || "")
    .replace(/\r/g, "")
    .split("\n")
    .forEach((para) => {
      if (!para.trim()) return lines.push("");
      let line = "";
      para.split(/\s+/).forEach((word) => {
        const next = line ? `${line} ${word}` : word;
        if (probe.measureText(next).width > W - pad - 70 && line) {
          lines.push(line);
          line = word;
        } else line = next;
      });
      lines.push(line);
    });
  const top = heading ? 150 : 90;
  const H = Math.max(1754, top + lines.length * lh + 120);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fffdf7";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(90, 140, 200, 0.28)";
  ctx.lineWidth = 1.5;
  for (let y = top + lh - 12; y < H - 40; y += lh) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(208, 2, 27, 0.35)";
  ctx.beginPath();
  ctx.moveTo(pad - 24, 0);
  ctx.lineTo(pad - 24, H);
  ctx.stroke();
  ctx.fillStyle = "#1d1a17";
  if (heading) {
    ctx.font = `bold 30px ${font}`;
    ctx.fillText(heading, pad, 90);
  }
  ctx.font = `${size}px ${font}`;
  lines.forEach((line, i) => ctx.fillText(line, pad, top + (i + 1) * lh - 24));
  return new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.88));
}

export function downloadCanvas(canvas, name) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/jpeg", 0.9);
}

/**
 * Редактор пометок на фото: красная ручка, жёлтый маркер, надписи, отмена.
 * Возвращает Promise с новым слоем (или null, если закрыли без сохранения).
 */
export function openPhotoEditor(url, layer = {}) {
  return new Promise(async (resolve) => {
    const state = { strokes: [...(layer.strokes || [])], labels: [...(layer.labels || [])] };
    const history = [];
    let tool = "pen";
    const wrap = document.createElement("div");
    wrap.className = "rv-editor";
    wrap.innerHTML = `
      <div class="rv-toolbar">
        <button type="button" data-tool="pen" class="is-on" title="Красная ручка">✎ Ручка</button>
        <button type="button" data-tool="marker" title="Выделить маркером">▍Маркер</button>
        <button type="button" data-tool="text" title="Нажмите на фото, чтобы написать">T Текст</button>
        <button type="button" data-tool="eraser" title="Стереть линию или надпись (или переверните перо)">⌫ Ластик</button>
        <button type="button" data-act="undo" title="Отменить последнее">↶ Отменить</button>
        <button type="button" data-act="clear">Очистить</button>
        <span class="rv-spacer"></span>
        <button type="button" data-act="cancel">Закрыть</button>
        <button type="button" data-act="save" class="rv-save">Сохранить пометки</button>
      </div>
      <div class="rv-stage"><canvas></canvas><p class="muted rv-loading">Загружаем фото…</p></div>`;
    document.body.appendChild(wrap);
    document.body.classList.add("rv-lock");
    const canvas = wrap.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    let img;
    try {
      img = await loadImage(url);
    } catch (err) {
      wrap.querySelector(".rv-loading").textContent = err.message;
      return;
    }
    wrap.querySelector(".rv-loading").remove();
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const redraw = (live) => {
      ctx.drawImage(img, 0, 0);
      drawOverlay(ctx, canvas.width, canvas.height, live ? { strokes: [...state.strokes, live], labels: state.labels } : state);
    };
    redraw();
    const point = (e) => {
      const r = canvas.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    };
    let current = null;
    let erasing = false;
    let penSeen = false;
    // ластик: убрать линии и надписи рядом с точкой (отмена вернёт их)
    const eraseAt = ([x, y]) => {
      const r = 0.012;
      const goneS = state.strokes.filter((s) => s.pts.some(([px, py]) => Math.hypot(px - x, (py - y) * (canvas.height / canvas.width)) < r));
      const goneL = state.labels.filter((l) => Math.hypot(l.x - x, (l.y - y) * (canvas.height / canvas.width)) < r * 3);
      if (!goneS.length && !goneL.length) return;
      state.strokes = state.strokes.filter((s) => !goneS.includes(s));
      state.labels = state.labels.filter((l) => !goneL.includes(l));
      history.push({ erased: goneS, labels: goneL });
      redraw();
    };
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (e.pointerType === "pen") penSeen = true;
      // работаете пером — касания ладони и пальцев не рисуют
      if (penSeen && e.pointerType === "touch") return;
      if (tool === "eraser" || (e.pointerType === "pen" && (e.buttons & 32 || e.button === 5))) {
        erasing = true;
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        eraseAt(point(e));
        return;
      }
      if (tool === "text") {
        const text = prompt("Текст пометки на фото:");
        if (text && text.trim()) {
          const [x, y] = point(e);
          state.labels.push({ x, y, text: text.trim() });
          history.push("label");
          redraw();
        }
        return;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      const withPressure = tool === "pen" && e.pointerType === "pen" && e.pressure > 0;
      const pt = (ev) => (withPressure ? [...point(ev), Math.round(Math.min(1, ev.pressure || 0.5) * 100) / 100] : point(ev));
      current = { tool, pts: [pt(e)], pt };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (erasing) return eraseAt(point(e));
      if (!current) return;
      const many = e.getCoalescedEvents?.();
      (many && many.length ? many : [e]).forEach((ev) => current.pts.push(current.pt(ev)));
      redraw(current);
    });
    const end = () => {
      erasing = false;
      if (!current) return;
      delete current.pt;
      // прореживаем точки, чтобы данные были лёгкими
      current.pts = current.pts.filter((p, i, a) => i === 0 || i === a.length - 1 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.002);
      current.pts = current.pts.map(([x, y, pr]) => (pr == null ? [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000] : [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000, pr]));
      state.strokes.push(current);
      history.push("stroke");
      current = null;
      redraw();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    const close = (result) => {
      wrap.remove();
      document.body.classList.remove("rv-lock");
      resolve(result);
    };
    wrap.querySelectorAll("[data-tool]").forEach((b) =>
      b.addEventListener("click", () => {
        tool = b.dataset.tool;
        wrap.querySelectorAll("[data-tool]").forEach((x) => x.classList.toggle("is-on", x === b));
        canvas.style.cursor = tool === "text" ? "text" : tool === "eraser" ? "cell" : "crosshair";
      })
    );
    wrap.querySelector('[data-act="undo"]').addEventListener("click", () => {
      const last = history.pop();
      if (last === "stroke") state.strokes.pop();
      if (last === "label") state.labels.pop();
      if (last && typeof last === "object") {
        state.strokes.push(...last.erased);
        state.labels.push(...last.labels);
      }
      if (!last) {
        // отменяем то, что было до открытия редактора
        if (state.labels.length) state.labels.pop();
        else state.strokes.pop();
      }
      redraw();
    });
    wrap.querySelector('[data-act="clear"]').addEventListener("click", () => {
      if (!confirm("Убрать все пометки с этого фото?")) return;
      state.strokes = [];
      state.labels = [];
      history.length = 0;
      redraw();
    });
    wrap.querySelector('[data-act="cancel"]').addEventListener("click", () => close(null));
    wrap.querySelector('[data-act="save"]').addEventListener("click", () => close(state));
  });
}

/* ------------------------------------------------------------------ */
/* Критерии                                                            */
/* ------------------------------------------------------------------ */

/** Форма выставления баллов по критериям. */
export function criteriaFormHtml(rubricId, saved = {}, ctx = {}) {
  const r = RUBRICS[rubricId] || RUBRICS.free;
  const counts = ctx.counts || {};
  const options = Object.entries(RUBRICS)
    .map(([k, v]) => `<option value="${k}" ${k === rubricId ? "selected" : ""}>${escapeHtml(v.title)}</option>`)
    .join("");
  const rows = r.criteria
    .map((c) => {
      const val = saved[c.code];
      const n = (c.errors || []).reduce((a, t) => a + (counts[t] || 0), 0);
      const hint = c.fromCount && (c.errors || []).length
        ? `<button type="button" class="linklike rv-hint" data-code="${c.code}" data-val="${c.fromCount(n)}">по пометкам: ${n} ош. → ${c.fromCount(n)}</button>`
        : "";
      return `
        <fieldset class="rv-crit" data-code="${c.code}">
          <legend><b>${escapeHtml(c.code)}</b> ${escapeHtml(c.name)} ${hint}</legend>
          ${c.levels
            .map(
              ([score, text]) =>
                `<label class="rv-level"><input type="radio" name="crit-${c.code}" value="${score}" ${Number(val) === score ? "checked" : ""}/> <b>${score}</b> — ${escapeHtml(text)}</label>`
            )
            .join("")}
        </fieldset>`;
    })
    .join("");
  return `
    <label>Критерии<select name="rubric" id="rv-rubric">${options}</select></label>
    ${r.minWords ? `<p class="muted">Слов в работе: <b>${ctx.words ?? 0}</b> (минимум ${r.minWords}). Слова в фото не считаются — проверьте объём сами.</p>` : ctx.words != null ? `<p class="muted">Слов в работе: ${ctx.words}</p>` : ""}
    <div class="rv-crits">${rows}</div>
    <p class="rv-fired" id="rv-fired"></p>
    <p class="rv-total" id="rv-total"></p>`;
}

/** Собрать баллы из формы, применить правила, показать сумму. */
export function readCriteria(form, rubricId, ctx) {
  const r = RUBRICS[rubricId] || RUBRICS.free;
  const raw = {};
  r.criteria.forEach((c) => {
    const v = form.querySelector(`input[name="crit-${c.code}"]:checked`);
    if (v) raw[c.code] = Number(v.value);
  });
  const filled = r.criteria.every((c) => raw[c.code] !== undefined);
  const res = applyRules(rubricId, raw, ctx);
  return { ...res, raw, filled };
}

/* ------------------------------------------------------------------ */
/* Что видит ученик                                                     */
/* ------------------------------------------------------------------ */

export function studentReviewHtml(work) {
  const crit = work.criteria || {};
  const rubric = crit.rubric && RUBRICS[crit.rubric];
  const scores = crit.scores || (crit.rubric ? {} : crit);
  const rows = rubric
    ? rubric.criteria
        .map((c) => {
          const v = scores[c.code];
          const lvl = c.levels.find((l) => l[0] === Number(v));
          const max = Math.max(...c.levels.map((l) => l[0]));
          return `<tr><td><b>${escapeHtml(c.code)}</b> ${escapeHtml(c.name)}</td><td class="rv-sc">${v ?? "—"} / ${max}</td><td class="muted">${escapeHtml(lvl?.[1] || "")}</td></tr>`;
        })
        .join("")
    : Object.entries(scores)
        .map(([k, v]) => `<tr><td><b>${escapeHtml(k)}</b></td><td class="rv-sc">${escapeHtml(String(v))}</td><td></td></tr>`)
        .join("");
  const marks = work.annotations?.text || [];
  const counts = countMarks(marks);
  const legend = Object.entries(counts)
    .filter(([t]) => t !== "good" && t !== "note")
    .map(([t, n]) => `<span class="rv-chip rv-${escapeHtml(t)}">${escapeHtml(MARKS[t]?.label || t)}</span> ${n}`)
    .join(" · ");
  return `
    ${rubric ? `<p class="muted">${escapeHtml(rubric.title)}</p>` : ""}
    ${rows ? `<div class="t-table-wrap"><table class="t-table rv-table"><tbody>${rows}</tbody></table></div>` : ""}
    ${(crit.fired || []).length ? `<p class="rv-fired">${crit.fired.map(escapeHtml).join("<br>")}</p>` : ""}
    ${marks.length ? `<p class="muted">Пометки в тексте: ${legend || "—"}. Выделенные места и комментарии к ним — в тексте и списке ниже.</p>` : ""}`;
}

export { rubricFor, countWords };
