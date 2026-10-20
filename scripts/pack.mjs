import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comfort-links-pack-'));
execFileSync('npx', ['web-ext', 'build', '--source-dir', 'src', '--artifacts-dir', tmp, '--overwrite-dest'], { stdio: 'ignore' });
const zip = fs.readdirSync(tmp).find((f) => f.endsWith('.zip'));
fs.mkdirSync('release', { recursive: true });
const out = path.join('release', zip.replace(/\.zip$/, '.xpi'));
const part = out + '.part';
fs.copyFileSync(path.join(tmp, zip), part);
fs.renameSync(part, out);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('packed ' + path.resolve(out));
