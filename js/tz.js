// Время студии — барнаульское (UTC+7, без перехода на летнее), как в Google Календаре.
// Даты на сайте показываются по нему на любом устройстве: у преподавателя в поездке
// «16:00» остаётся «16:00», и срок, введённый как «20:00», — это 20:00 по Барнаулу.

export const TZ = "Asia/Barnaul";
const OFF = 7 * 60; // минут к UTC

/** Дата, у которой «локальные» getHours()/getDate()/getDay() показывают барнаульское время. */
export const bz = (d = new Date()) => {
  const x = new Date(d);
  return new Date(x.getTime() + (OFF + x.getTimezoneOffset()) * 60000);
};

/** Обратно: «барнаульские» часы/день (после bz и setHours) → настоящий момент времени. */
export const fromBz = (local) => {
  const x = new Date(local);
  return new Date(x.getTime() - (OFF + x.getTimezoneOffset()) * 60000);
};

const pad = (n) => String(n).padStart(2, "0");

/** Значение для <input type="datetime-local"> по барнаульскому времени. */
export const toBzInput = (d) => {
  if (!d) return "";
  const x = bz(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

/** Значение из <input type="datetime-local"> (барнаульское время) → ISO. */
export const fromBzInput = (v) => (v ? new Date(`${v.length === 16 ? v + ":00" : v}+07:00`).toISOString() : null);

/** Начало сегодняшнего (или данного) дня по Барнаулу — настоящий момент времени. */
export const bzDayStart = (d = new Date()) => {
  const x = bz(d);
  x.setHours(0, 0, 0, 0);
  return fromBz(x);
};

/** Все toLocale*String() без явного timeZone показывают барнаульское время. */
export function installStudioTime() {
  const P = Date.prototype;
  if (P.__bzPatched) return;
  for (const name of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]) {
    const orig = P[name];
    P[name] = function (locales, opts) {
      return orig.call(this, locales, opts && opts.timeZone ? opts : { ...(opts || {}), timeZone: TZ });
    };
  }
  P.__bzPatched = true;
}
