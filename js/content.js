import { BASE, SITE } from "./config.js";

const STORAGE_KEY = "leksikon-content-overlay";

function overlay() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveOverlay(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getOverlay() {
  return overlay();
}

async function loadJson(path) {
  const url = new URL(path, new URL(BASE, location.href)).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось загрузить ${path}`);
  return res.json();
}

const EGE_NUMBERS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];

export async function loadContent() {
  const egeLoads = EGE_NUMBERS.map((n) =>
    loadJson(`data/ege/task-${String(n).padStart(2, "0")}.json`).catch(() => [])
  );
  const [orthography, punctuation, stylistics, exercises, ...egeParts] = await Promise.all([
    loadJson("data/orthography.json"),
    loadJson("data/punctuation.json"),
    loadJson("data/stylistics.json"),
    loadJson("data/exercises.json"),
    ...egeLoads,
  ]);

  const extra = overlay();
  const sections = [orthography, punctuation, stylistics];

  if (Array.isArray(extra.rules)) {
    for (const rule of extra.rules) {
      const section = sections.find((s) => s.id === rule.section) || orthography;
      let chapter = section.chapters.find((c) => c.id === rule.chapterId);
      if (!chapter) {
        chapter = {
          id: rule.chapterId || "extra",
          title: rule.chapterTitle || "Добавлено модератором",
          rules: [],
        };
        section.chapters.push(chapter);
      }
      chapter.rules = chapter.rules.filter((r) => r.id !== rule.id);
      chapter.rules.push(rule);
    }
  }

  const allExercises = [...exercises];
  if (Array.isArray(extra.exercises)) {
    for (const ex of extra.exercises) {
      const i = allExercises.findIndex((e) => e.id === ex.id);
      if (i >= 0) allExercises[i] = ex;
      else allExercises.push(ex);
    }
  }

  return { sections, exercises: allExercises, ege: egeParts.flat(), site: SITE };
}

export function allRules(content) {
  return content.sections.flatMap((section) =>
    section.chapters.map((chapter) =>
      chapter.rules.map((rule) => ({ ...rule, section, chapter }))
    ).flat()
  );
}

export function findRule(content, idOrSlug) {
  return allRules(content).find((r) => r.id === idOrSlug || r.slug === idOrSlug);
}

export function exercisesFor(content, ruleId) {
  return content.exercises.filter((ex) => ex.ruleId === ruleId || (ex.ruleIds || []).includes(ruleId));
}
