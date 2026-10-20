import { dbGet, dbPut } from './db.js';

const HIT_TTL = 30 * 864e5;
const MISS_TTL = 7 * 864e5;
const PARALLEL = 6;

export const ICON_ORIGINS = ['https://www.google.com/s2/favicons*', 'https://*.gstatic.com/faviconV2*', 'https://icons.duckduckgo.com/ip3/*'];

const google = (host) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
const duck = (host) => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;

const mem = new Map();
const inflight = new Map();
const queue = [];
let running = 0;

export function iconHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

const idbGet = (key) => dbGet('icons', key);
const idbPut = (key, value) => dbPut('icons', key, value);

function limited(fn) {
  return new Promise((resolve) => {
    queue.push(async () => {
      try {
        resolve(await fn());
      } finally {
        running--;
        queue.length && (running++, queue.shift()());
      }
    });
    if (running < PARALLEL) {
      running++;
      queue.shift()();
    }
  });
}

async function measure(blob) {
  const bm = await createImageBitmap(blob);
  const w = bm.width;
  bm.close();
  return w;
}

async function fetchIcon(host) {
  for (const src of [google(host), duck(host)]) {
    let res;
    try {
      res = await fetch(src, { credentials: 'omit' });
    } catch {
      return { error: true };
    }
    if (!res.ok) continue;
    try {
      const blob = await res.blob();
      const w = await measure(blob);
      if (w > 0) return { blob, w };
    } catch {
      continue;
    }
  }
  return { miss: true };
}

function probe(src) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(0), 10000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalWidth);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(0);
    };
    img.src = src;
  });
}

export function cachedIcon(host) {
  return mem.get(host);
}

async function resolveIcon(host) {
  const rec = await idbGet(host);
  const age = rec ? Date.now() - rec.at : Infinity;
  if (rec?.blob && age < HIT_TTL) return { url: URL.createObjectURL(rec.blob), w: rec.w };
  if (rec?.miss && age < MISS_TTL) return null;
  const got = await limited(() => fetchIcon(host));
  if (got.blob) {
    await idbPut(host, { blob: got.blob, w: got.w, at: Date.now() });
    return { url: URL.createObjectURL(got.blob), w: got.w };
  }
  if (got.miss) {
    await idbPut(host, { miss: true, at: Date.now() });
    return null;
  }
  if (rec?.blob) return { url: URL.createObjectURL(rec.blob), w: rec.w };
  const w = await limited(() => probe(google(host)));
  return w > 16 ? { url: google(host), w } : null;
}

export function loadIcon(host) {
  if (mem.has(host)) return Promise.resolve(mem.get(host));
  if (!inflight.has(host)) {
    inflight.set(
      host,
      resolveIcon(host)
        .catch(() => null)
        .then((r) => {
          mem.set(host, r);
          inflight.delete(host);
          return r;
        })
    );
  }
  return inflight.get(host);
}
