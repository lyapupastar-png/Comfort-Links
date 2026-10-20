import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FF = process.env.FIREFOX_BIN || '/Applications/Firefox.app/Contents/MacOS/firefox';
const ID = 'comfortlinks@lyapupastar';
const UUID = '3c9d5e7f-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const PAGE = `moz-extension://${UUID}/newtab.html`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfort-links-e2e-'));

const opts = new firefox.Options().setBinary(FF);
if (!process.env.HEADFUL) opts.addArguments('-headless');
opts.addArguments('-width=1280', '-height=900');
opts.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ID]: UUID }));
opts.setPreference('extensions.webextOptionalPermissionPrompts', false);
const driver = await new Builder()
  .forBrowser('firefox')
  .setFirefoxOptions(opts)
  .setFirefoxService(new firefox.ServiceBuilder(require('geckodriver').path).addArguments('--allow-system-access'))
  .build();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
};

async function waitFor(fn, ms = 6000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn().catch((e) => e);
    if (last && !(last instanceof Error)) return last;
    await sleep(150);
  }
  return last instanceof Error ? null : last;
}

const storage = async (area) =>
  JSON.parse(await driver.executeAsyncScript(`const d=arguments[arguments.length-1];browser.storage.${area}.get(null).then(v=>d(JSON.stringify(v)),e=>d(JSON.stringify({error:String(e)})))`));
const setLocal = (obj) =>
  driver.executeAsyncScript(`const d=arguments[arguments.length-1];browser.storage.local.set(arguments[0]).then(()=>d(1),e=>d(String(e)))`, obj);
const setSync = (obj) =>
  driver.executeAsyncScript(`const d=arguments[arguments.length-1];browser.storage.sync.clear().then(()=>browser.storage.sync.set(arguments[0])).then(()=>d(1),e=>d(String(e)))`, obj);

const titles = (s) => (s.state?.items || []).filter((x) => !x.smart).map((x) => (x.folder ? `[${x.name}:${x.items.map((y) => y.title).join(',')}]` : x.title)).join(' ');
const rootIcon = (title) => driver.findElement(By.xpath(`//*[@id="rootPager"]//*[contains(@class,"tile") and @data-id and .//span[contains(@class,"label") and text()="${title}"]]//span[contains(@class,"icon")]`));
const folderIcon = (title) => driver.findElement(By.xpath(`//*[@id="folderPager"]//*[contains(@class,"tile") and @data-id and .//span[contains(@class,"label") and text()="${title}"]]//span[contains(@class,"icon")]`));
const visible = (css) => driver.executeScript(`const e=document.querySelector(arguments[0]);return !!e && !e.hidden && e.getClientRects().length>0;`, css);

try {
  const packDir = path.join(tmp, 'pack');
  execFileSync('npx', ['web-ext', 'build', '--source-dir', 'src', '--artifacts-dir', packDir, '--overwrite-dest'], { cwd: ROOT, stdio: 'ignore' });
  await driver.installAddon(path.join(packDir, fs.readdirSync(packDir).find((f) => f.endsWith('.zip'))), true);

  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript('const t=gBrowser.addTab(arguments[0],{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});gBrowser.selectedTab=t;', PAGE);
  await driver.setContext(firefox.Context.CONTENT);
  const handles = await driver.getAllWindowHandles();
  await driver.switchTo().window(handles[handles.length - 1]);
  await waitFor(async () => (await driver.getCurrentUrl()) === PAGE && (await driver.executeScript('return document.body.dataset.ready')) === '1', 10000);
  check('new tab page loads', (await driver.getCurrentUrl()) === PAGE);
  await driver.executeScript('window.__errors=[];addEventListener("error",(e)=>__errors.push(e.message));addEventListener("unhandledrejection",(e)=>__errors.push(String(e.reason)));');

  const first = await waitFor(async () => {
    const s = await storage('local');
    return s.state ? s : null;
  });
  check('first run creates state from Firefox shortcuts', Boolean(first?.state?.pristine && Array.isArray(first.state.items)), `items=${first?.state?.items?.length}`);

  await setLocal({
    state: {
      v: 1,
      by: 'test',
      rev: 1,
      items: [
        { id: 'aaa111', url: 'https://a.example/', title: 'Alpha' },
        { id: 'bbb222', url: 'https://b.example/', title: 'Beta' },
        { id: 'ccc333', url: 'https://c.example/', title: 'Gamma' },
      ],
    },
  });
  const seeded = await waitFor(async () => (await driver.findElements(By.css('#rootPager .tile[data-id]'))).length === 3);
  check('page picks up external state change', Boolean(seeded));

  await driver.actions({ async: true }).move({ origin: await rootIcon('Alpha') }).press().move({ origin: await rootIcon('Beta'), duration: 300 }).pause(900).release().perform();
  const merged = await waitFor(async () => {
    const s = await storage('local');
    return /^\[[^:]+:Beta,Alpha\] Gamma$/.test(titles(s)) ? s : null;
  });
  check('drag shortcut onto shortcut creates folder', Boolean(merged), titles(await storage('local')));
  check('new folder opens with name field focused', (await visible('#folderLayer')) && (await driver.executeScript('return document.activeElement?.id')) === 'folderName');

  const name = await driver.findElement(By.id('folderName'));
  await name.clear();
  await name.sendKeys('Работа', Key.ENTER);
  const renamed = await waitFor(async () => titles(await storage('local')) === '[Работа:Beta,Alpha] Gamma');
  check('folder rename is saved', Boolean(renamed), titles(await storage('local')));

  await driver.actions().sendKeys(Key.ESCAPE).perform();
  check('Escape closes folder', Boolean(await waitFor(async () => !(await visible('#folderLayer')))));

  await (await rootIcon('Работа')).click();
  check('click opens folder', Boolean(await waitFor(() => visible('#folderLayer'))));

  await driver.actions({ async: true }).move({ origin: await folderIcon('Beta') }).press().move({ x: 20, y: 20, origin: 'viewport', duration: 300 }).pause(800).release().perform();
  const one = await waitFor(async () => titles(await storage('local')) === '[Работа:Alpha] Beta Gamma');
  check('dragging one out of a two-item folder keeps the folder', Boolean(one), titles(await storage('local')));
  check('folder overlay closed after extraction', !(await visible('#folderLayer')));
  await (await rootIcon('Работа')).click();
  await waitFor(() => visible('#folderLayer'));
  await driver.actions({ async: true }).move({ origin: await folderIcon('Alpha') }).press().move({ x: 20, y: 20, origin: 'viewport', duration: 300 }).pause(800).release().perform();
  const emptied = await waitFor(async () => titles(await storage('local')) === 'Alpha Beta Gamma');
  check('folder disappears when its last shortcut is dragged out', Boolean(emptied), titles(await storage('local')));

  const alpha = await rootIcon('Alpha');
  const rect = await alpha.getRect();
  await driver.actions({ async: true }).move({ origin: await rootIcon('Gamma') }).press().move({ origin: alpha, x: -Math.floor(rect.width / 2) - 6, y: 0, duration: 300 }).pause(500).release().perform();
  const reordered = await waitFor(async () => titles(await storage('local')) === 'Gamma Alpha Beta');
  check('drag to the gap before an icon reorders', Boolean(reordered), titles(await storage('local')));

  const synced = await waitFor(async () => {
    const s = await storage('sync');
    const e = s['root.0']?.e || [];
    return e.map((x) => x.t).join(' ') === 'Gamma Alpha Beta' ? s : null;
  }, 8000);
  check('structure is mirrored to storage.sync', Boolean(synced), JSON.stringify((await storage('sync'))['root.0'] || null));

  await driver.findElement(By.id('editBtn')).click();
  check('edit mode shows remove badges', Boolean(await driver.executeScript(`const b=document.querySelector('#rootPager .badge');return b && getComputedStyle(b).display!=='none';`)));
  const badges = await driver.findElements(By.css('#rootPager .tile[data-id] .badge'));
  await badges[badges.length - 1].click();
  const removed = await waitFor(async () => titles(await storage('local')) === 'Gamma Alpha');
  check('badge removes shortcut', Boolean(removed), titles(await storage('local')));
  await driver.findElement(By.id('doneBtn')).click();
  check('Done leaves edit mode', !(await driver.executeScript('return document.body.classList.contains("editing")')));

  await driver.findElement(By.css('#rootPager .tile.add')).click();
  await waitFor(() => driver.executeScript('return document.getElementById("linkDialog").open'));
  await driver.findElement(By.id('lUrl')).sendKeys('not a url');
  await driver.findElement(By.css('#linkDialog button[value="save"]')).click();
  check('invalid address is rejected', (await driver.executeScript('return document.getElementById("linkDialog").open && !document.getElementById("lError").hidden')) === true);
  const url = await driver.findElement(By.id('lUrl'));
  await url.clear();
  await url.sendKeys('example.org');
  const autoTitle = await waitFor(async () => (await driver.findElement(By.id('lTitle')).getAttribute('value')) === 'Example');
  check('name is filled from the address while typing', Boolean(autoTitle), await driver.findElement(By.id('lTitle')).getAttribute('value'));
  await url.clear();
  await url.sendKeys('mail.proton.me/u/0/inbox');
  check('subdomain becomes part of the name', (await driver.findElement(By.id('lTitle')).getAttribute('value')) === 'Proton Mail');
  await url.clear();
  await url.sendKeys('example.org');
  await driver.findElement(By.id('lTitle')).clear();
  await driver.findElement(By.id('lTitle')).sendKeys('Example');
  await driver.findElement(By.css('#linkDialog button[value="save"]')).click();
  const added = await waitFor(async () => {
    const s = await storage('local');
    const last = s.state.items[s.state.items.length - 1];
    return last?.title === 'Example' && last.url === 'https://example.org/';
  });
  check('dialog adds shortcut', Boolean(added), titles(await storage('local')));

  await driver.actions().contextClick(await rootIcon('Alpha')).perform();
  const menuItems = await waitFor(async () => (await driver.findElements(By.css('#menu:not([hidden]) button'))).length === 3);
  check('context menu on shortcut', Boolean(menuItems));
  await driver.actions().sendKeys(Key.ESCAPE).perform();

  const many = Array.from({ length: 60 }, (_, i) => ({ id: `m${String(i).padStart(4, '0')}`, url: `https://s${i}.example/`, title: `S${i}` }));
  await setLocal({ state: { v: 1, by: 'test', rev: 5, items: many } });
  await waitFor(async () => (await driver.findElements(By.css('#rootPager .tile[data-id]'))).length === 60);
  const cols = Number(await driver.executeScript(`const t=[...document.querySelectorAll('#rootPager .page:first-child .tile[data-id]')];const top=t[0].getBoundingClientRect().top;return t.filter((x)=>x.getBoundingClientRect().top===top).length;`));
  const pageNow = () => driver.executeScript(`const d=[...document.querySelectorAll('#rootDots button')];return d.findIndex((b)=>b.getAttribute('aria-current')==='true');`);
  check('grid has several pages for edge tests', (await pageNow()) === 0, `cols=${cols}`);
  const slowDrop = async (from, to) => {
    const a = await rootIcon(from);
    const b = await rootIcon(to);
    await driver.actions({ async: true }).move({ origin: a }).press().move({ origin: b, x: -12, y: 8, duration: 500 }).pause(300).move({ origin: b, x: 10, y: -10, duration: 400 }).pause(1300).release().perform();
  };
  await slowDrop(`S${cols - 2}`, `S${cols - 1}`);
  const rightEdge = await waitFor(async () => {
    const it = (await storage('local')).state.items[cols - 2];
    return it?.folder && it.items.map((x) => x.title).join(',') === `S${cols - 1},S${cols - 2}` ? it : null;
  });
  check('folder is created on the last column without the target moving', Boolean(rightEdge), titles(await storage('local')).split(' ').slice(0, cols).join(' '));
  check('page did not flip while hovering the edge column', (await pageNow()) === 0);
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await waitFor(async () => !(await visible('#folderLayer')));
  await slowDrop('S1', 'S0');
  const leftEdge = await waitFor(async () => {
    const it = (await storage('local')).state.items[0];
    return it?.folder && it.items.map((x) => x.title).join(',') === 'S0,S1' ? it : null;
  });
  check('folder is created on the first column without the target moving', Boolean(leftEdge), titles(await storage('local')).split(' ').slice(0, cols).join(' '));
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await waitFor(async () => !(await visible('#folderLayer')));
  const firstFolderName = (await storage('local')).state.items[0].name;
  await slowDrop('S9', firstFolderName);
  const intoEdgeFolder = await waitFor(async () => (await storage('local')).state.items[0]?.items?.length === 3);
  check('shortcut can be dropped into a folder on the first column', Boolean(intoEdgeFolder), titles(await storage('local')).split(' ').slice(0, 3).join(' '));
  check('page still did not flip', (await pageNow()) === 0);
  if (await driver.executeScript('return document.body.classList.contains("editing")')) await driver.findElement(By.id('doneBtn')).click();

  await setLocal({ state: { v: 1, by: 'test', rev: 6, items: [0, 1, 2, 3, 4].map((i) => ({ id: `p${i}0000`, url: `https://p${i}.example/`, title: `P${i}` })) } });
  await waitFor(async () => (await driver.findElements(By.css('#rootPager .tile[data-id]'))).length === 5);
  const fcols = Number(await driver.executeScript(`return getComputedStyle(document.getElementById('rootPager')).getPropertyValue('--cols')`));
  const cellAt = (slot) => driver.findElement(By.css(`#rootPager .page > :nth-child(${slot + 1})`));
  const dropOnCell = async (title, slot) => {
    const cell = await cellAt(slot);
    await driver.actions({ async: true }).move({ origin: await rootIcon(title) }).press().move({ origin: cell, duration: 400 }).pause(600).release().perform();
  };
  const slotOf = async (id) => (await storage('local')).state.items.find((x) => x.id === id)?.p;
  const domSlot = (id) => driver.executeScript(`return [...document.querySelectorAll('#rootPager .page > *')].findIndex((x) => x.dataset.id === arguments[0]);`, id);
  const base = await domSlot('p00000');
  const per = Number(await driver.executeScript(`const p=getComputedStyle(document.getElementById('rootPager'));return p.getPropertyValue('--cols')*p.getPropertyValue('--rows');`));
  check('grid has empty cells around default shortcuts', base >= fcols, `first shortcut at cell ${base}, ${per} cells per page`);
  const addIdx = () => driver.executeScript(`return [...document.querySelectorAll('#rootPager .page > *')].findIndex((x)=>x.classList.contains('add'));`);
  const blockIdx = () => driver.executeScript(`return [...document.querySelectorAll('#rootPager .page > *')].map((x,i)=>x.dataset.id&&!x.dataset.free?i:-1).filter((i)=>i>=0);`);
  const plusRightAfterBlock = async () => {
    const b = await blockIdx();
    const a = await addIdx();
    return a > Math.max(...b) && a - Math.max(...b) <= fcols;
  };
  const blockOrder = async () => (await storage('local')).state.items.filter((x) => x.p === undefined && !x.smart).map((x) => x.title || x.name).join(' ');
  const farSlot = base - fcols + 5;
  await dropOnCell('P0', farSlot);
  const out1 = await waitFor(async () => {
    const s = (await storage('local')).state;
    return s.cols === fcols && s.items.find((x) => x.id === 'p00000')?.p === farSlot ? s : null;
  });
  check('shortcut moved out of the block into an empty cell above', Boolean(out1), JSON.stringify((await storage('local')).state.items.map((x) => [x.title, x.p])));
  check('it is shown in that cell', (await (await cellAt(farSlot)).getAttribute('data-id')) === 'p00000');
  check('block closes the gap: next shortcut takes its place', (await domSlot('p10000')) === base && (await blockOrder()) === 'P1 P2 P3 P4', `P1 at ${await domSlot('p10000')}`);
  check('“+” is last in the block', await plusRightAfterBlock());
  const rowStart = Math.floor(base / fcols) * fcols;
  await dropOnCell('P3', rowStart);
  check('shortcut can be placed outside the block (first column of the page)', Boolean(await waitFor(async () => (await slotOf('p30000')) === rowStart)));
  check('block closes the gap again', (await blockOrder()) === 'P1 P2 P4' && (await domSlot('p40000')) === base + 2);
  const below = base + fcols + 4;
  await dropOnCell('P1', below);
  check('dropping into an empty cell of the block puts it at the end of the block', Boolean(await waitFor(async () => (await blockOrder()) === 'P2 P4 P1')) && (await slotOf('p10000')) === undefined);
  check('block stays packed after that', (await domSlot('p20000')) === base && (await domSlot('p10000')) === base + 2 && (await plusRightAfterBlock()));
  await driver.actions({ async: true }).move({ origin: await rootIcon('P4') }).press().move({ origin: await rootIcon('P0'), duration: 400 }).pause(900).release().perform();
  const freeFolder = await waitFor(async () => (await storage('local')).state.items.find((x) => x.folder && x.p === farSlot));
  check('folder made on a moved-out shortcut keeps that cell; block closes the gap', Boolean(freeFolder) && (await blockOrder()) === 'P2 P1', JSON.stringify((await storage('local')).state.items.map((x) => [x.title || x.name, x.p])));
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await waitFor(async () => !(await visible('#folderLayer')));
  check('layout is synced', Boolean(await waitFor(async () => (await storage('sync'))['root.0']?.cols === fcols, 8000)));
  const pagesNow = (await driver.findElements(By.css('#rootPager .page'))).length;
  const r3 = await (await rootIcon('P3')).getRect();
  await driver.actions({ async: true }).move({ origin: await rootIcon('P3') }).press().move({ x: 8, y: Math.round(r3.y), origin: 'viewport', duration: 300 }).pause(400).perform();
  const pagesDuring = (await driver.findElements(By.css('#rootPager .page'))).length;
  await driver.actions({ async: true }).release().perform();
  check('no new page is added while dragging', pagesDuring === pagesNow, `${pagesNow} -> ${pagesDuring}`);
  const addBefore = await addIdx();
  const p2 = await rootIcon('P2');
  const p2r = await p2.getRect();
  await driver.actions({ async: true }).move({ origin: await rootIcon('P1') }).press().move({ origin: p2, x: -Math.floor(p2r.width / 2) - 6, y: 0, duration: 300 }).pause(500).perform();
  const addDuring = await addIdx();
  await driver.actions({ async: true }).release().perform();
  check('while reordering inside the block “+” does not move', addDuring === addBefore, `${addBefore}->${addDuring}`);
  check('drop on a gap inside the block reorders it', Boolean(await waitFor(async () => (await blockOrder()) === 'P1 P2')));
  await driver.findElement(By.id('settingsBtn')).click();
  await driver.findElement(By.id('layoutReset')).click();
  const reset = await waitFor(async () => {
    const s = (await storage('local')).state;
    return !s.cols && s.items.every((x) => x.p === undefined) ? s.items.map((x) => x.title || x.name).join(' ') : null;
  });
  check('Default view brings everything back into the block', reset === `P1 P2 ${freeFolder?.name} P3`, String(reset));
  check('block is packed with “+” last', (await domSlot('p20000')) === (await domSlot('p10000')) + 1 && (await plusRightAfterBlock()));
  if (await driver.executeScript('return document.body.classList.contains("editing")')) await driver.findElement(By.id('doneBtn')).click();
  await setLocal({ state: { v: 1, by: 'test', rev: 7, items: Array.from({ length: 24 }, (_, i) => (i === 0 ? { id: 'fz0000', folder: true, name: 'Zfold', items: [{ id: 'fz0001', url: 'https://z1.example/', title: 'Z1' }, { id: 'fz0002', url: 'https://z2.example/', title: 'Z2' }] } : { id: `r${String(i).padStart(5, '0')}`, url: `https://r${i}.example/`, title: `R${i}` })) } });
  await waitFor(async () => (await driver.findElements(By.css('#rootPager .tile[data-id]'))).length === 24);
  const firstY = (await (await rootIcon('Zfold')).getRect()).y;
  const zStart = await domSlot('fz0000');
  await dropOnCell('Zfold', fcols - 1);
  check('folder moved from the first block cell to the top-right corner', Boolean(await waitFor(async () => (await slotOf('fz0000')) === fcols - 1)));
  fs.mkdirSync(path.join(ROOT, 'test-output'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'test-output', 'plus.png'), await driver.takeScreenshot(), 'base64');
  check('the block closes the gap (R1 takes the first cell)', (await domSlot('r00001')) === zStart);
  const r1y = (await (await rootIcon('R1')).getRect()).y;
  check('the block does not jump: R1 is on the same row where the folder was', Math.abs(r1y - firstY) < 2, `before=${Math.round(firstY)} after=${Math.round(r1y)}`);
  check('“+” goes right after the last shortcut of the block', (await addIdx()) === (await domSlot('r00023')) + 1);
  await driver.findElement(By.css('#rootPager .tile.add')).click();
  await waitFor(() => driver.executeScript('return document.getElementById("linkDialog").open'));
  await driver.findElement(By.id('lUrl')).sendKeys('newsite.example');
  const plusWas = await addIdx();
  await driver.findElement(By.css('#linkDialog button[value="save"]')).click();
  const newAt = await waitFor(async () => {
    const it = (await storage('local')).state.items.find((x) => x.url === 'https://newsite.example/');
    return it ? await domSlot(it.id) : null;
  });
  check('new shortcut takes the place of “+”', newAt === plusWas && (await plusRightAfterBlock()), `new=${newAt} plusWas=${plusWas}`);
  await driver.findElement(By.id('settingsBtn')).click();
  await driver.findElement(By.id('layoutReset')).click();
  await waitFor(async () => !(await storage('local')).state.cols);

  if (await driver.executeScript('return document.body.classList.contains("editing")')) await driver.findElement(By.id('doneBtn')).click();

  console.log('permissions:', await driver.executeAsyncScript(`const d=arguments[arguments.length-1];browser.permissions.getAll().then((p)=>d(JSON.stringify(p)))`));

  await driver.findElement(By.id('editBtn')).click();
  await driver.actions().move({ x: 640, y: 40, origin: 'viewport' }).click().perform();
  check('click on empty space leaves edit mode', (await driver.executeScript('return document.body.classList.contains("editing")')) === false);

  await setLocal({
    state: {
      v: 1,
      by: 'test',
      rev: 2,
      items: [
        { id: 'gh0001', url: 'https://github.com/', title: 'GitHub' },
        { id: 'sc0001', url: 'https://soundcloud.com/', title: 'SoundCloud' },
        { id: 'nx0001', url: 'https://nonexistent-site-xyz123.com/', title: 'Nowhere' },
        { id: 'fo0001', folder: true, name: 'Папка', items: [{ id: 'pm0001', url: 'https://proton.me/', title: 'Proton' }, { id: 'yt0001', url: 'https://music.youtube.com/', title: 'YT Music' }] },
      ],
    },
  });
  const icons = await waitFor(async () => {
    const r = await driver.executeScript(`const q=(s)=>document.querySelector(s);const w=(id)=>{const i=q('#rootPager .tile[data-id="'+id+'"] .icon img');return i&&i.complete&&i.naturalWidth>0?i.naturalWidth:0;};return {gh:w('gh0001'),sc:w('sc0001'),nx:!!q('#rootPager .tile[data-id="nx0001"] .icon img'),minis:[...document.querySelectorAll('#rootPager .tile[data-id="fo0001"] .mini img')].filter((i)=>i.complete&&i.naturalWidth>0).length};`);
    return r.gh && r.sc && r.minis === 2 ? r : null;
  }, 25000);
  check('site icons load (tiles and folder preview)', Boolean(icons), JSON.stringify(icons));
  await sleep(1500);
  check('unknown site keeps letter icon', (await driver.executeScript(`return !document.querySelector('#rootPager .tile[data-id="nx0001"] .icon img')`)) === true);
  const cached = await driver.executeAsyncScript(`const d=arguments[arguments.length-1];const r=indexedDB.open('comfort-links');r.onsuccess=()=>{const g=r.result.transaction('icons').objectStore('icons').getAllKeys();g.onsuccess=()=>d(g.result.join(','));};r.onerror=()=>d('ERR');`);
  check('icons are cached in IndexedDB', /github\.com/.test(cached) && /nonexistent-site-xyz123\.com/.test(cached), cached);

  const prev = await driver.executeScript(`const icon=document.querySelector('#rootPager .tile[data-id="fo0001"] .folder-icon').getBoundingClientRect();const m=[...document.querySelectorAll('#rootPager .tile[data-id="fo0001"] .mini')].map((x)=>x.getBoundingClientRect());return {top0:Math.round(m[0].top-icon.top),top1:Math.round(m[1].top-icon.top),left0:Math.round(m[0].left-icon.left),left1:Math.round(m[1].left-icon.left),h:Math.round(icon.height)};`);
  check('folder preview fills top row from the left', prev.top0 === prev.top1 && prev.top0 < prev.h / 3 && prev.left0 < prev.left1 && prev.left0 < prev.h / 3, JSON.stringify(prev));

  await (await rootIcon('Папка')).click();
  await waitFor(() => visible('#folderLayer'));
  const lay = await driver.executeScript(`const page=document.querySelector('#folderPager .page').getBoundingClientRect();const t=[...document.querySelectorAll('#folderPager .tile')].map((x)=>x.getBoundingClientRect());return {dTop:Math.round(t[0].top-page.top),dLeft:Math.round(t[0].left-page.left),sameRow:t[0].top===t[1].top,h:Math.round(page.height),w:Math.round(page.width)};`);
  check('open folder fills from top-left, fixed grid size', lay.dTop === 0 && lay.dLeft === 0 && lay.sameRow && lay.h >= 2 * 130 && lay.w >= 3 * 86, JSON.stringify(lay));
  await driver.actions().move({ x: 30, y: 30, origin: 'viewport' }).click().perform();
  check('click outside folder closes it', Boolean(await waitFor(async () => !(await visible('#folderLayer')))));

  await driver.findElement(By.id('settingsBtn')).click();
  check('settings panel opens', await visible('#settingsPanel'));
  await driver.findElement(By.id('setFrequent')).click();
  const freq = await waitFor(async () => (await driver.findElements(By.css('#rootPager .tile[data-smart="frequent"]'))).length === 1, 8000);
  check('“Most visited” folder appears when enabled', Boolean(freq));

  const pageHandle = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  await driver.get('https://example.com/');
  await sleep(1500);
  await driver.close();
  await driver.switchTo().window(pageHandle);
  if (!(await visible('#settingsPanel'))) await driver.findElement(By.id('settingsBtn')).click();
  await driver.findElement(By.id('setRecent')).click();
  const recent = await waitFor(async () => {
    await driver.executeScript('document.dispatchEvent(new Event("visibilitychange"))');
    return driver.executeScript(`return [...document.querySelectorAll('#rootPager .tile[data-smart="recent"] .mini')].length > 0`);
  }, 10000);
  check('“Recent” folder appears with visited sites', Boolean(recent));
  const recentFirst = await waitFor(async () => {
    const r = await driver.executeScript(`return document.querySelector('#rootPager .tile[data-smart="recent"]') ? 1 : 0`);
    return r || null;
  });
  await driver.findElement(By.css('#rootPager .tile[data-smart="recent"] .icon')).click();
  await waitFor(() => visible('#folderLayer'));
  const smartTile = await driver.findElement(By.css('#folderPager .tile[data-ctx="smart"]'));
  const smartUrl = await smartTile.getAttribute('href');
  const smartCount = (await driver.findElements(By.css('#folderPager .tile[data-ctx="smart"]'))).length;
  await driver.actions({ async: true }).move({ origin: await smartTile.findElement(By.css('.icon')) }).press().move({ x: 20, y: 20, origin: 'viewport', duration: 300 }).pause(800).release().perform();
  const pinned = await waitFor(async () => {
    const items = (await storage('local')).state.items;
    const i = items.findIndex((x) => x.url === smartUrl && !x.smart);
    return i >= 0 && items[i - 1]?.id === '~recent' ? items[i] : null;
  });
  check('shortcut from “Recent” can be dragged out to the home screen', Boolean(recentFirst && pinned), `${smartUrl} -> ${JSON.stringify(pinned)}`);
  check('“Recent” folder itself is unchanged', !(await visible('#folderLayer')) && (await storage('local')).state.items.some((x) => x.id === '~recent') && Boolean(await waitFor(async () => {
    await driver.findElement(By.css('#rootPager .tile[data-smart="recent"] .icon')).click();
    await waitFor(() => visible('#folderLayer'));
    const n = (await driver.findElements(By.css('#folderPager .tile[data-ctx="smart"]'))).length;
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    return n === smartCount;
  })), `before=${smartCount}`);
  if (!(await visible('#settingsPanel'))) await driver.findElement(By.id('settingsBtn')).click();
  const cfg = await waitFor(async () => {
    const c = (await storage('sync')).cfg;
    return c && c.recent && c.frequent ? c : null;
  }, 8000);
  check('settings are mirrored to Mozilla account (cfg)', Boolean(cfg), JSON.stringify(cfg));
  const orderBefore = (await storage('local')).state.items.map((x) => x.id).join(',');
  const sc = await rootIcon('SoundCloud');
  const scRect = await sc.getRect();
  const recentIcon = await driver.findElement(By.css('#rootPager .tile[data-smart="recent"] .icon'));
  await driver.actions({ async: true }).move({ origin: recentIcon }).press().move({ origin: sc, x: Math.floor(scRect.width / 2) + 6, y: 0, duration: 300 }).pause(500).release().perform();
  const moved = await waitFor(async () => {
    const ids = (await storage('local')).state.items.map((x) => x.id);
    return ids.indexOf('~recent') === ids.indexOf('sc0001') + 1 ? ids.join(',') : null;
  });
  check('smart folder can be dragged to a new place', Boolean(moved), `${orderBefore} -> ${(await storage('local')).state.items.map((x) => x.id).join(',')}`);
  const syncedSmart = await waitFor(async () => {
    const e = (await storage('sync'))['root.0']?.e || [];
    const i = e.findIndex((x) => x.s === 'recent');
    return i > 0 && e[i - 1].i === 'sc0001';
  }, 8000);
  check('smart folder position is synced', Boolean(syncedSmart));
  if (!(await visible('#settingsPanel'))) await driver.findElement(By.id('settingsBtn')).click();
  await driver.findElement(By.id('setFrequent')).click();
  check('“Most visited” folder hides when disabled', Boolean(await waitFor(async () => (await driver.findElements(By.css('#rootPager .tile[data-smart="frequent"]'))).length === 0)));
  check('disabling removes it from the structure', !(await storage('local')).state.items.some((x) => x.id === '~frequent'));
  await driver.actions().move({ x: 640, y: 40, origin: 'viewport' }).click().perform();
  check('click outside closes settings', !(await visible('#settingsPanel')));

  const revoked = await driver.executeAsyncScript(`const d=arguments[arguments.length-1];browser.permissions.remove({origins:['https://firefox-settings-attachments.cdn.mozilla.net/*']}).then(()=>browser.permissions.contains({origins:['https://firefox-settings-attachments.cdn.mozilla.net/*']})).then((c)=>d(!c),(e)=>d(String(e)))`);
  check('CDN permission revoked (updated add-on case)', revoked === true, String(revoked));
  const wallState = () => driver.executeScript(`const w=document.getElementById('wall');return {hidden:w.hidden,img:w.style.backgroundImage,color:w.style.backgroundColor,theme:document.body.dataset.wallTheme,credit:document.getElementById('credit').hidden?'':document.getElementById('credit').textContent};`);
  const openWall = async () => {
    if (!(await visible('#settingsPanel'))) await driver.findElement(By.id('settingsBtn')).click();
    await driver.findElement(By.id('wallOpen')).click();
  };
  const tab = async (name) => {
    await driver.findElement(By.css(`#wallTabs button[data-tab="${name}"]`)).click();
    await waitFor(async () => name === 'custom' || (await driver.findElements(By.css('#wallGrid .wall-thumb'))).length > 0);
  };
  const savedWall = async () => (await storage('local')).settings?.wallpaper ?? null;
  await openWall();
  const firefoxThumbs = await waitFor(async () => (await driver.findElements(By.css('#wallGrid .wall-thumb'))).length || null, 15000);
  check('background panel shows Mozilla catalog', Boolean(firefoxThumbs), `firefox thumbs=${firefoxThumbs}`);
  await tab('photographs');
  check('only the selected tab section is visible', (await visible('#wallGrid')) && !(await visible('#wallCustom')));
  await driver.findElement(By.css('#wallGrid .wall-thumb')).click();
  const photo = await waitFor(async () => {
    const s = await wallState();
    return !s.hidden && s.img.startsWith('url("https://firefox-settings-attachments') && s.credit ? s : null;
  }, 20000);
  check('choosing a photo previews it as background with credit', Boolean(photo), JSON.stringify(photo || (await wallState())));
  const painted = await driver.executeAsyncScript(`const d=arguments[arguments.length-1];const m=getComputedStyle(document.getElementById('wall')).backgroundImage.match(/url\\("(.+)"\\)/);if(!m)return d(0);const i=new Image();i.onload=()=>d(i.naturalWidth);i.onerror=()=>d(-1);i.src=m[1];`);
  check('photo background actually loads without CDN permission', painted > 0, `naturalWidth=${painted}`);
  check('preview is not saved before Done', (await savedWall()) === null && (await visible('#wallPanel')));
  await driver.findElement(By.id('wallDone')).click();
  const photoId = await waitFor(async () => (await savedWall())?.t === 'm' ? (await savedWall()).id : null);
  check('Done saves the choice and closes panel', Boolean(photoId) && !(await visible('#wallPanel')));
  check('saved choice is synced', Boolean(await waitFor(async () => (await storage('sync')).cfg?.wallpaper?.id === photoId, 8000)));

  await openWall();
  await tab('solid-colors');
  await driver.findElement(By.css('#wallGrid .wall-thumb')).click();
  check('solid color previews', Boolean(await waitFor(async () => {
    const s = await wallState();
    return !s.hidden && !s.img && s.color && !s.credit;
  })), JSON.stringify(await wallState()));
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  const reverted = await waitFor(async () => {
    const s = await wallState();
    return !(await visible('#wallPanel')) && s.img.startsWith('url("https://firefox-settings-attachments') && s.credit ? s : null;
  });
  check('Escape cancels preview and restores saved background', Boolean(reverted) && (await savedWall())?.id === photoId, JSON.stringify(await wallState()));

  await openWall();
  await tab('custom');
  check('custom tab hides catalog grid', (await visible('#wallCustom')) && !(await visible('#wallGrid')));
  const png = path.join(tmp, 'wall.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwHwyYGBgYGBgYAEcnBP0uI4/2AAAAAElFTkSuQmCC', 'base64'));
  await driver.findElement(By.id('wallFile')).sendKeys(png);
  check('uploaded image previews', Boolean(await waitFor(async () => {
    const s = await wallState();
    return !s.hidden && s.img.startsWith('url("blob:') && !s.credit;
  })));
  await driver.findElement(By.id('wallCancel')).click();
  check('Cancel restores saved background', Boolean(await waitFor(async () => (await wallState()).credit && !(await visible('#wallPanel')))));
  const noCustom = await driver.executeAsyncScript(`const d=arguments[arguments.length-1];const r=indexedDB.open('comfort-links');r.onsuccess=()=>{const g=r.result.transaction('wallpapers').objectStore('wallpapers').get('custom');g.onsuccess=()=>d(!g.result);};`);
  check('cancelled upload is not stored', noCustom === true);

  await openWall();
  await tab('custom');
  await driver.findElement(By.id('wallFile')).sendKeys(png);
  await waitFor(async () => !(await wallState()).credit);
  await driver.findElement(By.id('wallDone')).click();
  check('Done saves uploaded image', Boolean(await waitFor(async () => (await savedWall())?.t === 'f')));
  await driver.navigate().refresh();
  await waitFor(async () => (await driver.executeScript('return document.body.dataset.ready')) === '1', 10000);
  check('uploaded background survives page reload', Boolean(await waitFor(async () => {
    const s = await wallState();
    return !s.hidden && s.img.startsWith('url("blob:') && !s.credit;
  })));
  await driver.executeScript('window.__errors=[];addEventListener("error",(e)=>__errors.push(e.message));addEventListener("unhandledrejection",(e)=>__errors.push(String(e.reason)));');

  await openWall();
  await driver.executeScript(`const i=document.getElementById('wallColor');i.value='#f4f0e6';i.dispatchEvent(new Event('change',{bubbles:true}));`);
  check('light custom color switches labels to dark', Boolean(await waitFor(async () => {
    const s = await wallState();
    return s.color && !s.img && s.theme === 'light';
  })), JSON.stringify(await wallState()));
  await driver.actions().move({ x: 640, y: 40, origin: 'viewport' }).click().perform();
  check('click outside closes panel and cancels preview', !(await visible('#wallPanel')) && Boolean(await waitFor(async () => (await wallState()).img.startsWith('url("blob:'))));

  await openWall();
  await tab('custom');
  await driver.findElement(By.id('wallReset')).click();
  await driver.findElement(By.id('wallDone')).click();
  check('reset + Done returns default background', Boolean(await waitFor(async () => {
    const s = await wallState();
    return s.hidden && s.theme === 'dark' && (await savedWall()) === null;
  })), JSON.stringify(await wallState()));

  await setSync({ v: 1, 'root.0': { c: 1, e: [{ i: 'rem001', u: 'https://remote.example/', t: 'Remote' }, { i: 'fol001', f: 1 }] }, 'f.fol001.0': { c: 1, n: 'Облако', e: [{ i: 'r1', u: 'https://r1.example/', t: 'R1' }, { i: 'r2', u: 'https://r2.example/', t: 'R2' }] } });
  const pulled = await waitFor(async () => titles(await storage('local')) === 'Remote [Облако:R1,R2]', 10000);
  check('remote change from Mozilla account is applied', Boolean(pulled), titles(await storage('local')));
  check('enabled smart folder is restored after remote change', Boolean(await waitFor(async () => (await storage('local')).state.items.some((x) => x.id === '~recent'))));
  const shown = await waitFor(async () => (await driver.findElements(By.css('#rootPager .tile.folder:not(.smart)'))).length === 1);
  check('page re-renders after remote change', Boolean(shown));

  const errors = await driver.executeScript('return window.__errors || []');
  check('no page errors captured', errors.length === 0, errors.join('; '));
} catch (e) {
  check('e2e run', false, e.stack || String(e));
} finally {
  await driver.quit().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
