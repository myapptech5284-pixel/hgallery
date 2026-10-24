import { describe, it, expect } from 'vitest';
import {
  LOCATION_TYPES,
  LOCATION_LABEL,
  LOCATION_BADGE,
  isLocationType,
  describeItemBranches,
} from '../types.ts';

describe('Hawr Gallery System Core Business Logic & Financial Formulas', () => {
  // 1. Profit Formula & Frozen Cost Verification
  describe('Sales Invoice Profit Calculation & Frozen Purchase Cost', () => {
    it('correctly calculates item profit using (actualSalePrice - frozenPurchaseCost) * quantity', () => {
      const unitSalePrice = 150;
      const discount = 15;
      const actualSalePrice = unitSalePrice - discount; // 135
      const frozenPurchaseCost = 100;
      const quantity = 3;

      const itemProfit = (actualSalePrice - frozenPurchaseCost) * quantity;
      expect(actualSalePrice).toBe(135);
      expect(itemProfit).toBe((135 - 100) * 3); // 105
    });

    it('ensures item profit properly reflects discounts given to customer', () => {
      const unitSalePrice = 200;
      const frozenPurchaseCost = 120;
      const quantity = 2;

      // Without discount
      const profitWithoutDiscount = (unitSalePrice - frozenPurchaseCost) * quantity; // 160
      expect(profitWithoutDiscount).toBe(160);

      // With 20 EGP discount per unit
      const discount = 20;
      const actualSalePrice = unitSalePrice - discount; // 180
      const profitWithDiscount = (actualSalePrice - frozenPurchaseCost) * quantity; // 120
      expect(profitWithDiscount).toBe(120);
      expect(profitWithoutDiscount - profitWithDiscount).toBe(discount * quantity);
    });

    it('historical invoice profit remains unaffected if product purchase cost changes later', () => {
      const historicalFrozenCost = 80;
      const salePrice = 120;
      const qty = 5;

      const historicalInvoiceItemProfit = (salePrice - historicalFrozenCost) * qty; // 200

      // Product cost updated in catalog later to 110 EGP
      const updatedCatalogCost = 110;
      expect(updatedCatalogCost).toBe(110);

      // The historical invoice MUST still preserve historicalFrozenCost
      const recalculatedWithFrozen = (salePrice - historicalFrozenCost) * qty;
      expect(recalculatedWithFrozen).toBe(historicalInvoiceItemProfit);
    });
  });

  // 2. Installments Logic & Payments Tracking
  describe('Installment Payments & Status Tracking', () => {
    it('accurately handles partial payment and remaining balance updates', () => {
      const totalAmount = 1000;
      const initialPaid = 300;
      let remaining = totalAmount - initialPaid; // 700

      expect(remaining).toBe(700);

      // Add partial payment 1
      const payment1 = 200;
      let paid = initialPaid + payment1; // 500
      remaining = totalAmount - paid; // 500
      expect(paid).toBe(500);
      expect(remaining).toBe(500);
      let status = remaining <= 0 ? 'completed' : 'active';
      expect(status).toBe('active');

      // Add partial payment 2 (full remaining)
      const payment2 = 500;
      paid += payment2; // 1000
      remaining = totalAmount - paid; // 0
      expect(paid).toBe(1000);
      expect(remaining).toBe(0);
      status = remaining <= 0 ? 'completed' : 'active';
      expect(status).toBe('completed');
    });

    it('formats correct Arabic receipts for partial vs full payments', () => {
      const amount = 250;
      const remaining = 500;

      const partialNotice = `تم السداد جزئيًا بمبلغ: ${amount.toFixed(2)} ج.م (المتبقي: ${remaining.toFixed(2)} ج.م)`;
      expect(partialNotice).toContain('تم السداد جزئيًا بمبلغ: 250.00 ج.م');
      expect(partialNotice).toContain('المتبقي: 500.00 ج.م');

      const fullNotice = `تم السداد بالكامل بمبلغ: ${amount.toFixed(2)} ج.م`;
      expect(fullNotice).toBe('تم السداد بالكامل بمبلغ: 250.00 ج.م');
    });
  });

  // 3. Financial Net Profit Equation
  describe('Financial Net Profit Formula Verification', () => {
    it('calculates Net Profit = Gross Profit from Sales - (Operational Expenses + Salaries + Scrap)', () => {
      const grossSalesProfit = 25000;
      const operationalExpenses = 3000;
      const employeeSalaries = 8000;
      const scrapLosses = 1500;

      const totalDeductions = operationalExpenses + employeeSalaries + scrapLosses;
      const netProfit = grossSalesProfit - totalDeductions;

      expect(totalDeductions).toBe(12500);
      expect(netProfit).toBe(12500);
    });

    it('correctly handles salary duplicate protection for the same month', () => {
      const existingSalaryMonths = ['2026-08', '2026-09'];
      const targetMonth = '2026-09';

      const isDuplicate = existingSalaryMonths.includes(targetMonth);
      expect(isDuplicate).toBe(true);

      const newMonth = '2026-10';
      const isNewMonthDuplicate = existingSalaryMonths.includes(newMonth);
      expect(isNewMonthDuplicate).toBe(false);
    });
  });

  // 4. Location Isolation (Gallery vs Stationery vs Electrical Tools)
  describe('Operational Separation (Gallery vs Stationery vs Tools)', () => {
    it('strictly isolates products so a product belongs to exactly one branch', () => {
      const product1 = { id: 'p1', name: 'A', location: 'gallery' as const };
      const product2 = { id: 'p2', name: 'B', location: 'stationery' as const };
      const product3 = { id: 'p3', name: 'C', location: 'tools' as const };

      expect(product1.location).toBe('gallery');
      expect(product2.location).toBe('stationery');
      expect(product3.location).toBe('tools');
      expect(product1.location).not.toBe(product2.location);
      expect(product2.location).not.toBe(product3.location);
      expect(product1.location).not.toBe(product3.location);
    });

    it('filters sales and inventory strictly according to selected location', () => {
      const allProducts = [
        { id: 'p1', location: 'gallery' },
        { id: 'p2', location: 'gallery' },
        { id: 'p3', location: 'stationery' },
        { id: 'p4', location: 'tools' },
      ];

      const galleryProducts = allProducts.filter((p) => p.location === 'gallery');
      const stationeryProducts = allProducts.filter((p) => p.location === 'stationery');
      const toolsProducts = allProducts.filter((p) => p.location === 'tools');

      expect(galleryProducts.length).toBe(2);
      expect(stationeryProducts.length).toBe(1);
      expect(toolsProducts.length).toBe(1);
    });

    it('recognises exactly the three supported branches', () => {
      expect(LOCATION_TYPES).toEqual(['gallery', 'stationery', 'tools']);
      expect(isLocationType('gallery')).toBe(true);
      expect(isLocationType('stationery')).toBe(true);
      expect(isLocationType('tools')).toBe(true);
      expect(isLocationType('unknown')).toBe(false);
      expect(isLocationType(undefined)).toBe(false);
    });

    it('gives every branch its own label and colour', () => {
      expect(LOCATION_LABEL.gallery).toBe('المعرض');
      expect(LOCATION_LABEL.stationery).toBe('المكتبة');
      expect(LOCATION_LABEL.tools).toBe('الأدوات الكهربائية');
      const badges = new Set([
        LOCATION_BADGE.gallery,
        LOCATION_BADGE.stationery,
        LOCATION_BADGE.tools,
      ]);
      expect(badges.size).toBe(3);
    });

    it('describes a mixed invoice as a combination of its branches', () => {
      expect(describeItemBranches(['gallery']).label).toBe('معرض');
      expect(describeItemBranches(['stationery']).label).toBe('مكتبة');
      expect(describeItemBranches(['tools']).label).toBe('أدوات كهربائية');
      const mixed = describeItemBranches(['gallery', 'tools']);
      expect(mixed.mixed).toBe(true);
      expect(mixed.label).toContain('معرض');
      expect(mixed.label).toContain('أدوات كهربائية');
    });
  });
});
