import { dbGet, dbPut, dbDelete } from './db.js';

const RECORDS = 'https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/newtab-wallpapers-v2/records';
const CDN = 'https://firefox-settings-attachments.cdn.mozilla.net/';
const CATALOG_TTL = 864e5;
export const MAX_UPLOAD = 20 * 1024 * 1024;
export const CATEGORIES = ['firefox', 'solid-colors', 'abstracts', 'celestial', 'photographs'];

let catalogPromise = null;

function toItem(r) {
  const url = r.attachment?.location ? CDN + r.attachment.location : null;
  const color = /^#[0-9a-f]{6}$/i.test(r.solid_color || '') ? r.solid_color : null;
  if (!r.id || !CATEGORIES.includes(r.category) || (!url && !color) || r.visible === false) return null;
  const a = r.attribution;
  return {
    id: r.id,
    category: r.category,
    theme: r.theme === 'light' ? 'light' : 'dark',
    url,
    color,
    position: r.background_position || 'center',
    order: Number.isFinite(r.order) ? r.order : 1e6,
    credit: a?.name?.string ? { name: a.name.string, nameUrl: a.name.url, site: a.webpage?.string || '', siteUrl: a.webpage?.url } : null,
  };
}

async function fetchCatalog() {
  const res = await fetch(RECORDS, { credentials: 'omit' });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const { data } = await res.json();
  return data.map(toItem).filter(Boolean).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function catalog() {
  catalogPromise ||= (async () => {
    const { wallCatalog } = await browser.storage.local.get('wallCatalog');
    if (wallCatalog && Date.now() - wallCatalog.at < CATALOG_TTL && Array.isArray(wallCatalog.items)) return wallCatalog.items;
    try {
      const items = await fetchCatalog();
      await browser.storage.local.set({ wallCatalog: { at: Date.now(), items } });
      return items;
    } catch (e) {
      if (wallCatalog?.items) return wallCatalog.items;
      catalogPromise = null;
      throw e;
    }
  })();
  return catalogPromise;
}

const session = new Map();

export async function mozillaBlob(item, persist = true) {
  const key = `m:${item.id}`;
  let blob = session.get(key);
  if (!blob) {
    const cached = await dbGet('wallpapers', 'current');
    if (cached?.key === key && cached.blob) blob = cached.blob;
  }
  if (!blob) {
    try {
      const res = await fetch(item.url, { credentials: 'omit' });
      if (!res.ok) return null;
      blob = await res.blob();
    } catch {
      return null;
    }
  }
  session.set(key, blob);
  if (persist) await dbPut('wallpapers', 'current', { key, blob });
  return blob;
}

export const customBlob = async () => (await dbGet('wallpapers', 'custom'))?.blob || null;
export const saveCustom = (blob) => dbPut('wallpapers', 'custom', { blob, at: Date.now() });
export const dropCustom = () => dbDelete('wallpapers', 'custom');

export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
