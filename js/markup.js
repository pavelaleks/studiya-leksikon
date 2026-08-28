import { escapeHtml } from "./ui.js";

const KIND = {
  o: "o",
  p: "p",
  r: "r",
  s: "s",
  e: "e",
  x: "x",
  z: "z",
  m: "m",
  f: "f",
};

export function mark(text) {
  if (text == null || text === "") return "";
  const escaped = escapeHtml(String(text));
  return escaped.replace(/\{([^{}|]+)(?:\|([prseoxzmf]))?\}/g, (_, inner, type) => {
    const kind = KIND[type] || "o";
    return `<span class="lg lg-${kind}">${inner}</span>`;
  });
}

export function legend(sectionId = "") {
  if (sectionId === "stylistics") {
    return `
    <div class="legend" aria-label="Обозначения">
      <span><span class="lg lg-o">норма</span> рекомендуемая форма</span>
      <span><span class="lg lg-x">ошибка</span> так лучше не говорить</span>
      <span><span class="lg lg-s">-ся</span> суффикс / частица</span>
      <span><span class="lg lg-e">ок</span> окончание</span>
    </div>
  `;
  }
  return `
    <div class="legend" aria-label="Обозначения">
      <span><span class="lg lg-o">а</span> орфограмма</span>
      <span><span class="lg lg-p">при-</span> приставка</span>
      <span><span class="lg lg-r">кор</span> корень</span>
      <span><span class="lg lg-s">суф</span> суффикс</span>
      <span><span class="lg lg-e">ок</span> окончание</span>
      <span><span class="lg lg-z">,</span> знак</span>
      <span><span class="lg lg-x">искл.</span> исключение</span>
    </div>
  `;
}
