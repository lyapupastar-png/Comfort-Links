export const DEFAULT_SETTINGS = Object.freeze({ recent: false, frequent: false, icons: true, wallpaper: null });

export function cleanWallpaper(w) {
  if (!w || typeof w !== 'object') return null;
  if (w.t === 'm' && typeof w.id === 'string' && w.id.length <= 64) return { t: 'm', id: w.id };
  if (w.t === 'c' && /^#[0-9a-f]{6}$/i.test(w.v || '')) return { t: 'c', v: w.v.toLowerCase() };
  if (w.t === 'f') return { t: 'f' };
  return null;
}

export function cleanSettings(s) {
  return {
    recent: s?.recent === true,
    frequent: s?.frequent === true,
    icons: s?.icons !== false,
    wallpaper: cleanWallpaper(s?.wallpaper),
  };
}

export function sameSettings(a, b) {
  return JSON.stringify(cleanSettings(a)) === JSON.stringify(cleanSettings(b));
}
