export type LocationType = 'gallery' | 'stationery'; // المعرض | المكتبة

export type UserRole = 'admin' | 'supervisor' | 'employee'; // مدير | مشرف | موظف

export interface User {
  id: string;
  name: string;
  username: string;
  employeeCode: string;
  role: UserRole;
  status: 'active' | 'inactive';
  baseSalary: number;
  phone?: string;
  isActive: boolean;
  createdAt: string;
}

export type Employee = User;

export interface Product {
  id: string;
  name: string;
  sku: string; // SKU and Barcode are unified
  barcode: string;
  unit: string;
  location: LocationType; // Exclusively in either gallery OR stationery
  quantity: number;
  salePrice: number;
  purchaseCost: number;
  minStockAlert: number;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface StockTransfer {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  fromLocation: LocationType;
  toLocation: LocationType;
  quantity: number;
  date: string;
  notes?: string;
  performedByUserId: string;
  performedByName: string;
}

export interface SupplyMovement {
  id: string;
  productName: string;
  sku: string;
  unit: string;
  quantity: number;
  purchasePrice: number;
  salePrice?: number;
  location: LocationType;
  date: string;
  supplierId?: string;
  supplierName?: string;
  isReturn?: boolean;
  notes?: string;
  createdById: string;
  createdByName: string;
}

/**
 * Aggregated money figures for one customer, computed server-side from
 * every invoice / installment / return that belongs to them. Attached to
 * the customer directory rows so the list shows real business numbers
 * instead of just contact details.
 */
export interface CustomerSummary {
  invoiceCount: number;
  installmentCount: number;
  openInstallmentCount: number;
  overdueInstallmentCount: number;
  totalInvoiced: number; // Σ invoice.total
  totalDiscount: number;
  totalPaid: number;
  totalRemaining: number;
  totalReturns: number;
  netSales: number; // totalInvoiced - totalReturns
  installmentTotal: number;
  installmentPaid: number;
  installmentRemaining: number;
  lastActivityDate?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  notes?: string;
  createdAt: string;
  summary?: CustomerSummary;
}

/** Aggregated money figures for one supplier (purchase side). */
export interface SupplierSummary {
  supplyCount: number;
  itemCount: number; // Σ quantities
  totalPurchases: number;
  totalReturns: number;
  netPurchases: number;
  lastActivityDate?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  company?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  summary?: SupplierSummary;
}

/** One row of the chronological customer/supplier statement (كشف حساب). */
export type LedgerEntryType = 'invoice' | 'payment' | 'return' | 'purchase';

export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  date: string;
  time?: string;
  reference: string; // invoice number / payment id / return id
  description: string;
  location?: LocationType;
  sellerName?: string;
  /** Value added to what the customer owes. */
  debit: number;
  /** Value deducted (cash received / refunded). */
  credit: number;
  /** Running balance after this entry. */
  balance: number;
  /** For `payment` entries: the installment this payment settles. */
  installmentId?: string;
}

export interface CustomerLedger {
  customer: Customer;
  invoices: Invoice[];
  installments: InstallmentRecord[];
  returns: any[];
  statement: LedgerEntry[];
  summary: CustomerSummary;
  /** How the system matched this customer's historical rows. */
  matchInfo: {
    phoneKey: string;
    nameKey: string;
    nameSharedWithAnotherCustomer: boolean;
  };
}

export interface SupplierLedger {
  supplier: Supplier;
  supplies: SupplyMovement[];
  statement: LedgerEntry[];
  summary: SupplierSummary;
}

export interface InvoiceItem {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  quantity: number;
  unitSalePrice: number;
  discount: number; // Discount per item or line discount
  actualSalePrice: number; // unitSalePrice - discount
  frozenPurchaseCost: number; // Snapshot of cost at invoice creation
  itemProfit: number; // (actualSalePrice - frozenPurchaseCost) * quantity
  total: number; // actualSalePrice * quantity
  /**
   * Which branch this line belongs to. A single invoice may mix gallery and
   * stationery items; stock, sales and profit are attributed per line so the
   * two branches stay fully separate.
   */
  location?: LocationType;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone?: string;
  location: LocationType;
  sellerId: string;
  sellerName: string;
  sellerCode: string;
  date: string;
  time: string;
  items: InvoiceItem[];
  subtotal: number;
  totalDiscount: number;
  total: number;
  paid: number;
  remaining: number;
  paymentMethod: 'cash' | 'card' | 'installment';
  isInstallment: boolean;
  installmentDueDate?: string;
  installmentPercent?: number;
  installmentSurcharge?: number;
  finalTotal?: number;
  status: 'completed' | 'partial' | 'refunded';
  notes?: string;
  createdAt: string;
}

export interface InvoiceDraft {
  id: string;
  draftLabel: string;
  invoiceNumber?: string;
  customerName: string;
  customerPhone?: string;
  location: LocationType;
  sellerId: string;
  sellerName: string;
  sellerCode: string;
  date: string;
  time: string;
  items: InvoiceItem[];
  subtotal: number;
  totalDiscount: number;
  total: number;
  paid: number;
  remaining: number;
  paymentMethod: 'cash' | 'card' | 'installment';
  isInstallment: boolean;
  installmentDueDate?: string;
  notes?: string;
  itemCount: number;
  updatedAt: string;
}

export interface InstallmentPayment {
  id: string;
  installmentId: string;
  amount: number;
  date: string;
  time: string;
  paymentMethod: string;
  notes?: string;
  receivedById: string;
  receivedByName: string;
}

export interface InstallmentRecord {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  location: LocationType;
  sellerId: string;
  sellerName: string;
  sellerCode: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  dueDate: string;
  paymentCount: number;
  status: 'active' | 'completed' | 'overdue';
  payments: InstallmentPayment[];
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  type: 'operational' | 'salary' | 'scrap'; // تشغيلي | راتب | هوالك
  category?: string;
  description: string;
  amount: number;
  date: string;
  location: LocationType;
  employeeId?: string;
  employeeName?: string;
  salaryMonth?: string; // e.g. "2026-09" to prevent duplicate salary payments in same month
  notes?: string;
  createdBy?: string;
  createdById?: string;
  createdByName?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  userId: string;
  userName: string;
  details: string;
  timestamp: string;
}

export interface SystemStatus {
  isInitialized: boolean;
  adminExists: boolean;
  databasePath: string;
  dbSizeKB: number;
  version: string;
  lastBackupDate?: string;
}

export interface FinancialReport {
  summary: {
    totalGrossSales: number;
    totalDiscounts: number;
    totalNetSales: number;
    grossProfitFromSales: number;
    totalExpenses: number;
    totalSalaries: number;
    totalScrap: number;
    netProfit: number;
  };
  sellerPerformance: {
    sellerId: string;
    sellerName: string;
    sellerCode: string;
    invoiceCount: number;
    totalSales: number;
    totalProfit: number;
    totalDiscount: number;
  }[];
  productPerformance: {
    productId: string;
    productName: string;
    sku: string;
    quantitySold: number;
    totalSales: number;
    totalProfit: number;
  }[];
  installments: {
    totalSales: number;
    totalProfit: number;
    totalCollected: number;
    totalRemaining: number;
    dueCount: number;
  };
}
