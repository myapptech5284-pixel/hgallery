import React, { useState, useEffect } from 'react';
import { Expense, LocationType, User, Employee } from '../types.ts';
import { api } from '../services/api.ts';
import {
  DollarSign,
  Plus,
  Calendar,
  AlertCircle,
  User as UserIcon,
  Trash2,
  X,
  FileSpreadsheet,
  Layers,
  Store,
  BookOpen,
} from 'lucide-react';

interface ExpensesScreenProps {
  currentUser: User;
  activeLocation: LocationType;
  onLocationChange: (loc: LocationType) => void;
}

export const ExpensesScreen: React.FC<ExpensesScreenProps> = ({
  currentUser,
  activeLocation,
  onLocationChange,
}) => {
  const isAdmin = currentUser.role === 'admin';

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'operational' | 'salary' | 'scrap'>('all');

  // Add Expense Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [type, setType] = useState<'operational' | 'salary' | 'scrap'>('operational');
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState<LocationType>(activeLocation);
  const [employeeId, setEmployeeId] = useState('');
  const [salaryMonth, setSalaryMonth] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [expData, empData] = await Promise.all([
        api.getExpenses({
          location: activeLocation,
          type: typeFilter === 'all' ? undefined : typeFilter,
        }),
        api.getEmployees(),
      ]);
      setExpenses(expData);
      setEmployees(empData);
    } catch (err) {
      console.error('Failed to load expenses data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    setLocation(activeLocation);
  }, [activeLocation, typeFilter]);

  const openModal = () => {
    setType('operational');
    setAmount(0);
    setDescription('');
    setLocation(activeLocation);
    setEmployeeId('');
    // default salary month YYYY-MM
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setSalaryMonth(currentMonth);
    setFormError(null);
    setShowAddModal(true);
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (amount <= 0 || !description.trim()) {
      setFormError('يرجى تحديد المبلغ ووصف المصروف');
      return;
    }

    if (type === 'salary') {
      if (!employeeId) {
        setFormError('يرجى اختيار الموظف المستحق للراتب');
        return;
      }
      if (!salaryMonth) {
        setFormError('يرجى تحديد شهر الراتب');
        return;
      }
    }

    const selectedEmp = employees.find((emp) => emp.id === employeeId);

    try {
      const res = await api.createExpense({
        type,
        amount,
        description: description.trim(),
        location,
        employeeId: type === 'salary' ? employeeId : undefined,
        employeeName: type === 'salary' && selectedEmp ? selectedEmp.name : undefined,
        salaryMonth: type === 'salary' ? salaryMonth : undefined,
        createdBy: currentUser.id,
        createdByName: currentUser.name,
      });

      if (res.success) {
        setShowAddModal(false);
        loadData();
      } else {
        setFormError(res.error || 'فشل تسجيل المصروف');
      }
    } catch (err: any) {
      setFormError(err.message || 'فشل الاتصال بالخادم');
    }
  };

  const handleDelete = async (id: string, desc: string) => {
    if (!isAdmin) {
      alert('صلاحية حذف المصروفات مقتصرة على المدير العام');
      return;
    }
    if (!window.confirm(`هل أنت متأكد من حذف هذا المصروف (${desc})؟`)) return;

    try {
      const res = await api.deleteExpense(id);
      if (res.success) {
        loadData();
      } else {
        alert(res.error || 'فشل حذف المصروف');
      }
    } catch (err: any) {
      alert(err.message || 'فشل الاتصال بالخادم');
    }
  };

  // Metrics
  const totalOperational = expenses.filter((e) => e.type === 'operational').reduce((a, b) => a + b.amount, 0);
  const totalSalaries = expenses.filter((e) => e.type === 'salary').reduce((a, b) => a + b.amount, 0);
  const totalScrap = expenses.filter((e) => e.type === 'scrap').reduce((a, b) => a + b.amount, 0);
  const totalAll = totalOperational + totalSalaries + totalScrap;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-rose-600" />
            <span>إدارة المصروفات التشغيلية والرواتب والهوالك</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            توثيق كامل للإنفاق التشغيلي ورواتب الموظفين وقيمة الهوالك مع خصمها الدقيق من صافي أرباح التقارير
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-200/80 p-1 rounded-xl">
            <button
              onClick={() => onLocationChange('gallery')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeLocation === 'gallery'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span>مصروفات المعرض</span>
            </button>
            <button
              onClick={() => onLocationChange('stationery')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeLocation === 'stationery'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>مصروفات المكتبة</span>
            </button>
          </div>

          <button
            onClick={openModal}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm shadow-rose-900/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>تسجيل مصروف / راتب / هالك</span>
          </button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200">
          <span className="text-xs font-semibold text-slate-500 block mb-1">المصروفات التشغيلية</span>
          <span className="text-xl font-extrabold text-slate-800 font-mono">
            {totalOperational.toFixed(2)} ج.م
          </span>
          <span className="text-[10px] text-slate-400 block mt-1">فواتير كهرباء، إيجار، نظافة، نقل</span>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200">
          <span className="text-xs font-semibold text-indigo-600 block mb-1">إجمالي رواتب الموظفين</span>
          <span className="text-xl font-extrabold text-indigo-700 font-mono">
            {totalSalaries.toFixed(2)} ج.م
          </span>
          <span className="text-[10px] text-slate-400 block mt-1">تستحق نهاية كل شهر (يوم 30 أو الأخير)</span>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200">
          <span className="text-xs font-semibold text-amber-600 block mb-1">قيمة الهوالك والتالف</span>
          <span className="text-xl font-extrabold text-amber-700 font-mono">
            {totalScrap.toFixed(2)} ج.م
          </span>
          <span className="text-[10px] text-slate-400 block mt-1">تُخصم مباشرة من صافي الأرباح</span>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200 bg-linear-to-br from-rose-50/50 to-white">
          <span className="text-xs font-bold text-rose-700 block mb-1">إجمالي المنصرفات</span>
          <span className="text-xl font-black text-rose-800 font-mono">
            {totalAll.toFixed(2)} ج.م
          </span>
          <span className="text-[10px] text-slate-400 block mt-1">
            في {activeLocation === 'gallery' ? 'المعرض' : 'المكتبة'}
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white p-3.5 rounded-2xl shadow-xs border border-slate-200 mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">نوع المصروف:</span>
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                typeFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
              }`}
            >
              الكل
            </button>
            <button
              onClick={() => setTypeFilter('operational')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                typeFilter === 'operational' ? 'bg-slate-700 text-white shadow-xs' : 'text-slate-500'
              }`}
            >
              تشغيلي
            </button>
            <button
              onClick={() => setTypeFilter('salary')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                typeFilter === 'salary' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-500'
              }`}
            >
              رواتب
            </button>
            <button
              onClick={() => setTypeFilter('scrap')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                typeFilter === 'scrap' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-500'
              }`}
            >
              هوالك
            </button>
          </div>
        </div>

        <span className="text-xs text-slate-400 font-mono">
          العدد: {expenses.length} حركة
        </span>
      </div>

      {/* Expenses Table */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold">
              <tr>
                <th className="p-3.5">#</th>
                <th className="p-3.5">التاريخ والوقت</th>
                <th className="p-3.5">النوع</th>
                <th className="p-3.5">البيان والوصف</th>
                <th className="p-3.5 text-center">المبلغ</th>
                <th className="p-3.5">الموقع</th>
                <th className="p-3.5">الموظف / المستفيد</th>
                <th className="p-3.5">المسؤول عن التسجيل</th>
                {isAdmin && <th className="p-3.5 text-center">إجراء</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    جاري التحميل...
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    لا توجد مصروفات مسجلة
                  </td>
                </tr>
              ) : (
                expenses.map((exp, idx) => {
                  return (
                    <tr key={exp.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 text-slate-400 font-mono">{idx + 1}</td>
                      <td className="p-3.5 font-mono text-slate-600 text-[11px]">
                        {new Date(exp.date).toLocaleDateString('ar-EG')}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            exp.type === 'operational'
                              ? 'bg-slate-100 text-slate-700'
                              : exp.type === 'salary'
                              ? 'bg-indigo-100 text-indigo-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {exp.type === 'operational' ? 'تشغيلي' : exp.type === 'salary' ? 'راتب' : 'هالك'}
                        </span>
                      </td>
                      <td className="p-3.5 font-semibold text-slate-800">
                        {exp.description}
                        {exp.salaryMonth && (
                          <span className="text-indigo-600 mr-2 text-[10px] font-mono">
                            (شهر: {exp.salaryMonth})
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-center font-bold text-rose-600 font-mono">
                        {exp.amount.toFixed(2)} ج.م
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            exp.location === 'gallery'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-indigo-100 text-indigo-800'
                          }`}
                        >
                          {exp.location === 'gallery' ? 'المعرض' : 'المكتبة'}
                        </span>
                      </td>
                      <td className="p-3.5 text-slate-600">
                        {exp.employeeName ? exp.employeeName : '-'}
                      </td>
                      <td className="p-3.5 text-slate-500 text-[11px]">{exp.createdByName}</td>
                      {isAdmin && (
                        <td className="p-3.5 text-center">
                          <button
                            onClick={() => handleDelete(exp.id, exp.description)}
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-rose-600" />
                <span>تسجيل مصروف أو راتب أو هالك</span>
              </h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveExpense} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">نوع المصروف *</label>
                <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setType('operational');
                      setDescription('');
                    }}
                    className={`py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                      type === 'operational' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    تشغيلي
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setType('salary');
                      setDescription('راتب شهري للموظف');
                    }}
                    className={`py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                      type === 'salary' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    راتب موظف
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setType('scrap');
                      setDescription('هالك وتالف بضاعة');
                    }}
                    className={`py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                      type === 'scrap' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    هوالك
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">موقع المصروف *</label>
                <select
                  value={location}
                  onChange={(e) => setLocation(e.target.value as LocationType)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-rose-500"
                >
                  <option value="gallery">المعرض (الأدوات المنزلية)</option>
                  <option value="stationery">المكتبة</option>
                </select>
              </div>

              {type === 'salary' && (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">الموظف المستحق *</label>
                    <select
                      value={employeeId}
                      onChange={(e) => {
                        setEmployeeId(e.target.value);
                        const emp = employees.find((x) => x.id === e.target.value);
                        if (emp) {
                          setAmount(Number(emp.baseSalary) || 0);
                          setDescription(`راتب شهر ${salaryMonth} - ${emp.name}`);
                        }
                      }}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">-- اختر الموظف --</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} (كود: {emp.employeeCode}) - الراتب الأساسي: {Number(emp.baseSalary) || 0} ج.م
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">عن شهر *</label>
                    <input
                      type="month"
                      value={salaryMonth}
                      onChange={(e) => {
                        setSalaryMonth(e.target.value);
                        const emp = employees.find((x) => x.id === employeeId);
                        if (emp) {
                          setDescription(`راتب شهر ${e.target.value} - ${emp.name}`);
                        }
                      }}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                    />
                    <span className="text-[10px] text-slate-400 mt-0.5 block">
                      القاعدة: تستحق الرواتب في آخر يوم فعلي من كل شهر، ويتم منع تسجيل تكرار لنفس الشهر.
                    </span>
                  </div>
                </>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">المبلغ (ج.م) *</label>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  required
                  value={amount || ''}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">البيان / الوصف التفصيلي *</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="مثال: فاتورة كهرباء شهر يوليو، كرتونة أكواب تالفة"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  data-save-button
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  حفظ وتسجيل المصروف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
