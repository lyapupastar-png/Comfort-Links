import * as M from './lib/model.js';
import { cleanSettings, DEFAULT_SETTINGS } from './lib/settings.js';
import { ICON_ORIGINS, iconHost, cachedIcon, loadIcon } from './lib/icons.js';
import { recentLinks, frequentLinks, hasHistoryAccess } from './lib/smart.js';
import { catalog, mozillaBlob, customBlob, saveCustom, luminance, MAX_UPLOAD } from './lib/wallpapers.js';

const CELL_W = 86;
const CELL_H = 130;
const DRAG_START = 6;
const MERGE_DELAY = 450;
const LONG_PRESS = 550;
const EDGE = 48;
const EDGE_DELAY = 650;
const LEAVE_DELAY = 350;
const REORDER_DELAY = 220;
const MERGE_INSET = 0.1;
const SMART = { recent: { id: '~recent', mark: '⏱', name: 'smartRecent' }, frequent: { id: '~frequent', mark: '★', name: 'smartFrequent' } };

const t = (key, ...subs) => browser.i18n.getMessage(key, subs) || key;
const $ = (sel) => document.querySelector(sel);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const PAGE_ID = crypto.randomUUID();

let state = M.emptyState();
let saved = state;
let settings = { ...DEFAULT_SETTINGS };
let smartData = { recent: null, frequent: null };
let editing = false;
let openFolderId = null;
let press = null;
let drag = null;
let pendingRemote = null;
let suppressClick = false;
let suppressTimer = null;
let menuOpen = false;
let blockArea = { rowOff: 0, colOff: 0, pcols: 8, cols: 8 };

class Pager {
  constructor(view, dots, capacity, fixed = false) {
    this.view = view;
    this.track = view.querySelector('.track');
    this.dots = dots;
    this.capacity = capacity;
    this.fixed = fixed;
    this.page = 0;
    this.pages = 1;
    this.lastWheel = 0;
  }

  render(tiles, usedRows = null) {
    let { cols, rows } = this.capacity();
    const per = cols * rows;
    const pages = Math.max(1, Math.ceil(tiles.length / per));
    if (pages === 1 && usedRows) rows = usedRows;
    else if (pages === 1 && !this.fixed) rows = Math.max(1, Math.ceil(tiles.length / cols));
    this.view.style.setProperty('--cols', cols);
    this.view.style.setProperty('--rows', rows);
    const els = [];
    for (let p = 0; p < pages; p++) {
      const page = document.createElement('div');
      page.className = 'page';
      page.append(...tiles.slice(p * per, (p + 1) * per));
      els.push(page);
    }
    this.track.replaceChildren(...els);
    this.pages = pages;
    this.go(Math.min(this.page, pages - 1), false);
  }

  go(n, animate = true) {
    this.page = clamp(n, 0, this.pages - 1);
    this.track.style.transition = animate ? '' : 'none';
    this.track.style.transform = `translateX(${-100 * this.page}%)`;
    if (!animate) void this.track.offsetWidth;
    const dots = [];
    if (this.pages > 1) {
      for (let i = 0; i < this.pages; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', t('pageLabel', String(i + 1)));
        if (i === this.page) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', () => this.go(i));
        dots.push(b);
      }
    }
    this.dots.replaceChildren(...dots);
  }

  wheel(e) {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 4 || this.pages < 2) return;
    const now = performance.now();
    if (now - this.lastWheel < 450) return;
    this.lastWheel = now;
    this.go(this.page + (d > 0 ? 1 : -1));
  }
}

const rootPager = new Pager(
  $('#rootPager'),
  $('#rootDots'),
  () => {
    const full = clamp(Math.floor((window.innerWidth - 48) / CELL_W), 3, M.MAX_COLS);
    const packed = clamp(full - 2, M.MIN_COLS, 8);
    const cols = Math.max(packed, (full - packed) % 2 ? full - 1 : full);
    return { cols, rows: clamp(Math.floor((window.innerHeight - 64) / CELL_H), 1, 8), packed };
  },
  true
);

const folderPager = new Pager(
  $('#folderPager'),
  $('#folderDots'),
  () => ({
    cols: clamp(Math.floor((window.innerWidth - 96) / CELL_W), 3, 6),
    rows: window.innerHeight < 3 * CELL_H + 220 ? 2 : 3,
  }),
  true
);

function colorFor(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 52% 46%)`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function applyImage(node, icon) {
  node.textContent = '';
  node.classList.remove('img-full', 'img-mid', 'img-small');
  node.classList.add(icon.w >= 96 ? 'img-full' : icon.w >= 48 ? 'img-mid' : 'img-small');
  const img = new Image();
  img.alt = '';
  img.draggable = false;
  img.src = icon.url;
  node.append(img);
}

function refreshIcons(host, icon) {
  if (!icon) return;
  for (const node of document.querySelectorAll(`[data-host="${CSS.escape(host)}"]`)) {
    if (!node.querySelector('img')) applyImage(node, icon);
  }
}

function iconNode(link, cls) {
  const host = iconHost(link.url);
  const label = M.hostLabel(link.url);
  const node = el('span', cls, (link.title || label).trim().charAt(0).toUpperCase() || '•');
  node.style.background = colorFor(label);
  if (!settings.icons || !host) return node;
  node.dataset.host = host;
  const known = cachedIcon(host);
  if (known) applyImage(node, known);
  else if (known === undefined) loadIcon(host).then((icon) => refreshIcons(host, icon));
  return node;
}

function labelEl(text) {
  const l = el('span', 'label', text);
  if (!/\s/.test(text.trim())) l.classList.add('one');
  return l;
}

function badge() {
  const b = el('button', 'badge', '×');
  b.type = 'button';
  b.tabIndex = -1;
  b.setAttribute('aria-label', t('remove'));
  return b;
}

function linkTile(link, ctx) {
  const a = el('a', 'tile');
  a.href = link.url;
  a.draggable = false;
  a.dataset.id = link.id;
  a.dataset.ctx = ctx;
  a.title = `${link.title}\n${link.url}`;
  a.append(iconNode(link, 'icon'), labelEl(link.title));
  if (ctx !== 'smart') a.append(badge());
  return a;
}

function folderTile(folder) {
  const d = el('div', 'tile folder');
  d.tabIndex = 0;
  d.setAttribute('role', 'button');
  d.dataset.id = folder.id;
  d.dataset.ctx = 'root';
  d.title = folder.name;
  const icon = el('span', 'icon folder-icon');
  for (const link of folder.items.slice(0, 9)) icon.append(iconNode(link, 'mini'));
  d.append(icon, labelEl(folder.name));
  if (folder.smart) {
    d.classList.add('smart');
    d.dataset.smart = folder.smart;
    icon.dataset.mark = SMART[folder.smart].mark;
  } else {
    d.append(badge());
  }
  return d;
}

function addTile() {
  const b = el('button', 'tile add');
  b.type = 'button';
  b.append(el('span', 'icon', '+'), el('span', 'label', t('addShortcut')));
  return b;
}

function rootTile(it) {
  if (!it.smart) return it.folder ? folderTile(it) : linkTile(it, 'root');
  const f = smartFolder(it);
  return f ? folderTile(f) : null;
}

function emptyCell() {
  return el('div', 'cell');
}

function render() {
  const { cols, rows } = rootPager.capacity();
  const per = cols * rows;
  const view = layoutState(state);
  const free = new Map();
  const blockTiles = [];
  for (const it of view.items) {
    const tile = rootTile(it);
    if (!tile) continue;
    if (Number.isInteger(it.p)) {
      tile.dataset.free = '1';
      free.set(it.p, tile);
    } else blockTiles.push(tile);
  }
  const flow = flowCells(blockTiles.length + 1, new Set(free.keys()), blockTiles.length + free.size + 1);
  const span = Math.max(flow[flow.length - 1], ...free.keys()) + 1;
  const cells = new Array(Math.max(1, Math.ceil(span / per)) * per).fill(null);
  for (const [p, tile] of free) cells[p] = tile;
  blockTiles.forEach((tile, i) => (cells[flow[i]] = tile));
  cells[flow[blockTiles.length]] = addTile();
  for (let i = 0; i < cells.length; i++) cells[i] ||= emptyCell();
  rootPager.render(cells);
  renderFolder();
  if (drag) markPlaceholder();
}

function flowCells(count, taken, total = count) {
  const { cols, rows, packed: pcols } = rootPager.capacity();
  const needed = Math.ceil(total / pcols);
  const rowOff = needed >= rows ? 0 : clamp(Math.floor((rows - needed) / 2) + 1, 0, rows - needed);
  const colOff = Math.floor((cols - pcols) / 2);
  blockArea = { rowOff, colOff, pcols, cols };
  const out = [];
  for (let r = rowOff; out.length < count; r++) {
    for (let c = colOff; c < colOff + pcols && out.length < count; c++) {
      if (!taken.has(r * cols + c)) out.push(r * cols + c);
    }
  }
  return out;
}

function inBlockArea(slot) {
  const { rowOff, colOff, pcols, cols } = blockArea;
  const c = slot % cols;
  return c >= colOff && c < colOff + pcols && Math.floor(slot / cols) >= rowOff;
}

function layoutState(s) {
  const { cols } = rootPager.capacity();
  const r = M.normalizeSlots(M.rebaseSlots(s, cols));
  if (r.cols === cols) return r;
  return { ...r, items: r.items.map(({ p, ...rest }) => rest) };
}

function rootCells() {
  return [...rootPager.track.querySelectorAll(':scope > .page > *')];
}

function startRootDrag() {
  drag.order = [];
  drag.free = new Map();
  drag.cell = null;
  rootCells().forEach((c, i) => {
    if (!c.dataset.id) return;
    if (c.dataset.free) drag.free.set(c.dataset.id, i);
    else drag.order.push(c.dataset.id);
  });
  if (drag.free.has(drag.id)) {
    drag.cell = drag.free.get(drag.id);
    drag.free.delete(drag.id);
  }
}

function layoutPreview() {
  const { cols, rows } = rootPager.capacity();
  const per = cols * rows;
  const nodes = new Map(rootCells().filter((c) => c.dataset.id).map((c) => [c.dataset.id, c]));
  const taken = new Set(drag.free.values());
  if (drag.cell !== null) taken.add(drag.cell);
  const order = drag.cell !== null ? drag.order.filter((id) => id !== drag.id) : drag.order;
  const flow = flowCells(order.length + 1, taken, nodes.size + 1);
  const span = Math.max(flow[flow.length - 1], ...taken) + 1;
  const pages = [...rootPager.track.children];
  while (pages.length * per < span) {
    const page = el('div', 'page');
    rootPager.track.append(page);
    pages.push(page);
  }
  const cells = new Array(pages.length * per).fill(null);
  for (const [id, slot] of drag.free) cells[slot] = nodes.get(id);
  if (drag.cell !== null) cells[drag.cell] = nodes.get(drag.id);
  order.forEach((id, i) => (cells[flow[i]] = nodes.get(id)));
  cells[flow[order.length]] = rootPager.track.querySelector('.tile.add');
  for (let i = 0; i < cells.length; i++) cells[i] ||= emptyCell();
  pages.forEach((page, i) => page.replaceChildren(...cells.slice(i * per, (i + 1) * per)));
  if (rootPager.pages !== pages.length) {
    rootPager.pages = pages.length;
    rootPager.go(rootPager.page, false);
  }
}

function previewBlock(targetId, before) {
  const order = drag.order.filter((id) => id !== drag.id);
  const at = targetId ? order.indexOf(targetId) : order.length;
  if (at < 0) return;
  order.splice(targetId ? (before ? at : at + 1) : at, 0, drag.id);
  drag.order = order;
  drag.cell = null;
  layoutPreview();
}

function previewCell(slot) {
  if (inBlockArea(slot)) return previewBlock(null);
  drag.order = drag.order.filter((id) => id !== drag.id).concat(drag.id);
  drag.cell = slot;
  layoutPreview();
}

function smartFolder(it) {
  const items = smartData[it.smart];
  if (!settings[it.smart] || !items) return null;
  return { id: it.id, folder: true, smart: it.smart, name: t(SMART[it.smart].name), items };
}

function findFolder(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return null;
  return it.smart ? smartFolder(it) : it.folder ? it : null;
}

function reconcileSmart() {
  let next = state;
  for (const kind of M.SMART_KINDS) next = M.setSmart(next, kind, settings[kind]);
  if (next !== state) commit(next);
}

function renderFolder() {
  const f = openFolderId ? findFolder(openFolderId) : null;
  if (!f) {
    openFolderId = null;
    $('#folderLayer').hidden = true;
    return;
  }
  $('#folderLayer').hidden = false;
  const input = $('#folderName');
  input.dataset.folderId = f.smart ? '' : f.id;
  input.readOnly = Boolean(f.smart);
  if (document.activeElement !== input) input.value = f.name;
  $('#folderEmpty').hidden = f.items.length > 0;
  folderPager.render(f.items.map((l) => linkTile(l, f.smart ? 'smart' : 'folder')));
}

function openFolder(id, focusName = false) {
  openFolderId = id;
  folderPager.page = 0;
  renderFolder();
  if (focusName && !findFolder(id)?.smart) {
    const input = $('#folderName');
    input.focus();
    input.select();
  }
}

function closeFolder() {
  const input = $('#folderName');
  if (document.activeElement === input) input.blur();
  openFolderId = null;
  $('#folderLayer').hidden = true;
}

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  $('#editBtn').hidden = on;
  $('#doneBtn').hidden = !on;
}

function pickState(s) {
  return s.cols ? { v: s.v, cols: s.cols, items: s.items } : { v: s.v, items: s.items };
}

async function commit(next) {
  state = pickState(layoutState(next));
  saved = state;
  render();
  await browser.storage.local.set({ state: { ...state, by: PAGE_ID, rev: Date.now() } });
}

function applyRemote(nv) {
  state = pickState(nv);
  saved = state;
  render();
  reconcileSmart();
}

async function refreshSmart() {
  const next = {
    recent: settings.recent && (await hasHistoryAccess()) ? await recentLinks() : null,
    frequent: settings.frequent ? await frequentLinks() : null,
  };
  const changed = JSON.stringify(next) !== JSON.stringify(smartData);
  smartData = next;
  if (changed && !drag) render();
}

async function saveSettings(next) {
  const wallChanged = JSON.stringify(cleanSettings(next).wallpaper) !== JSON.stringify(settings.wallpaper) || next.wallpaper?.t === 'f';
  settings = cleanSettings(next);
  if (wallChanged) applyWallpaper();
  await browser.storage.local.set({ settings: { ...settings, by: PAGE_ID, rev: Date.now() } });
  await syncSettingsPanel();
  reconcileSmart();
  await refreshSmart();
  render();
}

async function iconAccess() {
  try {
    return await browser.permissions.contains({ origins: ICON_ORIGINS });
  } catch {
    return false;
  }
}

async function syncSettingsPanel() {
  const history = await hasHistoryAccess();
  $('#setRecent').checked = settings.recent && history;
  $('#recentHint').hidden = !(settings.recent && !history);
  $('#setFrequent').checked = settings.frequent;
  $('#setIcons').checked = settings.icons;
  $('#iconsHint').hidden = !settings.icons || (await iconAccess());
}

function toggleSettings(show = $('#settingsPanel').hidden) {
  $('#settingsPanel').hidden = !show;
  if (show) syncSettingsPanel();
}

const WALL_TABS = { firefox: 'wallCatFirefox', 'solid-colors': 'wallCatColors', abstracts: 'wallCatAbstract', celestial: 'wallCatCelestial', photographs: 'wallCatPhotos', custom: 'wallCustom' };
let wallUrl = null;
let wallToken = 0;
let wallTab = 'firefox';
let wallDraft;
let draftBlob = null;

function showCredit(credit) {
  const box = $('#credit');
  box.hidden = !credit;
  if (!credit) return box.replaceChildren();
  const link = (text, href) => {
    const a = el('a', null, text);
    if (href) a.href = href;
    return a;
  };
  box.replaceChildren(`${t('wallBy')} `, link(credit.name, credit.nameUrl), ` ${t('wallOn')} `, link(credit.site, credit.siteUrl));
}

async function applyWallpaper(w = settings.wallpaper, preview = false) {
  const token = ++wallToken;
  const look = { blob: null, url: null, color: null, theme: 'dark', credit: null, position: 'center' };
  try {
    if (w?.t === 'c') {
      look.color = w.v;
      look.theme = luminance(w.v) > 0.45 ? 'light' : 'dark';
    } else if (w?.t === 'f') {
      look.blob = preview && draftBlob ? draftBlob : await customBlob();
    } else if (w?.t === 'm') {
      const item = (await catalog()).find((x) => x.id === w.id);
      if (item) {
        look.theme = item.theme;
        look.position = item.position;
        if (item.color) look.color = item.color;
        else {
          look.blob = await mozillaBlob(item, !preview);
          if (!look.blob) look.url = item.url;
          look.credit = item.credit;
        }
      }
    }
  } catch (e) {
    console.warn('[comfort-links] wallpaper', e);
  }
  if (token !== wallToken) return;
  const old = wallUrl;
  wallUrl = look.blob ? URL.createObjectURL(look.blob) : null;
  const src = wallUrl || look.url;
  const wall = $('#wall');
  wall.style.backgroundImage = src ? `url("${src}")` : '';
  wall.style.backgroundColor = look.color || '';
  wall.style.backgroundPosition = look.position;
  wall.hidden = !src && !look.color;
  document.body.dataset.wallTheme = wall.hidden ? 'dark' : look.theme;
  showCredit(wall.hidden ? null : look.credit);
  if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
}

function setWallTab(tab) {
  wallTab = tab;
  for (const b of $('#wallTabs').children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  $('#wallCustom').hidden = tab !== 'custom';
  $('#wallGrid').hidden = tab === 'custom';
  if (tab !== 'custom') renderWallGrid();
}

async function renderWallGrid() {
  const grid = $('#wallGrid');
  $('#wallError').hidden = true;
  let items;
  try {
    items = await catalog();
  } catch {
    grid.replaceChildren();
    $('#wallError').textContent = t('wallLoadError');
    $('#wallError').hidden = false;
    return;
  }
  const tab = wallTab;
  if (tab === 'custom') return;
  grid.replaceChildren(
    ...items.filter((x) => x.category === tab).map((item) => {
      const b = el('button', 'wall-thumb');
      b.type = 'button';
      b.dataset.id = item.id;
      const sel = wallDraft !== undefined ? wallDraft : settings.wallpaper;
      b.setAttribute('aria-pressed', String(sel?.t === 'm' && sel.id === item.id));
      if (item.color) b.style.background = item.color;
      else {
        const img = new Image();
        img.loading = 'lazy';
        img.alt = item.credit?.name || '';
        img.src = item.url;
        b.append(img);
      }
      return b;
    })
  );
}

function toggleWallPanel(show = $('#wallPanel').hidden) {
  $('#wallPanel').hidden = !show;
  if (!show) {
    if (wallDraft !== undefined) {
      wallDraft = undefined;
      draftBlob = null;
      applyWallpaper();
    }
    return;
  }
  toggleSettings(false);
  wallDraft = settings.wallpaper;
  draftBlob = null;
  $('#wallError').hidden = true;
  if (!$('#wallTabs').children.length) {
    $('#wallTabs').replaceChildren(
      ...Object.entries(WALL_TABS).map(([tab, key]) => {
        const b = el('button', null, t(key));
        b.type = 'button';
        b.dataset.tab = tab;
        b.setAttribute('role', 'tab');
        b.addEventListener('click', () => setWallTab(tab));
        return b;
      })
    );
  }
  const w = settings.wallpaper;
  setWallTab(w?.t === 'f' || w?.t === 'c' ? 'custom' : wallTab);
}

function chooseWallpaper(wallpaper) {
  wallDraft = wallpaper;
  applyWallpaper(wallpaper, true);
  for (const b of $('#wallGrid').children) b.setAttribute('aria-pressed', String(wallpaper?.t === 'm' && wallpaper.id === b.dataset.id));
}

async function confirmWallpaper() {
  const w = wallDraft === undefined ? settings.wallpaper : wallDraft;
  if (w?.t === 'f' && draftBlob) await saveCustom(draftBlob);
  wallDraft = undefined;
  draftBlob = null;
  $('#wallPanel').hidden = true;
  await saveSettings({ ...settings, wallpaper: w });
  if (w?.t === 'f') applyWallpaper();
}

function showStatus(s) {
  const note = $('#syncNote');
  const key = s?.status === 'quota' ? 'syncQuota' : s?.status === 'error' ? 'syncError' : null;
  note.hidden = !key;
  if (key) note.textContent = t(key);
}

function closeMenu() {
  menuOpen = false;
  $('#menu').hidden = true;
}

function showMenu(x, y, entries) {
  const menu = $('#menu');
  menu.replaceChildren(
    ...entries.map(([label, action]) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => {
        closeMenu();
        action();
      });
      return b;
    })
  );
  menu.hidden = false;
  menuOpen = true;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${clamp(x, 8, window.innerWidth - r.width - 8)}px`;
  menu.style.top = `${clamp(y, 8, window.innerHeight - r.height - 8)}px`;
  menu.querySelector('button')?.focus();
}

let linkDialogId = null;
let titleTouched = false;

function openLinkDialog(id) {
  linkDialogId = id;
  const item = id ? M.locate(state, id)?.item : null;
  $('#linkDialogTitle').textContent = t(id ? 'editShortcut' : 'addShortcut');
  $('#lTitle').value = item?.title || '';
  $('#lUrl').value = item?.url || '';
  $('#lError').hidden = true;
  titleTouched = Boolean(id);
  $('#linkDialog').showModal();
  (id ? $('#lTitle') : $('#lUrl')).focus();
}

let folderDialogId = null;

function askDeleteFolder(id) {
  const f = state.items.find((x) => x.id === id && x.folder);
  if (!f) return;
  folderDialogId = id;
  $('#folderDialogText').textContent = t('deleteFolderQuestion', f.name);
  $('#folderDialog').showModal();
}

function removeTile(id) {
  const loc = M.locate(state, id);
  if (!loc) return;
  if (loc.item.folder) askDeleteFolder(id);
  else commit(M.removeItem(state, id));
}

function smartLink(id) {
  for (const list of Object.values(smartData)) {
    const l = list?.find((x) => x.id === id);
    if (l) return l;
  }
  return null;
}

function pinToHome(link) {
  commit(M.addLink(state, { url: link.url, title: link.title }).state);
}

function tileEl(id, ctx) {
  const root = ctx === 'root' ? '#rootPager' : '#folderPager';
  return document.querySelector(`${root} .tile[data-id="${CSS.escape(id)}"]`);
}

function markPlaceholder() {
  for (const x of document.querySelectorAll('.tile.placeholder')) x.classList.remove('placeholder');
  tileEl(drag.id, drag.ctx)?.classList.add('placeholder');
}

function clearMerge() {
  if (!drag) return;
  clearTimeout(drag.mergeTimer);
  drag.mergeTimer = null;
  drag.candidate = null;
  drag.mergeId = null;
  for (const x of document.querySelectorAll('.merge-target')) x.classList.remove('merge-target');
}

function startDrag(e) {
  const tile = tileEl(press.id, press.ctx) || press.tile;
  const rect = tile.getBoundingClientRect();
  const ghost = tile.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.classList.remove('placeholder');
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  document.body.append(ghost);
  drag = {
    id: press.id,
    ctx: press.ctx,
    isFolder: tile.classList.contains('folder'),
    ghost,
    dx: press.x - rect.left,
    dy: press.y - rect.top,
    candidate: null,
    mergeId: null,
    mergeTimer: null,
    edgeDir: 0,
    edgeTimer: null,
    leaveTimer: null,
    reorderTimer: null,
    reorderKey: null,
  };
  document.body.classList.add('dragging');
  closeMenu();
  if (drag.ctx === 'root') startRootDrag();
  markPlaceholder();
  moveDrag(e);
}

function extractFromFolder() {
  if (!drag || drag.ctx === 'root') return;
  const at = state.items.findIndex((x) => x.id === openFolderId);
  if (drag.ctx === 'smart') {
    const link = smartLink(drag.id);
    if (!link) return;
    const added = M.addLink(state, { url: link.url, title: link.title }, null, at + 1);
    state = added.state;
    drag.id = added.id;
  } else {
    state = M.moveItem(state, drag.id, null, at + 1);
  }
  drag.ctx = 'root';
  drag.leaveTimer = null;
  clearMerge();
  closeFolder();
  render();
  startRootDrag();
}

function edgeFlip(e, pager) {
  const r = pager.view.getBoundingClientRect();
  const dir = drag.candidate ? 0 : e.clientX < r.left + 4 ? -1 : e.clientX > r.right - 4 ? 1 : 0;
  if (dir === drag.edgeDir) return;
  clearTimeout(drag.edgeTimer);
  drag.edgeDir = dir;
  drag.edgeTimer = null;
  if (!dir) return;
  const flip = () => {
    if (!drag || drag.edgeDir !== dir) return;
    pager.go(pager.page + dir);
    drag.edgeTimer = setTimeout(flip, EDGE_DELAY * 1.5);
  };
  drag.edgeTimer = setTimeout(flip, EDGE_DELAY);
}

function clearReorder() {
  if (!drag) return;
  clearTimeout(drag.reorderTimer);
  drag.reorderTimer = null;
  drag.reorderKey = null;
}

function placeNear(target, before) {
  const ph = tileEl(drag.id, drag.ctx);
  if (!ph || !target.isConnected) return;
  if (before && ph.nextSibling !== target) target.parentNode.insertBefore(ph, target);
  else if (!before && target.nextSibling !== ph) target.parentNode.insertBefore(ph, target.nextSibling);
}

function moveDrag(e) {
  drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px) scale(1.08)`;
  const pager = drag.ctx === 'root' ? rootPager : folderPager;

  if (drag.ctx !== 'root') {
    const r = document.querySelector('.folder-panel').getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (outside && !drag.leaveTimer) drag.leaveTimer = setTimeout(extractFromFolder, LEAVE_DELAY);
    if (!outside && drag.leaveTimer) {
      clearTimeout(drag.leaveTimer);
      drag.leaveTimer = null;
    }
  }

  if (drag.ctx === 'smart') return;
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const target = hit?.closest('.tile[data-id], .cell');
  if (target?.classList.contains('cell') && drag.ctx === 'root' && pager.view.contains(target)) {
    clearMerge();
    if (drag.reorderKey !== target) {
      clearReorder();
      drag.reorderKey = target;
      drag.reorderTimer = setTimeout(() => {
        if (drag?.reorderKey !== target || !target.isConnected) return;
        previewCell(rootCells().indexOf(target));
      }, REORDER_DELAY);
    }
    edgeFlip(e, pager);
    return;
  }
  if (!target || target.classList.contains('cell') || !pager.view.contains(target) || target.dataset.id === drag.id) {
    if (!target || target.dataset.id !== drag.id) {
      clearMerge();
      clearReorder();
    }
    edgeFlip(e, pager);
    return;
  }
  const icon = target.querySelector('.icon').getBoundingClientRect();
  const pad = icon.width * MERGE_INSET;
  const onIcon =
    e.clientX > icon.left + pad && e.clientX < icon.right - pad &&
    e.clientY > icon.top + pad && e.clientY < icon.bottom - pad;

  if (drag.ctx === 'root' && !drag.isFolder && !target.dataset.smart && onIcon) {
    clearReorder();
    const id = target.dataset.id;
    if (drag.candidate !== id) {
      clearMerge();
      drag.candidate = id;
      drag.mergeTimer = setTimeout(() => {
        if (!drag || drag.candidate !== id) return;
        drag.mergeId = id;
        tileEl(id, 'root')?.classList.add('merge-target');
      }, MERGE_DELAY);
    }
  } else {
    clearMerge();
    const before = e.clientX < icon.left + icon.width / 2;
    const key = `${target.dataset.id}${before ? '<' : '>'}`;
    if (drag.reorderKey !== key) {
      clearReorder();
      drag.reorderKey = key;
      drag.reorderTimer = setTimeout(() => {
        if (drag?.reorderKey !== key) return;
        if (drag.ctx !== 'root') placeNear(target, before);
        else if (!target.dataset.free && target.isConnected) previewBlock(target.dataset.id, before);
      }, REORDER_DELAY);
    }
  }
  edgeFlip(e, pager);
}

function armClickSuppression() {
  suppressClick = true;
  clearTimeout(suppressTimer);
  suppressTimer = setTimeout(() => (suppressClick = false), 400);
}

function endDrag() {
  const d = drag;
  drag = null;
  clearTimeout(d.mergeTimer);
  clearTimeout(d.reorderTimer);
  clearTimeout(d.edgeTimer);
  clearTimeout(d.leaveTimer);
  d.ghost.remove();
  document.body.classList.remove('dragging');
  armClickSuppression();
  if (d.ctx === 'smart') {
    render();
    return;
  }

  if (d.mergeId) {
    const target = M.locate(state, d.mergeId);
    if (target?.item.folder) return commit(M.moveItem(state, d.id, d.mergeId));
    const r = M.createFolder(state, d.id, d.mergeId, t('folderDefault'));
    if (r.id) {
      commit(r.state);
      openFolder(r.id, true);
      return;
    }
  }

  let next;
  if (d.ctx === 'folder') {
    const ids = [...document.querySelectorAll('#folderPager .tile[data-id]')].map((x) => x.dataset.id);
    next = M.reorder(state, openFolderId, ids);
  } else {
    const free = new Map(d.free);
    if (d.cell !== null) free.set(d.id, d.cell);
    const order = d.cell !== null ? d.order.filter((id) => id !== d.id) : d.order;
    next = M.setLayout(state, order, free, rootPager.capacity().cols);
  }
  if (!M.sameItems(next, saved)) return commit(next);
  if (pendingRemote) applyRemote(pendingRemote);
  else render();
  pendingRemote = null;
}

function onPointerMove(e) {
  if (!press || e.pointerId !== press.pointerId) return;
  if (!drag) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_START) return;
    clearTimeout(press.longTimer);
    startDrag(e);
    return;
  }
  moveDrag(e);
}

function onPointerUp(e) {
  if (!press || e.pointerId !== press.pointerId) return;
  clearTimeout(press.longTimer);
  if (press.long) armClickSuppression();
  press = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  if (drag) endDrag();
}

document.addEventListener('pointerdown', (e) => {
  suppressClick = false;
  if (e.button !== 0 || press || e.target.closest('.badge')) return;
  const tile = e.target.closest('.tile[data-id]');
  if (!tile) return;
  press = { id: tile.dataset.id, ctx: tile.dataset.ctx || 'root', tile, x: e.clientX, y: e.clientY, pointerId: e.pointerId, long: false };
  press.longTimer = setTimeout(() => {
    if (press && !drag) {
      press.long = true;
      setEditing(true);
    }
  }, LONG_PRESS);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
});

const CHROME = '.tile, #toolbar, #menu, dialog, #settingsPanel, #wallPanel, #credit, .folder-panel, .dots, #syncNote';

document.addEventListener('click', (e) => {
  if (suppressClick) {
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!$('#settingsPanel').hidden && !e.target.closest('#settingsPanel, #settingsBtn')) toggleSettings(false);
  if (!$('#wallPanel').hidden && !e.target.closest('#wallPanel, #wallOpen, #wallFile')) toggleWallPanel(false);
  const thumb = e.target.closest('.wall-thumb');
  if (thumb) return chooseWallpaper({ t: 'm', id: thumb.dataset.id });
  const b = e.target.closest('.badge');
  if (b) {
    e.preventDefault();
    removeTile(b.closest('.tile').dataset.id);
    return;
  }
  if (e.target.closest('.tile.add')) return openLinkDialog(null);
  const tile = e.target.closest('.tile[data-id]');
  if (tile?.classList.contains('folder')) return openFolder(tile.dataset.id);
  if (tile && editing && tile.dataset.ctx !== 'smart') {
    e.preventDefault();
    openLinkDialog(tile.dataset.id);
    return;
  }
  if (tile) return;
  if (e.target.closest('.backdrop')) {
    closeFolder();
    return;
  }
  if (editing && !e.target.closest(CHROME)) setEditing(false);
}, true);

document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('input, textarea, dialog, #settingsPanel')) return;
  e.preventDefault();
  const tile = e.target.closest('.tile[data-id]');
  if (tile) {
    const id = tile.dataset.id;
    if (tile.dataset.smart) {
      showMenu(e.clientX, e.clientY, [[t('open'), () => openFolder(id)], [t('settings'), () => toggleSettings(true)]]);
      return;
    }
    if (tile.dataset.ctx === 'smart') {
      const link = smartLink(id);
      if (!link) return;
      showMenu(e.clientX, e.clientY, [
        [t('openNewTab'), () => browser.tabs.create({ url: link.url })],
        [t('pinToHome'), () => pinToHome(link)],
      ]);
      return;
    }
    const loc = M.locate(state, id);
    if (!loc) return;
    if (loc.item.folder) {
      showMenu(e.clientX, e.clientY, [
        [t('open'), () => openFolder(id)],
        [t('rename'), () => openFolder(id, true)],
        [t('ungroup'), () => commit(M.ungroupFolder(state, id))],
        [t('deleteFolder'), () => askDeleteFolder(id)],
      ]);
    } else {
      showMenu(e.clientX, e.clientY, [
        [t('openNewTab'), () => browser.tabs.create({ url: loc.item.url })],
        [t('editShortcut'), () => openLinkDialog(id)],
        [t('remove'), () => commit(M.removeItem(state, id))],
      ]);
    }
    return;
  }
  showMenu(e.clientX, e.clientY, [
    [t('addShortcut'), () => openLinkDialog(null)],
    [t(editing ? 'done' : 'editLayout'), () => setEditing(!editing)],
    [t('settings'), () => toggleSettings(true)],
  ]);
});

document.addEventListener('pointerdown', (e) => {
  if (menuOpen && !e.target.closest('#menu')) closeMenu();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (menuOpen) closeMenu();
    else if (!$('#wallPanel').hidden) toggleWallPanel(false);
    else if (!$('#settingsPanel').hidden) toggleSettings(false);
    else if (openFolderId) closeFolder();
    else if (editing) setEditing(false);
    return;
  }
  if (e.target.closest('input, textarea, dialog') || menuOpen) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const pager = openFolderId ? folderPager : rootPager;
    pager.go(pager.page + (e.key === 'ArrowRight' ? 1 : -1));
  } else if (e.key === 'Enter' && e.target.closest('.tile.folder')) {
    openFolder(e.target.closest('.tile').dataset.id);
  }
});

$('#main').addEventListener('wheel', (e) => rootPager.wheel(e), { passive: true });
$('#folderPager').addEventListener('wheel', (e) => folderPager.wheel(e), { passive: true });
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', () => render());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshSmart();
});

$('#editBtn').addEventListener('click', () => setEditing(true));
$('#doneBtn').addEventListener('click', () => setEditing(false));
$('#settingsBtn').addEventListener('click', () => toggleSettings());

$('#setRecent').addEventListener('change', (e) => {
  if (!e.target.checked) return saveSettings({ ...settings, recent: false });
  browser.permissions.request({ permissions: ['history'] }).then(
    (granted) => saveSettings({ ...settings, recent: granted }),
    () => saveSettings({ ...settings, recent: false })
  );
});
$('#setFrequent').addEventListener('change', (e) => saveSettings({ ...settings, frequent: e.target.checked }));
$('#setIcons').addEventListener('change', (e) => {
  if (!e.target.checked) return saveSettings({ ...settings, icons: false });
  browser.permissions.request({ origins: ICON_ORIGINS }).finally(() => saveSettings({ ...settings, icons: true }));
});
$('#wallOpen').addEventListener('click', () => toggleWallPanel(true));
$('#layoutReset').addEventListener('click', () => {
  if (state.cols) commit(M.resetLayout(state));
  toggleSettings(false);
});
$('#wallUploadBtn').addEventListener('click', () => $('#wallFile').click());
$('#wallFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const err = !file.type.startsWith('image/') ? 'wallNotImage' : file.size > MAX_UPLOAD ? 'wallTooBig' : null;
  $('#wallError').hidden = !err;
  if (err) return ($('#wallError').textContent = t(err));
  draftBlob = file;
  chooseWallpaper({ t: 'f' });
});
$('#wallColor').addEventListener('change', (e) => chooseWallpaper({ t: 'c', v: e.target.value }));
$('#wallReset').addEventListener('click', () => chooseWallpaper(null));
$('#wallDone').addEventListener('click', () => confirmWallpaper());
$('#wallCancel').addEventListener('click', () => toggleWallPanel(false));
$('#iconsGrant').addEventListener('click', () => {
  browser.permissions.request({ origins: ICON_ORIGINS }).finally(() => syncSettingsPanel());
});

$('#folderName').addEventListener('change', (e) => {
  const id = e.target.dataset.folderId;
  if (id) commit(M.renameFolder(state, id, e.target.value || t('folderDefault')));
});
$('#folderName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.target.blur();
});

$('#linkForm').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'save') return;
  const url = M.normalizeUrl($('#lUrl').value);
  if (!url) {
    e.preventDefault();
    $('#lError').hidden = false;
    $('#lUrl').focus();
    return;
  }
  const title = $('#lTitle').value;
  commit(linkDialogId ? M.updateLink(state, linkDialogId, { url, title }) : M.addLink(state, { url, title }).state);
});

$('#lTitle').addEventListener('input', () => (titleTouched = $('#lTitle').value.trim() !== ''));
$('#lUrl').addEventListener('input', () => {
  if (titleTouched) return;
  const url = M.normalizeUrl($('#lUrl').value);
  $('#lTitle').value = url ? M.siteName(url) : '';
});

$('#folderDialog').addEventListener('close', () => {
  const v = $('#folderDialog').returnValue;
  const id = folderDialogId;
  folderDialogId = null;
  if (!id) return;
  if (v === 'keep') commit(M.ungroupFolder(state, id));
  else if (v === 'delete') {
    if (openFolderId === id) closeFolder();
    commit(M.deleteFolder(state, id));
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.syncStatus) showStatus(changes.syncStatus.newValue);
  const ns = changes.settings?.newValue;
  if (ns && ns.by !== PAGE_ID) {
    const wallChanged = JSON.stringify(cleanSettings(ns).wallpaper) !== JSON.stringify(settings.wallpaper);
    settings = cleanSettings(ns);
    if (wallChanged && wallDraft === undefined) applyWallpaper();
    if (!$('#settingsPanel').hidden) syncSettingsPanel();
    reconcileSmart();
    refreshSmart().then(render);
  }
  const nv = changes.state?.newValue;
  if (!nv || nv.by === PAGE_ID || !M.isValidState(nv)) return;
  if (drag) pendingRemote = nv;
  else applyRemote(nv);
});

function localize() {
  document.documentElement.lang = browser.i18n.getUILanguage();
  document.title = t('newTabTitle');
  for (const x of document.querySelectorAll('[data-i18n]')) x.textContent = t(x.dataset.i18n);
  for (const x of document.querySelectorAll('[data-i18n-aria]')) x.setAttribute('aria-label', t(x.dataset.i18nAria));
  for (const x of document.querySelectorAll('[data-i18n-title]')) x.title = t(x.dataset.i18nTitle);
}

async function init() {
  localize();
  const { state: s, settings: st, syncStatus } = await browser.storage.local.get(['state', 'settings', 'syncStatus']);
  if (st) settings = cleanSettings(st);
  applyWallpaper();
  if (M.isValidState(s)) {
    state = pickState(s);
    saved = state;
  } else {
    browser.runtime.sendMessage('ensure').catch(() => {});
  }
  showStatus(syncStatus);
  if (M.isValidState(s)) reconcileSmart();
  render();
  await refreshSmart();
  document.body.dataset.ready = '1';
}

init();
