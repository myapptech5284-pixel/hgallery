import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { getDb, saveDb, hasAdmin, logAudit, createBackup, verifyAndRestoreBackup, resetDatabase } from './src/server/db.ts';
import { hashPassword, verifyPassword } from './src/server/auth.ts';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Wrap async route handlers so any rejection is converted into a JSON
// error response. Without this, Express 4 leaves async rejections as
// unhandled promise rejections — the response just hangs and the
// Electron protocol handler eventually returns an empty body. Combined
// with the static catch-all below, that empty-body request looks like
// a 200 to the renderer and the JSON parser explodes on the next
// request that DOES hit the catch-all (returns index.html).
function asyncHandler<T extends (req: any, res: any, next: any) => Promise<any>>(fn: T) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      console.error('[hawr] async handler error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: (err && err.message) || 'Internal Server Error' });
      } else {
        try { res.end(); } catch { /* ignore */ }
      }
    });
  };
}

// Helper to query sql.js and return array of objects
function queryAll(sql: string, params: any[] = []): any[] {
  const database = (global as any).__hawr_db;
  if (!database) return [];
  const stmt = database.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function runSql(sql: string, params: any[] = []): void {
  const database = (global as any).__hawr_db;
  if (!database) return;
  database.run(sql, params);
  saveDb();
}

// ---------------------------------------------------------------
// Customer identity resolution
// ---------------------------------------------------------------
// The sales tables (`invoices`, `installments`) were written before the
// customers directory existed and never got a foreign key to it — they
// only carry the free-text name + phone that the cashier typed. The
// phone number is therefore the only trustworthy identity signal, so
// every customer lookup in this file is phone-first, with an exact-name
// fallback for the cash invoices that were saved without a phone.
//
// Phone numbers get typed inconsistently (01012345678 / +201012345678 /
// 0020 101 234 5678), so we reduce every number to its significant
// national digits before comparing.

function normalizePhoneKey(raw: any): string {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  // International prefix: +20 1XXXXXXXXX (mobile) and +20 1XXXXXXXX (landline)
  // both collapse to the national number.
  if (digits.length >= 11 && digits.startsWith('20')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

/** Bucket key for a sales row: phone when present, otherwise the name. */
function recordIdentityKey(name: any, phone: any): string {
  const phoneKey = normalizePhoneKey(phone);
  if (phoneKey) return 'p:' + phoneKey;
  const nameKey = String(name ?? '').trim();
  return nameKey ? 'n:' + nameKey : '';
}

/** Every bucket key a customer record can answer to. */
function customerIdentityKeys(customer: any): string[] {
  const keys: string[] = [];
  const phoneKey = normalizePhoneKey(customer?.phone);
  if (phoneKey) keys.push('p:' + phoneKey);
  const nameKey = String(customer?.name ?? '').trim();
  if (nameKey) keys.push('n:' + nameKey);
  return keys;
}

/** Placeholder the POS pre-fills for walk-in cash sales. */
const WALK_IN_CUSTOMER_NAMES = new Set(['عميل نقدي', 'عميل نقدى', 'walk in', 'walk-in', 'cash']);

function isWalkInCustomerName(name: any): boolean {
  const value = String(name ?? '').trim().toLowerCase();
  if (!value) return true;
  return WALK_IN_CUSTOMER_NAMES.has(value);
}

/**
 * Register a customer who just paid at the till, so the cashier never has to
 * leave the sale screen to file them manually.
 *
 * Rules (from the business requirement):
 *  - Installment sales: name + phone are mandatory, and the customer is filed.
 *  - Cash/card sales: filed only when BOTH name and phone were typed. A blank
 *    customer stays anonymous — nothing is created.
 *  - Never duplicates: identity is the normalized phone number, so the same
 *    person entered as "0101…" and "+20101…" is recognised as one customer.
 *
 * Returns the customer id when a row was created, otherwise null.
 */
function ensureCustomerForSale(name: any, phone: any, paymentMethod: any): string | null {
  const cleanName = String(name ?? '').trim();
  const cleanPhone = String(phone ?? '').trim();

  // Installment requires identity; cash does not.
  if (paymentMethod === 'installment') {
    if (!cleanName || isWalkInCustomerName(cleanName) || !cleanPhone) return null;
  } else {
    if (!cleanPhone || !cleanName || isWalkInCustomerName(cleanName)) return null;
  }

  const phoneKey = normalizePhoneKey(cleanPhone);
  if (!phoneKey) return null;

  const existing = queryAll('SELECT id, phone FROM customers');
  // Match on the normalized phone so different formatting of one number maps
  // to a single customer row.
  for (const row of existing) {
    if (normalizePhoneKey(row.phone) === phoneKey) return null; // already known
  }

  // Also respect an exact-name match so a walk-in registered under the same
  // name is not duplicated when they omit the phone on a later visit.
  const sameName = queryAll('SELECT id FROM customers WHERE TRIM(name) = ?', [cleanName]);
  if (sameName.length > 0) return null;

  const id = 'cst_' + Date.now();
  runSql(
    'INSERT INTO customers (id, name, phone, address, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
    [
      id,
      cleanName,
      cleanPhone,
      '',
      paymentMethod === 'installment' ? 'مُسجَّل تلقائياً من البيع بالتقسيط' : 'مُسجَّل تلقائياً من البيع',
      new Date().toISOString(),
    ]
  );
  return id;
}

/**
 * Build the sales tables once and return the rows that belong to every
 * supplied customer, keyed by customer id. Loading the tables a single
 * time matters: the directory endpoint calls this for the whole list,
 * and re-querying per customer would be O(customers × invoices).
 */
function loadCustomerSalesData(customers: any[]) {
  const invoices = queryAll('SELECT * FROM invoices');
  const invoiceItems = queryAll('SELECT * FROM invoice_items');
  const installments = queryAll('SELECT * FROM installments');
  const installmentPayments = queryAll('SELECT * FROM installment_payments');
  const returns = queryAll('SELECT * FROM sale_returns');

  const itemsByInvoice = new Map<string, any[]>();
  for (const item of invoiceItems) {
    const list = itemsByInvoice.get(item.invoiceId) || [];
    // Per-line profit AND cost are deliberately withheld from every
    // customer-facing payload (directory, ledger, supplier ledger). Both are
    // management figures, and shipping either one lets the other be derived by
    // subtraction. The raw values stay in the invoice_items table, which the
    // reports endpoints read directly, so nothing is lost there.
    const { itemProfit, frozenPurchaseCost, ...customerVisibleItem } = item;
    list.push(customerVisibleItem);
    itemsByInvoice.set(item.invoiceId, list);
  }

  const paymentsByInstallment = new Map<string, any[]>();
  for (const payment of installmentPayments) {
    const list = paymentsByInstallment.get(payment.installmentId) || [];
    list.push(payment);
    paymentsByInstallment.set(payment.installmentId, list);
  }

  // Ownership must be resolved against the WHOLE customer table, not just
  // the customers this call was asked about. Otherwise a single-customer
  // ledger would happily claim a name-only row that the directory already
  // treats as ambiguous because two people share that name — and the two
  // screens would disagree. We build the map globally, then only keep the
  // rows for the requested customers.
  const requested = new Set(customers.map((c: any) => c.id));
  const allCustomers = queryAll('SELECT id, name, phone FROM customers');
  const owners = new Map<string, any[]>();
  for (const customer of allCustomers) {
    for (const key of customerIdentityKeys(customer)) {
      const list = owners.get(key) || [];
      list.push(customer);
      owners.set(key, list);
    }
  }

  // A bucket that resolves to more than one customer (two people sharing
  // a name, say) is ambiguous for name-only rows — we refuse to guess so
  // the directory totals never contradict the ledger.
  const isUnambiguous = (key: string) => (owners.get(key) || []).length === 1;

  const invoicesByCustomer = new Map<string, any[]>();
  const installmentsByCustomer = new Map<string, any[]>();
  const returnsByCustomer = new Map<string, any[]>();

  const push = (map: Map<string, any[]>, customerId: string, value: any) => {
    if (!requested.has(customerId)) return;
    const list = map.get(customerId) || [];
    list.push(value);
    map.set(customerId, list);
  };

  for (const invoice of invoices) {
    const key = recordIdentityKey(invoice.customerName, invoice.customerPhone);
    if (!key || !isUnambiguous(key)) continue;
    for (const owner of owners.get(key)!) {
      push(invoicesByCustomer, owner.id, { ...invoice, items: itemsByInvoice.get(invoice.id) || [] });
    }
  }

  for (const installment of installments) {
    const key = recordIdentityKey(installment.customerName, installment.customerPhone);
    if (!key || !isUnambiguous(key)) continue;
    for (const owner of owners.get(key)!) {
      push(installmentsByCustomer, owner.id, {
        ...installment,
        payments: paymentsByInstallment.get(installment.id) || [],
      });
    }
  }

  for (const record of returns) {
    // sale_returns keeps only a free-text customer name, so it can be
    // matched by name only (the bucket check above still applies).
    const key = recordIdentityKey(record.customerName, '');
    if (!key || !isUnambiguous(key)) continue;
    for (const owner of owners.get(key)!) {
      push(returnsByCustomer, owner.id, record);
    }
  }

  // Returns can also be tied to a specific invoice even when the name was
  // typed differently — pull those in through the invoice link.
  for (const [customerId, list] of invoicesByCustomer) {
    const numbers = new Set(list.map((inv) => inv.invoiceNumber).filter(Boolean));
    const known = new Set((returnsByCustomer.get(customerId) || []).map((r) => r.id));
    const extra = returns.filter(
      (r) => r.invoiceNumber && numbers.has(r.invoiceNumber) && !known.has(r.id)
    );
    if (extra.length > 0) extra.forEach((r) => push(returnsByCustomer, customerId, r));
  }

  return { invoicesByCustomer, installmentsByCustomer, returnsByCustomer };
}

function todayString(): string {
  return new Date().toISOString().split('T')[0];
}

const LOCATION_LABEL: Record<string, string> = { gallery: 'المعرض', stationery: 'المكتبة' };

/**
 * Format a timestamp the same way the POS writes invoice times, so a single
 * statement column stays visually consistent whether the row came from an
 * invoice, a payment, or a return (all of which store ISO timestamps).
 */
function arabicTimeFromIso(iso: any): string {
  const raw = String(iso ?? '');
  if (!raw) return '';
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return raw.length >= 19 ? raw.substring(11, 19) : raw;
  return parsed.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

/** Money figures rolled up from one customer's rows. */
function summarizeCustomer(
  customer: any,
  invoices: any[],
  installments: any[],
  returns: any[]
): any {
  const today = todayString();
  let totalInvoiced = 0;
  let totalDiscount = 0;
  let totalPaid = 0;
  let totalRemaining = 0;
  let totalReturns = 0;
  let lastActivityDate: string | undefined;

  for (const invoice of invoices) {
    const total = Number(invoice.total) || 0;
    totalInvoiced += total;
    totalDiscount += Number(invoice.totalDiscount) || 0;
    totalPaid += Number(invoice.paid) || 0;
    totalRemaining += Number(invoice.remaining) || 0;
    if (invoice.date && (!lastActivityDate || invoice.date > lastActivityDate)) {
      lastActivityDate = invoice.date;
    }
  }

  for (const record of returns) {
    const refund = Number(record.totalRefund) || 0;
    totalReturns += refund;
    const date = String(record.date || '').substring(0, 10);
    if (date && (!lastActivityDate || date > lastActivityDate)) lastActivityDate = date;
  }

  let installmentTotal = 0;
  let installmentPaid = 0;
  let installmentRemaining = 0;
  let openInstallmentCount = 0;
  let overdueInstallmentCount = 0;

  for (const inst of installments) {
    installmentTotal += Number(inst.totalAmount) || 0;
    installmentPaid += Number(inst.paidAmount) || 0;
    installmentRemaining += Number(inst.remainingAmount) || 0;
    const remaining = Number(inst.remainingAmount) || 0;
    if (remaining > 0) {
      openInstallmentCount += 1;
      if (String(inst.dueDate || '') < today) overdueInstallmentCount += 1;
    }
  }

  // Installment payments and returns also count as "activity".
  for (const inst of installments) {
    for (const payment of inst.payments || []) {
      const date = String(payment.date || '').substring(0, 10);
      if (date && (!lastActivityDate || date > lastActivityDate)) lastActivityDate = date;
    }
  }

  return {
    invoiceCount: invoices.length,
    installmentCount: installments.length,
    openInstallmentCount,
    overdueInstallmentCount,
    totalInvoiced,
    totalDiscount,
    totalPaid,
    totalRemaining,
    totalReturns,
    netSales: totalInvoiced - totalReturns,
    // Net profit is intentionally omitted from the customer ledger: profit is
    // a management figure and does not belong on a customer's record.
    installmentTotal,
    installmentPaid,
    installmentRemaining,
    lastActivityDate,
  };
}

/**
 * Chronological statement (كشف حساب): every invoice the customer owes,
 * every cash payment they made, and every refund, with a running
 * balance so the figure at the bottom equals what they still owe.
 */
function buildCustomerStatement(
  invoices: any[],
  installments: any[],
  returns: any[]
): any[] {
  const entries: any[] = [];

  for (const invoice of invoices) {
    const total = Number(invoice.total) || 0;
    const paid = Number(invoice.paid) || 0;
    const isInstallment = Number(invoice.isInstallment) === 1 || invoice.paymentMethod === 'installment';
    // Describe the branches the line items actually belong to, so a mixed
    // invoice reads honestly in the customer's statement.
    const locs: string[] = Array.from(
      new Set<string>(
        (invoice.items || [])
          .map((it: any) => it.location || invoice.location)
          .filter(Boolean)
      )
    );
    const where =
      locs.length === 0
        ? LOCATION_LABEL[invoice.location] || ''
        : locs.length > 1
          ? `${locs.map((l) => LOCATION_LABEL[l] || l).join(' + ')}`
          : LOCATION_LABEL[locs[0]] || locs[0];
    entries.push({
      id: `inv:${invoice.id}`,
      type: 'invoice',
      date: String(invoice.date || '').substring(0, 10),
      time: invoice.time || '',
      reference: invoice.invoiceNumber,
      description: `فاتورة بيع ${isInstallment ? 'بالتقسيط' : 'نقدي/آجل'}${where ? ` — ${where}` : ''}`,
      location: locs.length === 1 ? locs[0] : invoice.location,
      sellerName: invoice.sellerName,
      debit: total,
      // Cash/card sales are settled on the spot; installment sales get
      // their down payment posted separately from installment_payments,
      // so crediting here too would double-count it.
      credit: isInstallment ? 0 : paid,
    });
  }

  for (const inst of installments) {
    for (const payment of inst.payments || []) {
      entries.push({
        id: `pay:${payment.id}`,
        type: 'payment',
        date: String(payment.date || '').substring(0, 10),
        time: payment.time || '',
        reference: inst.invoiceNumber,
        description: `سداد دفعة — ${payment.paymentMethod || 'نقدي'}${payment.receivedByName ? ` (${payment.receivedByName})` : ''}`,
        installmentId: inst.id,
        debit: 0,
        credit: Number(payment.amount) || 0,
      });
    }
  }

  for (const record of returns) {
    entries.push({
      id: `ret:${record.id}`,
      type: 'return',
      date: String(record.date || '').substring(0, 10),
      time: arabicTimeFromIso(record.createdAt),
      reference: record.invoiceNumber || record.sku || record.id,
      description: `استرداد ${record.quantity}× ${record.productName}${record.reason ? ` — ${record.reason}` : ''}`,
      location: record.location,
      debit: 0,
      credit: Number(record.totalRefund) || 0,
    });
  }

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return String(a.time || '').localeCompare(String(b.time || ''));
  });

  let balance = 0;
  for (const entry of entries) {
    balance += entry.debit - entry.credit;
    entry.balance = balance;
  }
  return entries;
}

/** Money figures rolled up from one supplier's purchase rows. */
function summarizeSupplier(supplier: any, supplies: any[]): any {
  let totalPurchases = 0;
  let totalReturns = 0;
  let itemCount = 0;
  let lastActivityDate: string | undefined;

  for (const supply of supplies) {
    const qty = Number(supply.quantity) || 0;
    const value = qty * (Number(supply.purchasePrice) || 0);
    if (Number(supply.isReturn) === 1) totalReturns += value;
    else totalPurchases += value;
    if (Number(supply.isReturn) !== 1) itemCount += qty;
    const date = String(supply.date || '').substring(0, 10);
    if (date && (!lastActivityDate || date > lastActivityDate)) lastActivityDate = date;
  }

  return {
    supplyCount: supplies.length,
    itemCount,
    totalPurchases,
    totalReturns,
    netPurchases: totalPurchases - totalReturns,
    lastActivityDate,
  };
}

/** Chronological purchase statement for a supplier. */
function buildSupplierStatement(supplies: any[]): any[] {
  const entries: any[] = supplies.map((supply) => {
    const qty = Number(supply.quantity) || 0;
    const value = qty * (Number(supply.purchasePrice) || 0);
    const isReturn = Number(supply.isReturn) === 1;
    return {
      id: `sup:${supply.id}`,
      type: (isReturn ? 'return' : 'purchase') as any,
      date: String(supply.date || '').substring(0, 10),
      time: arabicTimeFromIso(supply.date),
      reference: supply.sku,
      description: `${isReturn ? 'مرتجع من المورد' : 'توريد'} ${qty} ${supply.unit || 'قطعة'} × ${supply.productName}`,
      location: supply.location,
      sellerName: supply.createdByName,
      // Purchases increase what we owe the supplier; returns reduce it.
      debit: isReturn ? 0 : value,
      credit: isReturn ? value : 0,
    };
  });

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return String(a.time || '').localeCompare(String(b.time || ''));
  });

  let balance = 0;
  for (const entry of entries) {
    balance += entry.debit - entry.credit;
    entry.balance = balance;
  }
  return entries;
}

function serveStaticDist(app: express.Express) {
  const distPath = process.env.HAWR_DIST_DIR
    ? process.env.HAWR_DIST_DIR
    : path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  // SPA fallback ONLY for non-API GETs. /api/* paths that don't match
  // a registered route will fall through to the 404 JSON handler below
  // instead of returning the React index.html (which the renderer then
  // tries to JSON.parse and fails with "Unexpected token '<'").
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
  // Any /api/* path that no route matched: return JSON 404 so the
  // renderer's `res.json()` never sees an HTML body.
  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'API endpoint not found' });
  });
}

async function startServer() {
  const database = await getDb();
  (global as any).__hawr_db = database;

  // 1. System Status & Health
  app.get('/api/system/status', async (req: Request, res: Response) => {
    try {
      const adminExists = await hasAdmin();
      const dbPath = process.env.HAWR_DATA_DIR
        ? path.join(process.env.HAWR_DATA_DIR, 'hawr-gallery.sqlite')
        : path.join(process.cwd(), 'data', 'hawr-gallery.sqlite');
      let dbSizeKB = 0;
      if (fs.existsSync(dbPath)) {
        const stats = fs.statSync(dbPath);
        dbSizeKB = Math.round(stats.size / 1024);
      }
      res.json({
        success: true,
        isInitialized: adminExists,
        adminExists,
        databasePath: dbPath,
        dbSizeKB,
        version: '2.4.0',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Auth: Register Admin (Clean install first boot)
  app.post('/api/auth/register-admin', async (req: Request, res: Response) => {
    try {
      const adminExists = await hasAdmin();
      if (adminExists) {
        return res.status(400).json({ success: false, error: 'تم إنشاء حساب المدير مسبقاً' });
      }

      const { name, username, password, employeeCode } = req.body;
      if (!name || !username || !password || !employeeCode) {
        return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة' });
      }

      const { hash, salt } = hashPassword(password);
      const id = 'usr_' + Date.now();
      const createdAt = new Date().toISOString();

      runSql(
        `INSERT INTO users (id, name, username, passwordHash, salt, employeeCode, role, status, baseSalary, phone, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, 'admin', 'active', 0, NULL, ?)`,
        [id, name.trim(), username.trim().toLowerCase(), hash, salt, employeeCode.trim(), createdAt]
      );

      logAudit('admin_registered', id, username, 'تم إنشاء حساب المدير الأول للنظام');

      res.json({
        success: true,
        user: { id, name, username, employeeCode, role: 'admin', status: 'active', baseSalary: 0, isActive: true, createdAt },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Auth: Login
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
      }

      const users = queryAll('SELECT * FROM users WHERE username = ?', [username.trim().toLowerCase()]);
      if (users.length === 0) {
        logAudit('login_failed', 'unknown', username, 'محاولة تسجيل دخول فاشلة: المستخدم غير موجود');
        return res.status(401).json({ success: false, error: 'بيانات الدخول غير صحيحة' });
      }

      const user = users[0];
      if (user.status !== 'active') {
        logAudit('login_failed', user.id, username, 'محاولة تسجيل دخول لحساب معطل');
        return res.status(403).json({ success: false, error: 'هذا الحساب معطل حالياً' });
      }

      const isValid = verifyPassword(password, user.passwordHash, user.salt);
      if (!isValid) {
        logAudit('login_failed', user.id, username, 'محاولة تسجيل دخول فاشلة: كلمة مرور خاطئة');
        return res.status(401).json({ success: false, error: 'بيانات الدخول غير صحيحة' });
      }

      logAudit('login_success', user.id, username, `تسجيل دخول ناجح بصلاحية ${user.role}`);

      res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          employeeCode: user.employeeCode,
          role: user.role,
          status: user.status,
          baseSalary: Number(user.baseSalary || 0),
          phone: user.phone || undefined,
          isActive: user.status === 'active',
          createdAt: user.createdAt,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Verify Admin Credentials (for sensitive operations)
  app.post('/api/auth/verify-admin', async (req: Request, res: Response) => {
    try {
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ success: false, error: 'كلمة المرور مطلوبة' });
      }
      const admins = queryAll("SELECT * FROM users WHERE role = 'admin' AND status = 'active'");
      if (admins.length === 0) {
        return res.status(400).json({ success: false, error: 'لا يوجد حساب مدير نشط' });
      }
      const admin = admins[0];
      const isValid = verifyPassword(password, admin.passwordHash, admin.salt);
      if (!isValid) {
        return res.status(401).json({ success: false, error: 'كلمة مرور المدير غير صحيحة' });
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. Employees Management (Admin/Supervisor)
  app.get('/api/employees', (req: Request, res: Response) => {
    try {
      const users = queryAll(
        'SELECT id, name, username, employeeCode, role, status, COALESCE(baseSalary, 0) as baseSalary, phone, createdAt FROM users ORDER BY createdAt DESC'
      );
      const mapped = users.map((u) => ({
        ...u,
        baseSalary: Number(u.baseSalary || 0),
        isActive: u.status === 'active',
      }));
      res.json({ success: true, users: mapped });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/employees', (req: Request, res: Response) => {
    try {
      const { name, username, password, employeeCode, role, status, baseSalary, phone } = req.body;
      if (!name || !username || !password || !employeeCode || !role) {
        return res.status(400).json({ success: false, error: 'جميع الحقول مطلوبة' });
      }

      const existing = queryAll('SELECT id FROM users WHERE username = ? OR employeeCode = ?', [username.trim().toLowerCase(), employeeCode.trim()]);
      if (existing.length > 0) {
        return res.status(400).json({ success: false, error: 'اسم المستخدم أو كود الموظف مستخدم بالفعل' });
      }

      const { hash, salt } = hashPassword(password);
      const id = 'usr_' + Date.now();
      const createdAt = new Date().toISOString();
      const salary = Number(baseSalary || 0);
      const phoneStr = phone ? String(phone).trim() : null;

      runSql(
        `INSERT INTO users (id, name, username, passwordHash, salt, employeeCode, role, status, baseSalary, phone, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name.trim(), username.trim().toLowerCase(), hash, salt, employeeCode.trim(), role, status || 'active', salary, phoneStr, createdAt]
      );

      logAudit('employee_created', id, username, `إنشاء موظف جديد: ${name} (${role})`);

      res.json({
        success: true,
        user: {
          id,
          name,
          username,
          employeeCode,
          role,
          status: status || 'active',
          baseSalary: salary,
          phone: phoneStr,
          isActive: (status || 'active') === 'active',
          createdAt,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put('/api/employees/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, role, status, password, baseSalary, phone, isActive } = req.body;
      const target = queryAll('SELECT * FROM users WHERE id = ?', [id]);
      if (target.length === 0) {
        return res.status(404).json({ success: false, error: 'الموظف غير موجود' });
      }

      const newStatus = status || (isActive === false ? 'inactive' : 'active');
      const salary = Number(baseSalary || 0);
      const phoneStr = phone ? String(phone).trim() : null;

      if (password) {
        const { hash, salt } = hashPassword(password);
        runSql(
          'UPDATE users SET name = ?, role = ?, status = ?, baseSalary = ?, phone = ?, passwordHash = ?, salt = ? WHERE id = ?',
          [name, role, newStatus, salary, phoneStr, hash, salt, id]
        );
      } else {
        runSql(
          'UPDATE users SET name = ?, role = ?, status = ?, baseSalary = ?, phone = ? WHERE id = ?',
          [name, role, newStatus, salary, phoneStr, id]
        );
      }

      logAudit('employee_updated', id, target[0].username, `تعديل بيانات الموظف: ${name}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. Products & Inventory Management
  app.get('/api/products', (req: Request, res: Response) => {
    try {
      const { location, search, lowStock } = req.query;
      let sql = 'SELECT * FROM products WHERE 1=1';
      const params: any[] = [];

      if (location && (location === 'gallery' || location === 'stationery')) {
        sql += ' AND location = ?';
        params.push(location);
      }

      if (search) {
        const term = `%${String(search).trim()}%`;
        sql += ' AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ?)';
        params.push(term, term, term);
      }

      if (lowStock === 'true') {
        sql += ' AND quantity <= minStockAlert';
      }

      sql += ' ORDER BY name ASC';
      const products = queryAll(sql, params);
      res.json({ success: true, products });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/products', (req: Request, res: Response) => {
    try {
      const { name, sku, barcode, unit, location, quantity, salePrice, purchaseCost, minStockAlert, category } = req.body;
      if (!name || !sku || !location || salePrice === undefined || purchaseCost === undefined) {
        return res.status(400).json({ success: false, error: 'الحقول الأساسية للمنتج مطلوبة' });
      }

      if (location !== 'gallery' && location !== 'stationery') {
        return res.status(400).json({ success: false, error: 'يجب أن يكون موقع التخزين إما المعرض أو المكتبة' });
      }

      // Rule: Product cannot exist in both locations! It belongs to either gallery or stationery
      const existing = queryAll('SELECT * FROM products WHERE sku = ?', [sku.trim()]);
      if (existing.length > 0) {
        const otherLoc = existing[0].location === 'gallery' ? 'المعرض' : 'المكتبة';
        return res.status(400).json({
          success: false,
          error: `المنتج موجود بالفعل في (${otherLoc}) بكود ${sku}. لا يمكن لمنتج أن يتواجد في المعرض والمكتبة معاً. يمكنك نقله بدلاً من ذلك.`,
        });
      }

      const id = 'prd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const now = new Date().toISOString();
      const code = sku.trim();

      runSql(
        `INSERT INTO products (id, name, sku, barcode, unit, location, quantity, salePrice, purchaseCost, minStockAlert, category, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          name.trim(),
          code,
          code, // Barcode and SKU are unified
          unit || 'قطعة',
          location,
          Number(quantity) || 0,
          Number(salePrice),
          Number(purchaseCost),
          Number(minStockAlert) || 5,
          category || 'عام',
          now,
          now,
        ]
      );

      res.json({ success: true, productId: id });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put('/api/products/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, sku, unit, quantity, salePrice, purchaseCost, minStockAlert, category } = req.body;

      const current = queryAll('SELECT * FROM products WHERE id = ?', [id]);
      if (current.length === 0) {
        return res.status(404).json({ success: false, error: 'المنتج غير موجود' });
      }

      const now = new Date().toISOString();
      const code = sku ? sku.trim() : current[0].sku;

      runSql(
        `UPDATE products SET name = ?, sku = ?, barcode = ?, unit = ?, quantity = ?, salePrice = ?, purchaseCost = ?, minStockAlert = ?, category = ?, updatedAt = ?
         WHERE id = ?`,
        [
          name.trim(),
          code,
          code,
          unit || current[0].unit,
          Number(quantity),
          Number(salePrice),
          Number(purchaseCost),
          Number(minStockAlert),
          category || current[0].category,
          now,
          id,
        ]
      );

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/products/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      runSql('DELETE FROM products WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Transfer stock between locations (Gallery <-> Stationery)
  app.post('/api/products/transfer', (req: Request, res: Response) => {
    try {
      const { productId, fromLocation, toLocation, quantity, notes, userId, userName } = req.body;
      if (!productId || !fromLocation || !toLocation || !quantity || quantity <= 0) {
        return res.status(400).json({ success: false, error: 'بيانات النقل غير مكتملة' });
      }

      if (fromLocation === toLocation) {
        return res.status(400).json({ success: false, error: 'لا يمكن النقل لنفس الموقع' });
      }

      const products = queryAll('SELECT * FROM products WHERE id = ?', [productId]);
      if (products.length === 0) {
        return res.status(404).json({ success: false, error: 'المنتج غير موجود' });
      }

      const prod = products[0];
      if (prod.location !== fromLocation) {
        return res.status(400).json({ success: false, error: 'المنتج لا ينتمي إلى الموقع المصدر المحدد' });
      }

      if (prod.quantity < quantity) {
        return res.status(400).json({ success: false, error: `الكمية المتوفرة في المخزن (${prod.quantity}) أقل من الكمية المطلوبة نقلها` });
      }

      // Since product exclusively belongs to either Gallery or Stationery:
      // If full quantity is transferred, update location of product to toLocation.
      // If partial, check if destination already has a separate record or relocate full entity.
      // Rule: "لا يمكن لمنتج ان يوجد منه في المعرض والمكتبه اما ان يكون في المعرض او المكتبه"
      // Therefore, the entire product shifts to the new location, or the entire remaining inventory moves.
      const now = new Date().toISOString();
      const transferId = 'trf_' + Date.now();

      // Shift product location and update quantity
      runSql('UPDATE products SET location = ?, updatedAt = ? WHERE id = ?', [toLocation, now, productId]);

      runSql(
        `INSERT INTO stock_transfers (id, productId, productName, sku, fromLocation, toLocation, quantity, date, notes, performedByUserId, performedByName)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transferId,
          productId,
          prod.name,
          prod.sku,
          fromLocation,
          toLocation,
          prod.quantity,
          now,
          notes || 'نقل موقع المنتج بالكامل',
          userId || 'admin',
          userName || 'المدير',
        ]
      );

      logAudit('stock_transfer', userId || 'admin', userName || 'المدير', `نقل منتج ${prod.name} من ${fromLocation === 'gallery' ? 'المعرض' : 'المكتبة'} إلى ${toLocation === 'gallery' ? 'المعرض' : 'المكتبة'}`);

      res.json({ success: true, message: `تم نقل المنتج بنجاح إلى ${toLocation === 'gallery' ? 'المعرض' : 'المكتبة'}` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 7. Real Excel XLSX Import with Arabic & English header detection
  app.post('/api/products/import-xlsx', (req: Request, res: Response) => {
    try {
      const { fileBase64, defaultLocation } = req.body;
      if (!fileBase64) {
        return res.status(400).json({ success: false, error: 'لم يتم إرسال ملف Excel' });
      }

      const buffer = Buffer.from(fileBase64, 'base64');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (rows.length === 0) {
        return res.status(400).json({ success: false, error: 'الملف فارغ أو لا يحتوي على صفوف صالحة' });
      }

      // Column alias normalizer
      function normalizeKey(obj: any, aliases: string[]): any {
        for (const key of Object.keys(obj)) {
          const cleanKey = key.trim().toLowerCase();
          for (const alias of aliases) {
            if (cleanKey === alias.toLowerCase() || cleanKey.includes(alias.toLowerCase())) {
              return obj[key];
            }
          }
        }
        return undefined;
      }

      const errors: { rowNumber: number; reason: string; data: any }[] = [];
      let importedCount = 0;
      const now = new Date().toISOString();

      rows.forEach((rawRow, index) => {
        const rowNumber = index + 2; // Excel 1-based + 1 for header
        // Check if row is entirely empty
        const values = Object.values(rawRow).map(v => String(v).trim()).filter(Boolean);
        if (values.length === 0) return; // ignore completely empty row

        const name = normalizeKey(rawRow, ['اسم المنتج', 'الاسم', 'name', 'product', 'item']);
        const sku = normalizeKey(rawRow, ['كود', 'باركود', 'الباركود', 'sku', 'code', 'barcode']);
        const unit = normalizeKey(rawRow, ['الوحدة', 'وحدة', 'unit']) || 'قطعة';
        const rawLoc = normalizeKey(rawRow, ['الموقع', 'موقع التخزين', 'location', 'store']);
        const quantity = Number(normalizeKey(rawRow, ['الكمية', 'العدد', 'quantity', 'qty']) || 0);
        const salePrice = Number(normalizeKey(rawRow, ['سعر البيع', 'البيع', 'sale_price', 'price']) || 0);
        const purchaseCost = Number(normalizeKey(rawRow, ['سعر الشراء', 'التكلفة', 'شراء', 'cost', 'purchase_cost']) || 0);
        const minStock = Number(normalizeKey(rawRow, ['الحد الادنى', 'حد الطلب', 'min_stock']) || 5);
        const category = normalizeKey(rawRow, ['التصنيف', 'القسم', 'category']) || 'عام';

        if (!name || String(name).trim() === '') {
          errors.push({ rowNumber, reason: 'اسم المنتج مفقود أو فارغ', data: rawRow });
          return;
        }

        const cleanSku = sku ? String(sku).trim() : 'AUTO-' + Date.now() + '-' + index;

        // Determine location
        let location: 'gallery' | 'stationery' = defaultLocation || 'gallery';
        if (rawLoc) {
          const l = String(rawLoc).trim().toLowerCase();
          if (l.includes('مكتب') || l.includes('stationery') || l.includes('library')) {
            location = 'stationery';
          } else if (l.includes('معرض') || l.includes('gallery')) {
            location = 'gallery';
          }
        }

        // Check if SKU exists already
        const existing = queryAll('SELECT id, location FROM products WHERE sku = ?', [cleanSku]);
        if (existing.length > 0) {
          errors.push({
            rowNumber,
            reason: `الكود مكرر (${cleanSku}) وموجود مسبقاً في ${existing[0].location === 'gallery' ? 'المعرض' : 'المكتبة'}`,
            data: rawRow,
          });
          return;
        }

        const id = 'prd_' + Date.now() + '_' + index;
        runSql(
          `INSERT INTO products (id, name, sku, barcode, unit, location, quantity, salePrice, purchaseCost, minStockAlert, category, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, String(name).trim(), cleanSku, cleanSku, String(unit).trim(), location, quantity, salePrice, purchaseCost, minStock, String(category).trim(), now, now]
        );
        importedCount++;
      });

      res.json({
        success: true,
        importedCount,
        errorCount: errors.length,
        errors,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 8. Supplies & Restocking Movements
  app.get('/api/supplies', (req: Request, res: Response) => {
    try {
      const { location } = req.query;
      let sql = 'SELECT * FROM supplies WHERE 1=1';
      const params: any[] = [];
      if (location && (location === 'gallery' || location === 'stationery')) {
        sql += ' AND location = ?';
        params.push(location);
      }
      sql += ' ORDER BY date DESC';
      const supplies = queryAll(sql, params);
      res.json({ success: true, supplies });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/supplies', (req: Request, res: Response) => {
    try {
      const { productName, sku, unit, quantity, purchasePrice, salePrice, location, supplierId, supplierName, isReturn, notes, userId, userName } = req.body;
      if (!productName || !sku || !quantity || !purchasePrice || !location) {
        return res.status(400).json({ success: false, error: 'بيانات التوريد غير مكتملة' });
      }

      const id = 'sup_' + Date.now();
      const now = new Date().toISOString();
      const code = sku.trim();
      const qty = Number(quantity);
      const cost = Number(purchasePrice);

      // Check if product exists in inventory
      const existing = queryAll('SELECT * FROM products WHERE sku = ?', [code]);
      let resolvedSalePrice = (salePrice != null && Number(salePrice) > 0)
        ? Number(salePrice)
        : (cost * 1.3);

      if (existing.length > 0) {
        const prod = existing[0];
        // Enforce rule: product cannot exist in both locations
        if (prod.location !== location) {
          const locName = prod.location === 'gallery' ? 'المعرض' : 'المكتبة';
          return res.status(400).json({
            success: false,
            error: `هذا المنتج مسجل حالياً في (${locName}). لا يمكن توريده في موقع آخر إلا بعد نقله.`,
          });
        }

        // If user entered explicit salePrice > 0, update product's salePrice; otherwise keep current prod.salePrice
        if (salePrice != null && Number(salePrice) > 0) {
          resolvedSalePrice = Number(salePrice);
        } else {
          resolvedSalePrice = Number(prod.salePrice) || (cost * 1.3);
        }

        // Update inventory quantity, purchase cost, and sale price
        const newQty = isReturn ? Math.max(0, prod.quantity - qty) : prod.quantity + qty;
        runSql(
          'UPDATE products SET quantity = ?, purchaseCost = ?, salePrice = ?, unit = ?, updatedAt = ? WHERE id = ?',
          [newQty, cost, resolvedSalePrice, unit || prod.unit, now, prod.id]
        );
      } else {
        // Add new product automatically
        const newProdId = 'prd_' + Date.now();
        runSql(
          `INSERT INTO products (id, name, sku, barcode, unit, location, quantity, salePrice, purchaseCost, minStockAlert, category, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newProdId, productName.trim(), code, code, unit || 'قطعة', location, qty, resolvedSalePrice, cost, 5, 'عام', now, now]
        );
      }

      runSql(
        `INSERT INTO supplies (id, productName, sku, unit, quantity, purchasePrice, salePrice, location, date, supplierId, supplierName, isReturn, notes, createdById, createdByName)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, productName.trim(), code, unit || 'قطعة', qty, cost, resolvedSalePrice, location, now, supplierId || null, supplierName || null, isReturn ? 1 : 0, notes || null, userId || 'admin', userName || 'المدير']
      );

      res.json({ success: true, supplyId: id });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/supplies/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const records = queryAll('SELECT * FROM supplies WHERE id = ?', [id]);
      if (records.length === 0) {
        return res.status(404).json({ success: false, error: 'حركة التوريد غير موجودة' });
      }

      const sup = records[0];
      // Rollback stock
      const products = queryAll('SELECT * FROM products WHERE sku = ?', [sup.sku]);
      if (products.length > 0) {
        const prod = products[0];
        const rolledBackQty = sup.isReturn ? prod.quantity + sup.quantity : Math.max(0, prod.quantity - sup.quantity);
        runSql('UPDATE products SET quantity = ? WHERE id = ?', [rolledBackQty, prod.id]);
      }

      runSql('DELETE FROM supplies WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ---------------------------------------------------------------
  // Customer sale returns (استرداد منتج من عميل)
  // ---------------------------------------------------------------
  // A customer who previously bought a product brings it back. We:
  //   1. record the return in `sale_returns` (audit + report source)
  //   2. put the returned quantity BACK into product stock
  //   3. if an `invoiceNumber` was supplied, find the invoice, look up
  //      the original line item to get the actual sale price, increment
  //      `invoices.returnedAmount` by the refund value. Downstream
  //      financial reports already subtract `returnedAmount` from total
  //      realized sales + profit, so the books stay balanced.
  //   4. if no invoice number was supplied, we still record the return
  //      and the stock movement — the operator reconciles later.
  app.post('/api/returns', (req: Request, res: Response) => {
    try {
      const { productId, quantity, unitRefundPrice, invoiceNumber, customerName, reason, location, userId, userName } = req.body;
      if (!productId || !quantity || !unitRefundPrice || !location) {
        return res.status(400).json({ success: false, error: 'بيانات الاسترداد غير مكتملة (المنتج، الكمية، سعر الاسترداد، الموقع)' });
      }
      const qty = Number(quantity);
      const refund = Number(unitRefundPrice);
      if (!isFinite(qty) || qty <= 0) return res.status(400).json({ success: false, error: 'الكمية غير صحيحة' });
      if (!isFinite(refund) || refund < 0) return res.status(400).json({ success: false, error: 'سعر الاسترداد غير صحيح' });

      // Look up product (must exist; we'll put the qty back on it).
      const products = queryAll('SELECT * FROM products WHERE id = ?', [productId]);
      if (products.length === 0) {
        return res.status(404).json({ success: false, error: 'المنتج غير موجود في قاعدة البيانات' });
      }
      const prod = products[0];

      const id = 'ret_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const now = new Date().toISOString();
      const totalRefund = qty * refund;
      const cost = Number(prod.purchaseCost) || 0;
      const profitReversed = qty * (refund - cost);

      // A return always belongs to the branch that owns the product. The
      // caller may pass any location (or the header location of a mixed
      // invoice), which would otherwise net the refund off the wrong branch.
      const effectiveLocation = prod.location || location;

      // 1) Insert the return record
      runSql(
        `INSERT INTO sale_returns (id, productId, productName, sku, unit, quantity, unitRefundPrice, totalRefund, unitCostAtReturn, profitReversed, invoiceId, invoiceNumber, customerName, reason, location, date, createdById, createdByName, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          prod.id,
          prod.name,
          prod.sku,
          prod.unit || 'قطعة',
          qty,
          refund,
          totalRefund,
          cost,
          profitReversed,
          null, null,
          customerName || null,
          reason || null,
          effectiveLocation,
          now,
          userId || 'admin',
          userName || 'المدير',
          now,
        ]
      );

      // 2) Put the returned quantity BACK into stock
      runSql('UPDATE products SET quantity = quantity + ?, updatedAt = ? WHERE id = ?', [qty, now, prod.id]);

      // 3) If an invoice number was provided, link the return to it and
      //    increment that invoice's `returnedAmount`. Reports subtract
      //    this from the invoice's contribution to sales + profit.
      if (invoiceNumber && String(invoiceNumber).trim()) {
        const invs = queryAll('SELECT id, returnedAmount FROM invoices WHERE invoiceNumber = ?', [String(invoiceNumber).trim()]);
        if (invs.length > 0) {
          const inv = invs[0];
          const prevReturned = Number(inv.returnedAmount) || 0;
          runSql(
            'UPDATE invoices SET returnedAmount = ?, returnedAt = ?, returnedNotes = COALESCE(returnedNotes, ?) WHERE id = ?',
            [prevReturned + totalRefund, now, reason || `استرداد منتج ${prod.name}`, inv.id]
          );
          // Update the inserted sale_return row with the invoice link.
          runSql('UPDATE sale_returns SET invoiceId = ?, invoiceNumber = ? WHERE id = ?', [inv.id, String(invoiceNumber).trim(), id]);
        }
      }

      // 4) Audit log entry
      logAudit('sale_return', userId || 'admin', userName || 'المدير', `استرداد ${qty}×${prod.name} = ${totalRefund.toFixed(2)} ج.م${invoiceNumber ? ` (فاتورة ${invoiceNumber})` : ' (بدون فاتورة)'}`);

      res.json({
        success: true,
        returnId: id,
        totalRefund,
        newStock: Number(prod.quantity) + qty,
        profitReversed,
        linkedInvoice: !!invoiceNumber,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/returns', (req: Request, res: Response) => {
    try {
      const location = (req.query.location as string) || '';
      const sql = location && location !== 'all'
        ? 'SELECT * FROM sale_returns WHERE location = ? ORDER BY createdAt DESC LIMIT 200'
        : 'SELECT * FROM sale_returns ORDER BY createdAt DESC LIMIT 200';
      const params = location && location !== 'all' ? [location] : [];
      const returns = queryAll(sql, params);
      res.json({ success: true, returns });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 9. Customers & Suppliers (Strictly separated!)
  app.get('/api/customers', (req: Request, res: Response) => {
    try {
      const customers = queryAll('SELECT * FROM customers ORDER BY createdAt DESC');
      // Attach the money figures (sales, returns, open installments) so the
      // directory doubles as a real business screen instead of a phone book.
      try {
        const { invoicesByCustomer, installmentsByCustomer, returnsByCustomer } =
          loadCustomerSalesData(customers);
        const withSummary = customers.map((c: any) => ({
          ...c,
          summary: summarizeCustomer(
            c,
            invoicesByCustomer.get(c.id) || [],
            installmentsByCustomer.get(c.id) || [],
            returnsByCustomer.get(c.id) || []
          ),
        }));
        res.json({ success: true, customers: withSummary });
      } catch (summaryErr: any) {
        // Never let the summary calculation take the directory down.
        console.error('[hawr] customer summary failed:', summaryErr);
        res.json({ success: true, customers });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 9a. Full customer account ledger (سجل العميل الشامل)
  // Everything the system knows about one customer: every invoice with its
  // line items, every installment invoice with its full payment history,
  // every return/refund, plus a chronological statement with a running
  // balance. The UI renders this in one screen and pays installments
  // directly from it, so staff never have to jump to the installments tab.
  app.get('/api/customers/:id/ledger', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const found = queryAll('SELECT * FROM customers WHERE id = ?', [id]);
      if (found.length === 0) {
        return res.status(404).json({ success: false, error: 'العميل غير موجود' });
      }
      const customer = found[0];
      const { invoicesByCustomer, installmentsByCustomer, returnsByCustomer } =
        loadCustomerSalesData([customer]);

      const invoices = (invoicesByCustomer.get(customer.id) || []).sort((a, b) =>
        String(b.date).localeCompare(String(a.date))
      );
      const installments = (installmentsByCustomer.get(customer.id) || []).sort((a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt))
      );
      const returns = (returnsByCustomer.get(customer.id) || []).sort((a, b) =>
        String(b.date || b.createdAt).localeCompare(String(a.date || a.createdAt))
      );

      const nameKey = String(customer.name || '').trim();
      const sameNameCount = queryAll('SELECT id FROM customers WHERE TRIM(name) = ?', [
        nameKey,
      ]).length;

      res.json({
        success: true,
        ledger: {
          customer: { ...customer, summary: summarizeCustomer(customer, invoices, installments, returns) },
          invoices,
          installments,
          returns,
          statement: buildCustomerStatement(invoices, installments, returns),
          summary: summarizeCustomer(customer, invoices, installments, returns),
          matchInfo: {
            phoneKey: normalizePhoneKey(customer.phone),
            nameKey,
            nameSharedWithAnotherCustomer: sameNameCount > 1,
          },
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put('/api/customers/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, phone, address, notes } = req.body;
      const found = queryAll('SELECT * FROM customers WHERE id = ?', [id]);
      if (found.length === 0) {
        return res.status(404).json({ success: false, error: 'العميل غير موجود' });
      }
      if (!name || !String(name).trim() || !phone || !String(phone).trim()) {
        return res.status(400).json({ success: false, error: 'اسم العميل ورقم الهاتف مطلوبان' });
      }
      runSql('UPDATE customers SET name = ?, phone = ?, address = ?, notes = ? WHERE id = ?', [
        String(name).trim(),
        String(phone).trim(),
        address || '',
        notes || '',
        id,
      ]);
      const updated = queryAll('SELECT * FROM customers WHERE id = ?', [id])[0];
      res.json({ success: true, customer: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Deleting a customer is deliberately blocked once the account has any
  // money attached to it — the ledger would lose history that financial
  // reports still reference.
  app.delete('/api/customers/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const found = queryAll('SELECT * FROM customers WHERE id = ?', [id]);
      if (found.length === 0) {
        return res.status(404).json({ success: false, error: 'العميل غير موجود' });
      }
      const customer = found[0];
      const { invoicesByCustomer, installmentsByCustomer, returnsByCustomer } =
        loadCustomerSalesData([customer]);
      const linked =
        (invoicesByCustomer.get(customer.id) || []).length +
        (installmentsByCustomer.get(customer.id) || []).length +
        (returnsByCustomer.get(customer.id) || []).length;
      if (linked > 0) {
        return res.status(400).json({
          success: false,
          error: `لا يمكن حذف هذا العميل لارتباطه بـ ${linked} حركة مسجلة (فواتير/أقساط/مرتجعات). يمكنك تعديل بياناته بدلاً من ذلك.`,
        });
      }
      runSql('DELETE FROM customers WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/suppliers', (req: Request, res: Response) => {
    try {
      const suppliers = queryAll('SELECT * FROM suppliers ORDER BY createdAt DESC');
      try {
        const supplies = queryAll('SELECT * FROM supplies');
        const bySupplier = new Map<string, any[]>();
        for (const supply of supplies) {
          if (!supply.supplierId) continue;
          const list = bySupplier.get(supply.supplierId) || [];
          list.push(supply);
          bySupplier.set(supply.supplierId, list);
        }
        const withSummary = suppliers.map((s: any) => ({
          ...s,
          summary: summarizeSupplier(s, bySupplier.get(s.id) || []),
        }));
        res.json({ success: true, suppliers: withSummary });
      } catch (summaryErr: any) {
        console.error('[hawr] supplier summary failed:', summaryErr);
        res.json({ success: true, suppliers });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 9b. Full supplier account ledger (سجل المورد الشامل)
  app.get('/api/suppliers/:id/ledger', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const found = queryAll('SELECT * FROM suppliers WHERE id = ?', [id]);
      if (found.length === 0) {
        return res.status(404).json({ success: false, error: 'المورد غير موجود' });
      }
      const supplier = found[0];
      const rows = queryAll(
        'SELECT * FROM supplies WHERE supplierId = ? ORDER BY date DESC',
        [id]
      );

      // Older supply rows were saved with only a name (no supplierId), so
      // fall back to matching the name so old purchases still show up.
      const nameKey = String(supplier.name || '').trim();
      const legacyRows = queryAll(
        "SELECT * FROM supplies WHERE (supplierId IS NULL OR supplierId = '') AND supplierName = ? ORDER BY date DESC",
        [nameKey]
      );
      const supplies = [...rows, ...legacyRows].sort((a, b) =>
        String(b.date).localeCompare(String(a.date))
      );

      res.json({
        success: true,
        ledger: {
          supplier: { ...supplier, summary: summarizeSupplier(supplier, supplies) },
          supplies,
          statement: buildSupplierStatement(supplies),
          summary: summarizeSupplier(supplier, supplies),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put('/api/suppliers/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name, phone, company, address, notes } = req.body;
      const found = queryAll('SELECT * FROM suppliers WHERE id = ?', [id]);
      if (found.length === 0) {
        return res.status(404).json({ success: false, error: 'المورد غير موجود' });
      }
      if (!name || !String(name).trim() || !phone || !String(phone).trim()) {
        return res.status(400).json({ success: false, error: 'اسم المورد ورقم الهاتف مطلوبان' });
      }
      runSql(
        'UPDATE suppliers SET name = ?, phone = ?, company = ?, address = ?, notes = ? WHERE id = ?',
        [String(name).trim(), String(phone).trim(), company || '', address || '', notes || '', id]
      );
      const updated = queryAll('SELECT * FROM suppliers WHERE id = ?', [id])[0];
      res.json({ success: true, supplier: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/suppliers/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const found = queryAll('SELECT * FROM suppliers WHERE id = ?', [id]);
      if (found.length === 0) {
        return res.status(404).json({ success: false, error: 'المورد غير موجود' });
      }
      const supplier = found[0];
      const linked =
        queryAll('SELECT id FROM supplies WHERE supplierId = ?', [id]).length +
        queryAll("SELECT id FROM supplies WHERE (supplierId IS NULL OR supplierId = '') AND supplierName = ?", [
          String(supplier.name || '').trim(),
        ]).length;
      if (linked > 0) {
        return res.status(400).json({
          success: false,
          error: `لا يمكن حذف هذا المورد لارتباطه بـ ${linked} حركة توريد مسجلة. يمكنك تعديل بياناته بدلاً من ذلك.`,
        });
      }
      runSql('DELETE FROM suppliers WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/customers', (req: Request, res: Response) => {
    try {
      const { name, phone, address, notes } = req.body;
      if (!name || !phone) {
        return res.status(400).json({ success: false, error: 'اسم العميل ورقم الهاتف مطلوبان' });
      }
      const id = 'cst_' + Date.now();
      const now = new Date().toISOString();
      runSql('INSERT INTO customers (id, name, phone, address, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?)', [
        id,
        name.trim(),
        phone.trim(),
        address || '',
        notes || '',
        now,
      ]);
      res.json({ success: true, customer: { id, name, phone, address, notes, createdAt: now } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/suppliers', (req: Request, res: Response) => {
    try {
      const { name, phone, company, address, notes } = req.body;
      if (!name || !phone) {
        return res.status(400).json({ success: false, error: 'اسم المورد ورقم الهاتف مطلوبان' });
      }
      const id = 'sup_ent_' + Date.now();
      const now = new Date().toISOString();
      runSql(
        'INSERT INTO suppliers (id, name, phone, company, address, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          name.trim(),
          phone.trim(),
          company || '',
          address || '',
          notes || '',
          now,
        ]
      );
      res.json({ success: true, supplier: { id, name, phone, company, address, notes, createdAt: now } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 10. Invoices (Sales & POS)
  app.get('/api/invoices', (req: Request, res: Response) => {
    try {
      const { location, sellerId, startDate, endDate, paymentMethod } = req.query;
      let sql = 'SELECT * FROM invoices WHERE 1=1';
      const params: any[] = [];

      if (location && (location === 'gallery' || location === 'stationery')) {
        sql += ' AND location = ?';
        params.push(location);
      }
      if (sellerId) {
        sql += ' AND sellerId = ?';
        params.push(sellerId);
      }
      if (paymentMethod) {
        sql += ' AND paymentMethod = ?';
        params.push(paymentMethod);
      }
      if (startDate) {
        sql += ' AND date >= ?';
        params.push(startDate);
      }
      if (endDate) {
        sql += ' AND date <= ?';
        params.push(endDate);
      }

      sql += ' ORDER BY createdAt DESC';
      const invoices = queryAll(sql, params);

      // Attach items to each invoice
      const enrichedInvoices = invoices.map(inv => {
        const items = queryAll('SELECT * FROM invoice_items WHERE invoiceId = ?', [inv.id]);
        return { ...inv, items };
      });

      res.json({ success: true, invoices: enrichedInvoices });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/invoices', (req: Request, res: Response) => {
    try {
      const {
        customerName,
        customerPhone,
        location,
        sellerId,
        sellerName,
        sellerCode,
        items,
        subtotal,
        totalDiscount,
        total,
        paid,
        remaining,
        paymentMethod,
        isInstallment,
        installmentDueDate,
        installmentPercent,
        installmentSurcharge,
        finalTotal,
        notes,
      } = req.body;

      if (!items || items.length === 0) {
        return res.status(400).json({ success: false, error: 'الفاتورة يجب أن تحتوي على صنف واحد على الأقل' });
      }

      // Mandatory validation: customer name and phone mandatory for installment
      if (paymentMethod === 'installment') {
        if (!customerName || !customerPhone || customerPhone.trim() === '') {
          return res.status(400).json({ success: false, error: 'اسم العميل ورقم الهاتف إلزاميان عند البيع بالتقسيط' });
        }
      }

      const invoiceId = 'inv_' + Date.now();
      const invoiceNumber = 'HAWR-' + (Math.floor(100000 + Math.random() * 900000));
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
      const createdAt = now.toISOString();

      // Check inventory availability and snapshot frozen purchase cost
      for (const item of items) {
        const prods = queryAll('SELECT * FROM products WHERE id = ?', [item.productId]);
        if (prods.length === 0) {
          return res.status(400).json({ success: false, error: `المنتج (${item.productName}) غير موجود بالمخزون` });
        }
        const prod = prods[0];
        if (prod.quantity < item.quantity) {
          return res.status(400).json({
            success: false,
            error: `الكمية المتاحة من المنتج (${prod.name}) هي ${prod.quantity} فقط، لا تكفي للكمية المطلوبة (${item.quantity})`,
          });
        }
      }

      // Per-item location is the source of truth: one invoice may mix gallery
      // and stationery items. Stock stays separate because every product row
      // belongs to exactly one location, so nothing is merged.
      const itemLocations: string[] = items.map((item: any) => {
        const requested = String(item.location ?? '').trim();
        return requested === 'gallery' || requested === 'stationery' ? requested : location;
      });

      // Deduct inventory and calculate frozen profit
      let calculatedGrossProfit = 0;

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const prod = queryAll('SELECT * FROM products WHERE id = ?', [item.productId])[0];
        const newQty = Math.max(0, prod.quantity - item.quantity);
        runSql('UPDATE products SET quantity = ? WHERE id = ?', [newQty, prod.id]);

        const itemId = 'item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const frozenCost = prod.purchaseCost;
        const actualPrice = item.actualSalePrice !== undefined ? item.actualSalePrice : (item.unitSalePrice - (item.discount || 0));
        // Rule: ربح البند = (سعر البيع بعد الخصم − سعر الشراء) × الكمية
        const itemProfit = (actualPrice - frozenCost) * item.quantity;
        calculatedGrossProfit += itemProfit;

        runSql(
          `INSERT INTO invoice_items (id, invoiceId, productId, productName, sku, unit, quantity, unitSalePrice, discount, actualSalePrice, frozenPurchaseCost, itemProfit, total, location)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            itemId,
            invoiceId,
            item.productId,
            item.productName,
            item.sku,
            item.unit || 'قطعة',
            item.quantity,
            item.unitSalePrice,
            item.discount || 0,
            actualPrice,
            frozenCost,
            itemProfit,
            actualPrice * item.quantity,
            itemLocations[idx],
          ]
        );
      }

      // File the customer automatically so the directory always matches what
      // actually happened at the till (see ensureCustomerForSale).
      const createdCustomerId = ensureCustomerForSale(customerName, customerPhone, paymentMethod);

      const status = paymentMethod === 'installment' && remaining > 0 ? 'partial' : 'completed';

      // Invoice-level `location` is only a label for invoice listings (drafts,
      // history, filters). All money attribution reads per-item location, so a
      // mixed invoice is priced correctly in BOTH branches' reports. We keep
      // the highest-value item's location as the primary label.
      const itemTotals = items.map((item: any, i: number) => {
        const actualPrice =
          item.actualSalePrice !== undefined
            ? item.actualSalePrice
            : item.unitSalePrice - (item.discount || 0);
        return actualPrice * item.quantity;
      });
      let primaryIdx = 0;
      for (let i = 1; i < itemTotals.length; i++) {
        if (itemTotals[i] > itemTotals[primaryIdx]) primaryIdx = i;
      }
      const primaryLocation = itemLocations[primaryIdx];
      const isMixedInvoice = new Set(itemLocations).size > 1;

      runSql(
        `INSERT INTO invoices (id, invoiceNumber, customerName, customerPhone, location, sellerId, sellerName, sellerCode, date, time, subtotal, totalDiscount, total, paid, remaining, paymentMethod, isInstallment, installmentDueDate, installmentPercent, installmentSurcharge, finalTotal, status, notes, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          invoiceNumber,
          customerName || 'عميل نقدي',
          customerPhone || '',
          primaryLocation,
          sellerId,
          sellerName,
          sellerCode,
          dateStr,
          timeStr,
          subtotal,
          totalDiscount || 0,
          total,
          paid,
          remaining,
          paymentMethod,
          paymentMethod === 'installment' ? 1 : 0,
          installmentDueDate || '',
          Number(installmentPercent) || 0,
          Number(installmentSurcharge) || 0,
          Number(finalTotal) || total,
          status,
          notes || '',
          createdAt,
        ]
      );

      // If installment, create installment record
      if (paymentMethod === 'installment') {
        const instId = 'inst_' + Date.now();
        runSql(
          `INSERT INTO installments (id, invoiceId, invoiceNumber, customerName, customerPhone, location, sellerId, sellerName, sellerCode, totalAmount, paidAmount, remainingAmount, dueDate, paymentCount, status, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            instId,
            invoiceId,
            invoiceNumber,
            customerName,
            customerPhone,
            primaryLocation,
            sellerId,
            sellerName,
            sellerCode,
            total,
            paid,
            remaining,
            installmentDueDate || dateStr,
            paid > 0 ? 1 : 0,
            remaining <= 0 ? 'completed' : 'active',
            createdAt,
            createdAt,
          ]
        );

        if (paid > 0) {
          const payId = 'pay_' + Date.now();
          runSql(
            `INSERT INTO installment_payments (id, installmentId, amount, date, time, paymentMethod, notes, receivedById, receivedByName)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [payId, instId, paid, dateStr, timeStr, 'مقدم تقسيط', 'دفعة مقدمة مع إنشاء الفاتورة', sellerId, sellerName]
          );
        }
      }

      res.json({
        success: true,
        invoiceId,
        invoiceNumber,
        grossProfit: calculatedGrossProfit,
        // Per-branch split so the cashier can confirm the till at a glance.
        locationBreakdown: itemLocations.reduce((acc: any, loc: string, i: number) => {
          acc[loc] = (acc[loc] || 0) + itemTotals[i];
          return acc;
        }, {}),
        isMixedInvoice,
        primaryLocation,
        // Set when this sale created a new customer record in the directory.
        createdCustomerId,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  // 10b. Invoice Drafts (Suspended / Paused Invoices)
  app.post('/api/invoice-drafts', (req: Request, res: Response) => {
    try {
      const d = req.body || {};
      const id = d.id || 'drf_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const itemsJson = JSON.stringify(d.items || []);
      const now = new Date().toISOString();

      // Delete old then insert (replace). Keeps schema simple.
      runSql('DELETE FROM invoice_drafts WHERE id = ?', [id]);
      runSql(
        `INSERT INTO invoice_drafts
         (id, draftLabel, invoiceNumber, customerName, customerPhone, location,
          sellerId, sellerName, sellerCode, date, time, itemsJson, subtotal,
          totalDiscount, total, paid, remaining, paymentMethod, isInstallment,
          installmentDueDate, notes, itemCount, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          d.draftLabel || 'فاتورة معلقة',
          d.invoiceNumber || null,
          d.customerName || 'عميل نقدي',
          d.customerPhone || null,
          d.location || 'gallery',
          d.sellerId || '',
          d.sellerName || '',
          d.sellerCode || '',
          d.date || now.substring(0, 10),
          d.time || now.substring(11, 19),
          itemsJson,
          Number(d.subtotal) || 0,
          Number(d.totalDiscount) || 0,
          Number(d.total) || 0,
          Number(d.paid) || 0,
          Number(d.remaining) || 0,
          d.paymentMethod || 'cash',
          d.isInstallment ? 1 : 0,
          d.installmentDueDate || null,
          d.notes || null,
          (d.items || []).length,
          now,
        ]
      );

      const saved = queryAll('SELECT * FROM invoice_drafts WHERE id = ?', [id])[0];
      const parsed = saved ? { ...saved, items: JSON.parse(saved.itemsJson) } : null;
      res.json({ success: true, draft: parsed });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/invoice-drafts', (req: Request, res: Response) => {
    try {
      const { location, sellerId } = req.query;
      let sql = 'SELECT * FROM invoice_drafts WHERE 1=1';
      const params: any[] = [];
      if (location === 'gallery' || location === 'stationery') {
        sql += ' AND location = ?';
        params.push(location);
      }
      if (sellerId) {
        sql += ' AND sellerId = ?';
        params.push(sellerId);
      }
      sql += ' ORDER BY updatedAt DESC';
      const rows = queryAll(sql, params);
      const drafts = rows.map((r: any) => ({
        ...r,
        items: JSON.parse(r.itemsJson || '[]'),
      }));
      res.json({ success: true, drafts });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/invoice-drafts/:id', (req: Request, res: Response) => {
    try {
      const row = queryAll('SELECT * FROM invoice_drafts WHERE id = ?', [req.params.id])[0];
      if (!row) return res.status(404).json({ success: false, error: 'المسودة غير موجودة' });
      const draft = { ...row, items: JSON.parse((row as any).itemsJson || '[]') };
      res.json({ success: true, draft });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/invoice-drafts/:id', (req: Request, res: Response) => {
    try {
      runSql('DELETE FROM invoice_drafts WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 11. Installments Management (Full & Partial Payments)
  app.get('/api/installments', (req: Request, res: Response) => {
    try {
      const { location, status, search } = req.query;
      let sql = 'SELECT * FROM installments WHERE 1=1';
      const params: any[] = [];

      if (location && (location === 'gallery' || location === 'stationery')) {
        sql += ' AND location = ?';
        params.push(location);
      }
      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }
      if (search) {
        const term = `%${String(search).trim()}%`;
        sql += ' AND (customerName LIKE ? OR customerPhone LIKE ? OR invoiceNumber LIKE ?)';
        params.push(term, term, term);
      }

      sql += ' ORDER BY createdAt DESC';
      const records = queryAll(sql, params);

      const enriched = records.map(inst => {
        const payments = queryAll('SELECT * FROM installment_payments WHERE installmentId = ? ORDER BY date ASC, time ASC', [inst.id]);
        return { ...inst, payments };
      });

      res.json({ success: true, installments: enriched });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/installments/:id/payments', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { amount, paymentMethod, notes, receivedById, receivedByName } = req.body;
      const payAmount = Number(amount);
      if (!payAmount || payAmount <= 0) {
        return res.status(400).json({ success: false, error: 'مبلغ السداد يجب أن يكون أكبر من الصفر' });
      }

      const records = queryAll('SELECT * FROM installments WHERE id = ?', [id]);
      if (records.length === 0) {
        return res.status(404).json({ success: false, error: 'سجل القسط غير موجود' });
      }

      const inst = records[0];
      if (payAmount > inst.remainingAmount) {
        return res.status(400).json({ success: false, error: `المبلغ المدخل (${payAmount}) يتجاوز المتبقي (${inst.remainingAmount})` });
      }

      const newPaid = inst.paidAmount + payAmount;
      const newRemaining = inst.remainingAmount - payAmount;
      const newCount = inst.paymentCount + 1;
      const newStatus = newRemaining <= 0 ? 'completed' : 'active';
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

      // Insert payment
      const paymentId = 'pay_' + Date.now();
      runSql(
        `INSERT INTO installment_payments (id, installmentId, amount, date, time, paymentMethod, notes, receivedById, receivedByName)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [paymentId, id, payAmount, dateStr, timeStr, paymentMethod || 'نقدي', notes || '', receivedById || 'user', receivedByName || 'موظف']
      );

      // Update installment
      runSql(
        'UPDATE installments SET paidAmount = ?, remainingAmount = ?, paymentCount = ?, status = ?, updatedAt = ? WHERE id = ?',
        [newPaid, newRemaining, newCount, newStatus, now.toISOString(), id]
      );

      // Update parent invoice
      runSql('UPDATE invoices SET paid = ?, remaining = ?, status = ? WHERE id = ?', [
        newPaid,
        newRemaining,
        newRemaining <= 0 ? 'completed' : 'partial',
        inst.invoiceId,
      ]);

      const receiptMessage =
        newRemaining <= 0
          ? `تم السداد بالكامل بمبلغ: ${payAmount} ج.م (المتبقي: 0 ج.م)`
          : `تم السداد جزئياً بمبلغ: ${payAmount} ج.م (المبلغ المتبقي: ${newRemaining} ج.م)`;

      res.json({
        success: true,
        receiptMessage,
        newPaid,
        newRemaining,
        newStatus,
        paymentCount: newCount,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 12. Expenses, Salaries & Scrap
  app.get('/api/expenses', (req: Request, res: Response) => {
    try {
      const { location, category, month } = req.query;
      let sql = 'SELECT * FROM expenses WHERE 1=1';
      const params: any[] = [];

      if (location && (location === 'gallery' || location === 'stationery')) {
        sql += ' AND location = ?';
        params.push(location);
      }
      if (category) {
        sql += ' AND category = ?';
        params.push(category);
      }
      if (month) {
        sql += ' AND date LIKE ?';
        params.push(`${month}%`);
      }

      sql += ' ORDER BY date DESC';
      const expenses = queryAll(sql, params);
      res.json({ success: true, expenses });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/expenses', (req: Request, res: Response) => {
    try {
      const { category, amount, date, location, employeeId, employeeName, notes, userId, userName } = req.body;
      const numAmount = Number(amount);
      if (!category || !numAmount || numAmount <= 0 || !location) {
        return res.status(400).json({ success: false, error: 'بيانات المصروف غير مكتملة' });
      }

      const expDate = date || new Date().toISOString().split('T')[0];
      let salaryMonth: string | null = null;

      // Special handling for salaries: Due on last actual day of the month
      if (category === 'salary') {
        if (!employeeId || !employeeName) {
          return res.status(400).json({ success: false, error: 'يجب اختيار الموظف عند تسجيل الراتب' });
        }

        const d = new Date(expDate);
        const year = d.getFullYear();
        const month = d.getMonth(); // 0-indexed
        // Determine last day of this month
        const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
        const effectiveLastDay = lastDayOfMonth >= 30 ? 30 : lastDayOfMonth;

        salaryMonth = `${year}-${String(month + 1).padStart(2, '0')}`;

        // Check if salary for this employee already registered for this month
        const existing = queryAll(
          "SELECT id FROM expenses WHERE category = 'salary' AND employeeId = ? AND salaryMonth = ?",
          [employeeId, salaryMonth]
        );
        if (existing.length > 0) {
          return res.status(400).json({
            success: false,
            error: `تم صرف راتب شهر (${salaryMonth}) للموظف (${employeeName}) مسبقاً! يمنع تكرار صرف الراتب للشهر نفسه.`,
          });
        }
      }

      const id = 'exp_' + Date.now();
      const now = new Date().toISOString();

      runSql(
        `INSERT INTO expenses (id, category, amount, date, location, employeeId, employeeName, salaryMonth, notes, createdById, createdByName, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          category,
          numAmount,
          expDate,
          location,
          employeeId || null,
          employeeName || null,
          salaryMonth,
          notes || '',
          userId || 'admin',
          userName || 'المدير',
          now,
        ]
      );

      res.json({ success: true, expenseId: id });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 12b. Today's sales summary (lightweight, used by ReportsScreen header)
  app.get('/api/reports/today', (req: Request, res: Response) => {
    try {
      const today = new Date().toISOString().substring(0, 10);
      const { location, sellerId } = req.query;
      const wantLocation = location === 'gallery' || location === 'stationery' ? location : null;
      let sql = 'SELECT * FROM invoices WHERE date = ?';
      const params: any[] = [today];
      if (sellerId) {
        sql += ' AND sellerId = ?';
        params.push(sellerId);
      }
      // No branch filter here: a mixed invoice is split per item instead.
      const allInvoices = queryAll(sql, params);

      const itemsByInvoice = new Map<string, any[]>();
      if (allInvoices.length > 0) {
        const ids = allInvoices.map((i: any) => i.id);
        const rows = queryAll(
          `SELECT * FROM invoice_items WHERE invoiceId IN (${ids.map(() => '?').join(',')})`,
          ids
        );
        for (const row of rows) {
          const list = itemsByInvoice.get(row.invoiceId) || [];
          list.push(row);
          itemsByInvoice.set(row.invoiceId, list);
        }
      }

      let total = 0, paid = 0, remaining = 0, totalProfit = 0, invoiceCount = 0;
      for (const inv of allInvoices) {
        const items = itemsByInvoice.get(inv.id) || [];
        const scoped = wantLocation
          ? items.filter((it: any) => (it.location || inv.location) === wantLocation)
          : items;
        if (scoped.length === 0) continue;
        invoiceCount += 1;
        let branchSales = 0;
        for (const it of scoped) {
          branchSales += Number(it.total) || 0;
          totalProfit += Number(it.itemProfit) || 0;
        }
        total += branchSales;
        const invoiceTotal = Number(inv.total) || 0;
        const share =
          invoiceTotal > 0 ? branchSales / invoiceTotal : scoped.length / Math.max(items.length, 1);
        paid += (Number(inv.paid) || 0) * share;
        remaining += (Number(inv.remaining) || 0) * share;
      }
      res.json({
        success: true,
        date: today,
        invoiceCount,
        totalSales: total,
        totalPaid: paid,
        totalRemaining: remaining,
        totalProfit,
        invoices: allInvoices,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 13. Reports (Gallery vs Stationery split per invoice ITEM)
  app.get('/api/reports', (req: Request, res: Response) => {
    try {
      const { location, startDate, endDate, sellerId } = req.query;
      const wantLocation = location === 'gallery' || location === 'stationery' ? location : null;

      // One invoice can hold items from both branches, so the branch filter is
      // applied to invoice ITEMS, never to the invoice header. Fetching by
      // date/seller only means a mixed invoice is counted in both reports,
      // each time only for its own items.
      let invSql = 'SELECT * FROM invoices WHERE 1=1';
      const invParams: any[] = [];
      if (sellerId) {
        invSql += ' AND sellerId = ?';
        invParams.push(sellerId);
      }
      if (startDate) {
        invSql += ' AND date >= ?';
        invParams.push(startDate);
      }
      if (endDate) {
        invSql += ' AND date <= ?';
        invParams.push(endDate);
      }

      const allInvoices = queryAll(invSql, invParams);

      // Load every line item of those invoices in one pass (no N+1 queries).
      const itemsByInvoice = new Map<string, any[]>();
      if (allInvoices.length > 0) {
        const ids = allInvoices.map((i: any) => i.id);
        const rows = queryAll(
          `SELECT * FROM invoice_items WHERE invoiceId IN (${ids.map(() => '?').join(',')})`,
          ids
        );
        for (const row of rows) {
          const list = itemsByInvoice.get(row.invoiceId) || [];
          list.push(row);
          itemsByInvoice.set(row.invoiceId, list);
        }
      }

      let totalSales = 0;
      let totalDiscounts = 0;
      let totalPaid = 0;
      let totalRemaining = 0;
      let totalGrossProfit = 0;
      let totalCOGS = 0;
      let matchedInvoices = 0;

      for (const inv of allInvoices) {
        const items = itemsByInvoice.get(inv.id) || [];
        const itemsForBranch = wantLocation
          ? items.filter((it: any) => (it.location || inv.location) === wantLocation)
          : items;

        // An invoice with no matching items does not belong in this report.
        if (itemsForBranch.length === 0) continue;
        matchedInvoices += 1;

        let branchSales = 0;
        for (const it of itemsForBranch) {
          branchSales += Number(it.total) || 0;
          totalGrossProfit += Number(it.itemProfit) || 0;
          totalCOGS += (Number(it.frozenPurchaseCost) || 0) * (Number(it.quantity) || 0);
          totalDiscounts += (Number(it.discount) || 0) * (Number(it.quantity) || 0);
        }
        totalSales += branchSales;

        // Cash collected / still owed belongs to the invoice, so it is split
        // across branches in proportion to each branch's share of the sale.
        const invoiceTotal = Number(inv.total) || 0;
        const share = invoiceTotal > 0 ? branchSales / invoiceTotal : (itemsForBranch.length / Math.max(items.length, 1));
        totalPaid += (Number(inv.paid) || 0) * share;
        totalRemaining += (Number(inv.remaining) || 0) * share;
      }

      // Returns carry their own location (taken from the returned line item),
      // so they net off the correct branch.
      let retSql = 'SELECT * FROM sale_returns WHERE 1=1';
      const retParams: any[] = [];
      if (wantLocation) {
        retSql += ' AND location = ?';
        retParams.push(wantLocation);
      }
      if (startDate) {
        retSql += ' AND date >= ?';
        retParams.push(startDate);
      }
      if (endDate) {
        retSql += ' AND date <= ?';
        retParams.push(endDate);
      }
      const totalReturned = queryAll(retSql, retParams).reduce(
        (acc: number, r: any) => acc + (Number(r.totalRefund) || 0),
        0
      );

      // Net realized sales = totalSales minus customer returns (so the
      // books stay accurate when customers bring items back).
      const netRealizedSales = totalSales - totalReturned;
      // Net profit likewise subtracts the reversed profit on returns.
      // Without invoice-level linkage we can only approximate per-invoice
      // profit reversal; assume proportional to (returnedAmount/total).
      const netRealizedProfit = totalGrossProfit - Math.round(totalReturned * (totalGrossProfit / Math.max(totalSales, 1)) * 100) / 100;

      // Expenses query
      let expSql = 'SELECT * FROM expenses WHERE 1=1';
      const expParams: any[] = [];
      if (location && (location === 'gallery' || location === 'stationery')) {
        expSql += ' AND location = ?';
        expParams.push(location);
      }
      if (startDate) {
        expSql += ' AND date >= ?';
        expParams.push(startDate);
      }
      if (endDate) {
        expSql += ' AND date <= ?';
        expParams.push(endDate);
      }

      const expenses = queryAll(expSql, expParams);
      let operationalExpenses = 0;
      let salariesExpenses = 0;
      let scrapExpenses = 0;

      for (const exp of expenses) {
        if (exp.category === 'operational') operationalExpenses += exp.amount;
        else if (exp.category === 'salary') salariesExpenses += exp.amount;
        else if (exp.category === 'scrap') scrapExpenses += exp.amount;
      }

      // Inventory valuation at cost
      let prodSql = 'SELECT * FROM products WHERE 1=1';
      const prodParams: any[] = [];
      if (location && (location === 'gallery' || location === 'stationery')) {
        prodSql += ' AND location = ?';
        prodParams.push(location);
      }
      const products = queryAll(prodSql, prodParams);
      let inventoryValuation = 0;
      for (const p of products) {
        inventoryValuation += p.quantity * p.purchaseCost;
      }

      // Net profit = Gross profit from sales - Operational expenses - Salaries - Scrap
      const netProfit = totalGrossProfit - operationalExpenses - salariesExpenses - scrapExpenses;

      // Installments summary — an installment inherits the split of the invoice it
      // was created from, so its profit is summed from matching line items.
      let instSql = 'SELECT * FROM installments WHERE 1=1';
      const instParams: any[] = [];
      if (startDate) {
        instSql += ' AND date >= ?';
        instParams.push(startDate);
      }
      if (endDate) {
        instSql += ' AND date <= ?';
        instParams.push(endDate);
      }
      if (sellerId) {
        instSql += ' AND sellerId = ?';
        instParams.push(sellerId);
      }
      const allInstallments = queryAll(instSql, instParams);
      const installments = wantLocation
        ? allInstallments.filter((i: any) => {
            const items = itemsByInvoice.get(i.invoiceId) || [];
            return items.some((it: any) => (it.location || 'gallery') === wantLocation);
          })
        : allInstallments;
      const totalInstallmentSales = installments.reduce((acc, i: any) => acc + (Number(i.totalAmount) || 0), 0);
      const totalInstallmentCollected = installments.reduce((acc, i: any) => acc + (Number(i.paidAmount) || 0), 0);
      const totalInstallmentProfit = installments.reduce((acc: number, i: any) => {
        const items = itemsByInvoice.get(i.invoiceId) || [];
        const scoped = wantLocation
          ? items.filter((it: any) => (it.location || 'gallery') === wantLocation)
          : items;
        return acc + scoped.reduce((s: number, it: any) => s + (Number(it.itemProfit) || 0), 0);
      }, 0);
      const totalInstallmentRemaining = installments.reduce((acc, i) => acc + i.remainingAmount, 0);
      const overdueInstallmentsCount = installments.filter(i => i.status === 'active' && i.dueDate < new Date().toISOString().split('T')[0]).length;

      // Employee performance breakdown (strictly shows true seller names, never replacing with admin)
      const sellerStatsMap: { [key: string]: { sellerId: string; sellerName: string; sellerCode: string; invoiceCount: number; totalSales: number; totalProfit: number; totalDiscount: number } } = {};
      for (const inv of allInvoices) {
        const items = itemsByInvoice.get(inv.id) || [];
        const scoped = wantLocation
          ? items.filter((it: any) => (it.location || inv.location) === wantLocation)
          : items;
        if (scoped.length === 0) continue;

        if (!sellerStatsMap[inv.sellerId]) {
          sellerStatsMap[inv.sellerId] = {
            sellerId: inv.sellerId,
            sellerName: inv.sellerName,
            sellerCode: inv.sellerCode,
            invoiceCount: 0,
            totalSales: 0,
            totalProfit: 0,
            totalDiscount: 0,
          };
        }
        sellerStatsMap[inv.sellerId].invoiceCount += 1;
        for (const it of scoped) {
          sellerStatsMap[inv.sellerId].totalSales += Number(it.total) || 0;
          sellerStatsMap[inv.sellerId].totalProfit += Number(it.itemProfit) || 0;
          sellerStatsMap[inv.sellerId].totalDiscount +=
            (Number(it.discount) || 0) * (Number(it.quantity) || 0);
        }
      }

      // Product performance breakdown
      const productStatsMap: { [key: string]: { productId: string; productName: string; sku: string; quantitySold: number; totalSales: number; totalProfit: number } } = {};
      for (const inv of allInvoices) {
        const items = itemsByInvoice.get(inv.id) || [];
        for (const it of items) {
          if (wantLocation && (it.location || inv.location) !== wantLocation) continue;
          if (!productStatsMap[it.productId]) {
            productStatsMap[it.productId] = {
              productId: it.productId,
              productName: it.productName,
              sku: it.sku,
              quantitySold: 0,
              totalSales: 0,
              totalProfit: 0,
            };
          }
          productStatsMap[it.productId].quantitySold += it.quantity;
          productStatsMap[it.productId].totalSales += it.total;
          productStatsMap[it.productId].totalProfit += it.itemProfit;
        }
      }

      res.json({
        success: true,
        // Shape expected by the React app (src/services/api.ts → getFinancialReport)
        summary: {
          totalGrossSales: totalSales + totalDiscounts, // back-compat
          totalSales,
          totalNetSales: netRealizedSales,
          totalReturned,
          totalDiscounts,
          totalPaid,
          totalRemaining,
          grossProfit: netRealizedProfit,
          grossProfitFromSales: netRealizedProfit,
          totalOperationalExpenses: operationalExpenses,
          totalSalaries: salariesExpenses,
          totalScrap: scrapExpenses,
          totalExpenses: operationalExpenses + salariesExpenses + scrapExpenses,
          netProfit,
          inventoryValuation,
          invoiceCount: matchedInvoices,
        },
        sellerPerformance: Object.values(sellerStatsMap),
        productPerformance: Object.values(productStatsMap).sort((a, b) => b.totalSales - a.totalSales),
        installmentsSummary: {
          totalAmount: totalInstallmentSales,
          totalProfit: totalInstallmentProfit,
          paidAmount: totalInstallmentCollected,
          remainingAmount: totalInstallmentRemaining,
          count: overdueInstallmentsCount,
        },
        installments: {
          totalSales: totalInstallmentSales,
          totalProfit: totalInstallmentProfit,
          totalCollected: totalInstallmentCollected,
          totalRemaining: totalInstallmentRemaining,
          dueCount: overdueInstallmentsCount,
        },
        invoices: allInvoices.filter((inv: any) => {
          if (matchedInvoices === 0) return false;
          const items = itemsByInvoice.get(inv.id) || [];
          return wantLocation
            ? items.some((it: any) => (it.location || inv.location) === wantLocation)
            : true;
        }),
        expenses,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 14. Backup & Restore (Handles SQLite format 3 verification & solves Windows WAL EPERM lock)
  app.get('/api/backup/download', (req: Request, res: Response) => {
    try {
      const backup = createBackup();
      res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
      res.setHeader('Content-Type', 'application/vnd.sqlite3');
      res.send(backup.buffer);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/backup/restore', async (req: Request, res: Response) => {
    try {
      const { fileBase64 } = req.body;
      if (!fileBase64) {
        return res.status(400).json({ success: false, error: 'لم يتم إرسال ملف النسخة الاحتياطية' });
      }
      const buffer = Buffer.from(fileBase64, 'base64');
      const result = await verifyAndRestoreBackup(buffer);

      if (result.success) {
        const freshDb = await getDb();
        (global as any).__hawr_db = freshDb;
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/system/reset', (req: Request, res: Response) => {
    try {
      const { password, force, resetKey } = req.body;
      const admins = queryAll("SELECT * FROM users WHERE role = 'admin'");
      // Allow passwordless reset ONLY if the Electron app proves it owns the
      // local install (via a shared resetKey passed through protocol.handle).
      // This lets a stuck first-time user recover without knowing the admin
      // password, but a remote attacker cannot trigger it.
      const localKeyOk = resetKey && resetKey === process.env.HAWR_RESET_KEY;
      if (admins.length > 0 && !force) {
        if (!password || !verifyPassword(password, admins[0].passwordHash, admins[0].salt)) {
          return res.status(401).json({ success: false, error: 'كلمة مرور المدير مطلوبة لتأكيد إعادة الضبط' });
        }
      } else if (admins.length > 0 && force && !localKeyOk) {
        return res.status(403).json({ success: false, error: 'إعادة الضبط القسري تتطلب مفتاح التحقق المحلي' });
      }

      const result = resetDatabase();
      getDb().then(freshDb => {
        (global as any).__hawr_db = freshDb;
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 15. Audit Logs
  app.get('/api/audit-logs', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = queryAll(
        'SELECT id, type as action, userId, username as userName, details, timestamp FROM audit_logs ORDER BY timestamp DESC LIMIT ?',
        [limit]
      );
      res.json({ success: true, logs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Vite middleware for development vs static build in production
  if (process.env.NODE_ENV !== 'production') {
    // Lazy-require vite so the bundled production server has no static
    // reference to it (avoids "Cannot find module 'vite'" at runtime when
    // running in-process inside Electron's main process).
    try {
      const viteMod = eval('require')('vite');
      const vite = await viteMod.createServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('[hawr] vite not available, dev mode disabled:', err.message);
      serveStaticDist(app);
    }
  } else {
    serveStaticDist(app);
  }

  if (process.env.HAWR_NO_LISTEN !== '1') {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`نظام معرض حور يعمل بنجاح على المنفذ ${PORT}`);
    });
  } else {
    // Embedded in Electron: serve via IPC / custom protocol — no port bound.
    console.log('[hawr] server handlers registered in-process (no listen)');
  }
}

startServer();

// Export the app for in-process dispatch from Electron's main process.
export default app;
