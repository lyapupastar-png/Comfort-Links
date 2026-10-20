import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/lib/model.js';

const base = () => M.fromLinks([
  { url: 'https://a.example', title: 'A' },
  { url: 'https://b.example', title: 'B' },
  { url: 'https://c.example', title: 'C' },
]);
const titles = (s) => s.items.map((x) => (x.folder ? `[${x.name}:${x.items.map((y) => y.title).join(',')}]` : x.title)).join(' ');

test('normalizeUrl accepts sites and rejects junk', () => {
  assert.equal(M.normalizeUrl('example.com'), 'https://example.com/');
  assert.equal(M.normalizeUrl('http://x.org/a?b'), 'http://x.org/a?b');
  assert.equal(M.normalizeUrl('localhost:3000'), 'https://localhost:3000/');
  assert.equal(M.normalizeUrl('file:///Users/me/a.html'), 'file:///Users/me/a.html');
  for (const bad of ['', 'hello', 'javascript:alert(1)', 'a b.com', 'data:text/html,x', 'about:config']) assert.equal(M.normalizeUrl(bad), null, bad);
});

test('fromLinks dedupes and fills titles', () => {
  const s = M.fromLinks([{ url: 'https://x.org' }, { url: 'https://x.org/' }, { url: 'nope' }, { url: 'www.y.org', title: '  Y  ' }]);
  assert.equal(s.items.length, 2);
  assert.equal(s.items[0].title, 'X');
  assert.equal(s.items[1].title, 'Y');
  assert.ok(M.isValidState(s));
});

test('createFolder replaces target with folder of target and dragged', () => {
  const s = base();
  const [a, b] = s.items;
  const r = M.createFolder(s, a.id, b.id, 'Work');
  assert.ok(r.id);
  assert.equal(titles(r.state), '[Work:B,A] C');
  assert.equal(titles(s), 'A B C');
});

test('createFolder refuses folders, self and nesting', () => {
  const s = base();
  const [a, b, c] = s.items;
  const f = M.createFolder(s, a.id, b.id, 'F');
  assert.equal(M.createFolder(s, a.id, a.id, 'X').id, null);
  assert.equal(M.createFolder(f.state, c.id, f.id, 'X').id, null);
  assert.equal(M.createFolder(f.state, f.id, c.id, 'X').id, null);
  assert.equal(M.createFolder(f.state, c.id, a.id, 'X').id, null);
});

test('folder keeps its last shortcut and disappears only when emptied', () => {
  const s = base();
  const [a, b] = s.items;
  const { state: f, id } = M.createFolder(s, a.id, b.id, 'F');
  const at = f.items.findIndex((x) => x.id === id);
  const one = M.moveItem(f, a.id, null, at + 1);
  assert.equal(titles(one), '[F:B] A C');
  const none = M.moveItem(one, b.id, null, at + 1);
  assert.equal(titles(none), 'B A C');
});

test('moveItem into folder; removing shortcuts keeps folder until empty', () => {
  const s = base();
  const [a, b, c] = s.items;
  const { state: f, id } = M.createFolder(s, a.id, b.id, 'F');
  const g = M.moveItem(f, c.id, id);
  assert.equal(titles(g), '[F:B,A,C]');
  const h = M.removeItem(M.removeItem(g, a.id), c.id);
  assert.equal(titles(h), '[F:B]');
  assert.equal(titles(M.removeItem(h, b.id)), '');
});

test('folders cannot be moved into folders', () => {
  const s = base();
  const [a, b] = s.items;
  const { state: f, id } = M.createFolder(s, a.id, b.id, 'F');
  const s2 = M.addLink(f, { url: 'd.example', title: 'D' }).state;
  const e = M.addLink(s2, { url: 'e.example', title: 'E' }).state;
  const [, d, ee] = e.items;
  const { state: two, id: id2 } = M.createFolder(e, d.id, ee.id, 'G');
  assert.equal(titles(M.moveItem(two, id, id2)), titles(two));
});

test('rename, ungroup, delete folder', () => {
  const s = base();
  const [a, b] = s.items;
  const { state: f, id } = M.createFolder(s, a.id, b.id, 'F');
  assert.equal(M.renameFolder(f, id, '  Новая  папка ').items[0].name, 'Новая папка');
  assert.equal(M.renameFolder(f, id, '   ').items[0].name, 'F');
  assert.equal(titles(M.ungroupFolder(f, id)), 'B A C');
  assert.equal(titles(M.deleteFolder(f, id)), 'C');
});

test('reorder keeps unknown ids at the end', () => {
  const s = base();
  const [a, b, c] = s.items;
  assert.equal(titles(M.reorder(s, null, [c.id, a.id])), 'C A B');
  assert.equal(titles(M.reorder(s, null, [b.id, c.id, a.id])), 'B C A');
});

test('addLink and updateLink validate addresses', () => {
  const s = base();
  assert.throws(() => M.addLink(s, { url: 'bad' }), /invalid-url/);
  const { state, id } = M.addLink(s, { url: 'd.example', title: '' }, null, 0);
  assert.equal(state.items[0].title, 'D');
  const u = M.updateLink(state, id, { url: 'https://e.example/x', title: 'E' });
  assert.equal(M.locate(u, id).item.url, 'https://e.example/x');
  assert.throws(() => M.updateLink(state, id, { url: 'nope' }), /invalid-url/);
});

test('ids are unique', () => {
  let s = M.emptyState();
  for (let i = 0; i < 300; i++) s = M.addLink(s, { url: `https://s${i}.example` }).state;
  assert.equal(new Set(s.items.map((x) => x.id)).size, 300);
});

test('siteName gives a clean name from the address', () => {
  const cases = {
    'https://www.lostfilm.tv/series/abc/season_1/': 'Lostfilm',
    'https://github.com/user/repo': 'Github',
    'https://music.youtube.com/watch?v=1': 'Youtube Music',
    'https://mail.proton.me/u/0/inbox': 'Proton Mail',
    'https://m.facebook.com/': 'Facebook',
    'https://www.bbc.co.uk/news': 'Bbc',
    'https://en.wikipedia.org/wiki/Firefox': 'Wikipedia',
    'https://my-cool-site.com.ua/': 'My cool site',
    'http://localhost:3000/x': 'localhost',
    'http://192.168.1.10/': '192.168.1.10',
  };
  for (const [url, name] of Object.entries(cases)) assert.equal(M.siteName(url), name, url);
  assert.equal(M.addLink(M.emptyState(), { url: 'mail.proton.me/u/0' }).state.items[0].title, 'Proton Mail');
  assert.equal(M.addLink(M.emptyState(), { url: 'mail.proton.me', title: 'Моя почта' }).state.items[0].title, 'Моя почта');
});
