import { normalizeUrl, cleanTitle } from './model.js';

export const SMART_LIMIT = 12;
const MONTH = 30 * 864e5;

function toLinks(list, prefix) {
  const out = [];
  const seen = new Set();
  for (const x of list) {
    const url = normalizeUrl(x?.url);
    if (!url || !/^https?:/.test(url)) continue;
    const host = new URL(url).hostname;
    if (seen.has(host)) continue;
    seen.add(host);
    out.push({ id: `${prefix}${out.length}`, url, title: cleanTitle(x.title, url) });
    if (out.length >= SMART_LIMIT) break;
  }
  return out;
}

export async function hasHistoryAccess() {
  try {
    return await browser.permissions.contains({ permissions: ['history'] });
  } catch {
    return false;
  }
}

export async function recentLinks() {
  if (!(await hasHistoryAccess())) return [];
  const list = await browser.history.search({ text: '', startTime: Date.now() - MONTH, maxResults: 500 });
  list.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
  return toLinks(list, '~r');
}

export async function frequentLinks() {
  try {
    return toLinks(await browser.topSites.get({ limit: 40, onePerDomain: true }), '~f');
  } catch {
    return [];
  }
}
