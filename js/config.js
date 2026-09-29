export const SITE = {
  title: "Студия Лексикон",
  subtitle: "Русский язык и литература",
  githubUser: "pavelaleks",
  repo: "studiya-leksikon",
  adminPassword: "leksikon",
};

export const BASE = (() => {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] === SITE.repo) return `/${SITE.repo}/`;
  return "./";
})();

/** Настройки студии для лендинга и заявок. */
export const STUDIO = {
  name: "Студия Лексикон",
  city: "Горно-Алтайск",
  address: "пр. Коммунистический, 47",
  addressHint: "вход со стороны ул. Головина",
  mapUrl: "https://go.2gis.com/lknNX",
  teacher: "П. В. Алексеев",
  teacherFull: "Павел Викторович Алексеев",
  teacherTitle: "доктор филологических наук, профессор",
  teacherSite: "https://palekseev.ru/",
  applyEmail: "pavel.alekseev.gasu@gmail.com",
  telegram: "terminus12",
  /** Части номера — собираются только по клику «Позвонить». */
  phoneParts: ["+7", "913", "998", "53", "10"],
  /** После отправки FormSubmit (абсолютный URL на проде). Пусто — текущий origin + #/thanks */
  applyThanksUrl: "",
  /** Тренажёры ОГЭ: JSON в js/trainers-data/, маршрут #/trainer/:slug */
  trainers: [
    {
      slug: "trenazher-n-nn-leksikon",
      title: "Н и НН",
      blurb: "В прилагательных, причастиях и наречиях · 174 задания",
      tag: "Орфография",
    },
    {
      slug: "trenazher-oborotov-leksikon",
      title: "Причастные и деепричастные обороты",
      blurb: "Запятые при оборотах · 75 заданий",
      tag: "Пунктуация",
    },
  ],
};

export function studioPhone() {
  const parts = STUDIO.phoneParts || [];
  let digits = parts.join("").replace(/\D/g, "");
  if (digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (!digits.startsWith("7")) digits = "7" + digits;
  const local = digits.slice(1);
  const display = `+7 ${local.slice(0, 3)} ${local.slice(3, 6)}-${local.slice(6, 8)}-${local.slice(8)}`;
  return { display, tel: `+${digits}` };
}
