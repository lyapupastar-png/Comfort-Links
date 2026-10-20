export const SCHEMA = 1;
export const TITLE_MAX = 200;
export const FOLDER_NAME_MAX = 60;
export const SMART_KINDS = ['recent', 'frequent'];
export const MIN_COLS = 3;
export const MAX_COLS = 40;
const isSlot = (p) => Number.isInteger(p) && p >= 0 && p < 100000;
export const smartId = (kind) => `~${kind}`;

const SCHEME = /^(https?|ftp|file):/i;
const PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'file:']);

export function emptyState() {
  return { v: SCHEMA, items: [] };
}

export function normalizeUrl(input) {
  const s = String(input ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  let u;
  try {
    u = new URL(SCHEME.test(s) ? s : 'https://' + s);
  } catch {
    return null;
  }
  if (!PROTOCOLS.has(u.protocol)) return null;
  if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.hostname) return null;
  if ((u.protocol === 'http:' || u.protocol === 'https:') && !u.hostname.includes('.') && !u.hostname.includes(':') && u.hostname !== 'localhost') return null;
  return u.href;
}

export function hostLabel(url) {
  try {
    const u = new URL(url);
    return (u.hostname || u.pathname).replace(/^www\./, '');
  } catch {
    return String(url);
  }
}

const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'in']);
const SERVICE_SUBDOMAINS = new Set(['www', 'www2', 'm', 'mobile', 'app', 'web', 'en', 'ru', 'uk', 'ua', 'de', 'fr', 'es', 'it', 'pl', 'beta', 'home', 'my']);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pretty = (label) => capitalize(label.replace(/[-_]+/g, ' ').trim());

export function siteName(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  if (u.protocol === 'file:') return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  const host = u.hostname.replace(/\.$/, '');
  if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || host.startsWith('[')) return host;
  const parts = host.split('.');
  if (parts.length === 1) return pretty(parts[0]);
  let main = parts.length - 2;
  if (parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2])) main = parts.length - 3;
  const sub = parts.slice(0, main).filter((s) => !SERVICE_SUBDOMAINS.has(s) && !/^\d+$/.test(s)).pop();
  return [pretty(parts[main]), sub && pretty(sub)].filter(Boolean).join(' ');
}

export function cleanTitle(title, url) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  return t || siteName(url) || hostLabel(url);
}

export function cleanFolderName(name, fallback) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_MAX);
  return n || fallback;
}

function allIds(state) {
  const s = new Set();
  for (const it of state.items) {
    s.add(it.id);
    if (it.folder) for (const x of it.items) s.add(x.id);
  }
  return s;
}

export function freshId(state) {
  const used = allIds(state);
  for (;;) {
    const b = new Uint8Array(6);
    crypto.getRandomValues(b);
    const id = Array.from(b, (x) => (x % 36).toString(36)).join('');
    if (!used.has(id)) return id;
  }
}

export function locate(state, id) {
  for (let i = 0; i < state.items.length; i++) {
    const it = state.items[i];
    if (it.id === id) return { item: it, folder: null, index: i };
    if (it.folder) {
      const j = it.items.findIndex((x) => x.id === id);
      if (j >= 0) return { item: it.items[j], folder: it, index: j };
    }
  }
  return null;
}

function listOf(state, folderId) {
  if (!folderId) return state.items;
  const f = state.items.find((x) => x.id === folderId && x.folder);
  return f ? f.items : null;
}

function tidy(state) {
  const out = [];
  for (const it of state.items) {
    if (!it.folder || it.items.length > 0) out.push(it);
  }
  state.items = out;
  return state;
}

function take(state, id) {
  const loc = locate(state, id);
  if (!loc) return null;
  const list = loc.folder ? loc.folder.items : state.items;
  list.splice(loc.index, 1);
  return loc.item;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function addLink(state, { url, title }, folderId = null, index = Infinity) {
  const href = normalizeUrl(url);
  if (!href) throw new Error('invalid-url');
  const s = structuredClone(state);
  const list = listOf(s, folderId) || s.items;
  const id = freshId(s);
  list.splice(clamp(index, 0, list.length), 0, { id, url: href, title: cleanTitle(title, href) });
  return { state: s, id };
}

export function updateLink(state, id, { url, title }) {
  const href = normalizeUrl(url);
  if (!href) throw new Error('invalid-url');
  const s = structuredClone(state);
  const loc = locate(s, id);
  if (!loc || loc.item.folder || loc.item.smart) return s;
  loc.item.url = href;
  loc.item.title = cleanTitle(title, href);
  return s;
}

export function removeItem(state, id) {
  const s = structuredClone(state);
  take(s, id);
  return tidy(s);
}

export function moveItem(state, id, folderId = null, index = Infinity) {
  const s = structuredClone(state);
  const loc = locate(s, id);
  if (!loc) return s;
  if ((loc.item.folder || loc.item.smart) && folderId) return s;
  if (folderId && !listOf(s, folderId)) return s;
  const item = take(s, id);
  const list = listOf(s, folderId);
  if (!list) return tidy(s);
  list.splice(clamp(index, 0, list.length), 0, item);
  return tidy(s);
}

export function createFolder(state, dragId, targetId, name) {
  if (dragId === targetId) return { state, id: null };
  const s = structuredClone(state);
  const drag = locate(s, dragId);
  const target = locate(s, targetId);
  if (!drag || !target || drag.item.folder || drag.item.smart || target.item.folder || target.item.smart || target.folder) return { state, id: null };
  const dragItem = take(s, dragId);
  const at = s.items.findIndex((x) => x.id === targetId);
  const id = freshId(s);
  const { p, ...targetLink } = s.items[at];
  const folder = { id, folder: true, name: cleanFolderName(name, 'Folder'), items: [targetLink, stripSlot(dragItem)] };
  if (isSlot(p)) folder.p = p;
  s.items.splice(at, 1, folder);
  return { state: tidy(s), id };
}

export function setSmart(state, kind, on) {
  const id = smartId(kind);
  const has = state.items.some((x) => x.id === id);
  if (has === on || !SMART_KINDS.includes(kind)) return state;
  const s = structuredClone(state);
  if (on) s.items.unshift({ id, smart: kind });
  else s.items = s.items.filter((x) => x.id !== id);
  return s;
}

export function renameFolder(state, id, name) {
  const s = structuredClone(state);
  const f = s.items.find((x) => x.id === id && x.folder);
  if (f) f.name = cleanFolderName(name, f.name);
  return s;
}

export function ungroupFolder(state, id) {
  const s = structuredClone(state);
  const at = s.items.findIndex((x) => x.id === id && x.folder);
  if (at >= 0) s.items.splice(at, 1, ...s.items[at].items);
  return s;
}

export function deleteFolder(state, id) {
  const s = structuredClone(state);
  s.items = s.items.filter((x) => x.id !== id);
  return s;
}

export function reorder(state, folderId, orderedIds) {
  const s = structuredClone(state);
  const list = listOf(s, folderId);
  if (!list) return s;
  const pos = new Map(orderedIds.map((id, i) => [id, i]));
  const sorted = list
    .map((it, i) => ({ it, k: pos.has(it.id) ? pos.get(it.id) : orderedIds.length + i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.it);
  list.splice(0, list.length, ...sorted);
  return s;
}

export function fromLinks(links) {
  const s = emptyState();
  const seen = new Set();
  for (const l of links) {
    const href = normalizeUrl(l && l.url);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    s.items.push({ id: freshId(s), url: href, title: cleanTitle(l.title, href) });
  }
  return s;
}

export function isValidState(s) {
  if (!s || s.v !== SCHEMA || !Array.isArray(s.items)) return false;
  if (s.cols !== undefined && !(Number.isInteger(s.cols) && s.cols >= MIN_COLS && s.cols <= MAX_COLS)) return false;
  if (s.items.some((it) => it && it.p !== undefined && !isSlot(it.p))) return false;
  return s.items.every((it) =>
    it && typeof it.id === 'string' && (it.smart
      ? SMART_KINDS.includes(it.smart) && it.id === smartId(it.smart)
      : it.folder
      ? typeof it.name === 'string' && Array.isArray(it.items) && it.items.every((x) => x && !x.folder && typeof x.url === 'string')
      : typeof it.url === 'string'));
}

export function sameItems(a, b) {
  return (a?.cols ?? null) === (b?.cols ?? null) && JSON.stringify(a && a.items) === JSON.stringify(b && b.items);
}

function stripSlot(it) {
  const { p, ...rest } = it;
  return rest;
}

export function normalizeSlots(state) {
  const s = structuredClone(state);
  const used = new Set();
  for (const it of s.items) {
    if (s.cols && isSlot(it.p) && !used.has(it.p)) used.add(it.p);
    else delete it.p;
  }
  if (!used.size) delete s.cols;
  return s;
}

export function rebaseSlots(state, cols) {
  if (!state.cols || state.cols === cols) return state;
  if (!state.items.every((it) => !isSlot(it.p) || it.p % state.cols < cols)) return state;
  const s = structuredClone(state);
  for (const it of s.items) if (isSlot(it.p)) it.p = Math.floor(it.p / state.cols) * cols + (it.p % state.cols);
  s.cols = cols;
  return s;
}

export function setLayout(state, blockIds, free, cols) {
  const s = structuredClone(state);
  const byId = new Map(s.items.map((it) => [it.id, it]));
  const seen = new Set();
  const out = [];
  for (const id of blockIds) {
    const it = byId.get(id);
    if (!it || seen.has(id)) continue;
    delete it.p;
    out.push(it);
    seen.add(id);
  }
  for (const [id, p] of free) {
    const it = byId.get(id);
    if (!it || seen.has(id) || !isSlot(p)) continue;
    it.p = p;
    out.push(it);
    seen.add(id);
  }
  for (const it of s.items) if (!seen.has(it.id)) out.push(it);
  s.items = out;
  s.cols = cols;
  return normalizeSlots(s);
}

export function resetLayout(state) {
  const s = normalizeSlots(state);
  const block = s.items.filter((it) => !isSlot(it.p));
  const placed = s.items.filter((it) => isSlot(it.p)).sort((a, b) => a.p - b.p);
  s.items = [...block, ...placed].map(stripSlot);
  delete s.cols;
  return s;
}
