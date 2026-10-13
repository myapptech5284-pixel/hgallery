const fs = require('fs');
const path = require('path');
const target = process.argv[2] || 'C:\\Users\\Dr mohamed soliman\\.minimax\\sessions\\mvs_dec1346605cd49ddbd74e938b951f833\\workspace\\hawar-app\\dist-installer\\win-unpacked';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function rmWithRetry(p, tries = 10) {
  for (let i = 0; i < tries; i++) {
    try {
      if (!fs.existsSync(p)) return;
      const s = fs.lstatSync(p);
      if (s.isDirectory()) {
        for (const e of fs.readdirSync(p)) {
          await rmWithRetry(path.join(p, e), tries);
        }
        fs.rmdirSync(p);
      } else {
        fs.unlinkSync(p);
      }
      return;
    } catch (e) {
      if (i === tries - 1) {
        console.error('giving up on', p, e.message);
        return;
      }
      // rename first to free the original path
      try {
        const newPath = p + '.del-' + Date.now();
        fs.renameSync(p, newPath);
        await sleep(50);
        if (fs.existsSync(newPath)) {
          try { fs.unlinkSync(newPath); } catch (_) {}
        }
        return;
      } catch (_) {
        await sleep(300);
      }
    }
  }
}

(async () => {
  await rmWithRetry(target);
  console.log('cleaned', target);
})();
