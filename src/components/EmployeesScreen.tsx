import React, { useState, useEffect } from 'react';
import { Employee, User } from '../types.ts';
import { api } from '../services/api.ts';
import {
  UserCheck,
  Plus,
  Shield,
  Key,
  User as UserIcon,
  Hash,
  DollarSign,
  AlertCircle,
  X,
  Lock,
  Edit2,
  CheckCircle,
} from 'lucide-react';

interface EmployeesScreenProps {
  currentUser: User;
}

export const EmployeesScreen: React.FC<EmployeesScreenProps> = ({ currentUser }) => {
  const isAdmin = currentUser.role === 'admin';

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [role, setRole] = useState<'admin' | 'supervisor' | 'employee'>('employee');
  const [baseSalary, setBaseSalary] = useState<number>(3000);
  const [phone, setPhone] = useState('');
  const [isActive, setIsActive] = useState<boolean>(true);
  const [formError, setFormError] = useState<string | null>(null);

  const loadEmployees = async () => {
    setLoading(true);
    try {
      const data = await api.getEmployees();
      const sanitized = (data || []).map((emp) => ({
        ...emp,
        baseSalary: Number(emp.baseSalary != null ? emp.baseSalary : 0) || 0,
        isActive: emp.isActive !== undefined ? Boolean(emp.isActive) : emp.status === 'active',
      }));
      setEmployees(sanitized);
    } catch (err) {
      console.error('Failed to load employees:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
  }, []);

  const openAddModal = () => {
    setEditingEmp(null);
    setName('');
    setUsername('');
    setPassword('');
    setEmployeeCode(`EMP-${Math.floor(100 + Math.random() * 900)}`);
    setRole('employee');
    setBaseSalary(3000);
    setPhone('');
    setIsActive(true);
    setFormError(null);
    setShowModal(true);
  };

  const openEditModal = (emp: Employee) => {
    setEditingEmp(emp);
    setName(emp.name);
    setUsername(emp.username);
    setPassword(''); // leave blank if unchanged
    setEmployeeCode(emp.employeeCode);
    setRole(emp.role);
    setBaseSalary(emp.baseSalary != null ? Number(emp.baseSalary) : 0);
    setPhone(emp.phone || '');
    setIsActive(emp.isActive !== undefined ? emp.isActive : emp.status === 'active');
    setFormError(null);
    setShowModal(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim() || !username.trim() || !employeeCode.trim()) {
      setFormError('يرجى ملء جميع الحقول الإلزامية');
      return;
    }

    if (!editingEmp && !password.trim()) {
      setFormError('كلمة المرور مطلوبة لإنشاء الموظف الجديد');
      return;
    }

    try {
      if (editingEmp) {
        const res = await api.updateEmployee(editingEmp.id, {
          name: name.trim(),
          role,
          baseSalary,
          phone: phone.trim(),
          isActive,
          password: password.trim() ? password.trim() : undefined,
        });
        if (res.success) {
          setShowModal(false);
          loadEmployees();
        } else {
          setFormError(res.error || 'فشل تعديل بيانات الموظف');
        }
      } else {
        const res = await api.createEmployee({
          name: name.trim(),
          username: username.trim(),
          password: password.trim(),
          employeeCode: employeeCode.trim(),
          role,
          baseSalary,
          phone: phone.trim(),
        });
        if (res.success) {
          setShowModal(false);
          loadEmployees();
        } else {
          setFormError(res.error || 'فشل إنشاء الموظف');
        }
      }
    } catch (err: any) {
      setFormError(err.message || 'فشل الاتصال بالخادم');
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-indigo-600" />
            <span>إدارة الموظفين والصلاحيات التشغيلية</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            تحديد الأدوار (مدير، مشرف، موظف مبيعات)، أكواد الموظفين، والرواتب الأساسية الشهرية
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={openAddModal}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm shadow-indigo-900/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة موظف جديد</span>
          </button>
        )}
      </div>

      {/* Employees Table */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-bold">
              <tr>
                <th className="p-3.5">#</th>
                <th className="p-3.5">اسم الموظف</th>
                <th className="p-3.5">كود الموظف</th>
                <th className="p-3.5">اسم المستخدم (Login)</th>
                <th className="p-3.5">الدور والصلاحية</th>
                <th className="p-3.5 text-center">الراتب الأساسي</th>
                <th className="p-3.5">رقم الهاتف</th>
                <th className="p-3.5">الحالة</th>
                <th className="p-3.5">تاريخ التعيين</th>
                {isAdmin && <th className="p-3.5 text-center">تعديل</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    جاري التحميل...
                  </td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400">
                    لا يوجد موظفين مسجلين
                  </td>
                </tr>
              ) : (
                employees.map((emp, idx) => (
                  <tr key={emp.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 text-slate-400 font-mono">{idx + 1}</td>
                    <td className="p-3.5 font-bold text-slate-800">{emp.name}</td>
                    <td className="p-3.5 font-mono text-slate-600 font-semibold">{emp.employeeCode}</td>
                    <td className="p-3.5 font-mono text-slate-600">{emp.username}</td>
                    <td className="p-3.5">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          emp.role === 'admin'
                            ? 'bg-rose-100 text-rose-800'
                            : emp.role === 'supervisor'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {emp.role === 'admin' ? 'المدير العام' : emp.role === 'supervisor' ? 'مشرف' : 'موظف مبيعات'}
                      </span>
                    </td>
                    <td className="p-3.5 text-center font-bold text-slate-800 font-mono">
                      {(Number(emp.baseSalary) || 0).toFixed(2)} ج.م
                    </td>
                    <td className="p-3.5 font-mono text-slate-600">{emp.phone || '-'}</td>
                    <td className="p-3.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          (emp.isActive ?? (emp.status === 'active')) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {(emp.isActive ?? (emp.status === 'active')) ? 'نشط' : 'موقوف'}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-slate-400 text-[11px]">
                      {new Date(emp.createdAt).toLocaleDateString('ar-EG')}
                    </td>
                    {isAdmin && (
                      <td className="p-3.5 text-center">
                        <button
                          onClick={() => openEditModal(emp)}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-indigo-600" />
                <span>{editingEmp ? 'تعديل بيانات الموظف والصلاحية' : 'إضافة موظف جديد للمنظومة'}</span>
              </h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEmployee} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">الاسم الكامل *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: أحمد محمود"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">اسم المستخدم *</label>
                  <input
                    type="text"
                    required
                    disabled={!!editingEmp}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ahmed"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 disabled:bg-slate-200"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">كود الموظف *</label>
                  <input
                    type="text"
                    required
                    value={employeeCode}
                    onChange={(e) => setEmployeeCode(e.target.value)}
                    placeholder="EMP-101"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  كلمة المرور {editingEmp ? '(اتركها فارغة إذا لم ترغب بالتغيير)' : '*'}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">الدور والصلاحية *</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="employee">موظف مبيعات (نقطة البيع فقط)</option>
                    <option value="supervisor">مشرف (مخزون ومبيعات وتقارير)</option>
                    <option value="admin">مدير عام (صلاحيات كاملة)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">الراتب الأساسي الشهري (ج.م) *</label>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    required
                    value={baseSalary}
                    onChange={(e) => setBaseSalary(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">رقم الهاتف</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010xxxxxxxx"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {editingEmp && (
                <div>
                  <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>حساب الموظف نشط وقادر على تسجيل الدخول</span>
                  </label>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  data-save-button
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  {editingEmp ? 'حفظ التعديلات' : 'إنشاء الموظف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
