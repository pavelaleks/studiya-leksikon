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
import { MARKS, RUBRICS, applyRules, countWords, rubricFor } from "./rubrics.js?v=land194";

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

const INK = { red: "#d0021b", green: "#1f7a3a", blue: "#1f4fa8" };
const LABEL_FONT = "Manrope, Arial, sans-serif";

/** Толщина пера: s.w — 1 (обычная) или 0.6 (тонкая); у точки третье число — нажим 0…1. */
function strokeWidth(s, base, p = null) {
  const k = s.w || 1;
  if (s.tool === "marker") return 18 * base;
  return 3.2 * base * k * (p == null ? 1 : 0.45 + 1.1 * p);
}

/** Линия по точкам — сглаженная (кривые через середины отрезков), чтобы волна и почерк выглядели как рукой. */
function drawStroke(ctx, s, w, h, base) {
  const pts = s.pts || [];
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.tool === "marker" ? "rgba(255, 214, 0, 0.38)" : INK[s.c] || INK.red;
  const P = pts.map(([x, y, pr]) => [x * w, y * h, pr]);
  if (P.length === 1) {
    ctx.lineWidth = strokeWidth(s, base, P[0][2] ?? null);
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    ctx.lineTo(P[0][0] + 0.5, P[0][1] + 0.5);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const pressure = s.tool !== "marker" && P[0][2] != null;
  if (!pressure) {
    ctx.lineWidth = strokeWidth(s, base);
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length - 1; i++) {
      const m = mid(P[i], P[i + 1]);
      ctx.quadraticCurveTo(P[i][0], P[i][1], m[0], m[1]);
    }
    ctx.lineTo(P.at(-1)[0], P.at(-1)[1]);
    ctx.stroke();
  } else {
    // с нажимом — по кусочкам, у каждого своя толщина
    let from = P[0];
    for (let i = 1; i < P.length; i++) {
      const to = i < P.length - 1 ? mid(P[i], P[i + 1]) : P[i];
      ctx.lineWidth = strokeWidth(s, base, ((P[i - 1][2] ?? 0.5) + (P[i][2] ?? 0.5)) / 2);
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      ctx.quadraticCurveTo(P[i][0], P[i][1], to[0], to[1]);
      ctx.stroke();
      from = to;
    }
  }
  ctx.restore();
}

/** Размер и шрифт надписи. Пометки на полях (О, П, Г…) — крупнее и жирнее. */
function labelFont(l, base) {
  const size = (l.k === "mark" ? 34 : 24) * (l.s || 1) * base;
  return { size, font: `${l.k === "mark" ? 800 : 600} ${size}px ${LABEL_FONT}` };
}

function labelBox(ctx, l, w, h, base) {
  const { size, font } = labelFont(l, base);
  ctx.font = font;
  const lines = String(l.text || "").split("\n");
  const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const x = Math.max(4 * base, Math.min(l.x * w, w - widest - 8 * base));
  return { x, y: l.y * h, wd: widest, ht: lines.length * size * 1.2, size, lines, font };
}

function drawLabel(ctx, l, w, h, base) {
  ctx.save();
  const b = labelBox(ctx, l, w, h, base);
  ctx.font = b.font;
  ctx.textBaseline = "top";
  ctx.fillStyle = INK[l.c] || INK.red;
  b.lines.forEach((line, k) => ctx.fillText(line, b.x, b.y + k * b.size * 1.2));
  ctx.restore();
}

function drawOverlay(ctx, w, h, layer = {}) {
  const base = Math.max(w, h) / 1000;
  (layer.strokes || []).forEach((s) => drawStroke(ctx, s, w, h, base));
  (layer.labels || []).forEach((l) => drawLabel(ctx, l, w, h, base));
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
 * Редактор пометок на фото: ручка (красная / зелёная, обычная / тонкая), маркер, надписи,
 * пометки на полях (О, П, Г, Р…), ластик, отмена и возврат, масштаб.
 * Линия рисуется на отдельном прозрачном слое по мере движения пера — без перерисовки фото,
 * поэтому волнистые линии и почерк не «выпрямляются». Двумя пальцами — масштаб и сдвиг,
 * при работе стилусом одним пальцем можно двигать страницу.
 * Возвращает Promise с новым слоем (или null, если закрыли без сохранения).
 */
const MARGIN_MARKS = [
  ["О", "орфография"],
  ["П", "пунктуация"],
  ["Г", "грамматика"],
  ["Р", "речь"],
  ["Ф", "факт"],
  ["Л", "логика"],
  ["V", "пропуск"],
  ["?", "неясно"],
  ["✓", "верно"],
];

export function openPhotoEditor(url, layer = {}) {
  return new Promise(async (resolve) => {
    const state = { strokes: [...(layer.strokes || [])], labels: [...(layer.labels || [])] };
    const undo = [];
    const redo = [];
    let tool = "pen";
    let color = "red";
    let thin = false;
    let mark = "О";
    let zoom = 1;
    const wrap = document.createElement("div");
    wrap.className = "rv-editor";
    wrap.innerHTML = `
      <div class="rv-toolbar" role="toolbar" aria-label="Инструменты проверки">
        <span class="rv-group">
          <button type="button" data-tool="pen" class="is-on" title="Ручка (линии, волна, подписи от руки)">✎ Ручка</button>
          <button type="button" data-tool="marker" title="Выделить маркером">▍Маркер</button>
          <button type="button" data-tool="text" title="Нажмите на фото и напечатайте">T Текст</button>
          <button type="button" data-tool="mark" title="Пометка на полях: выберите букву и нажмите на фото">О П Г</button>
          <button type="button" data-tool="eraser" title="Стереть линию или надпись (или обратный конец пера)">⌫ Ластик</button>
        </span>
        <span class="rv-group rv-opts">
          <button type="button" data-color="red" class="rv-sw is-on" title="Красный" aria-label="Красный цвет"><i style="background:${INK.red}"></i></button>
          <button type="button" data-color="green" class="rv-sw" title="Зелёный — отметить удачное" aria-label="Зелёный цвет"><i style="background:${INK.green}"></i></button>
          <button type="button" data-thin title="Тонкое перо — для подписей мелким почерком">Тонко</button>
        </span>
        <span class="rv-group">
          <button type="button" data-act="undo" title="Отменить (Ctrl+Z)" aria-label="Отменить">↶</button>
          <button type="button" data-act="redo" title="Вернуть (Ctrl+Shift+Z)" aria-label="Вернуть">↷</button>
          <button type="button" data-act="zoom-out" title="Уменьшить" aria-label="Уменьшить">−</button>
          <button type="button" data-act="zoom-fit" title="По ширине экрана" class="rv-zoom">100%</button>
          <button type="button" data-act="zoom-in" title="Увеличить" aria-label="Увеличить">+</button>
          <button type="button" data-act="clear" title="Убрать все пометки">Очистить</button>
        </span>
        <span class="rv-spacer"></span>
        <button type="button" data-act="cancel">Закрыть</button>
        <button type="button" data-act="save" class="rv-save">Сохранить пометки</button>
        <div class="rv-marks" hidden>${MARGIN_MARKS.map(([m, t]) => `<button type="button" data-mark="${m}" title="${t}" class="${m === mark ? "is-on" : ""}"><b>${m}</b><small>${t}</small></button>`).join("")}</div>
      </div>
      <div class="rv-stage"><div class="rv-sheet"><canvas class="rv-base"></canvas><canvas class="rv-live"></canvas></div><p class="muted rv-loading">Загружаем фото…</p></div>`;
    document.body.appendChild(wrap);
    document.body.classList.add("rv-lock");
    const stage = wrap.querySelector(".rv-stage");
    const sheet = wrap.querySelector(".rv-sheet");
    const canvas = wrap.querySelector(".rv-base");
    const live = wrap.querySelector(".rv-live");
    const ctx = canvas.getContext("2d");
    const lctx = live.getContext("2d");
    let img;
    try {
      img = await loadImage(url);
    } catch (err) {
      wrap.querySelector(".rv-loading").textContent = err.message;
      return;
    }
    wrap.querySelector(".rv-loading").remove();
    const W = (canvas.width = live.width = img.naturalWidth);
    const H = (canvas.height = live.height = img.naturalHeight);
    const base = Math.max(W, H) / 1000;
    const redraw = () => {
      ctx.drawImage(img, 0, 0);
      drawOverlay(ctx, W, H, state);
    };
    redraw();

    // ----- масштаб: ширина листа = ширина экрана × zoom
    const fitWidth = () => Math.min(stage.clientWidth - 24, (stage.clientHeight - 24) * (W / H) * 1.6, W);
    const applyZoom = (z, cx = null, cy = null) => {
      const old = sheet.getBoundingClientRect();
      zoom = Math.min(5, Math.max(0.5, z));
      sheet.style.width = `${Math.round(fitWidth() * zoom)}px`;
      wrap.querySelector(".rv-zoom").textContent = `${Math.round(zoom * 100)}%`;
      if (cx != null && old.width) {
        // держим точку под пальцами на месте
        const r = stage.getBoundingClientRect();
        const fx = (cx - old.left) / old.width;
        const fy = (cy - old.top) / old.height;
        const nw = sheet.offsetWidth;
        const nh = sheet.offsetHeight;
        stage.scrollLeft = fx * nw - (cx - r.left) + 12;
        stage.scrollTop = fy * nh - (cy - r.top) + 12;
      }
    };
    applyZoom(1);
    const onResize = () => applyZoom(zoom);
    window.addEventListener("resize", onResize);

    const point = (e) => {
      const r = canvas.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    };
    const push = (op) => {
      undo.push(op);
      redo.length = 0;
    };

    // ----- ластик
    const eraseAt = ([x, y]) => {
      const r = 0.012 / zoom;
      const ar = H / W;
      const goneS = state.strokes.filter((s) => s.pts.some(([px, py]) => Math.hypot(px - x, (py - y) * ar) < r));
      const goneL = state.labels.filter((l) => {
        const b = labelBox(ctx, l, W, H, base);
        return x * W >= b.x - 6 * base && x * W <= b.x + b.wd + 6 * base && y * H >= b.y - 6 * base && y * H <= b.y + b.ht + 6 * base;
      });
      if (!goneS.length && !goneL.length) return;
      state.strokes = state.strokes.filter((s) => !goneS.includes(s));
      state.labels = state.labels.filter((l) => !goneL.includes(l));
      push({ t: "erase", strokes: goneS, labels: goneL });
      redraw();
    };
    const labelAt = ([x, y]) =>
      [...state.labels].reverse().find((l) => {
        const b = labelBox(ctx, l, W, H, base);
        return x * W >= b.x - 8 * base && x * W <= b.x + b.wd + 8 * base && y * H >= b.y - 8 * base && y * H <= b.y + b.ht + 8 * base;
      });

    // ----- надпись: поле ввода прямо на фото
    let editor = null;
    const closeText = (commit) => {
      if (!editor) return;
      const { ta, label, before } = editor;
      editor = null;
      const text = ta.value.replace(/\s+$/, "");
      ta.remove();
      if (!commit) {
        if (label && before) Object.assign(label, before);
        redraw();
        return;
      }
      if (label) {
        if (!text.trim()) {
          state.labels = state.labels.filter((l) => l !== label);
          push({ t: "erase", strokes: [], labels: [label] });
        } else if (text !== before.text) {
          label.text = text;
          push({ t: "edit", label, before: { ...before }, after: { ...label } });
        }
      } else if (text.trim()) {
        const l = { x: editorPos.x, y: editorPos.y, text, c: color, ...(thin ? { s: 0.8 } : {}) };
        state.labels.push(l);
        push({ t: "add", label: l });
      }
      redraw();
    };
    let editorPos = { x: 0, y: 0 };
    const openText = (pt, label = null) => {
      closeText(true);
      editorPos = { x: label ? label.x : pt[0], y: label ? label.y : pt[1] };
      const ta = document.createElement("textarea");
      ta.className = "rv-textin";
      ta.rows = 1;
      ta.placeholder = "Напишите пометку";
      ta.value = label ? label.text : "";
      const r = canvas.getBoundingClientRect();
      const scale = r.width / W;
      const { size } = labelFont(label || { s: thin ? 0.8 : 1 }, base);
      ta.style.left = `${editorPos.x * sheet.offsetWidth}px`;
      ta.style.top = `${editorPos.y * sheet.offsetHeight}px`;
      ta.style.fontSize = `${Math.max(14, size * scale)}px`;
      ta.style.color = INK[(label && label.c) || color] || INK.red;
      sheet.appendChild(ta);
      editor = { ta, label, before: label ? { ...label } : null };
      if (label) {
        // пока редактируем — прячем старую надпись
        label.text = "";
        redraw();
        label.text = editor.before.text;
      }
      const grow = () => {
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight}px`;
        ta.style.width = "auto";
        ta.style.width = `${Math.min(sheet.offsetWidth * 0.9, Math.max(160, ta.scrollWidth + 12))}px`;
      };
      ta.addEventListener("input", grow);
      ta.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          closeText(true);
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          closeText(false);
        }
      });
      ta.addEventListener("blur", () => setTimeout(() => editor?.ta === ta && closeText(true), 0));
      grow();
      setTimeout(() => ta.focus(), 0);
    };

    // ----- перо: точки собираем все, рисуем кусочками на прозрачном слое
    let current = null;
    let erasing = false;
    let penSeen = false;
    const touches = new Map();
    let gesture = null;
    const drawLiveTail = () => {
      const P = current.pts;
      const n = P.length;
      if (n < 2) return;
      const s = current;
      const px = (p) => [p[0] * W, p[1] * H];
      const a = n >= 3 ? [(P[n - 3][0] + P[n - 2][0]) / 2, (P[n - 3][1] + P[n - 2][1]) / 2] : P[0];
      const c = P[n - 2];
      const b = [(P[n - 2][0] + P[n - 1][0]) / 2, (P[n - 2][1] + P[n - 1][1]) / 2];
      lctx.save();
      lctx.lineCap = "round";
      lctx.lineJoin = "round";
      lctx.strokeStyle = s.tool === "marker" ? "rgba(255, 214, 0, 0.38)" : INK[s.c] || INK.red;
      lctx.lineWidth = strokeWidth(s, base, c[2] ?? null);
      if (s.tool === "marker") {
        // маркер полупрозрачный: перерисовываем целиком, чтобы не было пятен в местах наложения
        lctx.clearRect(0, 0, W, H);
        drawStroke(lctx, s, W, H, base);
      } else {
        lctx.beginPath();
        lctx.moveTo(...px(a));
        lctx.quadraticCurveTo(...px(c), ...px(b));
        lctx.stroke();
      }
      lctx.restore();
    };
    const startGesture = () => {
      const [p1, p2] = [...touches.values()];
      gesture = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), z: zoom, mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2, sl: stage.scrollLeft, st: stage.scrollTop };
    };
    live.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (e.pointerType === "pen") penSeen = true;
      if (e.pointerType === "touch") {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { live.setPointerCapture(e.pointerId); } catch {}
        if (touches.size === 2) {
          // второй палец — это масштаб, а не линия
          if (current && current.touch) {
            current = null;
            lctx.clearRect(0, 0, W, H);
          }
          startGesture();
          return;
        }
        // работаете стилусом — одним пальцем двигаем страницу
        if (penSeen) {
          gesture = { pan: true, x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
          return;
        }
      }
      if (editor) {
        closeText(true);
        if (tool === "text") return;
      }
      const pt = point(e);
      if (tool === "eraser" || (e.pointerType === "pen" && (e.buttons & 32 || e.button === 5))) {
        erasing = true;
        try { live.setPointerCapture(e.pointerId); } catch {}
        eraseAt(pt);
        return;
      }
      if (tool === "text") {
        openText(pt, labelAt(pt));
        return;
      }
      if (tool === "mark") {
        const l = { x: pt[0], y: Math.max(0, pt[1] - 0.012), text: mark, k: "mark", c: mark === "✓" ? "green" : color };
        state.labels.push(l);
        push({ t: "add", label: l });
        redraw();
        return;
      }
      try { live.setPointerCapture(e.pointerId); } catch {}
      const withPressure = tool === "pen" && e.pointerType === "pen" && e.pressure > 0;
      const pt3 = (ev) => (withPressure ? [...point(ev), Math.round(Math.min(1, ev.pressure || 0.5) * 100) / 100] : point(ev));
      current = { tool, pts: [pt3(e)], pt: pt3, touch: e.pointerType === "touch", id: e.pointerId };
      if (tool === "pen") {
        current.c = color;
        if (thin) current.w = 0.6;
      }
    });
    live.addEventListener("pointermove", (e) => {
      if (touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (gesture && touches.size === 2) {
          const [p1, p2] = [...touches.values()];
          const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          const mx = (p1.x + p2.x) / 2;
          const my = (p1.y + p2.y) / 2;
          applyZoom(gesture.z * (d / gesture.d), mx, my);
          stage.scrollLeft += gesture.mx - mx;
          stage.scrollTop += gesture.my - my;
          gesture.mx = mx;
          gesture.my = my;
          return;
        }
        if (gesture?.pan) {
          stage.scrollLeft = gesture.sl - (e.clientX - gesture.x);
          stage.scrollTop = gesture.st - (e.clientY - gesture.y);
          return;
        }
      }
      if (erasing) return eraseAt(point(e));
      if (!current || e.pointerId !== current.id) return;
      const many = e.getCoalescedEvents?.();
      (many && many.length ? many : [e]).forEach((ev) => {
        const p = current.pt(ev);
        const last = current.pts.at(-1);
        // совсем близкие точки не нужны: меньше «дрожи» и лёгкие данные
        if (Math.hypot((p[0] - last[0]) * W, (p[1] - last[1]) * H) < 1.2 * base) return;
        current.pts.push(p);
        drawLiveTail();
      });
    });
    const end = (e) => {
      if (touches.has(e.pointerId)) {
        touches.delete(e.pointerId);
        if (touches.size < 2 && gesture && !gesture.pan) gesture = null;
        if (gesture?.pan && !touches.size) gesture = null;
      }
      erasing = false;
      if (!current || (e && e.pointerId !== current.id)) return;
      const s = current;
      current = null;
      delete s.pt;
      delete s.touch;
      delete s.id;
      s.pts = s.pts.map(([x, y, pr]) => (pr == null ? [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000] : [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000, pr]));
      state.strokes.push(s);
      push({ t: "add", stroke: s });
      lctx.clearRect(0, 0, W, H);
      drawStroke(ctx, s, W, H, base);
    };
    live.addEventListener("pointerup", end);
    live.addEventListener("pointercancel", end);

    // ----- отмена / возврат
    const apply = (op, back) => {
      if (op.t === "add") {
        if (op.stroke) state.strokes = back ? state.strokes.filter((x) => x !== op.stroke) : [...state.strokes, op.stroke];
        if (op.label) state.labels = back ? state.labels.filter((x) => x !== op.label) : [...state.labels, op.label];
      } else if (op.t === "erase") {
        if (back) {
          state.strokes.push(...op.strokes);
          state.labels.push(...op.labels);
        } else {
          state.strokes = state.strokes.filter((x) => !op.strokes.includes(x));
          state.labels = state.labels.filter((x) => !op.labels.includes(x));
        }
      } else if (op.t === "edit") {
        Object.assign(op.label, back ? op.before : op.after);
      } else if (op.t === "clear") {
        if (back) {
          state.strokes = op.strokes;
          state.labels = op.labels;
        } else {
          state.strokes = [];
          state.labels = [];
        }
      }
      redraw();
    };
    const doUndo = () => {
      closeText(true);
      const op = undo.pop();
      if (op) {
        apply(op, true);
        redo.push(op);
      }
    };
    const doRedo = () => {
      const op = redo.pop();
      if (op) {
        apply(op, false);
        undo.push(op);
      }
    };
    const onKey = (e) => {
      if (editor) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
      }
    };
    document.addEventListener("keydown", onKey);

    const close = (result) => {
      closeText(true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      wrap.remove();
      document.body.classList.remove("rv-lock");
      resolve(result);
    };
    const marksBar = wrap.querySelector(".rv-marks");
    wrap.querySelectorAll("[data-tool]").forEach((b) =>
      b.addEventListener("click", () => {
        closeText(true);
        tool = b.dataset.tool;
        wrap.querySelectorAll("[data-tool]").forEach((x) => x.classList.toggle("is-on", x === b));
        marksBar.hidden = tool !== "mark";
        live.style.cursor = tool === "text" ? "text" : tool === "eraser" ? "cell" : tool === "mark" ? "copy" : "crosshair";
      })
    );
    wrap.querySelectorAll("[data-mark]").forEach((b) =>
      b.addEventListener("click", () => {
        mark = b.dataset.mark;
        wrap.querySelectorAll("[data-mark]").forEach((x) => x.classList.toggle("is-on", x === b));
      })
    );
    wrap.querySelectorAll("[data-color]").forEach((b) =>
      b.addEventListener("click", () => {
        color = b.dataset.color;
        wrap.querySelectorAll("[data-color]").forEach((x) => x.classList.toggle("is-on", x === b));
        if (tool === "marker" || tool === "eraser") wrap.querySelector('[data-tool="pen"]').click();
      })
    );
    wrap.querySelector("[data-thin]").addEventListener("click", (e) => {
      thin = !thin;
      e.currentTarget.classList.toggle("is-on", thin);
    });
    wrap.querySelector('[data-act="undo"]').addEventListener("click", doUndo);
    wrap.querySelector('[data-act="redo"]').addEventListener("click", doRedo);
    wrap.querySelector('[data-act="zoom-in"]').addEventListener("click", () => applyZoom(zoom * 1.25));
    wrap.querySelector('[data-act="zoom-out"]').addEventListener("click", () => applyZoom(zoom / 1.25));
    wrap.querySelector('[data-act="zoom-fit"]').addEventListener("click", () => applyZoom(1));
    wrap.querySelector('[data-act="clear"]').addEventListener("click", () => {
      if (!state.strokes.length && !state.labels.length) return;
      if (!confirm("Убрать все пометки с этого фото? Это можно отменить кнопкой ↶.")) return;
      push({ t: "clear", strokes: state.strokes, labels: state.labels });
      state.strokes = [];
      state.labels = [];
      redraw();
    });
    wrap.querySelector('[data-act="cancel"]').addEventListener("click", () => {
      if (undo.length && !confirm("Закрыть без сохранения? Новые пометки пропадут.")) return;
      close(null);
    });
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
        ? `<button type="button" class="rv-hint" data-code="${c.code}" data-val="${c.fromCount(n)}" title="Поставить балл по числу пометок в тексте">по пометкам: ${n} ош. → <b>${c.fromCount(n)}</b></button>`
        : "";
      const levels = [...c.levels].sort((x, y) => x[0] - y[0]);
      const max = Math.max(...levels.map((l) => l[0]));
      return `
        <div class="rv-crit" data-code="${c.code}">
          <div class="rv-crit-head"><span class="rv-code">${escapeHtml(c.code)}</span><span class="rv-name">${escapeHtml(c.name)}</span>${hint}</div>
          <div class="rv-seg" role="radiogroup" aria-label="${escapeHtml(`${c.code} ${c.name}`)}">
            ${levels
              .map(
                ([score, text]) =>
                  `<label title="${escapeHtml(`${score} — ${text}`)}"><input type="radio" name="crit-${c.code}" value="${score}" ${Number(val) === score ? "checked" : ""} /><span>${score}</span></label>`
              )
              .join("")}
            <span class="rv-max">из ${max}</span>
          </div>
          <p class="rv-desc">${levels.map(([score, text]) => `<span class="rv-d rv-d-${String(score).replace(".", "_")}">${escapeHtml(text)}</span>`).join("")}<span class="rv-d rv-d-none">Выберите балл</span></p>
        </div>`;
    })
    .join("");
  return `
    <div class="rv-crit-top">
      <label class="rv-rubric">Критерии<select name="rubric" id="rv-rubric">${options}</select></label>
      ${r.minWords ? `<p class="muted rv-words">${ctx.words ? `Слов: <b>${ctx.words}</b> · минимум ${r.minWords}${ctx.words < r.minWords ? " — меньше минимума" : ""}.` : `Работа на фото — объём проверьте сами (минимум ${r.minWords} слов).`}</p>` : ctx.words ? `<p class="muted rv-words">Слов: ${ctx.words}</p>` : ""}
    </div>
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
  const verdict = rubric?.verdict && rubric.criteria.every((c) => scores[c.code] !== undefined) ? rubric.verdict(Object.fromEntries(rubric.criteria.map((c) => [c.code, Number(scores[c.code])]))) : "";
  return `
    ${rubric ? `<p class="muted">${escapeHtml(rubric.title)}</p>` : ""}
    ${verdict ? `<p class="rv-verdict"><b>${escapeHtml(verdict)}</b></p>` : ""}
    ${rows ? `<div class="t-table-wrap"><table class="t-table rv-table"><tbody>${rows}</tbody></table></div>` : ""}
    ${(crit.fired || []).length ? `<p class="rv-fired">${crit.fired.map(escapeHtml).join("<br>")}</p>` : ""}
    ${marks.length ? `<p class="muted">Пометки в тексте: ${legend || "—"}. Выделенные места и комментарии к ним — в тексте и списке ниже.</p>` : ""}`;
}

export { rubricFor, countWords };
