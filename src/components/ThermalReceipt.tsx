import React from 'react';
import { Invoice } from '../types.ts';
import { Printer, X } from 'lucide-react';

interface ThermalReceiptProps {
  invoice: Invoice;
  onClose: () => void;
}

export const ThermalReceipt: React.FC<ThermalReceiptProps> = ({ invoice, onClose }) => {
  const handlePrint = () => {
    window.print();
  };

  // Installment surcharge is baked into the unit price shown on the receipt.
  // The customer pays the post-surcharge price per item, so the line totals
  // already sum to الإجمالي النهائي. Old invoices that don't have
  // installmentPercent saved default to 0 (i.e. no surcharge).
  const installmentPct = Number(invoice.installmentPercent) || 0;
  const surchargeMultiplier = 1 + installmentPct / 100;

  // IMPORTANT: Compute الإجمالي النهائي as the actual sum of the
  // post-surcharge line totals shown on the receipt. We deliberately do
  // NOT trust `invoice.total` from the DB because a different (older)
  // build can write a pre-surcharge total to the DB while still saving
  // installmentPercent > 0. Recomputing here keeps the printed الإجمالي
  // consistent with the per-item prices the customer is looking at.
  const computedFinalTotal = (invoice.items || []).reduce((acc, it) => {
    const baseUnit = Number(it.actualSalePrice) || 0;
    const qty = Number(it.quantity) || 0;
    return acc + baseUnit * surchargeMultiplier * qty;
  }, 0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto" dir="rtl">
      <div className="bg-white text-slate-900 rounded-2xl shadow-2xl max-w-sm w-full max-h-[calc(100vh-2rem)] flex flex-col p-6 relative border border-slate-200 print:shadow-none print:border-none print:m-0 print:p-2 print:w-[80mm] print:max-h-none">
        {/* Controls - Hidden in Print */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 print:hidden">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-700">معاينة إيصال حراري 80mm</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 80mm Thermal Receipt Content */}
        <div className="font-mono text-center text-xs text-slate-800 leading-relaxed print:text-black overflow-y-auto flex-1 min-h-0">
          <div className="font-bold text-base mb-0.5">معرض حور للأدوات المنزليه والمدرسيه</div>

          <div className="text-right text-[11px] space-y-1 mb-3 mt-3">
            <div className="flex justify-between">
              <span className="text-slate-500">رقم الفاتورة:</span>
              <span className="font-bold">{invoice.invoiceNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">التاريخ والوقت:</span>
              <span>{invoice.date} {invoice.time}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">اسم العميل:</span>
              <span>{invoice.customerName}</span>
            </div>
            {invoice.customerPhone && (
              <div className="flex justify-between">
                <span className="text-slate-500">هاتف العميل:</span>
                <span>{invoice.customerPhone}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-500">البائع:</span>
              <span className="font-semibold">{invoice.sellerName} ({invoice.sellerCode})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">طريقة الدفع:</span>
              <span className="font-semibold">
                {invoice.paymentMethod === 'cash' ? 'نقدي' : invoice.paymentMethod === 'card' ? 'شبكة / بطاقة' : 'تقسيط'}
              </span>
            </div>
          </div>

          {/* Items Table */}
          <table className="w-full text-right text-[11px] border-t border-b border-dashed border-slate-400 my-2 py-1">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-1">الصنف</th>
                <th className="py-1 text-center">الكمية</th>
                <th className="py-1 text-center">السعر</th>
                <th className="py-1 text-left">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, idx) => {
                const baseUnit = Number(item.actualSalePrice) || 0;
                const qty = Number(item.quantity) || 0;
                // Price per unit AFTER installment surcharge so the printed
                // receipt matches what the customer is actually paying.
                const finalUnitPrice = baseUnit * surchargeMultiplier;
                const finalLineTotal = finalUnitPrice * qty;
                return (
                  <tr key={idx} className="border-b border-slate-100 last:border-none">
                    <td className="py-1 font-sans">{item.productName}</td>
                    <td className="py-1 text-center">{qty}</td>
                    <td className="py-1 text-center">{finalUnitPrice.toFixed(2)}</td>
                    <td className="py-1 text-left font-bold">{finalLineTotal.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Totals - clean: just الإجمالي النهائي (already includes installment
              surcharge) and the payment breakdown. No subtotal/surcharge
              breakdown so the printed receipt stays simple and customer-
              friendly. */}
          <div className="space-y-1 text-right text-[11px] border-b border-dashed border-slate-400 pb-2 mb-3">
            <div className="flex justify-between font-bold text-sm text-slate-900 border-t border-slate-300 pt-1">
              <span>الإجمالي النهائي:</span>
              <span>{computedFinalTotal.toFixed(2)} ج.م</span>
            </div>
            <div className="flex justify-between">
              <span>المبلغ المدفوع:</span>
              <span>{(Number(invoice.paid) || 0).toFixed(2)} ج.م</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>المتبقي:</span>
              <span>{Math.max(0, computedFinalTotal - (Number(invoice.paid) || 0)).toFixed(2)} ج.م</span>
            </div>
          </div>

          {invoice.isInstallment && (
            <div className="bg-amber-50 p-2 rounded border border-amber-200 text-amber-900 text-[10px] mb-3 text-right">
              <div className="font-bold mb-0.5">تفاصيل القسط:</div>
              <div>تاريخ الاستحقاق: {invoice.installmentDueDate || 'غير محدد'}</div>
              <div>المبلغ المتبقي: {(Number(invoice.remaining) || 0).toFixed(2)} ج.م</div>
            </div>
          )}

          <div className="text-[10px] text-slate-500 border-t border-dashed border-slate-400 pt-2">
            شكراً لتعاملكم معنا
            <br />
            <span className="font-bold text-slate-700">العنوان:</span> عبدالباعث الفقي بجوار سنترال عمر لخدمات المحمول
          </div>
        </div>
      </div>
    </div>
  );
};
