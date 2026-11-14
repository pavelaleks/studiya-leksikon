// Курсы ученика («предмет:класс») и трек, по которому строится его кабинет.
// Ученик может ходить на несколько курсов (русский и литература, разные классы) —
// тогда на главной есть переключатель трека.

export const SUBJECTS = { rus: "Русский язык", lit: "Литература" };
export const GRADES = [5, 6, 7, 8, 9, 10, 11];
export const TRACK_TITLE = { "ege-rus": "Русский · ЕГЭ", "oge-rus": "Русский · ОГЭ", "vpr-rus": "Русский · ВПР", "ege-lit": "Литература" };
export const TRACK_HREF = { "ege-rus": "#/ege", "oge-rus": "#/oge", "vpr-rus": "#/vpr", "ege-lit": "#/literature" };

export function courseLabel(c) {
  const [s, g] = String(c).split(":");
  const n = Number(g);
  const exam = n === 8 && s === "rus" ? " (ВПР)" : n === 9 ? " (ОГЭ)" : n >= 10 ? " (ЕГЭ)" : "";
  return `${SUBJECTS[s] || s} · ${n} класс${exam}`;
}

/** По какому банку заданий строится трек курса. */
export function courseTrack(c) {
  const [s, g] = String(c).split(":");
  if (s === "lit") return "ege-lit";
  const n = Number(g);
  return n >= 10 ? "ege-rus" : n === 9 ? "oge-rus" : "vpr-rus";
}

function legacyTrack(profile) {
  const t = String(profile?.exam_target || "");
  if (/ОГЭ/.test(t)) return "oge-rus";
  if (/ВПР/.test(t)) return "vpr-rus";
  if (/литератур/i.test(t)) return "ege-lit";
  return "ege-rus";
}

/** Треки всех курсов ученика (без повторов, в порядке курсов). */
export function tracksOf(profile) {
  const list = [...new Set((profile?.courses || []).map(courseTrack))];
  return list.length ? list : [legacyTrack(profile)];
}

export function currentTrack(profile) {
  const list = tracksOf(profile);
  let saved = null;
  try {
    saved = localStorage.getItem("leksikon-track");
  } catch {}
  return list.includes(saved) ? saved : list[0];
}

export function setTrack(code) {
  try {
    localStorage.setItem("leksikon-track", code);
  } catch {}
}
