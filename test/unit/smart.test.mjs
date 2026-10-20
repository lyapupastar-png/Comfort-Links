import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/lib/model.js';
import * as S from '../../src/lib/syncpack.js';

const base = () => M.fromLinks([{ url: 'https://a.example', title: 'A' }, { url: 'https://b.example', title: 'B' }]);

test('setSmart adds at start once and removes', () => {
  const s = M.setSmart(M.setSmart(base(), 'frequent', true), 'recent', true);
  assert.deepEqual(s.items.slice(0, 2).map((x) => x.id), ['~recent', '~frequent']);
  assert.ok(M.isValidState(s));
  assert.equal(M.setSmart(s, 'recent', true), s);
  assert.equal(M.setSmart(s, 'recent', false).items.some((x) => x.smart === 'recent'), false);
  assert.equal(M.setSmart(base(), 'bogus', true).items.length, 2);
});

test('smart folders reorder like folders but never merge or nest', () => {
  const s = M.setSmart(base(), 'recent', true);
  const [r, a, b] = s.items;
  assert.deepEqual(M.reorder(s, null, [a.id, b.id, r.id]).items.map((x) => x.id), [a.id, b.id, r.id]);
  assert.equal(M.createFolder(s, a.id, r.id, 'X').id, null);
  assert.equal(M.createFolder(s, r.id, a.id, 'X').id, null);
  const f = M.createFolder(s, a.id, b.id, 'F');
  assert.deepEqual(M.moveItem(f.state, r.id, f.id).items, f.state.items);
  assert.equal(M.removeItem(s, r.id).items.length, 2);
});

test('invalid smart entries are rejected', () => {
  assert.equal(M.isValidState({ v: 1, items: [{ id: '~x', smart: 'recent' }] }), false);
  assert.equal(M.isValidState({ v: 1, items: [{ id: '~recent', smart: 'other' }] }), false);
});

test('smart positions travel through sync', () => {
  const s = M.reorder(M.setSmart(base(), 'frequent', true), null, [base().items[0].id]);
  const s2 = M.setSmart(base(), 'frequent', true);
  const order = [s2.items[1].id, '~frequent', s2.items[2].id];
  const moved = M.reorder(s2, null, order);
  const map = S.pack(moved);
  assert.ok(map['root.0'].e.some((e) => e.s === 'frequent' && e.i === '~frequent'));
  assert.deepEqual(S.unpack(map).items, moved.items);
  assert.ok(M.isValidState(s));
});
