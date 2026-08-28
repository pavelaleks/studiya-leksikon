import { SITE } from "./config.js";
import { escapeHtml } from "./ui.js";
import { getOverlay, saveOverlay, allRules } from "./content.js";

export function adminPage(content) {
  const overlay = getOverlay();
  const extraRules = overlay.rules || [];
  const extraEx = overlay.exercises || [];
  return `
    <p class="eyebrow">Только для педагога</p>
    <h1>Модератору</h1>
    <p class="lede">Добавляйте правила и задания. Пока сайт открытый и статический, новые материалы сначала сохраняются в этом браузере; чтобы они появились у всех учеников, скачайте JSON и положите его в репозиторий (или пришлите мне в чат).</p>
    <div id="admin-gate" class="card" style="padding:22px;max-width:520px">
      <form id="login-form" class="stack">
        <label>Пароль модератора
          <input type="password" name="password" autocomplete="current-password" />
        </label>
        <button class="btn" type="submit">Войти</button>
      </form>
    </div>
    <div id="admin-app" class="admin" hidden>
      <div class="filter-bar">
        <button class="pill active" data-tab="rule">Новое правило</button>
        <button class="pill" data-tab="ex">Новое задание</button>
        <button class="pill" data-tab="list">Черновики (${extraRules.length + extraEx.length})</button>
      </div>
      <div data-panel="rule" class="card" style="padding:22px">
        <form id="rule-form" class="stack">
          <label>Раздел
            <select name="section">${content.sections.map((s) => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join("")}</select>
          </label>
          <label>Глава
            <select name="chapterId"></select>
          </label>
          <label>Название правила<input name="title" required placeholder="Приставки пре- и при-" /></label>
          <label>Кратко для карточки<textarea name="summary" required></textarea></label>
          <label>Объяснение<textarea name="body" required></textarea></label>
          <label>Примеры через запятую (орфограмма в фигурных скобках: соб{и}рать, {при-|p}ехать)<input name="examples" placeholder="соб{и}рать, {при-|p}ехать" /></label>
          <label>Исключения<input name="exceptions" /></label>
          <button class="btn" type="submit">Сохранить черновик правила</button>
        </form>
      </div>
      <div data-panel="ex" class="card" style="padding:22px" hidden>
        <form id="ex-form" class="stack">
          <label>Тип
            <select name="type">
              <option value="choice">Тест</option>
              <option value="insert">Вставить букву</option>
              <option value="copy">Списывание</option>
            </select>
          </label>
          <label>Правило
            <select name="ruleId">${allRules(content).map((r) => `<option value="${r.id}">${escapeHtml(r.title)}</option>`).join("")}</select>
          </label>
          <label>Название<input name="title" required /></label>
          <label>Для теста: вопросы в формате Вопрос | верный вариант | другой | другой (каждый вопрос с новой строки)<textarea name="choiceText" placeholder="В каком слове пишется А? | касаться | косаться | коссаться"></textarea></label>
          <label>Для вставки и списывания: текст, пропуски в двойных фигурных скобках — {{о}}<textarea name="template" placeholder="На закате небо {{о}}зарилось."></textarea></label>
          <button class="btn" type="submit">Сохранить черновик задания</button>
        </form>
      </div>
      <div data-panel="list" class="card" style="padding:22px" hidden>
        <p class="muted">Черновики живут в этом браузере. Скачайте файл, чтобы добавить их в общую базу.</p>
        <div class="actions">
          <button class="btn" id="download">Скачать JSON</button>
          <button class="btn secondary" id="clear">Очистить черновики</button>
        </div>
        <pre id="draft-view" style="white-space:pre-wrap;font-size:13px"></pre>
      </div>
    </div>
  `;
}

function fillChapters(content, root) {
  const sectionSel = root.querySelector('select[name="section"]');
  const chapterSel = root.querySelector('select[name="chapterId"]');
  if (!sectionSel || !chapterSel) return;
  const section = content.sections.find((s) => s.id === sectionSel.value);
  chapterSel.innerHTML = (section?.chapters || [])
    .map((c) => `<option value="${c.id}">${escapeHtml((c.roman ? c.roman + ". " : "") + c.title)}</option>`)
    .join("");
}

export function bindAdmin(content, root) {
  const gate = root.querySelector("#admin-gate");
  const app = root.querySelector("#admin-app");
  fillChapters(content, root);
  root.querySelector('select[name="section"]').addEventListener("change", () => fillChapters(content, root));
  root.querySelector("#login-form").onsubmit = (e) => {
    e.preventDefault();
    const value = new FormData(e.target).get("password");
    if (value !== SITE.adminPassword) {
      alert("Неверный пароль.");
      return;
    }
    sessionStorage.setItem("leksikon-admin", "1");
    gate.hidden = true;
    app.hidden = false;
  };
  if (sessionStorage.getItem("leksikon-admin") === "1") {
    gate.hidden = true;
    app.hidden = false;
  }

  root.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      root.querySelectorAll("[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      root.querySelectorAll("[data-panel]").forEach((p) => {
        p.hidden = p.getAttribute("data-panel") !== btn.dataset.tab;
      });
      if (btn.dataset.tab === "list") refreshList(root);
    };
  });

  root.querySelector("#rule-form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const overlay = getOverlay();
    overlay.rules = overlay.rules || [];
    const id = "custom-" + Date.now();
    overlay.rules.push({
      id,
      slug: id,
      section: f.get("section"),
      chapterId: f.get("chapterId"),
      chapterTitle: content.sections
        .flatMap((s) => s.chapters)
        .find((c) => c.id === f.get("chapterId"))?.title,
      title: f.get("title"),
      summary: f.get("summary"),
      theory: [
        {
          heading: f.get("title"),
          body: f.get("body"),
          examples: String(f.get("examples") || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      ],
      exceptions: String(f.get("exceptions") || "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
      grades: [8, 9, 10, 11],
    });
    saveOverlay(overlay);
    alert("Правило сохранено в черновики этого браузера.");
    e.target.reset();
  };

  root.querySelector("#ex-form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const overlay = getOverlay();
    overlay.exercises = overlay.exercises || [];
    const type = f.get("type");
    const id = "ex-custom-" + Date.now();
    const exercise = {
      id,
      type,
      ruleId: f.get("ruleId"),
      title: f.get("title"),
    };
    if (type === "choice") {
      exercise.items = String(f.get("choiceText") || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [prompt, ...choices] = line.split("|").map((s) => s.trim());
          return { prompt, choices, answer: 0, explanation: "Первый вариант — верный." };
        });
    } else {
      exercise.template = f.get("template");
      exercise.lead = "Вставьте пропущенные буквы или знаки.";
    }
    overlay.exercises.push(exercise);
    saveOverlay(overlay);
    alert("Задание сохранено в черновики.");
    e.target.reset();
  };

  root.querySelector("#download").onclick = () => {
    const blob = new Blob([JSON.stringify(getOverlay(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "leksikon-drafts.json";
    a.click();
  };
  root.querySelector("#clear").onclick = () => {
    if (confirm("Удалить черновики в этом браузере?")) {
      saveOverlay({});
      refreshList(root);
    }
  };
  refreshList(root);
}

function refreshList(root) {
  const view = root.querySelector("#draft-view");
  if (view) view.textContent = JSON.stringify(getOverlay(), null, 2);
}
