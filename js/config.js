export const SITE = {
  title: "Студия Лексикон",
  subtitle: "Орфография, пунктуация и стилистика русского языка для 8–11 кл.",
  githubUser: "pavelaleks",
  repo: "studiya-leksikon",
  adminPassword: "leksikon",
};

export const BASE = (() => {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] === SITE.repo) return `/${SITE.repo}/`;
  return "./";
})();
