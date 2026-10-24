import React from 'react';
import { User, LocationType, LOCATION_TYPES, LOCATION_LABEL, LOCATION_HEADER_ACTIVE } from '../types.ts';
import {
  ShoppingCart,
  Package,
  Truck,
  CreditCard,
  Users,
  DollarSign,
  BarChart3,
  UserCheck,
  HardDrive,
  LogOut,
  Store,
  BookOpen,
  Receipt,
  Tag,
  Wrench,
} from 'lucide-react';

interface HeaderProps {
  currentUser: User;
  activeLocation: LocationType;
  onLocationChange: (loc: LocationType) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  activeLocation,
  onLocationChange,
  activeTab,
  onTabChange,
  onLogout,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const isSupervisorOrAdmin = currentUser.role === 'admin' || currentUser.role === 'supervisor';

  const navItems = [
    { id: 'pos', label: 'نقطة البيع السريع', icon: ShoppingCart, allowed: true },
    { id: 'invoices', label: 'الفواتير المحفوظة', icon: Receipt, allowed: true },
    { id: 'products', label: 'المنتجات والمخزون', icon: Package, allowed: true },
    { id: 'supplies', label: 'التوريد والمخازن', icon: Truck, allowed: true },
    { id: 'labels', label: 'طباعة باركود المنتجات', icon: Tag, allowed: isSupervisorOrAdmin },
    { id: 'installments', label: 'الأقساط والدفعات', icon: CreditCard, allowed: isSupervisorOrAdmin },
    { id: 'customers', label: 'العملاء', icon: Users, allowed: true },
    { id: 'suppliers', label: 'الموردون', icon: Truck, allowed: true },
    { id: 'expenses', label: 'المصروفات والرواتب', icon: DollarSign, allowed: isSupervisorOrAdmin },
    { id: 'reports', label: 'التقارير المستقلة', icon: BarChart3, allowed: isSupervisorOrAdmin },
    { id: 'employees', label: 'الموظفين والصلاحيات', icon: UserCheck, allowed: isSupervisorOrAdmin },
    { id: 'backup', label: 'النسخ والصيانة', icon: HardDrive, allowed: isAdmin },
  ];

  return (
    <header className="bg-white border-b border-slate-200 text-slate-800 select-none sticky top-0 z-40" dir="rtl">
      {/* Top Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4">
        {/* Brand & Location Switcher */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold shadow-xs">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-sm text-emerald-600 tracking-wide block leading-tight">
                معرض حور
              </span>
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block leading-tight">
                نظام الإدارة المتكامل للأدوات المنزلية والمكتبة والأدوات الكهربائية
              </span>
            </div>
          </div>

          {/* Location Toggle Indicator — one button per branch, driven by the shared
              table so adding a branch later needs no change here. */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/80 mr-2">
            {LOCATION_TYPES.map((loc) => (
              <button
                key={loc}
                onClick={() => onLocationChange(loc)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeLocation === loc
                    ? LOCATION_HEADER_ACTIVE[loc]
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {loc === 'gallery' ? (
                  <Store className="w-3.5 h-3.5 text-emerald-600" />
                ) : loc === 'stationery' ? (
                  <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                ) : (
                  <Wrench className="w-3.5 h-3.5 text-amber-600" />
                )}
                <span>{LOCATION_LABEL[loc]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* User Session Info & Logout */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200/80">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <div className="text-right">
              <span className="text-xs font-bold text-slate-800 block leading-none">
                {currentUser.name}
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5 leading-none font-medium">
                كود: {currentUser.employeeCode} | {currentUser.role === 'admin' ? 'المدير العام' : currentUser.role === 'supervisor' ? 'مشرف' : 'موظف مبيعات'}
              </span>
            </div>
          </div>

          <button
            onClick={onLogout}
            title="تسجيل الخروج"
            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="bg-white border-t border-slate-100 px-4 sm:px-6">
        <nav className="max-w-7xl mx-auto flex items-center gap-1 overflow-x-auto py-1.5 scrollbar-none">
          {navItems
            .filter((item) => item.allowed)
            .map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-bold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </nav>
      </div>
    </header>
  );
};
