import { emptyState, fromLinks, addLink, isValidState, sameItems, siteName } from './lib/model.js';
import { pack, unpack, unpackSettings, diff, checkLimits, hasData, isManagedKey } from './lib/syncpack.js';
import { cleanSettings, sameSettings } from './lib/settings.js';

const PUSH_DELAY = 1500;
const PULL_DELAY = 2500;
let pushTimer = null;
let pullTimer = null;
let pullPending = false;
let chain = Promise.resolve();
const ownWrites = new Map();
const REMOVED = '\u0000removed';

const serial = (fn) => (chain = chain.then(fn).catch((e) => console.error('[comfort-links]', e)));

async function readLocal() {
  const { state } = await browser.storage.local.get('state');
  return isValidState(state) ? state : null;
}

async function readSettings() {
  const { settings } = await browser.storage.local.get('settings');
  return settings ? cleanSettings(settings) : null;
}

async function writeSettings(settings, by) {
  await browser.storage.local.set({ settings: { ...cleanSettings(settings), by, rev: Date.now() } });
}

async function writeLocal(state, by, extra = {}) {
  const layout = state.cols ? { cols: state.cols } : {};
  await browser.storage.local.set({ state: { v: state.v, ...layout, items: state.items, by, rev: Date.now(), ...extra } });
}

async function setStatus(status) {
  const { syncStatus } = await browser.storage.local.get('syncStatus');
  if (syncStatus?.status !== status) await browser.storage.local.set({ syncStatus: { status, at: Date.now() } });
}

async function topSites() {
  try {
    return await browser.topSites.get({ newtab: true, limit: 48 });
  } catch {
    try {
      return await browser.topSites.get({ includePinned: true, limit: 24 });
    } catch {
      return [];
    }
  }
}

async function ensureState() {
  const map = await browser.storage.sync.get(null);
  const cfg = unpackSettings(map);
  if (cfg && !(await readSettings())) await writeSettings(cfg, 'sync');
  if (await readLocal()) return;
  const remote = unpack(map, null);
  if (remote && remote.items.length) return writeLocal(remote, 'sync');
  await writeLocal(fromLinks(await topSites()), 'import', { pristine: true });
}

async function push() {
  if (pullPending) return;
  const local = await readLocal();
  if (!local) return;
  const current = await browser.storage.sync.get(null);
  if (local.pristine && hasData(current)) return;
  const next = pack(local, (await readSettings()) || cleanSettings(null));
  if (checkLimits(next)) return setStatus('quota');
  const { set, remove } = diff(current, next);
  for (const [k, v] of Object.entries(set)) ownWrites.set(k, JSON.stringify(v));
  for (const k of remove) ownWrites.set(k, REMOVED);
  try {
    if (Object.keys(set).length) await browser.storage.sync.set(set);
    if (remove.length) await browser.storage.sync.remove(remove);
    await setStatus('ok');
  } catch (e) {
    console.error('[comfort-links] sync', e);
    await setStatus('error');
  }
}

async function pull() {
  pullPending = false;
  const map = await browser.storage.sync.get(null);
  const cfg = unpackSettings(map);
  const mine = await readSettings();
  if (cfg && (!mine || !sameSettings(cfg, mine))) await writeSettings(cfg, 'sync');
  const local = await readLocal();
  const remote = unpack(map, local);
  if (!remote || (local && sameItems(local, remote))) return;
  await writeLocal(remote, 'sync');
}

function setupMenus() {
  browser.menus.removeAll().then(() => {
    browser.menus.create({ id: 'cl-page', title: browser.i18n.getMessage('menuAddPage'), contexts: ['page'] });
    browser.menus.create({ id: 'cl-link', title: browser.i18n.getMessage('menuAddLink'), contexts: ['link'] });
  });
}

browser.menus.onClicked.addListener((info, tab) =>
  serial(async () => {
    const isLink = info.menuItemId === 'cl-link';
    if (!isLink && info.menuItemId !== 'cl-page') return;
    const url = isLink ? info.linkUrl : info.pageUrl || tab?.url;
    try {
      const { state } = addLink((await readLocal()) || emptyState(), { url, title: siteName(url) });
      await writeLocal(state, 'menu');
    } catch {
      /* unsupported address */
    }
  })
);

function foreignChange(changes) {
  let foreign = false;
  for (const [k, ch] of Object.entries(changes)) {
    if (!isManagedKey(k)) continue;
    const now = 'newValue' in ch ? JSON.stringify(ch.newValue) : REMOVED;
    if (ownWrites.get(k) === now) ownWrites.delete(k);
    else foreign = true;
  }
  return foreign;
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.state || changes.settings)) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => serial(push), PUSH_DELAY);
  }
  if (area === 'sync' && foreignChange(changes)) {
    pullPending = true;
    clearTimeout(pullTimer);
    pullTimer = setTimeout(() => serial(pull), PULL_DELAY);
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg === 'ensure') return serial(ensureState);
  return undefined;
});

browser.runtime.onInstalled.addListener(() => {
  setupMenus();
  serial(ensureState);
});

browser.runtime.onStartup.addListener(() => {
  setupMenus();
  serial(ensureState);
  serial(pull);
});
