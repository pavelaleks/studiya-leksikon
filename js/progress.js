const KEY = "leksikon-ege-progress";

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function write(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function readProgress() {
  return read();
}

export function touchEge(ex, index) {
  const p = read();
  p.lastId = ex.id;
  p.lastTask = ex.egeTask;
  p.lastIndex = index + 1;
  write(p);
}

export function markEgeDone(ex) {
  const p = read();
  p.done = p.done || {};
  const k = String(ex.egeTask);
  const set = new Set(p.done[k] || []);
  set.add(ex.id);
  p.done[k] = [...set];
  write(p);
}

export function doneIds(task) {
  const p = read();
  return new Set((p.done && p.done[String(task)]) || []);
}

export function pickEgeVariant(list) {
  if (!list.length) return null;
  const done = doneIds(list[0].egeTask);
  const open = list.filter((x) => !done.has(x.id));
  const pool = open.length ? open : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

const OGE_KEY = "leksikon-oge-progress";

function readOge() {
  try {
    return JSON.parse(localStorage.getItem(OGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeOge(data) {
  localStorage.setItem(OGE_KEY, JSON.stringify(data));
}

export function readOgeProgress() {
  return readOge();
}

export function touchOge(ex, index) {
  const p = readOge();
  p.lastId = ex.id;
  p.lastTask = ex.ogeTask;
  p.lastIndex = index + 1;
  writeOge(p);
}

export function markOgeDone(ex) {
  const p = readOge();
  p.done = p.done || {};
  const k = String(ex.ogeTask);
  const set = new Set(p.done[k] || []);
  set.add(ex.id);
  p.done[k] = [...set];
  writeOge(p);
}

export function doneOgeIds(task) {
  const p = readOge();
  return new Set((p.done && p.done[String(task)]) || []);
}

export function pickOgeVariant(list) {
  if (!list.length) return null;
  const done = doneOgeIds(list[0].ogeTask);
  const open = list.filter((x) => !done.has(x.id));
  const pool = open.length ? open : list;
  return pool[Math.floor(Math.random() * pool.length)];
}
