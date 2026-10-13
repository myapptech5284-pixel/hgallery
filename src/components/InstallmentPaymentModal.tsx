import React, { useState } from 'react';
import { InstallmentRecord, User } from '../types.ts';
import { api } from '../services/api.ts';
import { DollarSign, X, CheckCircle2, AlertCircle } from 'lucide-react';

const money = (value: any) => (Number(value) || 0).toFixed(2);

interface InstallmentPaymentModalProps {
  installment: InstallmentRecord;
  currentUser: User;
  /** Extra context shown above the form, e.g. "من سجل العميل أحمد". */
  contextLabel?: string;
  onClose: () => void;
  onPaid: (installmentId: string) => void;
}

/**
 * Records a partial or full payment against one installment invoice.
 *
 * Shared by the installments screen and the customer ledger so staff can
 * settle an invoice from either place with identical validation, identical
 * wording, and identical audit trail (the server writes the payment row and
 * updates both the installment and its parent invoice).
 */
export const InstallmentPaymentModal: React.FC<InstallmentPaymentModalProps> = ({
  installment,
  currentUser,
  contextLabel,
  onClose,
  onPaid,
}) => {
  const [paymentAmount, setPaymentAmount] = useState<number>(installment.remainingAmount);
  const [paymentMethod, setPaymentMethod] = useState('نقدي');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [receiptNotice, setReceiptNotice] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // Live view of the installment: after a successful payment we update it
  // in place so the totals on screen reflect reality instead of the values
  // the modal was opened with.
  const [view, setView] = useState(installment);

  const remaining = Number(view.remainingAmount) || 0;
  const isSettled = remaining <= 0;

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setPaymentError(null);

    if (isSettled) {
      setPaymentError('هذا القسط مسدد بالكامل بالفعل');
      return;
    }

    if (paymentAmount <= 0) {
      setPaymentError('مبلغ السداد يجب أن يكون أكبر من الصفر');
      return;
    }

    if (paymentAmount > remaining) {
      setPaymentError(`المبلغ المطلوب سداده (${paymentAmount}) يتجاوز المتبقي (${remaining})`);
      return;
    }

    setIsSubmittingPayment(true);
    try {
      const res = await api.addInstallmentPayment(installment.id, {
        amount: paymentAmount,
        paymentMethod,
        notes: paymentNotes.trim(),
        receivedById: currentUser.id,
        receivedByName: currentUser.name,
      });

      if (res.success) {
        setReceiptNotice(res.receiptMessage || 'تم تسجيل السداد بنجاح');
        if (res.newPaid !== undefined && res.newRemaining !== undefined) {
          const newPaid = Number(res.newPaid) || 0;
          const newRemaining = Number(res.newRemaining) || 0;
          setView({
            ...view,
            paidAmount: newPaid,
            remainingAmount: newRemaining,
            paymentCount: (Number(view.paymentCount) || 0) + 1,
            status: newRemaining <= 0 ? 'completed' : 'active',
          });
          setPaymentAmount(newRemaining);
          setPaymentNotes('');
        }
        onPaid(installment.id);
      } else {
        setPaymentError(res.error || 'فشل تسجيل السداد');
      }
    } catch (err: any) {
      setPaymentError(err.message || 'فشل الاتصال بالخادم');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-amber-600" />
            <span>سداد قسط (سداد جزئي أو كامل)</span>
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {receiptNotice && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{receiptNotice}</span>
          </div>
        )}

        {paymentError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{paymentError}</span>
          </div>
        )}

        <form onSubmit={handleRecordPayment} className="space-y-3 text-xs">
          {contextLabel && (
            <div className="p-2 bg-emerald-50/70 border border-emerald-200 text-emerald-800 text-[11px] rounded-xl font-semibold">
              {contextLabel}
            </div>
          )}

          <div className="p-3 bg-slate-50 rounded-xl space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">العميل:</span>
              <span className="font-bold text-slate-800">{view.customerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">رقم الفاتورة:</span>
              <span className="font-mono font-bold text-slate-700">{view.invoiceNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">المبلغ الإجمالي:</span>
              <span className="font-mono">{money(view.totalAmount)} ج.م</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">المسدد حتى الآن:</span>
              <span className="font-mono text-emerald-600">{money(view.paidAmount)} ج.م</span>
            </div>
            <div className="flex justify-between text-amber-800 font-extrabold pt-1 border-t border-slate-200">
              <span>المبلغ المتبقي:</span>
              <span className="font-mono">{money(remaining)} ج.م</span>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              مبلغ السداد الحالي (ج.م) *
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                max={remaining}
                step="any"
                required
                value={paymentAmount || ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') return;
                  const n = Number(raw);
                  if (isNaN(n)) return;
                  setPaymentAmount(n);
                }}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (isNaN(n) || n <= 0 || n > remaining) {
                    setPaymentAmount(remaining);
                  }
                }}
                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={() => setPaymentAmount(remaining)}
                className="px-3 py-2 bg-amber-50 text-amber-800 font-bold rounded-xl border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer"
              >
                سداد كامل
              </button>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              {paymentAmount === remaining
                ? 'سيتم إغلاق القسط وتحديده كمسدد بالكامل'
                : `سداد جزئي، وسيتبقى في القسط: ${(remaining - paymentAmount).toFixed(2)} ج.م`}
            </span>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">طريقة الدفع</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-amber-500"
            >
              <option value="نقدي">نقدي (كاش)</option>
              <option value="شبكة / بطاقة">شبكة / بطاقة بنكية</option>
              <option value="تحويل بنكي / فودافون كاش">تحويل بنكي / محفظة إلكترونية</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">ملاحظات السداد</label>
            <input
              type="text"
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="رقم إيصال التحويل أو ملاحظات إضافية"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
            >
              إغلاق
            </button>
            <button
              type="submit"
              data-save-button
              disabled={isSubmittingPayment || isSettled}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-300 text-white font-bold rounded-xl shadow-xs cursor-pointer"
            >
              {isSubmittingPayment
                ? 'جاري توثيق السداد...'
                : isSettled
                  ? 'تم سداد القسط بالكامل'
                  : 'تأكيد السداد وتحديث الفاتورة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};