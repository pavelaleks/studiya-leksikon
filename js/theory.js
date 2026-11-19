// Теория к отдельным заданиям экзамена (таблица public.task_theory, текст в Markdown).
// Видна преподавателю и ученикам курса этого экзамена; гостю — только отметка, что теория есть.
import { supa, accessState } from "./supa.js";
import { escapeHtml } from "./ui.js";

const listCache = new Map();
const bodyCache = new Map();

/** Номера заданий, к которым есть теория. */
export async function theoryTasks(source) {
  if (!listCache.has(source)) {
    listCache.set(
      source,
      supa
        .rpc("theory_tasks", { p_source: source })
        .then(({ data }) => new Set((data || []).map(Number)))
        .catch(() => new Set())
    );
  }
  return listCache.get(source);
}

/** Текст теории или null, если её нет или она закрыта для этого пользователя. */
export async function theoryBody(source, no) {
  const key = `${source}:${no}`;
  if (!bodyCache.has(key)) {
    bodyCache.set(
      key,
      supa
        .from("task_theory")
        .select("body")
        .eq("source", source)
        .eq("task_no", Number(no))
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) throw error;
          return data?.body || null;
        })
    );
  }
  try {
    return await bodyCache.get(key);
  } catch (err) {
    bodyCache.delete(key);
    throw err;
  }
}

export function clearTheoryCache() {
  listCache.clear();
  bodyCache.clear();
}

function inline(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<i>$2</i>");
}

function cells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Простой Markdown → HTML: заголовки, списки, таблицы, абзацы, **жирный**, *курсив*. */
export function mdToHtml(md) {
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(4, h[1].length + 1);
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i += 1;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
      const [head, ...rest] = body;
      const hs = cells(head);
      out.push(
        `<div class="th-table"><table><thead><tr>${cells(head)
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${rest
          .map((r) => `<tr>${cells(r).map((c, k) => `<td data-label="${escapeHtml(hs[k] || "")}">${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      );
      continue;
    }
    const li = /^\s*(?:[-*]|\d+[.)])\s+/;
    if (li.test(line)) {
      const ordered = /^\s*\d/.test(line);
      // пункты с отступом (2+ пробела) — вложенный список внутри предыдущего пункта
      const items = [];
      while (i < lines.length && li.test(lines[i])) {
        const raw = lines[i++];
        const text = raw.replace(li, "");
        if (/^\s{2,}/.test(raw) && items.length) items[items.length - 1].sub.push(text);
        else items.push({ text, sub: [] });
      }
      const tag = ordered ? "ol" : "ul";
      out.push(
        `<${tag}>${items
          .map((t) => `<li>${inline(t.text)}${t.sub.length ? `<ul>${t.sub.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>` : ""}</li>`)
          .join("")}</${tag}>`
      );
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*(?:[-*]|\d+[.)])\s)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

export function theoryArticleHtml(md) {
  return `<div class="th-body">${mdToHtml(md)}</div>`;
}

/** Что показать, если теория не пришла: вход, ожидание доступа или «для курса ЕГЭ». */
export function theoryClosedHtml(courseName, backHref) {
  const st = accessState();
  if (st === "guest")
    return `<div class="gate card"><p class="eyebrow">Теория к заданию</p><h2>Открыта ученикам студии</h2><p>Войдите в личный кабинет, чтобы читать теорию к заданиям.</p><p class="actions"><a class="btn" href="#/login">Войти</a> <a class="btn secondary" href="${backHref}">Назад</a></p></div>`;
  if (st === "pending" || st === "paused" || st === "expired")
    return `<div class="gate card"><p class="eyebrow">Теория к заданию</p><h2>Пока недоступна</h2><p>Теория откроется, когда у вас будет действующий доступ к занятиям.</p><p class="actions"><a class="btn secondary" href="#/me">Личный кабинет</a></p></div>`;
  return `<div class="gate card"><p class="eyebrow">Теория к заданию</p><h2>Для учеников курса ${escapeHtml(courseName)}</h2><p>Эта теория открыта тем, кто готовится к этому экзамену. Если вам она нужна — напишите преподавателю.</p><p class="actions"><a class="btn secondary" href="${backHref}">Назад</a></p></div>`;
}
