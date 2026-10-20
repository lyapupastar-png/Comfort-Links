import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/lib/model.js';
import * as S from '../../src/lib/syncpack.js';

const base = () => M.fromLinks(['a', 'b', 'c', 'd'].map((x) => ({ url: `https://${x}.example`, title: x.toUpperCase() })));
const ids = (s) => s.items.map((x) => x.id);
const view = (s) => s.items.map((x) => (Number.isInteger(x.p) ? `${x.title || x.name}@${x.p}` : x.title || x.name)).join(' ');

test('default layout: everything in the block, no cells', () => {
  const s = base();
  assert.equal(s.cols, undefined);
  assert.equal(view(s), 'A B C D');
});

test('setLayout keeps the block packed and places moved-out items in cells', () => {
  const s = base();
  const [a, b, c, d] = ids(s);
  const f = M.setLayout(s, [b, c, d], new Map([[a, 13]]), 8);
  assert.equal(f.cols, 8);
  assert.equal(view(f), 'B C D A@13');
  assert.ok(M.isValidState(f));
});

test('moving the last placed item back into the block returns to default layout', () => {
  const s = base();
  const [a, b, c, d] = ids(s);
  const f = M.setLayout(s, [b, c, d], new Map([[a, 13]]), 8);
  const back = M.setLayout(f, [a, b, c, d], new Map(), 8);
  assert.equal(back.cols, undefined);
  assert.equal(view(back), 'A B C D');
});

test('duplicate cells fall back into the block', () => {
  const s = base();
  const [a, b, c, d] = ids(s);
  const f = M.normalizeSlots({ ...s, cols: 8, items: s.items.map((x, i) => (i < 2 ? { ...x, p: 5 } : x)) });
  assert.equal(view(f), 'A@5 B C D');
  assert.ok([a, b, c, d].every(Boolean));
});

test('reset puts placed items at the end of the block in cell order', () => {
  const s = base();
  const [a, b, c, d] = ids(s);
  const f = M.setLayout(s, [c, a], new Map([[d, 3], [b, 1]]), 8);
  const r = M.resetLayout(f);
  assert.equal(r.cols, undefined);
  assert.equal(view(r), 'C A B D');
});

test('folder made from a placed item keeps its cell', () => {
  const s = base();
  const [a, b, c, d] = ids(s);
  const f = M.setLayout(s, [c, d, b], new Map([[a, 20]]), 8);
  const r = M.createFolder(f, b, a, 'F');
  const folder = r.state.items.find((x) => x.folder);
  assert.equal(folder.p, 20);
  assert.ok(folder.items.every((x) => x.p === undefined));
  assert.equal(view(r.state), 'C D F@20');
});

test('rebase keeps row and column when the page gets wider', () => {
  const s = base();
  const [a, b, c, d] = ids(s);
  const f = M.setLayout(s, [b, c, d], new Map([[a, 2 * 8 + 5]]), 8);
  const w = M.rebaseSlots(f, 12);
  assert.equal(w.items.find((x) => x.id === a).p, 2 * 12 + 5);
  assert.equal(M.rebaseSlots(f, 5), f);
});

test('layout travels through sync', () => {
  const s = M.setSmart(base(), 'recent', true);
  const [r, a, b, c, d] = ids(s);
  const f = M.setLayout(s, [a, b, c], new Map([[r, 0], [d, 30]]), 12);
  const map = S.pack(f);
  assert.equal(map['root.0'].cols, 12);
  const u = S.unpack(map);
  assert.equal(u.cols, 12);
  assert.deepEqual(u.items, f.items);
  assert.equal(S.unpack(S.pack(M.resetLayout(f))).cols, undefined);
});

test('invalid layout data is rejected', () => {
  assert.equal(M.isValidState({ v: 1, cols: 99, items: [] }), false);
  assert.ok(M.isValidState({ v: 1, cols: 20, items: [] }));
  assert.equal(M.isValidState({ v: 1, cols: 8, items: [{ id: 'a', url: 'https://a/', title: 'A', p: -1 }] }), false);
  assert.ok(!M.sameItems({ cols: 8, items: [] }, { cols: 7, items: [] }));
});
