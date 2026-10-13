/**
 * Hawr Gallery — Electron Main Process
 *
 * Self-contained desktop app: NO localhost, NO separate server.
 * The Express app is loaded in-process (HAWR_NO_LISTEN=1) and requests
 * are dispatched from the renderer's `app://./api/...` URLs into the
 * same Express app via Electron's `protocol.handle()`.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { Writable, Readable } = require('stream');

const isDev = !app.isPackaged;

// Ensure the userData folder uses the product name (not the npm package name),
// so all installs land at the same path regardless of how the app was packaged.
app.setName('نظام إدارة معرض حور');

let mainWindow = null;

// ---- Privileged scheme: must be registered before app is ready ------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ---- Path helpers ----------------------------------------------------------
function getDataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getServerCjsPath() {
  // In dev: ./dist/server.cjs
  // Packaged: resources/app.asar.unpacked/dist/server.cjs
  const unpacked = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'dist', 'server.cjs');
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(__dirname, 'dist', 'server.cjs');
}

function getDistDir() {
  // Where the React build (index.html, assets) lives.
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'dist'),
    path.join(process.resourcesPath || '', 'app', 'dist'),
    path.join(__dirname, 'dist'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return path.join(__dirname, 'dist');
}

// ---- Load the Express app in-process (no listen) ---------------------------
// One-time reset key shared between main and protocol.handle so the renderer
// can prove it's running inside our local app (and not a remote attacker).
const RESET_KEY = require('crypto').randomBytes(16).toString('hex');
process.env.HAWR_RESET_KEY = RESET_KEY;

function loadServerApp() {
  const dataDir = getDataDir();
  const distDir = getDistDir();
  process.env.HAWR_NO_LISTEN = '1';
  process.env.HAWR_DATA_DIR = dataDir;
  process.env.HAWR_DIST_DIR = distDir;
  process.env.NODE_ENV = 'production';
  process.env.HAWR_RESET_KEY = RESET_KEY;
  const serverPath = getServerCjsPath();
  console.log('[hawr] loading server:', serverPath);
  console.log('[hawr] DATA_DIR=', dataDir);
  console.log('[hawr] DIST_DIR=', distDir);
  const mod = require(serverPath);
  return mod && mod.default ? mod.default : (mod && mod.app ? mod.app : mod);
}

// ---- Build a fake Express-compatible req/res from a fetch Request --------
// IMPORTANT: the synthetic `req` MUST be a real Readable stream AND its
// `socket` must be a real Duplex stream. Two reasons:
//
// 1. Express's finalhandler calls `unpipe(req)` and `req.resume()` when
//    it needs to terminate the connection (e.g. on 404 or unhandled
//    error). A plain object literal would crash with:
//      TypeError: Cannot read properties of undefined (reading 'pipes')
//    because Node's internal Readable.unpipe() tries to read
//    `this._readableState.pipes` and we never had a Readable state.
//
// 2. Express's `lib/request.js` reassigns `req.__proto__` to
//    `http.IncomingMessage.prototype`. So when the request is destroyed,
//    IncomingMessage._destroy() runs, which (in Node 22) calls
//    `finished(this.socket, ...)` — and a plain object for `socket`
//    throws:
//      TypeError [ERR_INVALID_ARG_TYPE]: The "stream" argument must be
//      an instance of ReadableStream, WritableStream, or Stream.
//    Setting `req._consuming = true` and `req._dumped = true` makes
//    IncomingMessage._destroy() take the "already handled" branch and
//    skip the eos() call.
//
// Using `new Readable({ read() {} })` plus a real Duplex socket covers
// every case the express+node internals might probe.
function buildReqRes(url, request) {
  const { Duplex } = require('stream');
  const u = new URL(url);
  const req = new Readable({ read() { /* no-op; we never push data */ } });
  // A Duplex socket so any internal call to eos()/finished() on
  // `req.socket` passes the type-check.
  const socket = new Duplex({
    read() { /* no-op */ },
    write(_chunk, _enc, cb) { cb(); },
  });
  socket.remoteAddress = '127.0.0.1';
  socket.encrypted = false;
  socket.destroyed = true; // mark as already destroyed so node skips teardown
  // Push EOF into the socket too so its `readable` state mirrors a
  // closed connection.
  socket.push(null);
  socket.resume();
  Object.assign(req, {
    method: request.method,
    url: u.pathname + u.search,
    originalUrl: u.pathname + u.search,
    headers: Object.fromEntries(request.headers.entries()),
    query: Object.fromEntries(u.searchParams.entries()),
    params: {},
    body: undefined,
    rawHeaders: [],
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    httpVersion: '1.1',
    socket,
    connection: socket,
    get(header) { return this.headers[String(header).toLowerCase()]; },
    header(name) { return this.headers[String(name).toLowerCase()]; },
    accepts() { return undefined; },
    is() { return undefined; },
  });
  // Skip IncomingMessage._destroy()'s special socket-teardown path
  // (it would call finished(this.socket, ...) which then eos()'s
  // something the type-check rejects). We already destroyed the
  // socket above.
  req._consuming = true;
  req._dumped = true;
  // Mark the request stream as already-ended so express bodyParser
  // (and the finalhandler's `isFinished(req)` check) don't wait for
  // more data.
  req.push(null);
  // Start the flow so the buffered `null` actually transitions the
  // stream to the 'ended' state (readableEnded = true). Without this
  // resume, `onFinished.isFinished(req)` returns false and finalhandler
  // falls through to its `unpipe(req)` branch.
  req.resume();

  let statusCode = 200;
  const headers = {};
  const chunks = [];
  let ended = false;
  const res = new Writable({
    write(chunk, enc, cb) {
      if (!ended) chunks.push(Buffer.from(chunk, enc));
      cb();
    },
  });
  res.statusCode = 200;
  res.status = function (code) { this.statusCode = code; return this; };
  res.statusMessage = 'OK';
  res.setHeader = function (name, value) { headers[String(name).toLowerCase()] = value; return this; };
  res.getHeader = function (name) { return headers[String(name).toLowerCase()]; };
  res.removeHeader = function (name) { delete headers[String(name).toLowerCase()]; return this; };
  res.set = res.setHeader;
  res.header = res.setHeader;
  res.type = function (t) { this.setHeader('Content-Type', t); return this; };
  res.vary = function () { return this; };
  res.cookie = function () { return this; };
  res.clearCookie = function () { return this; };
  res.location = function (u) { this.setHeader('Location', u); return this; };
  res.links = function () { return this; };
  res.send = function (body) {
    if (body == null) { body = ''; }
    if (typeof body === 'object' && !Buffer.isBuffer(body)) {
      if (!this.getHeader('content-type')) this.setHeader('Content-Type', 'application/json; charset=utf-8');
      body = JSON.stringify(body);
    } else if (typeof body === 'string' && !this.getHeader('content-type')) {
      this.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
    this.setHeader('Content-Length', Buffer.byteLength(body));
    this.end(body);
    return this;
  };
  res.json = function (obj) {
    this.setHeader('Content-Type', 'application/json; charset=utf-8');
    return this.send(JSON.stringify(obj));
  };
  res.jsonp = res.json;
  res.sendFile = function (filePath) {
    try {
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
      this.setHeader('Content-Type', mime);
      this.setHeader('Content-Length', buf.length);
      this.end(buf);
    } catch (e) {
      this.statusCode = 404;
      this.end('Not Found');
    }
    return this;
  };
  res.sendStatus = function (code) { this.statusCode = code; this.end(); return this; };
  res.end = function (chunk, enc) {
    if (chunk && !ended) chunks.push(Buffer.from(chunk, enc));
    ended = true;
    this.emit('finish');
    return this;
  };
  res.write = function (chunk, enc) {
    if (!ended) chunks.push(Buffer.from(chunk, enc));
    return true;
  };
  res.writeHead = function (code, hdrs) {
    this.statusCode = code;
    if (hdrs) for (const k of Object.keys(hdrs)) this.setHeader(k, hdrs[k]);
    return this;
  };
  res.redirect = function (code, u) {
    if (typeof code === 'string') { u = code; code = 302; }
    this.statusCode = code || 302;
    this.setHeader('Location', u);
    this.end();
    return this;
  };
  res.attachment = function () { return this; };
  res.download = function () { return this; };
  res.append = function (k, v) { this.setHeader(k, v); return this; };
  res.format = function () { return this; };
  res.render = function () { return this; };
  res.on = Writable.prototype.on.bind(res);
  res.once = Writable.prototype.once.bind(res);
  res.emit = Writable.prototype.emit.bind(res);

  return { req, res, finalize: () => ({ statusCode, headers, body: Buffer.concat(chunks) }) };
}

// ---- protocol.handle for `app://` ------------------------------------------
let serverApp = null;
function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/./') || pathname.startsWith('./')) {
        pathname = pathname.replace(/^\.?\//, '/');
      }
      if (pathname === '/' || pathname === '') pathname = '/index.html';

      // API requests -> dispatch to in-process Express app
      if (pathname.startsWith('/api/')) {
        if (!serverApp) {
          return new Response('Server not ready', { status: 503 });
        }
        const { req, res, finalize } = buildReqRes(request.url, request);
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          const ct = request.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            try { req.body = await request.json(); } catch { req.body = {}; }
          } else if (ct.includes('text/')) {
            try { req.body = await request.text(); } catch { req.body = ''; }
          } else {
            try { req.body = await request.arrayBuffer(); } catch { req.body = null; }
          }
          // Flag the body as already-parsed so express body-parser does
          // not try to re-read the stream (which would hang waiting for
          // data on a request that has already been fully consumed).
          req._body = true;
          // For force-reset, inject the local reset key so the renderer can
          // prove it's running inside our local app.
          if (pathname === '/api/system/reset' && req.body && typeof req.body === 'object') {
            if (req.body.force) req.body.resetKey = RESET_KEY;
          }
        }
        await new Promise((resolve) => {
          const finishOnce = () => resolve();
          res.once('finish', finishOnce);
          try {
            serverApp(req, res);
          } catch (err) {
            console.error('[hawr] handler error:', err);
            try { res.statusCode = 500; res.end(JSON.stringify({ success: false, error: err.message })); } catch {}
          }
          setTimeout(() => { try { if (!res.writableEnded) res.end(); } catch {}; resolve(); }, 10000);
        });
        const { statusCode, headers, body } = finalize();
        const responseHeaders = {};
        for (const k of Object.keys(headers)) responseHeaders[k] = [String(headers[k])];
        return new Response(body, { status: statusCode || 200, headers: responseHeaders });
      }

      // Static file requests -> serve from dist/
      const distDir = getDistDir();
      let filePath = path.join(distDir, pathname);
      const normalized = path.resolve(filePath);
      const distNorm = path.resolve(distDir);
      if (!normalized.startsWith(distNorm)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(normalized)) {
        const idx = path.join(distDir, 'index.html');
        if (fs.existsSync(idx)) {
          const buf = fs.readFileSync(idx);
          return new Response(buf, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        return new Response('Not Found', { status: 404 });
      }
      const stat = fs.statSync(normalized);
      if (stat.isDirectory()) {
        const idx = path.join(normalized, 'index.html');
        if (fs.existsSync(idx)) {
          const buf = fs.readFileSync(idx);
          return new Response(buf, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        return new Response('Not Found', { status: 404 });
      }
      const ext = path.extname(normalized).toLowerCase();
      const mime = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.mjs': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.map': 'application/json',
      }[ext] || 'application/octet-stream';
      const buf = fs.readFileSync(normalized);
      return new Response(buf, { status: 200, headers: { 'Content-Type': mime, 'Content-Length': String(buf.length) } });
    } catch (err) {
      console.error('[hawr] protocol.handle error:', err);
      return new Response('Internal Server Error: ' + (err.message || err), { status: 500 });
    }
  });
}

// ---- Single instance -------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ---- Window ----------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    title: 'نظام إدارة معرض حور',
    backgroundColor: '#f8fafc',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed = url.startsWith('app://');
    if (!allowed) {
      e.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
      }
    }
  });

  // ---- Keyboard shortcut hardening (main process) -----------------------
  // Electron exposes `before-input-event` which fires in the MAIN PROCESS
  // for every keyboard event BEFORE it is forwarded to the renderer.
  // Anything that might be intercepting events at the renderer level
  // (some Windows accessibility tools, IME compositors, third-party
  // Chromium extensions loaded by the renderer) cannot stop the event
  // from being observed here. We use this as a defensive observation
  // point + a guarantee that the default browser behaviour for
  // `Ctrl+S` / `Ctrl+P` (Save Page / Print) is suppressed — even if
  // some library in the renderer forgets to call `preventDefault()`.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    try {
      // input.type === 'keyDown' | 'keyUp'
      // input.key === the key (e.g. 's', 'س', 'Enter')
      // input.code === the physical key (e.g. 'KeyS')
      // input.alt / control / shift / meta
      const mod = input.control || input.meta;
      const isSKey = (input.key || '').toLowerCase() === 's'
                  || input.key === 'س'
                  || input.code === 'KeyS';
      const isAltS = input.alt && !mod && isSKey;
      const isCtrlS = mod && !input.alt && !input.shift && isSKey;
      if (isAltS || isCtrlS) {
        // Suppress the Chromium default behaviour (Save Page, Print, etc.)
        // so the renderer's handler is the only thing that runs.
        event.preventDefault();
      }
      // (Optional) emit a small counter that the renderer can read to
      // confirm events are arriving at the main process. Useful in
      // DevTools / future diagnostics — invisible to the user.
      if (!global.__hawrKeyCounter) global.__hawrKeyCounter = { down: 0, altS: 0, ctrlS: 0 };
      global.__hawrKeyCounter.down += 1;
      if (isAltS) global.__hawrKeyCounter.altS += 1;
      if (isCtrlS) global.__hawrKeyCounter.ctrlS += 1;
    } catch (_) { /* ignore */ }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Close button = logout (clears the saved user from localStorage so the
  // next open shows the login screen), then the window closes normally.
  let clearedSession = false;
  mainWindow.on('close', (e) => {
    if (clearedSession) return;
    e.preventDefault();
    (async () => {
      try {
        await mainWindow.webContents.executeJavaScript(
          "try { localStorage.removeItem('hawr_user'); } catch (e) {} true;"
        );
      } catch (_) { /* ignore */ }
      clearedSession = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    })();
  });

  mainWindow.loadURL('app://./index.html').catch((err) => {
    console.error('[hawr] failed to load app://', err);
    dialog.showErrorBox(
      'تعذر فتح النظام',
      'فشل تحميل التطبيق. الرجاء إعادة تشغيله.\n\n' + (err && err.message ? err.message : '')
    );
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---- Menu ------------------------------------------------------------------
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'ملف',
      submenu: [
        {
          label: 'فتح مجلد البيانات',
          click: () => shell.openPath(getDataDir()),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'عرض',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'مساعدة',
      submenu: [
        {
          label: 'حول البرنامج',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'حول البرنامج',
              message: 'نظام إدارة معرض حور',
              detail: 'الإصدار: 6.0.3\nتطبيق Windows مستقل بدون سيرفر محلي أو متصفح.\n© Hawr Gallery Inc.',
              buttons: ['حسناً'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC -------------------------------------------------------------------
ipcMain.handle('hawr:openDataFolder', () => shell.openPath(getDataDir()));
ipcMain.handle('hawr:getInfo', () => ({
  version: app.getVersion(),
  dataDir: getDataDir(),
  userData: app.getPath('userData'),
}));

// Print from the main process so we can pass an EXACT page size to the
// printer driver. window.print() inside the renderer often falls back to
// A4/Letter default paper, which on a 38mm/50mm thermal label printer
// causes a tiny barcode to be printed at the corner of a giant page and
// the rest of the roll to come out blank.
//
// pageSize: { width: <micrometers>, height: <micrometers> }
// deviceName (optional): exact printer name from getPrintersAsync()
ipcMain.handle('hawr:print', async (_event, opts) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'no window' };
  }
  const o = opts || {};
  const pageSize = o.pageSize || { width: 76000, height: 25000 };
  // Build margins from offsetX/offsetY (micrometers). marginType 'none'
  // + custom margin is the only way to shift the print area within the
  // physical paper.
  const offsetX = Number(o.offsetX) || 0;
  const offsetY = Number(o.offsetY) || 0;
  const marginLeft = Math.max(0, offsetX);
  const marginTop = Math.max(0, offsetY);
  try {
    return await new Promise((resolve) => {
      mainWindow.webContents.print(
        {
          silent: !!o.silent,
          printBackground: true,
          deviceName: o.deviceName || undefined,
          pageSize: {
            width: Number(pageSize.width) || 76000,
            height: Number(pageSize.height) || 25000,
          },
          margins: { marginType: 'custom', marginLeft, marginTop, marginRight: 0, marginBottom: 0 },
          landscape: false,
          color: false,
        },
        (success, reason) => {
          resolve({ ok: success, reason: reason || null });
        }
      );
    });
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// List installed printers so the renderer can show a dropdown.
ipcMain.handle('hawr:listPrinters', async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return [];
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      description: p.description || '',
      isDefault: !!p.isDefault,
      status: p.status,
    }));
  } catch (e) {
    return [];
  }
});

// ---- Backup folder picker + auto daily backup -----------------------
// Let the user pick where daily backups go.
ipcMain.handle('hawr:selectBackupFolder', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no window' };
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'اختر مكان حفظ النسخ الاحتياطية اليومية',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Run a backup. Copies the SQLite database + settings JSON to the
// target folder. The "daily" filename is fixed so it always overwrites
// the previous one (per the user's request).
// Run a backup. Copies the SQLite database + settings JSON to the
// target folder. The user's spec: every new backup REPLACES the old one
// (no per-day files). A `last-backup.json` file is written alongside
// the backup with the timestamp, so we can detect when the next daily
// backup is due.
function performBackupTo(target) {
  if (!target) return { ok: false, error: 'لم يتم تحديد مكان الحفظ' };
  if (!fs.existsSync(target)) {
    try { fs.mkdirSync(target, { recursive: true }); } catch (_) { /* ignore */ }
  }
  // Erase the previous backup so the new one fully replaces it.
  const backupDir = path.join(target, 'hawr-latest-backup');
  try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  fs.mkdirSync(backupDir, { recursive: true });

  const dataDir = getDataDir();
  let copiedFiles = 0;
  let totalBytes = 0;
  const skipExt = new Set(['.db-journal', '.db-wal', '.db-shm']);
  let files = [];
  try { files = fs.readdirSync(dataDir); } catch (_) { /* ignore */ }
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (skipExt.has(ext)) continue;
    const src = path.join(dataDir, f);
    let stat;
    try { stat = fs.statSync(src); } catch (_) { continue; }
    if (!stat.isFile()) continue;
    const dest = path.join(backupDir, f);
    fs.copyFileSync(src, dest);
    copiedFiles++;
    totalBytes += stat.size;
  }
  // Write meta file with timestamp + file list
  const meta = {
    timestamp: new Date().toISOString(),
    copiedFiles,
    totalBytes,
    source: dataDir,
  };
  try {
    fs.writeFileSync(path.join(backupDir, 'last-backup.json'), JSON.stringify(meta, null, 2), 'utf8');
  } catch (_) { /* ignore */ }
  return {
    ok: true,
    path: backupDir,
    copiedFiles,
    totalBytes,
    timestamp: meta.timestamp,
  };
}

ipcMain.handle('hawr:runBackup', async (_event, opts) => {
  try {
    const target = (opts && opts.path) || '';
    const result = performBackupTo(target);
    return result;
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Return last backup info (read from last-backup.json inside the folder)
ipcMain.handle('hawr:getLastBackup', async (_event, p) => {
  try {
    const target = p || '';
    if (!target) return { ok: false, error: 'لم يتم تحديد مكان' };
    const metaFile = path.join(target, 'hawr-latest-backup', 'last-backup.json');
    if (!fs.existsSync(metaFile)) return { ok: true, hasBackup: false };
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    return { ok: true, hasBackup: true, ...meta };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Auto-backup interval — 20 minutes. Short enough to recover from a
// crash with minimal data loss, long enough to be invisible to the user
// while they're working.
const AUTO_BACKUP_INTERVAL_MS = 20 * 60 * 1000;

// Run an auto backup if the saved target folder has one and > 20 min
// passed since the last one. Returns the result of the run (or null if
// no folder configured).
function runAutoBackupIfDue() {
  try {
    const targetPath = path.join(app.getPath('userData'), 'backup-folder.txt');
    if (!fs.existsSync(targetPath)) return null;
    const target = fs.readFileSync(targetPath, 'utf8').trim();
    if (!target) return null;
    const metaFile = path.join(target, 'hawr-latest-backup', 'last-backup.json');
    if (fs.existsSync(metaFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      const last = new Date(meta.timestamp).getTime();
      if (Date.now() - last < AUTO_BACKUP_INTERVAL_MS) {
        return { ok: true, skipped: true, reason: 'مر أقل من 20 دقيقة على آخر نسخة' };
      }
    }
    return performBackupTo(target);
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// Periodic auto-backup scheduler. Once the user has chosen a backup
// folder, we run a backup every AUTO_BACKUP_INTERVAL_MS regardless of
// whether the app is in focus. The interval is cleared on app quit.
let autoBackupInterval = null;
function startAutoBackupScheduler() {
  if (autoBackupInterval) return;
  autoBackupInterval = setInterval(() => {
    try {
      const result = runAutoBackupIfDue();
      if (result && result.ok && !result.skipped) {
        console.log('[hawr] auto-backup (periodic) done:', result);
      } else if (result && result.skipped) {
        // quiet on skip — these happen every 20 min on a healthy install
      } else if (result && !result.ok) {
        console.warn('[hawr] auto-backup (periodic) failed:', result.error);
      }
      // null = no folder configured; skip silently
    } catch (e) { console.warn('[hawr] auto-backup (periodic) exception:', e); }
  }, AUTO_BACKUP_INTERVAL_MS);
}
function stopAutoBackupScheduler() {
  if (autoBackupInterval) {
    clearInterval(autoBackupInterval);
    autoBackupInterval = null;
  }
}

ipcMain.handle('hawr:runAutoBackupIfDue', async () => {
  return runAutoBackupIfDue();
});

// Show a one-time native dialog on the very first launch (when no
// backup folder has been chosen yet) so the user picks a destination
// exactly once. From then on `backup-folder.txt` exists and this is a
// no-op. The folder is saved to userData so the daily auto-backup
// scheduler can find it on every subsequent launch.
function getSavedBackupFolder() {
  try {
    const targetPath = path.join(app.getPath('userData'), 'backup-folder.txt');
    if (!fs.existsSync(targetPath)) return null;
    const v = fs.readFileSync(targetPath, 'utf8').trim();
    return v || null;
  } catch (_) { return null; }
}
function saveBackupFolder(target) {
  try {
    const targetPath = path.join(app.getPath('userData'), 'backup-folder.txt');
    fs.writeFileSync(targetPath, target, 'utf8');
    return true;
  } catch (_) { return false; }
}
function maybePromptFirstTimeBackup() {
  if (getSavedBackupFolder()) return; // user has already chosen
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'info',
    buttons: ['اختر الآن', 'لاحقاً'],
    defaultId: 0,
    cancelId: 1,
    title: 'إعداد النسخ الاحتياطي التلقائي',
    message: 'مرحباً! لإتمام الإعداد، اختر مجلد حفظ النسخ الاحتياطية اليومية.',
    detail: 'سيتم حفظ نسخة كاملة من قاعدة البيانات (SQLite) في هذا المجلد كل 20 دقيقة، مع استبدال النسخة القديمة تلقائياً.\n\nاختر "اختر الآن" لتحديد المجلد، أو "لاحقاً" للتأجيل (يمكنك اختيار المجلد لاحقاً من شاشة "النسخ الاحتياطي").',
    noLink: true,
  });
  if (choice !== 0) return; // user chose "لاحقاً"
  const result = dialog.showOpenDialogSync(mainWindow, {
    title: 'اختر مجلد حفظ النسخ الاحتياطية اليومية',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result && result.filePaths && result.filePaths[0]) {
    saveBackupFolder(result.filePaths[0]);
    // Run an immediate first backup so the user sees evidence the
    // setup worked.
    const r = performBackupTo(result.filePaths[0]);
    if (r && r.ok) {
      dialog.showMessageBoxSync(mainWindow, {
        type: 'info',
        title: 'تم الإعداد',
        message: 'تم حفظ أول نسخة احتياطية بنجاح',
        detail: `المسار: ${r.path}\n${r.copiedFiles} ملف (${(r.totalBytes / 1024).toFixed(1)} KB)\nكل 20 دقيقة سيتم تحديث هذه النسخة تلقائياً.`,
      });
    }
  }
}

// Persist the chosen backup folder so the auto-backup scheduler can
// find it the next time the app starts.
ipcMain.handle('hawr:saveBackupTarget', async (_event, p) => {
  try {
    const target = (p || '').toString();
    const file = path.join(app.getPath('userData'), 'backup-folder.txt');
    fs.writeFileSync(file, target, 'utf8');
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Save-as dialog for the "Download SQLite backup" button. Lets the user
// pick the destination folder + filename. The actual `.db` is streamed
// from the live SQLite file so it includes the most recent data.
//
// First-time use: if the user has never chosen a destination before,
// we prompt for a folder (so subsequent "download" calls reuse the
// same path). After the first time, the same path is reused silently
// (a fresh timestamped file is written inside it each time).
let lastDownloadDir = null;
ipcMain.handle('hawr:downloadSqliteBackup', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'no window' };
  }
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const defaultName = `hawr-backup-${stamp}.db`;

    // Resolve the data dir + DB filename (the SQLite file is named
    // hawr-gallery.sqlite per src/server/db.ts — the previous build was
    // hard-coded to "app.db" which never existed, causing the
    // "ملف قاعدة البيانات غير موجود" error).
    const dataDir = getDataDir();
    const dbCandidates = ['hawr-gallery.sqlite', 'app.db'];
    let dbSrc = null;
    for (const name of dbCandidates) {
      const p = path.join(dataDir, name);
      if (fs.existsSync(p)) { dbSrc = p; break; }
    }
    if (!dbSrc) {
      return { ok: false, error: 'ملف قاعدة البيانات غير موجود في مجلد البيانات' };
    }

    // First-time selection: ask the user for a folder. After that,
    // silently reuse the last folder so the next backup doesn't interrupt
    // them with another dialog.
    let targetDir = lastDownloadDir;
    if (!targetDir) {
      const folderResult = await dialog.showOpenDialog(mainWindow, {
        title: 'اختر مجلد حفظ النسخ الاحتياطية (سيُحفظ كل نسخة جديدة داخله)',
        defaultPath: app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (folderResult.canceled || !folderResult.filePaths || !folderResult.filePaths[0]) {
        return { ok: false, canceled: true };
      }
      targetDir = folderResult.filePaths[0];
      lastDownloadDir = targetDir;
    }
    const destPath = path.join(targetDir, defaultName);
    fs.copyFileSync(dbSrc, destPath);
    const stat = fs.statSync(destPath);
    return {
      ok: true,
      path: destPath,
      size: stat.size,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Open the folder where the last "Download SQLite" backup was saved
ipcMain.handle('hawr:revealInFolder', async (_event, p) => {
  try {
    if (!p) return { ok: false, error: 'لم يحدد مسار' };
    if (fs.existsSync(p)) {
      shell.showItemInFolder(p);
      return { ok: true };
    }
    return { ok: false, error: 'الملف غير موجود' };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Open the backup folder in Explorer
ipcMain.handle('hawr:openBackupFolder', async (_event, p) => {
  try {
    const target = p || '';
    if (!target || !fs.existsSync(target)) return { ok: false, error: 'المجلد غير موجود' };
    return { ok: true, result: shell.openPath(target) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// ---- App lifecycle ---------------------------------------------------------
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.whenReady().then(async () => {
  try {
    serverApp = loadServerApp();
  } catch (err) {
    console.error('[hawr] failed to load server module:', err);
    dialog.showErrorBox(
      'تعذر تهيئة قاعدة البيانات',
      'فشل تحميل وحدة قاعدة البيانات.\n\n' + (err && err.message ? err.message : err)
    );
    app.quit();
    return;
  }
  registerAppProtocol();
  buildMenu();
  createWindow();

  // First-time backup setup. The user must pick a backup folder exactly
  // once. After that, every subsequent launch (and the 5-second auto
  // backup scheduler) will reuse the same path silently. We give the
  // UI ~4 seconds to render so the dialog appears on top of the
  // loaded window rather than before it.
  setTimeout(() => {
    try { maybePromptFirstTimeBackup(); } catch (e) { console.warn('[hawr] backup setup prompt failed:', e); }
  }, 4000);

  // Run the auto daily backup silently in the background, ~7 seconds
  // after launch so the UI is fully ready and the first-time prompt
  // (if any) has been handled. The user sees a single "آخر نسخة"
  // timestamp update if a backup was actually performed.
  setTimeout(() => {
    try {
      const result = runAutoBackupIfDue();
      if (result && result.ok && !result.skipped) {
        console.log('[hawr] auto-backup done:', result);
      } else if (result && result.skipped) {
        console.log('[hawr] auto-backup skipped:', result.reason);
      } else if (result && !result.ok) {
        console.warn('[hawr] auto-backup failed:', result.error);
      } else {
        console.log('[hawr] auto-backup: no target folder configured');
      }
    } catch (e) { console.warn('[hawr] auto-backup exception:', e); }
  }, 7000);

  // Start the periodic auto-backup scheduler — runs every 20 minutes
  // (AUTO_BACKUP_INTERVAL_MS) for the lifetime of the app process.
  startAutoBackupScheduler();
}).catch((err) => {
  console.error('[hawr] startup error:', err);
  dialog.showErrorBox('خطأ في بدء التشغيل', String(err && err.message ? err.message : err));
  app.quit();
});

// Stop the auto-backup scheduler on quit so it doesn't leak a handle.
app.on('before-quit', () => {
  stopAutoBackupScheduler();
});
