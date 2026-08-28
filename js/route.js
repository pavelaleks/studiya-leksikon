/** Разбор хеша `#/path?q=…&board=1` и параметра `?board=1` у адреса. */

export function parseRoute() {
  let raw = (location.hash || "#").replace(/^#/, "") || "/";
  let hashQuery = "";
  const qi = raw.indexOf("?");
  if (qi >= 0) {
    hashQuery = raw.slice(qi + 1);
    raw = raw.slice(0, qi);
  }
  const hashParams = new URLSearchParams(hashQuery);
  const searchParams = new URLSearchParams(location.search);
  const board = hashParams.has("board") || searchParams.has("board");
  const q = hashParams.get("q") || "";
  const parts = decodeURIComponent(raw)
    .split("/")
    .filter(Boolean);
  return { parts, board, q };
}

export function applyBoard() {
  const on = parseRoute().board;
  document.documentElement.classList.toggle("board", on);
  return on;
}

export function setBoard(on) {
  const u = new URL(location.href);
  if (on) u.searchParams.set("board", "1");
  else u.searchParams.delete("board");

  let raw = (u.hash || "#").replace(/^#/, "");
  const qi = raw.indexOf("?");
  let path = raw;
  let qs = "";
  if (qi >= 0) {
    path = raw.slice(0, qi);
    const p = new URLSearchParams(raw.slice(qi + 1));
    p.delete("board");
    qs = p.toString();
  }
  u.hash = "#" + path + (qs ? "?" + qs : "");
  history.replaceState(null, "", u);
  applyBoard();
}

export function keepBoardOnHash(href) {
  if (!parseRoute().board) return href;
  if (new URLSearchParams(location.search).has("board")) return href;
  if (!href || !href.startsWith("#")) return href;
  if (/[?&]board(?:=|&|$)/.test(href)) return href;
  const hash = href.slice(1);
  const qi = hash.indexOf("?");
  const path = qi >= 0 ? hash.slice(0, qi) : hash;
  const params = new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : "");
  params.set("board", "1");
  return "#" + path + "?" + params.toString();
}
