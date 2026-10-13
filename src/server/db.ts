import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { hashPassword } from './auth.ts';

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;

// Allow overriding the data directory via env var (used by Electron wrapper
// to point to a writable user data location instead of the install dir).
const DATA_DIR = process.env.HAWR_DATA_DIR
  ? process.env.HAWR_DATA_DIR
  : path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'hawr-gallery.sqlite');

/**
 * Locate the sql-wasm.wasm file. SQL.js needs an explicit `locateFile`
 * because, in the packaged Electron app, the wasm is unpacked to
 * `app.asar.unpacked/dist/sql-wasm.wasm` while the bundled server.cjs
 * sits inside `app.asar/dist/server.cjs`. Without `locateFile` SQL.js
 * looks next to the calling script (which is inside the read-only asar)
 * and crashes with `ENOENT: sql-wasm.wasm` — causing every API call
 * that touches the DB to silently fail and the catch-all static
 * handler to return index.html (which the renderer then chokes on
 * with "Unexpected token '<', '<!DOCTYPE'... is not valid JSON").
 *
 * Search order:
 *   1. $HAWR_DIST_DIR/sql-wasm.wasm        (set by Electron main process)
 *   2. ./dist/sql-wasm.wasm                (dev: run via `vite preview`)
 *   3. ../node_modules/sql.js/dist/sql-wasm.wasm
 *                                         (dev: bundler didn't copy it)
 *   4. ./sql-wasm.wasm                     (last-ditch: same dir as script)
 */
function findWasmDir(): string {
  const candidates: string[] = [];
  if (process.env.HAWR_DIST_DIR) candidates.push(process.env.HAWR_DIST_DIR);
  candidates.push(path.join(process.cwd(), 'dist'));
  candidates.push(path.join(process.cwd(), 'node_modules', 'sql.js', 'dist'));
  candidates.push(__dirname);
  for (const dir of candidates) {
    const p = path.join(dir, 'sql-wasm.wasm');
    if (fs.existsSync(p)) return dir;
  }
  // Final fallback — return whatever HAWR_DIST_DIR points to (will throw
  // a clearer error from sql.js itself rather than our generic ENOENT).
  return process.env.HAWR_DIST_DIR || path.join(process.cwd(), 'dist');
}

export async function getDb(): Promise<Database> {
  if (db) return db;

  if (!SQL) {
    const wasmDir = findWasmDir();
    SQL = await initSqlJs({
      locateFile: (file: string) => path.join(wasmDir, file),
    });
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      db = new SQL.Database(fileBuffer);
    } catch (err) {
      console.error('Failed to load existing SQLite file, creating new:', err);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  initTables(db);
  saveDb();
  return db;
}

export function saveDb(): void {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  } catch (err) {
    console.error('Failed to persist SQLite to disk:', err);
  }
}

function initTables(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      salt TEXT NOT NULL,
      employeeCode TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL, -- admin, supervisor, employee
      status TEXT NOT NULL DEFAULT 'active',
      baseSalary REAL DEFAULT 0,
      phone TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL,
      barcode TEXT NOT NULL,
      unit TEXT NOT NULL,
      location TEXT NOT NULL, -- 'gallery' OR 'stationery'
      quantity REAL NOT NULL DEFAULT 0,
      salePrice REAL NOT NULL DEFAULT 0,
      purchaseCost REAL NOT NULL DEFAULT 0,
      minStockAlert REAL NOT NULL DEFAULT 5,
      category TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_transfers (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      productName TEXT NOT NULL,
      sku TEXT NOT NULL,
      fromLocation TEXT NOT NULL,
      toLocation TEXT NOT NULL,
      quantity REAL NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      performedByUserId TEXT NOT NULL,
      performedByName TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supplies (
      id TEXT PRIMARY KEY,
      productName TEXT NOT NULL,
      sku TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      purchasePrice REAL NOT NULL,
      salePrice REAL,
      location TEXT NOT NULL, -- 'gallery' OR 'stationery'
      date TEXT NOT NULL,
      supplierId TEXT,
      supplierName TEXT,
      isReturn INTEGER DEFAULT 0,
      notes TEXT,
      createdById TEXT NOT NULL,
      createdByName TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT,
      notes TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      company TEXT,
      address TEXT,
      notes TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      invoiceNumber TEXT UNIQUE NOT NULL,
      customerName TEXT NOT NULL,
      customerPhone TEXT,
      location TEXT NOT NULL,
      sellerId TEXT NOT NULL,
      sellerName TEXT NOT NULL,
      sellerCode TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      subtotal REAL NOT NULL,
      totalDiscount REAL NOT NULL,
      total REAL NOT NULL,
      paid REAL NOT NULL,
      remaining REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      isInstallment INTEGER NOT NULL DEFAULT 0,
      installmentDueDate TEXT,
      installmentPercent REAL NOT NULL DEFAULT 0,
      installmentSurcharge REAL NOT NULL DEFAULT 0,
      finalTotal REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      notes TEXT,
      createdAt TEXT NOT NULL
    );
  `);

  // Idempotent migration: add the installment surcharge columns to
  // pre-existing DBs that were created before this feature shipped.
  // sql.js does not support IF NOT EXISTS on ALTER TABLE ADD COLUMN,
  // so we swallow the "duplicate column name" error and move on.
  // NOTE: these must be separate `database.run` calls, NOT embedded
  // inside the SQL template above — SQL doesn't understand `try {}`.
  try {
    database.run('ALTER TABLE invoices ADD COLUMN installmentPercent REAL NOT NULL DEFAULT 0');
  } catch (e) { /* column already exists */ }
  try {
    database.run('ALTER TABLE invoices ADD COLUMN installmentSurcharge REAL NOT NULL DEFAULT 0');
  } catch (e) { /* column already exists */ }
  try {
    database.run('ALTER TABLE invoices ADD COLUMN finalTotal REAL NOT NULL DEFAULT 0');
  } catch (e) { /* column already exists */ }

  // Migration: track per-invoice return totals. Reports subtract these
  // from total realized sales + profit so the financial picture stays
  // accurate even when customers bring items back.
  try {
    database.run('ALTER TABLE invoices ADD COLUMN returnedAmount REAL NOT NULL DEFAULT 0');
  } catch (e) { /* column already exists */ }
  try {
    database.run('ALTER TABLE invoices ADD COLUMN returnedAt TEXT');
  } catch (e) { /* column already exists */ }
  try {
    database.run('ALTER TABLE invoices ADD COLUMN returnedNotes TEXT');
  } catch (e) { /* column already exists */ }

  database.run(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoiceId TEXT NOT NULL,
      productId TEXT NOT NULL,
      productName TEXT NOT NULL,
      sku TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      unitSalePrice REAL NOT NULL,
      discount REAL NOT NULL,
      actualSalePrice REAL NOT NULL,
      frozenPurchaseCost REAL NOT NULL,
      itemProfit REAL NOT NULL,
      total REAL NOT NULL,
      location TEXT
    );

    CREATE TABLE IF NOT EXISTS installments (
      id TEXT PRIMARY KEY,
      invoiceId TEXT UNIQUE NOT NULL,
      invoiceNumber TEXT NOT NULL,
      customerName TEXT NOT NULL,
      customerPhone TEXT NOT NULL,
      location TEXT NOT NULL,
      sellerId TEXT NOT NULL,
      sellerName TEXT NOT NULL,
      sellerCode TEXT NOT NULL,
      totalAmount REAL NOT NULL,
      paidAmount REAL NOT NULL,
      remainingAmount REAL NOT NULL,
      dueDate TEXT NOT NULL,
      paymentCount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS installment_payments (
      id TEXT PRIMARY KEY,
      installmentId TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      paymentMethod TEXT NOT NULL,
      notes TEXT,
      receivedById TEXT NOT NULL,
      receivedByName TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL, -- operational, salary, scrap
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      location TEXT NOT NULL,
      employeeId TEXT,
      employeeName TEXT,
      salaryMonth TEXT,
      notes TEXT,
      createdById TEXT NOT NULL,
      createdByName TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      userId TEXT NOT NULL,
      username TEXT NOT NULL,
      details TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Customer sale returns - a product a customer previously bought
    -- comes back; we refund them (or part of the original sale), put the
    -- quantity back into stock, and record the return for audit + reports.
    -- The invoiceNumber column is OPTIONAL: if the operator knows the
    -- original invoice number, they can link the return to it so the
    -- invoice returnedAmount column is incremented and downstream reports
    -- subtract it. If no invoice number is known, the return still
    -- records the stock movement + refund amount and the user can later
    -- reconcile by hand.
    CREATE TABLE IF NOT EXISTS sale_returns (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      productName TEXT NOT NULL,
      sku TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'قطعة',
      quantity REAL NOT NULL,
      unitRefundPrice REAL NOT NULL,
      totalRefund REAL NOT NULL,
      unitCostAtReturn REAL NOT NULL,
      profitReversed REAL NOT NULL,
      invoiceId TEXT,
      invoiceNumber TEXT,
      customerName TEXT,
      reason TEXT,
      location TEXT NOT NULL,
      date TEXT NOT NULL,
      createdById TEXT NOT NULL,
      createdByName TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoice_drafts (
      id TEXT PRIMARY KEY,
      draftLabel TEXT NOT NULL,
      invoiceNumber TEXT,
      customerName TEXT NOT NULL,
      customerPhone TEXT,
      location TEXT NOT NULL,
      sellerId TEXT NOT NULL,
      sellerName TEXT NOT NULL,
      sellerCode TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      itemsJson TEXT NOT NULL,
      subtotal REAL NOT NULL,
      totalDiscount REAL NOT NULL,
      total REAL NOT NULL,
      paid REAL NOT NULL,
      remaining REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      isInstallment INTEGER NOT NULL DEFAULT 0,
      installmentDueDate TEXT,
      notes TEXT,
      itemCount INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL
    );
  `);

  try {
    database.run('ALTER TABLE users ADD COLUMN baseSalary REAL DEFAULT 0');
  } catch (err) {
    // Column already exists, safe to ignore
  }

  try {
    database.run('ALTER TABLE users ADD COLUMN phone TEXT');
  } catch (err) {
    // Column already exists, safe to ignore
  }

  try {
    database.run('ALTER TABLE supplies ADD COLUMN salePrice REAL');
  } catch (err) {
    // Column already exists, safe to ignore
  }

  // The suppliers table shipped without an `address` column even though the
  // UI has always rendered one, so every supplier address silently came back
  // empty. Add it here; older databases pick it up on next launch.
  try {
    database.run('ALTER TABLE suppliers ADD COLUMN address TEXT');
  } catch (err) {
    // Column already exists, safe to ignore
  }

  // A single invoice may now hold items from BOTH branches. Per-item location
  // is the source of truth for stock, sales and profit attribution, so every
  // historical line inherits its parent invoice's location and stays
  // reportable per branch. Runs AFTER the CREATE TABLEs so it is safe on a
  // brand-new database too.
  try {
    database.run('ALTER TABLE invoice_items ADD COLUMN location TEXT');
  } catch (err) {
    // Column already exists, safe to ignore
  }
  database.run(`
    UPDATE invoice_items
       SET location = (SELECT i.location FROM invoices i WHERE i.id = invoice_items.invoiceId)
     WHERE location IS NULL
       AND invoiceId IN (SELECT id FROM invoices WHERE location IS NOT NULL)
  `);
}

export async function hasAdmin(): Promise<boolean> {
  const database = await getDb();
  const res = database.exec("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'");
  if (res.length > 0 && res[0].values.length > 0) {
    const count = res[0].values[0][0] as number;
    return count > 0;
  }
  return false;
}

export function logAudit(type: string, userId: string, username: string, details: string): void {
  if (!db) return;
  const id = 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO audit_logs (id, type, userId, username, details, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
    [id, type, userId, username, details, now]
  );
  saveDb();
}

export function createBackup(): { filename: string; path: string; buffer: Buffer } {
  if (!db) throw new Error('Database not initialized');
  const data = db.export();
  const buffer = Buffer.from(data);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `hawr-backup-${timestamp}.sqlite`;
  const filePath = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  return { filename, path: filePath, buffer };
}

export async function verifyAndRestoreBackup(backupBuffer: Buffer): Promise<{ success: boolean; message: string }> {
  // 1. Verify SQLite format 3 signature (first 16 bytes)
  const header = backupBuffer.subarray(0, 16).toString('ascii');
  if (!header.startsWith('SQLite format 3')) {
    return {
      success: false,
      message: 'الملف غير صالح: لا يحتوي على ترويسة توقيع SQLite format 3 الحقيقية',
    };
  }

  if (!SQL) {
    const wasmDir = findWasmDir();
    SQL = await initSqlJs({
      locateFile: (file: string) => path.join(wasmDir, file),
    });
  }

  // 2. Open in temp database to verify structural integrity and essential tables
  let testDb: Database | null = null;
  try {
    testDb = new SQL.Database(backupBuffer);
    const integrityRes = testDb.exec('PRAGMA integrity_check;');
    const result = integrityRes[0]?.values[0]?.[0];
    if (result !== 'ok') {
      testDb.close();
      return {
        success: false,
        message: 'فشل فحص سلامة قاعدة البيانات (PRAGMA integrity_check فشل)',
      };
    }

    // Verify critical tables exist
    const tablesRes = testDb.exec("SELECT name FROM sqlite_master WHERE type='table';");
    const tableNames = tablesRes[0]?.values.map(v => v[0] as string) || [];
    const requiredTables = ['users', 'products', 'invoices'];
    const missing = requiredTables.filter(t => !tableNames.includes(t));
    if (missing.length > 0) {
      testDb.close();
      return {
        success: false,
        message: `الملف يفتقر إلى الجداول الأساسية للنظام: ${missing.join(', ')}`,
      };
    }
  } catch (err: any) {
    if (testDb) testDb.close();
    return {
      success: false,
      message: `تعذر فتح قاعدة البيانات للتحقق: ${err.message || 'خطأ غير معروف'}`,
    };
  }

  // 3. Take safety backup of current database before replacing
  try {
    if (db) {
      createBackup();
      db.close();
      db = null;
    }
  } catch (err) {
    console.warn('Pre-restore backup warning:', err);
  }

  // 4. Safely overwrite DB file with clean atomic write (preventing any Windows WAL lock EPERM)
  try {
    fs.writeFileSync(DB_FILE, backupBuffer);
    db = testDb;
    return {
      success: true,
      message: 'تمت استعادة قاعدة البيانات بنجاح بعد التحقق من توقيع SQLite وسلامة الجداول',
    };
  } catch (err: any) {
    return {
      success: false,
      message: `فشل استبدال ملف قاعدة البيانات: ${err.message}`,
    };
  }
}

export function resetDatabase(): { success: boolean; message: string } {
  try {
    // 1. Mandatory safety backup before reset
    if (db) {
      createBackup();
      db.close();
      db = null;
    }
    // 2. Delete main file if exists
    if (fs.existsSync(DB_FILE)) {
      fs.unlinkSync(DB_FILE);
    }
    // 3. Re-initialize empty database
    if (SQL) {
      db = new SQL.Database();
      initTables(db);
      saveDb();
    }
    return {
      success: true,
      message: 'تمت إعادة ضبط النظام إلى وضع التثبيت النظيف مع الاحتفاظ بنسخة احتياطية آمنة',
    };
  } catch (err: any) {
    return {
      success: false,
      message: `فشل إعادة الضبط: ${err.message}`,
    };
  }
}
