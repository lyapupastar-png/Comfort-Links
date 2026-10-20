import { SCHEMA, SMART_KINDS, smartId } from './model.js';
import { cleanSettings } from './settings.js';

export const SYNC_TOTAL = 102400;
export const SYNC_ITEM = 8192;
export const SYNC_ITEMS = 512;
const CHUNK = 7000;

const enc = new TextEncoder();
export const byteSize = (key, value) => enc.encode(key).length + enc.encode(JSON.stringify(value)).length;

export const isManagedKey = (k) => k === 'v' || k === 'cfg' || k.startsWith('root.') || k.startsWith('f.');

const linkOut = (l) => ({ i: l.id, u: l.url, t: l.title });
const linkIn = (e) => (e && typeof e.i === 'string' && typeof e.u === 'string' ? { id: e.i, url: e.u, title: String(e.t ?? '') } : null);

function chunk(base, entries, head = {}) {
  const parts = [];
  let cur = [];
  const fits = (list, idx) => byteSize(`${base}.${idx}`, { c: 999, ...(idx === 0 ? head : {}), e: list }) <= CHUNK;
  for (const e of entries) {
    cur.push(e);
    if (!fits(cur, parts.length) && cur.length > 1) {
      cur.pop();
      parts.push(cur);
      cur = [e];
    }
  }
  parts.push(cur);
  const out = {};
  parts.forEach((e, i) => {
    out[`${base}.${i}`] = { c: parts.length, ...(i === 0 ? head : {}), e };
  });
  return out;
}

export function pack(state, settings = null) {
  const out = { v: SCHEMA };
  if (settings) out.cfg = cleanSettings(settings);
  const slot = (it, e) => (state.cols && Number.isInteger(it.p) ? { ...e, p: it.p } : e);
  const root = state.items.map((it) => slot(it, it.smart ? { i: it.id, s: it.smart } : it.folder ? { i: it.id, f: 1 } : linkOut(it)));
  Object.assign(out, chunk('root', root, state.cols ? { cols: state.cols } : {}));
  for (const it of state.items) {
    if (it.folder) Object.assign(out, chunk(`f.${it.id}`, it.items.map(linkOut), { n: it.name }));
  }
  return out;
}

function readChunks(map, base) {
  const first = map[`${base}.0`];
  if (!first || !Number.isInteger(first.c) || first.c < 1) return null;
  const entries = [];
  for (let i = 0; i < first.c; i++) {
    const part = map[`${base}.${i}`];
    if (!part || part.c !== first.c || !Array.isArray(part.e)) return null;
    entries.push(...part.e);
  }
  return { head: first, entries };
}

export function unpackSettings(map) {
  return map && map.cfg && typeof map.cfg === 'object' ? cleanSettings(map.cfg) : null;
}

export function hasData(map) {
  return Boolean(map && map['root.0']);
}

export function unpack(map, fallback = null) {
  if (!map || map.v !== SCHEMA) return null;
  const root = readChunks(map, 'root');
  if (!root) return null;
  const old = new Map((fallback?.items || []).filter((x) => x.folder).map((x) => [x.id, x]));
  const items = [];
  const cols = Number.isInteger(root.head.cols) ? root.head.cols : null;
  const withSlot = (e, it) => (cols && Number.isInteger(e.p) && e.p >= 0 ? { ...it, p: e.p } : it);
  for (const e of root.entries) {
    if (e && SMART_KINDS.includes(e.s)) {
      if (!items.some((x) => x.smart === e.s)) items.push(withSlot(e, { id: smartId(e.s), smart: e.s }));
    } else if (e && e.f === 1 && typeof e.i === 'string') {
      const f = readChunks(map, `f.${e.i}`);
      if (f) {
        const links = f.entries.map(linkIn).filter(Boolean);
        if (links.length) items.push(withSlot(e, { id: e.i, folder: true, name: String(f.head.n ?? ''), items: links }));
      } else if (old.has(e.i)) {
        items.push(withSlot(e, structuredClone(old.get(e.i))));
      }
    } else {
      const l = linkIn(e);
      if (l) items.push(withSlot(e, l));
    }
  }
  return cols ? { v: SCHEMA, cols, items } : { v: SCHEMA, items };
}

export function totalSize(map) {
  return Object.entries(map).reduce((n, [k, v]) => n + byteSize(k, v), 0);
}

export function checkLimits(map) {
  const keys = Object.keys(map);
  if (keys.length > SYNC_ITEMS) return 'items';
  if (keys.some((k) => byteSize(k, map[k]) > SYNC_ITEM)) return 'item';
  if (totalSize(map) > SYNC_TOTAL - 1024) return 'total';
  return null;
}

export function diff(current, next) {
  const set = {};
  for (const [k, v] of Object.entries(next)) {
    if (JSON.stringify(current[k]) !== JSON.stringify(v)) set[k] = v;
  }
  const remove = Object.keys(current).filter((k) => isManagedKey(k) && !(k in next));
  return { set, remove };
}
