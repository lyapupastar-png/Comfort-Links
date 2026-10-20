import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/lib/model.js';
import * as S from '../../src/lib/syncpack.js';
import { cleanSettings, sameSettings, cleanWallpaper, DEFAULT_SETTINGS } from '../../src/lib/settings.js';

test('settings defaults: smart folders off, icons on, default wallpaper', () => {
  assert.deepEqual(cleanSettings(null), { recent: false, frequent: false, icons: true, wallpaper: null });
  assert.deepEqual(cleanSettings({ recent: 'yes', frequent: true, icons: 0, junk: 1 }), { recent: false, frequent: true, icons: true, wallpaper: null });
  assert.deepEqual(cleanSettings({ icons: false }), { ...DEFAULT_SETTINGS, icons: false });
  assert.ok(sameSettings({ frequent: false }, {}));
  assert.ok(!sameSettings({ frequent: true }, {}));
  assert.ok(!sameSettings({ wallpaper: { t: 'c', v: '#112233' } }, {}));
});

test('wallpaper choice is validated', () => {
  assert.deepEqual(cleanWallpaper({ t: 'm', id: 'a01be688-31cf-4f68-ac3e-e2cec09cb15a', x: 1 }), { t: 'm', id: 'a01be688-31cf-4f68-ac3e-e2cec09cb15a' });
  assert.deepEqual(cleanWallpaper({ t: 'c', v: '#AABBCC' }), { t: 'c', v: '#aabbcc' });
  assert.deepEqual(cleanWallpaper({ t: 'f', blob: 'x' }), { t: 'f' });
  for (const bad of [null, 'x', { t: 'c', v: 'red' }, { t: 'm' }, { t: 'm', id: 'x'.repeat(65) }, { t: 'z' }]) assert.equal(cleanWallpaper(bad), null);
});

test('settings travel in the cfg sync key', () => {
  const s = M.fromLinks([{ url: 'https://a.example' }]);
  const cfg = { recent: true, frequent: true, icons: false, wallpaper: { t: 'm', id: 'w1' } };
  const map = S.pack(s, { ...cfg, by: 'x' });
  assert.deepEqual(map.cfg, cfg);
  assert.ok(S.isManagedKey('cfg'));
  assert.deepEqual(S.unpackSettings(map), cfg);
  assert.equal(S.unpackSettings({}), null);
  assert.equal('cfg' in S.pack(s), false);
  const d = S.diff(map, S.pack(s, { ...cfg, wallpaper: null }));
  assert.deepEqual(Object.keys(d.set), ['cfg']);
});
