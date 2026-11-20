import React, { useState } from 'react';
import {
  BarChart3,
  BedDouble,
  Bell,
  ChefHat,
  CreditCard,
  History,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  MessageSquareHeart,
  Package,
  QrCode,
  Settings,
  UserCheck,
  UserCircle,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import {
  markAllNotificationsRead,
  markNotificationRead,
  sendAccountPasswordReset,
  updateOwnStaffProfile,
} from '../services/firestoreService';
import {
  BAIDYANATH_MEDIA_LOGO,
  ROLE_ALLOWED_MODULES,
  ROLE_LABELS,
  ROLE_TO_PORTAL,
  type AppNotification,
  type StaffProfile,
  type StaffRole,
  type WorkspaceModule,
} from '../types';
import { formatTime } from '../utils/format';

interface AppShellProps {
  profile: StaffProfile;
  activeRole: StaffRole;
  onSwitchPreviewRole: (role: StaffRole) => void;
  activeModule: WorkspaceModule;
  onSelectModule: (mod: WorkspaceModule) => void;
  notifications: AppNotification[];
  onOpenQrMenuPreview: () => void;
  onProfileUpdated: (updated: StaffProfile) => void;
  onSignOut: () => Promise<void>;
  children: React.ReactNode;
}

const ROLE_CONSOLE_SUBTITLE: Record<StaffRole, string> = {
  super_admin: 'Executive Admin Panel',
  manager: 'Operations Manager Console',
  cashier: 'POS & Billing Terminal',
  waiter: 'Waiter Service Console',
  kitchen: 'Kitchen Display System',
};

export const NAV_ITEMS: {
  id: WorkspaceModule;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'tables', label: 'Tables & QR', icon: LayoutGrid },
  { id: 'waiter', label: 'Waiter Panel', icon: UtensilsCrossed },
  { id: 'kds', label: 'Kitchen Display', icon: ChefHat },
  { id: 'pos', label: 'POS Billing', icon: CreditCard },
  { id: 'room_service', label: 'Room Service', icon: BedDouble },
  { id: 'menu', label: 'Menu Catalog', icon: QrCode },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'feedback', label: 'Feedback', icon: MessageSquareHeart },
  { id: 'customers', label: 'Customers', icon: UserCheck },
  { id: 'staff', label: 'Staff & Roles', icon: Users },
  { id: 'audit', label: 'Audit Logs', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const getEffectiveAllowedModules = (
  profile: StaffProfile,
  activeRole: StaffRole
): WorkspaceModule[] => {
  const base =
    activeRole === profile.role &&
    profile.permissions &&
    profile.permissions.length > 0
      ? profile.permissions
      : ROLE_ALLOWED_MODULES[activeRole];

  if (activeRole !== 'super_admin') {
    return base.filter((m) => m !== 'audit' && m !== 'settings' && m !== 'customers');
  }
  return base;
};

export const AppShell: React.FC<AppShellProps> = ({
  profile,
  activeRole,
  onSwitchPreviewRole,
  activeModule,
  onSelectModule,
  notifications,
  onOpenQrMenuPreview,
  onProfileUpdated,
  onSignOut,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profName, setProfName] = useState(profile.displayName);
  const [profPhone, setProfPhone] = useState(profile.phone || '');
  const [profStatus, setProfStatus] = useState<string | null>(null);
  const [savingProf, setSavingProf] = useState(false);

  const allowed = getEffectiveAllowedModules(profile, activeRole);
  const visibleNav = NAV_ITEMS.filter((item) => allowed.includes(item.id));

  const roleNotifications = notifications.filter(
    (n) => n.targetRoles.includes(activeRole) || activeRole === 'super_admin'
  );
  const unreadCount = roleNotifications.filter((n) => !n.read).length;

  const handleSaveSelfProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profName.trim()) return;
    setSavingProf(true);
    setProfStatus(null);
    try {
      await updateOwnStaffProfile(profile.uid, {
        displayName: profName,
        phone: profPhone,
      });
      onProfileUpdated({
        ...profile,
        displayName: profName.trim(),
        phone: profPhone.trim(),
      });
      setProfStatus('Profile updated successfully.');
    } catch (err) {
      setProfStatus(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSavingProf(false);
    }
  };

  const handleSelfPasswordReset = async () => {
    setProfStatus(null);
    try {
      await sendAccountPasswordReset(profile.email);
      setProfStatus(`Password reset link sent to ${profile.email}.`);
    } catch (err) {
      setProfStatus(err instanceof Error ? err.message : 'Unable to send reset email.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F2] flex flex-col lg:flex-row">
      {/* Sidebar (Desktop) */}
      <aside className="no-print hidden lg:flex lg:w-64 bg-[#141518] text-zinc-200 flex-col justify-between shrink-0 border-r border-zinc-800">
        <div>
          <div className="px-5 py-5 border-b border-zinc-800">
            <div className="text-[11px] font-semibold tracking-widest uppercase text-[#D4AF37]">
              {ROLE_CONSOLE_SUBTITLE[activeRole]}
            </div>
            <h1 className="font-display text-lg font-semibold text-white mt-0.5">
              Hotel Rudraksh Inn
            </h1>
            <div className="font-mono-tabular text-[11px] text-zinc-400 mt-0.5">
              /{ROLE_TO_PORTAL[activeRole]}/dashboard
            </div>
          </div>

          <nav className="p-3 space-y-1">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              const active = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectModule(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-[#C59B27] text-[#141518]'
                      : 'text-zinc-300 hover:bg-zinc-800/80 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-zinc-800 space-y-3 text-xs">
          <button
            type="button"
            onClick={onOpenQrMenuPreview}
            className="w-full py-2 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <QrCode className="w-3.5 h-3.5 text-[#D4AF37]" />
            Open QR Guest Menu
          </button>

          <button
            type="button"
            onClick={() => {
              setProfName(profile.displayName);
              setProfPhone(profile.phone || '');
              setProfStatus(null);
              setProfileOpen(true);
            }}
            className="w-full text-left pt-2 border-t border-zinc-800/80 hover:bg-zinc-800/60 p-2 rounded-lg transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-white truncate">{profile.displayName}</div>
              <UserCircle className="w-4 h-4 text-[#D4AF37] shrink-0" />
            </div>
            <div className="text-[11px] text-zinc-400 truncate">{profile.email}</div>
            <div className="text-[11px] text-[#D4AF37] font-medium mt-0.5">
              {ROLE_LABELS[activeRole]} · Profile
            </div>
          </button>

          <button
            type="button"
            onClick={() => void onSignOut()}
            className="w-full py-2 px-3 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800 text-xs font-medium inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>

          <div className="pt-2 border-t border-zinc-800/80 flex items-center gap-2">
            <img
              src={BAIDYANATH_MEDIA_LOGO}
              alt="Baidyanath Media"
              className="w-6 h-6 rounded object-cover bg-[#F4F1EA] shrink-0"
            />
            <span className="text-[11px] text-zinc-400 leading-tight">
              Baidyanath Media Agency
            </span>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 bg-[#141518] text-white flex flex-col justify-between p-4">
            <div className="overflow-y-auto">
              <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
                <div>
                  <span className="font-display text-base font-semibold block">
                    Hotel Rudraksh Inn
                  </span>
                  <span className="text-[11px] text-[#D4AF37]">
                    {ROLE_CONSOLE_SUBTITLE[activeRole]}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 text-zinc-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="mt-4 space-y-1">
                {visibleNav.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectModule(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold ${
                        activeModule === item.id
                          ? 'bg-[#C59B27] text-[#141518]'
                          : 'text-zinc-300'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="py-2.5 px-3 rounded-lg border border-zinc-700 text-xs font-semibold text-zinc-200 inline-flex items-center justify-center gap-2 mt-4"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
          <div
            className="flex-1 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="no-print bg-white border-b border-zinc-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-zinc-200 text-zinc-700"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs text-zinc-500 truncate">
              <span className="font-semibold text-zinc-900">
                {ROLE_CONSOLE_SUBTITLE[activeRole]}
              </span>
              <span className="mx-1.5">/</span>
              <span>
                {NAV_ITEMS.find((n) => n.id === activeModule)?.label || 'Workspace'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Super Admin Role Preview Switcher */}
            {profile.role === 'super_admin' && (
              <select
                aria-label="Switch workspace role view"
                value={activeRole}
                onChange={(e) => onSwitchPreviewRole(e.target.value as StaffRole)}
                className="px-2.5 py-1.5 rounded-lg border border-zinc-300 bg-zinc-50 text-xs font-semibold text-zinc-800"
              >
                <option value="super_admin">View: Super Admin</option>
                <option value="manager">View: Manager</option>
                <option value="waiter">View: Waiter</option>
                <option value="kitchen">View: Kitchen KDS</option>
                <option value="cashier">View: Cashier POS</option>
              </select>
            )}

            <button
              type="button"
              onClick={() => {
                setProfName(profile.displayName);
                setProfPhone(profile.phone || '');
                setProfStatus(null);
                setProfileOpen(true);
              }}
              className="p-2 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 cursor-pointer lg:hidden"
              aria-label="My profile"
            >
              <UserCircle className="w-4 h-4" />
            </button>

            {/* Real-time Notification Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                className="relative p-2 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 cursor-pointer"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center font-mono-tabular">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-zinc-200 rounded-xl shadow-xl z-40 overflow-hidden">
                  <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-900">
                      Live Alerts ({unreadCount} unread)
                    </span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void markAllNotificationsRead(roleNotifications)}
                        className="text-[11px] font-semibold text-[#9A7415] hover:underline cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-zinc-100">
                    {roleNotifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-zinc-500">
                        No notifications yet.
                      </div>
                    ) : (
                      roleNotifications.slice(0, 15).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            if (!n.read) void markNotificationRead(n.id);
                            setNotifOpen(false);
                          }}
                          className={`w-full text-left px-4 py-3 text-xs hover:bg-zinc-50 cursor-pointer ${
                            !n.read ? 'bg-amber-50/40' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-zinc-900">{n.title}</span>
                            <span className="font-mono-tabular text-[10px] text-zinc-400">
                              {formatTime(n.createdAt)}
                            </span>
                          </div>
                          <p className="text-zinc-600 mt-0.5">{n.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Active Module Content */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>

        {/* Footer Software Credit with Baidyanath Media Logo */}
        <footer className="no-print px-6 py-4 border-t border-zinc-200 bg-white text-xs text-zinc-500 flex flex-wrap items-center justify-between gap-3">
          <span>
            Hotel Rudraksh Inn · Smart Restaurant & Hotel Management System
          </span>
          <a
            href="https://www.baidyanathmedia.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-zinc-700 hover:text-[#9A7415]"
          >
            <img
              src={BAIDYANATH_MEDIA_LOGO}
              alt="Baidyanath Media"
              className="w-5 h-5 rounded object-cover bg-[#F4F1EA]"
            />
            <span>
              Designed & Developed by <strong className="text-zinc-900">Baidyanath Media Agency</strong> · www.baidyanathmedia.com
            </span>
          </a>
        </footer>
      </div>

      {/* Staff Self Profile Modal */}
      {profileOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-[#141518] text-white flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold">My Staff Profile</h3>
                <p className="text-xs text-[#D4AF37]">{ROLE_LABELS[profile.role]}</p>
              </div>
              <button
                type="button"
                onClick={() => setProfileOpen(false)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={(e) => void handleSaveSelfProfile(e)} className="p-5 space-y-3 text-xs">
              {profStatus && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-medium">
                  {profStatus}
                </div>
              )}
              <div>
                <label className="block font-semibold text-zinc-700 mb-1">Full Name</label>
                <input
                  required
                  value={profName}
                  onChange={(e) => setProfName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-zinc-700 mb-1">Email</label>
                <input
                  disabled
                  value={profile.email}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-100 text-zinc-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1">Phone</label>
                  <input
                    value={profPhone}
                    onChange={(e) => setProfPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1">Shift</label>
                  <input
                    disabled
                    value={profile.shift || 'Assigned Shift'}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-100 text-zinc-500"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => void handleSelfPasswordReset()}
                  className="px-3 py-2 rounded-lg border border-zinc-300 text-zinc-700 font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#9A7415]" />
                  Reset Password
                </button>
                <button
                  type="submit"
                  disabled={savingProf}
                  className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] font-semibold cursor-pointer"
                >
                  {savingProf ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
