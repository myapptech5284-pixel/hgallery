import {
  User,
  Product,
  Invoice,
  InstallmentRecord,
  Expense,
  Customer,
  Supplier,
  SupplyMovement,
  StockTransfer,
  SystemStatus,
  LocationType,
  AuditLog,
  FinancialReport,
  InvoiceDraft,
  CustomerLedger,
  SupplierLedger,
} from '../types.ts';

export const api = {
  // System Status & Init Check
  async getSystemStatus(): Promise<SystemStatus> {
    const res = await fetch('/api/system/status');
    const data = await res.json();
    return data;
  },

  async getSystemInit(): Promise<{ initialized: boolean }> {
    try {
      const res = await fetch('/api/system/status');
      const data = await res.json();
      return { initialized: !!data.adminExists };
    } catch (e) {
      return { initialized: false };
    }
  },

  // Auth
  async registerAdmin(payload: {
    name: string;
    username: string;
    password: string;
    employeeCode: string;
  }): Promise<{ success: boolean; user?: User; error?: string }> {
    const res = await fetch('/api/auth/register-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async login(payload: {
    username: string;
    password: string;
  }): Promise<{ success: boolean; user?: User; error?: string }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async verifyAdmin(password: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch('/api/auth/verify-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    return res.json();
  },

  // Employees
  async getEmployees(): Promise<User[]> {
    try {
      const res = await fetch('/api/employees');
      if (!res.ok) return [];
      const data = await res.json();
      return (data.users || []).map((u: any) => ({
        ...u,
        baseSalary: Number(u.baseSalary != null ? u.baseSalary : 0) || 0,
        phone: u.phone || '',
        isActive: u.isActive !== undefined ? Boolean(u.isActive) : u.status === 'active',
      }));
    } catch (err) {
      console.error('getEmployees error:', err);
      return [];
    }
  },

  async createEmployee(payload: any): Promise<{ success: boolean; user?: User; error?: string }> {
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async updateEmployee(id: string, payload: any): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`/api/employees/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  // Products
  async getProducts(params?: {
    location?: LocationType | 'all';
    search?: string;
    lowStock?: boolean;
  }): Promise<Product[]> {
    try {
      const query = new URLSearchParams();
      if (params?.location && params.location !== 'all') query.set('location', params.location);
      if (params?.search) query.set('search', params.search);
      if (params?.lowStock) query.set('lowStock', 'true');

      const res = await fetch(`/api/products?${query.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.products || []).map((p: any) => ({
        ...p,
        salePrice: Number(p.salePrice) || 0,
        purchaseCost: Number(p.purchaseCost) || 0,
        quantity: Number(p.quantity) || 0,
        minStockAlert: Number(p.minStockAlert) || 5,
      }));
    } catch {
      return [];
    }
  },

  async createProduct(payload: Partial<Product>): Promise<{ success: boolean; productId?: string; error?: string }> {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async updateProduct(id: string, payload: Partial<Product>): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`/api/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async deleteProduct(id: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    return res.json();
  },

  async transferProduct(payload: {
    productId: string;
    fromLocation: LocationType;
    toLocation: LocationType;
    quantity: number;
    notes?: string;
    userId: string;
    userName: string;
  }): Promise<{ success: boolean; message?: string; error?: string }> {
    const res = await fetch('/api/products/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async importXlsx(payload: { fileBase64: string; defaultLocation: LocationType }): Promise<{
    success: boolean;
    importedCount?: number;
    errorCount?: number;
    errors?: { rowNumber: number; reason: string; data: any }[];
    error?: string;
  }> {
    const res = await fetch('/api/products/import-xlsx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  // Supplies
  async getSupplies(params?: { location?: LocationType }): Promise<SupplyMovement[]> {
    try {
      const query = new URLSearchParams();
      if (params?.location) query.set('location', params.location);
      const res = await fetch(`/api/supplies?${query.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.supplies || []).map((s: any) => ({
        ...s,
        quantity: Number(s.quantity) || 0,
        purchasePrice: Number(s.purchasePrice) || 0,
        salePrice: s.salePrice != null ? Number(s.salePrice) : undefined,
      }));
    } catch {
      return [];
    }
  },

  async createSupply(payload: any): Promise<{ success: boolean; supplyId?: string; error?: string }> {
    const res = await fetch('/api/supplies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async deleteSupply(id: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`/api/supplies/${id}`, { method: 'DELETE' });
    return res.json();
  },

  // Customer sale returns — record a returned product, put the quantity
  // back into stock, and (optionally) link the return to the original
  // invoice so the financial reports subtract it from sales + profit.
  async createReturn(payload: {
    productId: string;
    quantity: number;
    unitRefundPrice: number;
    invoiceNumber?: string;
    customerName?: string;
    reason?: string;
    location: string;
    userId: string;
    userName: string;
  }): Promise<{ success: boolean; returnId?: string; totalRefund?: number; newStock?: number; profitReversed?: number; linkedInvoice?: boolean; error?: string }> {
    const res = await fetch('/api/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async getReturns(location?: string): Promise<any[]> {
    try {
      const url = location ? `/api/returns?location=${encodeURIComponent(location)}` : '/api/returns';
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return data.returns || [];
    } catch {
      return [];
    }
  },

  // Customers & Suppliers
  async getCustomers(): Promise<Customer[]> {
    try {
      const res = await fetch('/api/customers');
      if (!res.ok) return [];
      const data = await res.json();
      return data.customers || [];
    } catch {
      return [];
    }
  },

  async createCustomer(payload: {
    name: string;
    phone: string;
    address?: string;
    notes?: string;
  }): Promise<{ success: boolean; customer?: Customer; error?: string }> {
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async updateCustomer(id: string, payload: {
    name: string;
    phone: string;
    address?: string;
    notes?: string;
  }): Promise<{ success: boolean; customer?: Customer; error?: string }> {
    const res = await fetch(`/api/customers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async deleteCustomer(id: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`/api/customers/${id}`, { method: 'DELETE' });
    return res.json();
  },

  /** Everything the system knows about one customer, in one payload. */
  async getCustomerLedger(id: string): Promise<{ success: boolean; ledger?: CustomerLedger; error?: string }> {
    try {
      const res = await fetch(`/api/customers/${id}/ledger`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'تعذر تحميل سجل العميل' };
      }
      const ledger = data.ledger as CustomerLedger;
      // Normalise numbers so the UI never renders "NaN" money.
      ledger.invoices = (ledger.invoices || []).map((inv) => ({
        ...inv,
        subtotal: Number(inv.subtotal) || 0,
        totalDiscount: Number(inv.totalDiscount) || 0,
        total: Number(inv.total) || 0,
        paid: Number(inv.paid) || 0,
        remaining: Number(inv.remaining) || 0,
        items: inv.items || [],
      }));
      ledger.installments = (ledger.installments || []).map((inst) => ({
        ...inst,
        totalAmount: Number(inst.totalAmount) || 0,
        paidAmount: Number(inst.paidAmount) || 0,
        remainingAmount: Number(inst.remainingAmount) || 0,
        paymentCount: Number(inst.paymentCount) || 0,
        payments: (inst.payments || []).map((p) => ({ ...p, amount: Number(p.amount) || 0 })),
      }));
      ledger.statement = (ledger.statement || []).map((e) => ({
        ...e,
        debit: Number(e.debit) || 0,
        credit: Number(e.credit) || 0,
        balance: Number(e.balance) || 0,
      }));
      return { success: true, ledger };
    } catch (err: any) {
      return { success: false, error: err?.message || 'فشل الاتصال بالخادم' };
    }
  },

  async getSuppliers(): Promise<Supplier[]> {
    try {
      const res = await fetch('/api/suppliers');
      if (!res.ok) return [];
      const data = await res.json();
      return data.suppliers || [];
    } catch {
      return [];
    }
  },

  async createSupplier(payload: {
    name: string;
    phone: string;
    company?: string;
    address?: string;
    notes?: string;
  }): Promise<{ success: boolean; supplier?: Supplier; error?: string }> {
    const res = await fetch('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async updateSupplier(id: string, payload: {
    name: string;
    phone: string;
    company?: string;
    address?: string;
    notes?: string;
  }): Promise<{ success: boolean; supplier?: Supplier; error?: string }> {
    const res = await fetch(`/api/suppliers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async deleteSupplier(id: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`/api/suppliers/${id}`, { method: 'DELETE' });
    return res.json();
  },

  /** Purchase-side ledger for one supplier. */
  async getSupplierLedger(id: string): Promise<{ success: boolean; ledger?: SupplierLedger; error?: string }> {
    try {
      const res = await fetch(`/api/suppliers/${id}/ledger`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'تعذر تحميل سجل المورد' };
      }
      const ledger = data.ledger as SupplierLedger;
      ledger.supplies = (ledger.supplies || []).map((s) => ({
        ...s,
        quantity: Number(s.quantity) || 0,
        purchasePrice: Number(s.purchasePrice) || 0,
      }));
      ledger.statement = (ledger.statement || []).map((e) => ({
        ...e,
        debit: Number(e.debit) || 0,
        credit: Number(e.credit) || 0,
        balance: Number(e.balance) || 0,
      }));
      return { success: true, ledger };
    } catch (err: any) {
      return { success: false, error: err?.message || 'فشل الاتصال بالخادم' };
    }
  },

  // Invoices & Sales
  async getInvoices(params?: {
    location?: LocationType;
    sellerId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<Invoice[]> {
    try {
      const query = new URLSearchParams();
      if (params?.location) query.set('location', params.location);
      if (params?.sellerId) query.set('sellerId', params.sellerId);
      if (params?.startDate) query.set('startDate', params.startDate);
      if (params?.endDate) query.set('endDate', params.endDate);

      const res = await fetch(`/api/invoices?${query.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.invoices || []).map((inv: any) => ({
        ...inv,
        subtotal: Number(inv.subtotal) || 0,
        totalDiscount: Number(inv.totalDiscount) || 0,
        total: Number(inv.total) || 0,
        paid: Number(inv.paid) || 0,
        remaining: Number(inv.remaining) || 0,
        totalProfit: Number(inv.totalProfit) || 0,
      }));
    } catch {
      return [];
    }
  },

  async createInvoice(payload: any): Promise<{
    success: boolean;
    invoiceId?: string;
    invoiceNumber?: string;
    grossProfit?: number;
    error?: string;
  }> {
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  // Installments
  async getInstallments(params?: {
    location?: LocationType;
    status?: string;
    search?: string;
  }): Promise<InstallmentRecord[]> {
    try {
      const query = new URLSearchParams();
      if (params?.location) query.set('location', params.location);
      if (params?.status) query.set('status', params.status);
      if (params?.search) query.set('search', params.search);

      const res = await fetch(`/api/installments?${query.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.installments || []).map((inst: any) => ({
        ...inst,
        totalAmount: Number(inst.totalAmount) || 0,
        paidAmount: Number(inst.paidAmount) || 0,
        remainingAmount: Number(inst.remainingAmount) || 0,
        paymentCount: Number(inst.paymentCount) || 0,
      }));
    } catch {
      return [];
    }
  },

  async addInstallmentPayment(
    id: string,
    payload: {
      amount: number;
      paymentMethod: string;
      notes?: string;
      receivedById: string;
      receivedByName: string;
    }
  ): Promise<{
    success: boolean;
    receiptMessage?: string;
    newPaid?: number;
    newRemaining?: number;
    error?: string;
  }> {
    const res = await fetch(`/api/installments/${id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  // Expenses, Salaries & Scrap
  async getExpenses(params?: {
    location?: LocationType;
    type?: string;
    category?: string;
    month?: string;
  }): Promise<Expense[]> {
    try {
      const query = new URLSearchParams();
      if (params?.location) query.set('location', params.location);
      if (params?.type) query.set('category', params.type);
      else if (params?.category) query.set('category', params.category);
      if (params?.month) query.set('month', params.month);

      const res = await fetch(`/api/expenses?${query.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.expenses || []).map((exp: any) => ({
        ...exp,
        amount: Number(exp.amount) || 0,
        type: exp.category || 'operational',
        description: exp.notes || exp.description || '',
      }));
    } catch {
      return [];
    }
  },

  async createExpense(payload: any): Promise<{ success: boolean; expenseId?: string; error?: string }> {
    const formatted = {
      ...payload,
      category: payload.type || payload.category,
      notes: payload.description || payload.notes,
    };
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formatted),
    });
    return res.json();
  },

  async deleteExpense(id: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
    return res.json();
  },

  // Reports
  async getTodayReport(params?: {
    location?: LocationType | 'all';
    sellerId?: string;
  }): Promise<{
    success: boolean;
    date: string;
    invoiceCount: number;
    totalSales: number;
    totalPaid: number;
    totalRemaining: number;
    totalProfit: number;
    invoices: Invoice[];
  }> {
    const query = new URLSearchParams();
    if (params?.location && params.location !== 'all') query.set('location', params.location);
    if (params?.sellerId) query.set('sellerId', params.sellerId);
    const res = await fetch(`/api/reports/today?${query.toString()}`);
    if (!res.ok) return { success: false, date: '', invoiceCount: 0, totalSales: 0, totalPaid: 0, totalRemaining: 0, totalProfit: 0, invoices: [] };
    return res.json();
  },

  async getFinancialReport(params?: {
    location?: LocationType;
    startDate?: string;
    endDate?: string;
    sellerId?: string;
    paymentMethod?: string;
  }): Promise<FinancialReport> {
    const emptyReport: FinancialReport = {
      summary: {
        totalGrossSales: 0,
        totalDiscounts: 0,
        totalNetSales: 0,
        grossProfitFromSales: 0,
        totalExpenses: 0,
        totalSalaries: 0,
        totalScrap: 0,
        netProfit: 0,
      },
      sellerPerformance: [],
      productPerformance: [],
      installments: {
        totalSales: 0,
        totalProfit: 0,
        totalCollected: 0,
        totalRemaining: 0,
        dueCount: 0,
      },
    };

    try {
      const query = new URLSearchParams();
      if (params?.location) query.set('location', params.location);
      if (params?.startDate) query.set('startDate', params.startDate);
      if (params?.endDate) query.set('endDate', params.endDate);
      if (params?.sellerId) query.set('sellerId', params.sellerId);
      if (params?.paymentMethod) query.set('paymentMethod', params.paymentMethod);

      const res = await fetch(`/api/reports?${query.toString()}`);
      if (!res.ok) return emptyReport;
      const data = await res.json();

      return {
        summary: {
          totalGrossSales: Number(data.summary?.totalGrossSales) || 0,
          totalDiscounts: Number(data.summary?.totalDiscounts) || 0,
          totalNetSales: Number(data.summary?.totalSales) || 0,
          grossProfitFromSales: Number(data.summary?.grossProfit) || 0,
          totalExpenses: Number(data.summary?.totalOperationalExpenses) || 0,
          totalSalaries: Number(data.summary?.totalSalaries) || 0,
          totalScrap: Number(data.summary?.totalScrap) || 0,
          netProfit: Number(data.summary?.netProfit) || 0,
        },
        sellerPerformance: (data.sellerPerformance || []).map((s: any) => ({
          sellerId: s.sellerId || '',
          sellerName: s.sellerName || '',
          sellerCode: s.sellerCode || '',
          invoiceCount: Number(s.invoiceCount) || 0,
          totalSales: Number(s.totalSales) || 0,
          totalProfit: Number(s.totalProfit) || 0,
          totalDiscount: Number(s.totalDiscount) || 0,
        })),
        productPerformance: (data.productPerformance || []).map((p: any) => ({
          productId: p.productId || '',
          productName: p.productName || '',
          sku: p.sku || '',
          quantitySold: Number(p.quantitySold) || 0,
          totalSales: Number(p.totalSales) || 0,
          totalProfit: Number(p.totalProfit) || 0,
        })),
        installments: {
          totalSales: Number(data.installmentsSummary?.totalAmount) || 0,
          totalProfit: Number(data.installmentsSummary?.totalProfit) || 0,
          totalCollected: Number(data.installmentsSummary?.paidAmount) || 0,
          totalRemaining: Number(data.installmentsSummary?.remainingAmount) || 0,
          dueCount: Number(data.installmentsSummary?.count) || 0,
        },
      };
    } catch {
      return emptyReport;
    }
  },

  // Audit Logs & Security
  async getAuditLogs(limit?: number): Promise<AuditLog[]> {
    try {
      const res = await fetch(`/api/audit-logs?limit=${limit || 100}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.logs || []).map((l: any) => ({
        id: l.id,
        action: l.action || l.type,
        userId: l.userId,
        userName: l.userName || l.username,
        details: l.details,
        timestamp: l.timestamp,
      }));
    } catch (err) {
      console.error('Failed to get audit logs:', err);
      return [];
    }
  },

  // Backup & Reset
  async restoreDatabase(payload: {
    fileBase64: string;
    userId?: string;
    userName?: string;
  }): Promise<{ success: boolean; message?: string; error?: string }> {
    const res = await fetch('/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  // Invoice drafts (suspended/paused invoices)
  async saveInvoiceDraft(draft: Partial<InvoiceDraft> & { id?: string }): Promise<{ success: boolean; draft?: InvoiceDraft; error?: string }> {
    const res = await fetch('/api/invoice-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    return res.json();
  },

  async getInvoiceDrafts(params?: { location?: LocationType; sellerId?: string }): Promise<InvoiceDraft[]> {
    try {
      const query = new URLSearchParams();
      if (params?.location) query.set('location', params.location);
      if (params?.sellerId) query.set('sellerId', params.sellerId);
      const res = await fetch(`/api/invoice-drafts?${query.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.drafts || [];
    } catch {
      return [];
    }
  },

  async getInvoiceDraft(id: string): Promise<{ success: boolean; draft?: InvoiceDraft; error?: string }> {
    const res = await fetch(`/api/invoice-drafts/${id}`);
    return res.json();
  },

  async deleteInvoiceDraft(id: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`/api/invoice-drafts/${id}`, { method: 'DELETE' });
    return res.json();
  },

  async resetSystem(
    payload: string | { adminPassword: string; userId?: string; userName?: string; force?: boolean }
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const pwd = typeof payload === 'string' ? payload : payload.adminPassword;
    const force = typeof payload === 'object' ? !!payload.force : false;
    const res = await fetch('/api/system/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd, force }),
    });
    return res.json();
  },
};
