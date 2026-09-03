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

export function layout(content, active = "", board = false, { hideFooter = false } = {}) {
  return `
    <button type="button" class="skip-link">К содержанию</button>
    <header class="site-header">
      <div class="wrap header-inner">
        <a class="brand" href="#/">
          <span class="brand-mark">Л</span>
          <span class="brand-text">
            <strong>Студия Лексикон</strong>
            <span>8–11 классы</span>
          </span>
        </a>
        <nav class="nav">
          <a href="#/rules" class="${active === "rules" ? "active" : ""}">Правила</a>
          <a href="#/practice" class="${active === "practice" ? "active" : ""}">Задания</a>
          <a href="#/ege" class="${active === "ege" ? "active" : ""}">ЕГЭ</a>
          <button type="button" class="nav-board ${board ? "active" : ""}" id="board-toggle" aria-pressed="${board ? "true" : "false"}">Режим доски</button>
        </nav>
      </div>
    </header>
    <main id="main"><div class="wrap">${content}</div></main>
    ${
      hideFooter
        ? ""
        : `<footer class="site-footer">
      <div class="wrap footer-inner">
        <p class="footer-name">Студия Лексикон</p>
        <p>Руководитель — д.ф.н., профессор П.В. Алексеев</p>
        <p>
          <a href="https://go.2gis.com/lknNX" target="_blank" rel="noopener noreferrer">г. Горно-Алтайск, пр. Коммунистический, 47</a>
          <span> (вход со стороны ул. Головина)</span>
        </p>
        <p class="footer-note">Орфография, пунктуация и стилистика для занятий в студии и дома.</p>
        <p class="footer-admin"><a href="#/admin">Модератору</a></p>
      </div>
    </footer>`
    }
  `;
}
