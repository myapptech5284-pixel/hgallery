const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');

// Extract and check the bundle in v39f
const asarPath = 'dist-installer-v39f/win-unpacked/resources/app.asar';
const list = asar.listPackage(asarPath);
const matches = list.filter(p => /index-.*\.js$/.test(p) && !p.includes('node_modules'));
console.log('Bundle candidates:');
matches.forEach(m => console.log(' ', m));

const target = matches.find(p => p.endsWith('index-EhZISjhw.js')); // From v39c build
if (!target) {
  console.log('Could not find target bundle, listing any index files:');
  list.filter(p => p.includes('dist/assets')).forEach(m => console.log(' ', m));
  process.exit(1);
}

const buf = asar.extractFile(asarPath, target.replace(/^\\/, ''));
const out = path.join(process.env.TEMP || '.', 'v39f-bundle.js');
fs.writeFileSync(out, buf);
console.log('Extracted to', out, 'size', buf.length);
