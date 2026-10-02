/** Разбор хеша `#/path?q=…`. */

export function parseRoute() {
  let raw = (location.hash || "#").replace(/^#/, "") || "/";
  let hashQuery = "";
  const qi = raw.indexOf("?");
  if (qi >= 0) {
    hashQuery = raw.slice(qi + 1);
    raw = raw.slice(0, qi);
  }
  const hashParams = new URLSearchParams(hashQuery);
  const q = hashParams.get("q") || "";
  const parts = decodeURIComponent(raw)
    .split("/")
    .filter(Boolean);
  return { parts, q };
}
