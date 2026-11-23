/**
 * Настоящие имена учеников — только у преподавателя (таблица student_names, ученикам недоступна).
 * Ученики везде под псевдонимами; у преподавателя рядом с псевдонимом на странице появляется
 * подпись с настоящим именем (в тесных местах — только подсказка при наведении).
 * Работает поверх любых страниц: находит псевдонимы в тексте, поэтому новых мест вручную размечать не нужно.
 * Переключатель «Имена» в кабинете прячет подписи (например, когда экран видят ученики).
 */
import { escapeHtml } from "./ui.js";
import { supa } from "./supa.js";

const SHOW_KEY = "lx-realnames-show";
let byPseudo = new Map(); // псевдоним → { id, real }
let byId = new Map(); // id ученика → настоящее имя
let pattern = null;
let observer = null;
let loaded = null;

export const realNamesShown = () => {
  try {
    return localStorage.getItem(SHOW_KEY) !== "0";
  } catch {
    return true;
  }
};

export async function loadRealNames(force = false) {
  if (loaded && !force) return loaded;
  loaded = (async () => {
    const [{ data: names }, { data: people }] = await Promise.all([
      supa.from("student_names").select("student_id, real_name"),
      supa.from("profiles").select("id, full_name").neq("role", "teacher"),
    ]);
    byId = new Map((names || []).map((r) => [r.student_id, r.real_name]));
    byPseudo = new Map();
    (people || []).forEach((p) => {
      const pseudo = String(p.full_name || "").trim();
      const real = byId.get(p.id);
      if (pseudo.length >= 3 && real && real !== pseudo) byPseudo.set(pseudo, { id: p.id, real });
    });
    const keys = [...byPseudo.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    pattern = keys.length ? new RegExp(`(${keys.join("|")})(?![\\p{L}\\d])`, "gu") : null;
    return byId;
  })();
  return loaded;
}

export const realNameOf = (id) => byId.get(id) || "";

export async function saveRealName(id, name) {
  const real = String(name || "").trim().slice(0, 120);
  const res = real
    ? await supa.from("student_names").upsert({ student_id: id, real_name: real, updated_at: new Date().toISOString() })
    : await supa.from("student_names").delete().eq("student_id", id);
  if (res.error) throw res.error;
  await loadRealNames(true);
  refresh();
  return real;
}

/* ---------------- подписи на странице ---------------- */

const SKIP = "script,style,textarea,input,select,code,.rn-wrap,[data-rn-skip]";

function decorate(root) {
  if (!pattern || !realNamesShown() || !root) return;
  // <option> не может содержать разметку — дописываем имя в текст
  (root.querySelectorAll ? root.querySelectorAll("option:not([data-rn])") : []).forEach((o) => {
    const t = o.textContent;
    pattern.lastIndex = 0;
    if (!pattern.test(t)) return;
    o.dataset.rn = t;
    o.textContent = t.replace(pattern, (m) => `${m} — ${byPseudo.get(m).real}`);
  });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || n.nodeValue.length < 3) return NodeFilter.FILTER_REJECT;
      const el = n.parentElement;
      if (!el || el.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      pattern.lastIndex = 0;
      return pattern.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((n) => {
    const html = escapeHtml(n.nodeValue).replace(pattern, (m) => {
      const real = byPseudo.get(m)?.real;
      if (!real) return m;
      return `<span class="rn-wrap" title="Настоящее имя (видно только вам): ${escapeHtml(real)}">${m}<span class="rn"> · ${escapeHtml(real)}</span></span>`;
    });
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    n.replaceWith(tpl.content);
  });
}

function undecorate(root = document.body) {
  root.querySelectorAll(".rn-wrap").forEach((w) => w.replaceWith(document.createTextNode(w.firstChild?.nodeValue || "")));
  root.querySelectorAll("option[data-rn]").forEach((o) => {
    o.textContent = o.dataset.rn;
    delete o.dataset.rn;
  });
}

function refresh() {
  if (observer) observer.disconnect();
  undecorate();
  decorate(document.body);
  if (observer) observer.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll("[data-rn-toggle]").forEach((b) => {
    b.classList.toggle("active", realNamesShown());
    b.setAttribute("aria-pressed", String(realNamesShown()));
  });
}

export function setRealNamesShown(on) {
  try {
    localStorage.setItem(SHOW_KEY, on ? "1" : "0");
  } catch {}
  refresh();
}

/** Включить подписи (вызывается из кабинета преподавателя; повторный вызов ничего не делает). */
export async function installRealNames() {
  await loadRealNames().catch(() => null);
  if (observer) return refresh();
  let queued = false;
  observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      observer.disconnect();
      decorate(document.body);
      observer.observe(document.body, { childList: true, subtree: true });
    }, 0);
  });
  refresh();
}

/** Кнопка-переключатель для панели кабинета. */
export const toggleHtml = () =>
  `<button type="button" class="pill rn-toggle ${realNamesShown() ? "active" : ""}" data-rn-toggle aria-pressed="${realNamesShown()}" title="Показывать настоящие имена рядом с псевдонимами (видно только вам). Выключите, если экран видят ученики.">👤 Имена</button>`;

document.addEventListener("click", (e) => {
  if (e.target.closest?.("[data-rn-toggle]")) setRealNamesShown(!realNamesShown());
});
