import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/lib/model.js';
import * as S from '../../src/lib/syncpack.js';

function big(n, folders = 0, per = 30) {
  let s = M.emptyState();
  for (let i = 0; i < n; i++) s = M.addLink(s, { url: `https://site-number-${i}.example.com/some/longer/path?q=${i}`, title: `Сайт номер ${i} с длинным названием` }).state;
  for (let f = 0; f < folders; f++) {
    const ids = s.items.filter((x) => !x.folder).slice(0, per).map((x) => x.id);
    const r = M.createFolder(s, ids[1], ids[0], `Папка ${f}`);
    s = r.state;
    for (const id of ids.slice(2)) s = M.moveItem(s, id, r.id);
  }
  return s;
}

test('pack/unpack round trip', () => {
  const s = big(40, 2, 10);
  const map = S.pack(s);
  assert.deepEqual(S.unpack(map), { v: M.SCHEMA, items: s.items });
});

test('large structures are chunked within per-item limits', () => {
  const s = big(400, 3, 60);
  const map = S.pack(s);
  assert.ok(Object.keys(map).filter((k) => k.startsWith('root.')).length > 1);
  assert.ok(Object.keys(map).some((k) => /^f\.[a-z0-9]+\.1$/.test(k)));
  for (const [k, v] of Object.entries(map)) assert.ok(S.byteSize(k, v) <= S.SYNC_ITEM, k);
  assert.deepEqual(S.unpack(map).items, s.items);
});

test('checkLimits flags oversize totals', () => {
  assert.equal(S.checkLimits(S.pack(big(50))), null);
  assert.equal(S.checkLimits(S.pack(big(900))), 'total');
});

test('incomplete root is rejected, missing folder falls back to local copy', () => {
  const s = big(30, 1, 5);
  const map = S.pack(s);
  const folder = s.items.find((x) => x.folder);
  const noRoot = { ...map };
  delete noRoot['root.0'];
  assert.equal(S.unpack(noRoot), null);
  const noFolder = Object.fromEntries(Object.entries(map).filter(([k]) => !k.startsWith(`f.${folder.id}.`)));
  assert.equal(S.unpack(noFolder).items.some((x) => x.id === folder.id), false);
  assert.deepEqual(S.unpack(noFolder, s).items, s.items);
});

test('one-link folder from sync stays a folder', () => {
  const s = big(3, 1, 2);
  const map = S.pack(s);
  const f = s.items.find((x) => x.folder);
  map[`f.${f.id}.0`] = { ...map[`f.${f.id}.0`], e: map[`f.${f.id}.0`].e.slice(0, 1) };
  const u = S.unpack(map);
  const folder = u.items.find((x) => x.folder);
  assert.equal(folder.items.length, 1);
  assert.equal(u.items.length, 2);
});

test('diff writes only changed keys and removes stale managed keys', () => {
  const s = big(10, 1, 4);
  const map = S.pack(s);
  const current = { ...map, other: 1, 'f.gone.0': { c: 1, n: 'x', e: [] } };
  const same = S.diff(current, map);
  assert.deepEqual(same.set, {});
  assert.deepEqual(same.remove, ['f.gone.0']);
  const changed = S.pack(M.renameFolder(s, s.items.find((x) => x.folder).id, 'Другое'));
  const d = S.diff(map, changed);
  assert.deepEqual(Object.keys(d.set).length, 1);
  assert.ok(Object.keys(d.set)[0].startsWith('f.'));
});

test('unknown schema is ignored', () => {
  assert.equal(S.unpack({ v: 99, 'root.0': { c: 1, e: [] } }), null);
  assert.equal(S.hasData({}), false);
});
