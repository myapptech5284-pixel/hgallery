// Restores the binary build assets that live in this repo base64-encoded.
//
// GitHub's file API cannot take raw bytes through this connection, so the two
// small binaries the installer build needs (the app icon in .ico/.png form)
// are committed as `.b64` text next to this script.
//
// Run once after cloning, before `npm run electron:build`:
//     node build/restore-binaries.mjs
//
// Already restored files are left untouched, so it is safe to re-run.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const targets = ['icon.ico', 'icon.png'];

let restored = 0;
let skipped = 0;

for (const name of targets) {
  const out = join(here, name);
  const encoded = join(here, name + '.b64');

  if (existsSync(out)) {
    console.log(`skip   ${name} (already present)`);
    skipped++;
    continue;
  }
  if (!existsSync(encoded)) {
    console.log(`miss   ${name}.b64 not found`);
    continue;
  }

  const b64 = readFileSync(encoded, 'utf8').replace(/\s+/g, '');
  writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log(`decode ${name}.b64 -> ${name} (${Buffer.from(b64, 'base64').length} bytes)`);
  restored++;
}

console.log(`\ndone: ${restored} restored, ${skipped} already present`);
if (restored === 0 && skipped === 0) {
  console.log('nothing to do — icon assets are missing from this checkout');
}