export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function layout(content, active = "") {
  return `
    <header class="site-header">
      <div class="wrap header-inner">
        <a class="brand" href="#/">
          <span class="mark">Л</span>
          <span class="brand-text">
            <strong>Студия Лексикон</strong>
            <span>8–11 классы</span>
          </span>
        </a>
        <nav class="nav">
          <a href="#/rules" class="${active === "rules" ? "active" : ""}">Правила</a>
          <a href="#/practice" class="${active === "practice" ? "active" : ""}">Задания</a>
          <a href="#/admin" class="${active === "admin" ? "active" : ""}">Модератору</a>
        </nav>
      </div>
    </header>
    <main><div class="wrap">${content}</div></main>
    <footer class="site-footer">
      <div class="wrap">Студия Лексикон · открытый учебный сайт по русскому языку. Теория написана для занятий в студии; ссылки на справочник Розенталя даны как внешний источник для углубления.</div>
    </footer>
  `;
}
