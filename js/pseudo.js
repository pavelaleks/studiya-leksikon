// Псевдонимы учеников: «Рыжий Лис 47» + логин ryzhiy-lis-47 + пароль. Настоящих имён и почт на сайте нет.
import { supa, humanError } from "./supa.js";

export const STUDENT_DOMAIN = "students.lexicon.local";

const ADJ = [
  ["Рыжий", "Рыжая", "ryzhiy"], ["Быстрый", "Быстрая", "bystryy"], ["Смелый", "Смелая", "smelyy"],
  ["Мудрый", "Мудрая", "mudryy"], ["Весёлый", "Весёлая", "veselyy"], ["Тихий", "Тихая", "tikhiy"],
  ["Звёздный", "Звёздная", "zvezdnyy"], ["Лесной", "Лесная", "lesnoy"], ["Горный", "Горная", "gornyy"],
  ["Северный", "Северная", "severnyy"], ["Ясный", "Ясная", "yasnyy"], ["Зоркий", "Зоркая", "zorkiy"],
  ["Ловкий", "Ловкая", "lovkiy"], ["Добрый", "Добрая", "dobryy"], ["Хитрый", "Хитрая", "khitryy"],
  ["Серебряный", "Серебряная", "serebryanyy"], ["Летний", "Летняя", "letniy"], ["Снежный", "Снежная", "snezhnyy"],
];
const NOUN = [
  ["Лис", "m", "lis"], ["Ёж", "m", "ezh"], ["Барсук", "m", "barsuk"], ["Манул", "m", "manul"], ["Филин", "m", "filin"],
  ["Бобр", "m", "bobr"], ["Кедр", "m", "kedr"], ["Сокол", "m", "sokol"], ["Медведь", "m", "medved"], ["Дельфин", "m", "delfin"],
  ["Сова", "f", "sova"], ["Белка", "f", "belka"], ["Рысь", "f", "rys"], ["Чайка", "f", "chayka"], ["Лань", "f", "lan"],
  ["Выдра", "f", "vydra"], ["Комета", "f", "kometa"], ["Ласточка", "f", "lastochka"],
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

/** Новый псевдоним: { name: "Рыжий Лис 47", login: "ryzhiy-lis-47" }. */
export function newPseudonym() {
  const [m, f, al] = pick(ADJ);
  const [noun, g, nl] = pick(NOUN);
  const n = 10 + Math.floor(Math.random() * 90);
  return { name: `${g === "m" ? m : f} ${noun} ${n}`, login: `${al}-${nl}-${n}` };
}

/** Пароль, который легко продиктовать: два слова и цифры. */
export function newPassword() {
  const words = ["луна", "река", "книга", "ветер", "пирог", "гора", "лист", "свет", "мост", "звон", "сад", "снег"];
  const lat = { луна: "luna", река: "reka", книга: "kniga", ветер: "veter", пирог: "pirog", гора: "gora", лист: "list", свет: "svet", мост: "most", звон: "zvon", сад: "sad", снег: "sneg" };
  return `${lat[pick(words)]}-${lat[pick(words)]}-${100 + Math.floor(Math.random() * 900)}`;
}

/** Логин ученика → служебная почта для входа; почту преподавателя оставляем как есть. */
export function loginToEmail(login) {
  const v = String(login || "").trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${STUDENT_DOMAIN}`;
}

export const isPseudoEmail = (email) => String(email || "").endsWith(`@${STUDENT_DOMAIN}`);
export const loginOf = (email) => (isPseudoEmail(email) ? String(email).split("@")[0] : "");

async function call(body) {
  const { data, error } = await supa.functions.invoke("admin", { body });
  if (error) {
    let msg = error.message;
    try {
      msg = (await error.context.json()).error || msg;
    } catch {}
    throw humanError({ message: msg });
  }
  return data;
}

export const createStudent = (o) => call({ action: "create", ...o });
export const resetStudentPassword = (student, password) => call({ action: "reset", student, password });
export const convertStudent = (o) => call({ action: "convert", ...o });
