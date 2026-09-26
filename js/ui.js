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
  const boardBanner = board
    ? `<p class="board-banner" role="status">Крупный шрифт для проектора. Нажмите ещё раз в шапке, чтобы выключить.</p>`
    : "";
  const isHome = active === "home";
  const nav = isHome
    ? `
          <a href="#about">О студии</a>
          <a href="#teacher">Преподаватель</a>
          <a href="#apply">Запись</a>
          <a href="#learn">Материалы</a>`
    : `
          <a href="#/">Студия</a>
          <a href="#/rules" class="${active === "rules" ? "active" : ""}">Правила</a>
          <a href="#/ege" class="${active === "ege" ? "active" : ""}">ЕГЭ</a>
          <a href="#/oge" class="${active === "oge" ? "active" : ""}">ОГЭ</a>
          <a href="#/literature" class="${active === "literature" ? "active" : ""}">Литература</a>
          <button type="button" class="nav-board ${board ? "active" : ""}" id="board-toggle" aria-pressed="${board ? "true" : "false"}" title="Увеличить текст на экране — для проектора и доски">Крупный шрифт</button>`;
  return `
    <button type="button" class="skip-link">К содержанию</button>
    <header class="site-header">
      <div class="wrap header-inner">
        <a class="brand" href="#/">
          <span class="brand-mark">Л</span>
          <span class="brand-text">
            <strong>Студия Лексикон</strong>
            <span>${isHome ? "русский язык и литература" : "русский язык"}</span>
          </span>
        </a>
        <nav class="nav">${nav}
        </nav>
      </div>
      ${boardBanner}
    </header>
    <main id="main"><div class="wrap">${content}</div></main>
    ${
      hideFooter
        ? ""
        : `<footer class="site-footer">
      <div class="wrap footer-inner">
        <p class="footer-name">Студия Лексикон</p>
        <p>Руководитель — П. В. Алексеев · <a href="https://palekseev.ru/" target="_blank" rel="noopener noreferrer">личный сайт</a></p>
        <p>
          <a href="https://go.2gis.com/lknNX" target="_blank" rel="noopener noreferrer">г. Горно-Алтайск, пр. Коммунистический, 47</a>
          <span> (вход со стороны ул. Головина)</span>
        </p>
        <p class="footer-note">Русский язык и литература. Очно и онлайн.</p>
        <p class="footer-admin"><a href="#/admin">Модератору</a></p>
      </div>
    </footer>`
    }
  `;
}
