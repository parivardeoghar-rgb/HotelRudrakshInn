import React, { useState } from 'react';
import {
  ArrowRight,
  ChefHat,
  CreditCard,
  QrCode,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Utensils,
  UtensilsCrossed,
} from 'lucide-react';
import { HOTEL_HERO_IMAGE } from '../data/seedCatalog';
import { BAIDYANATH_MEDIA_LOGO, type PortalKey } from '../types';

interface PortalSelectorViewProps {
  onSelectPortal: (portal: PortalKey) => void;
  onOpenGuestMenu: (tableId: string) => void;
  onBackToHome?: () => void;
  requireCustomerLogin?: boolean;
}

const PORTAL_CARDS: {
  key: PortalKey;
  title: string;
  subtitle: string;
  route: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
  ctaLabel: string;
}[] = [
  {
    key: 'customer',
    title: 'Customer',
    subtitle: 'Menu · Orders · Feedback',
    route: '/customer/login',
    description: 'Browse digital menu, order by table QR, track dishes live, and manage dining profile.',
    icon: Utensils,
    accentClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    ctaLabel: 'Customer Login',
  },
  {
    key: 'admin',
    title: 'Admin',
    subtitle: 'Full system control',
    route: '/admin/login',
    description: 'Executive analytics, staff credentials, RBAC permissions, audit logs, and system settings.',
    icon: ShieldCheck,
    accentClass: 'text-[#9A7415] bg-amber-50 border-amber-200',
    ctaLabel: 'Admin Login',
  },
  {
    key: 'manager',
    title: 'Manager',
    subtitle: 'Operations · Reports',
    route: '/manager/login',
    description: 'Floor oversight, waiter assignments, menu catalog, stock control, and sales reports.',
    icon: TrendingUp,
    accentClass: 'text-sky-700 bg-sky-50 border-sky-200',
    ctaLabel: 'Manager Login',
  },
  {
    key: 'cashier',
    title: 'Cashier',
    subtitle: 'POS · Billing · Payments',
    route: '/cashier/login',
    description: 'Generate GST invoices, apply discounts, accept Cash/UPI/Card/Split settlements.',
    icon: CreditCard,
    accentClass: 'text-indigo-700 bg-indigo-50 border-indigo-200',
    ctaLabel: 'Cashier Login',
  },
  {
    key: 'waiter',
    title: 'Waiter',
    subtitle: 'Tables · Orders · Service',
    route: '/waiter/login',
    description: 'Manage assigned tables, punch orders, transfer or merge tables, and answer calls.',
    icon: UserCheck,
    accentClass: 'text-amber-800 bg-amber-50 border-amber-200',
    ctaLabel: 'Waiter Login',
  },
  {
    key: 'kitchen',
    title: 'Kitchen Staff',
    subtitle: 'Kitchen · Live Orders',
    route: '/kitchen/login',
    description: 'Real-time KDS ticket queue, preparation status updates, priority orders, and stock check.',
    icon: ChefHat,
    accentClass: 'text-rose-700 bg-rose-50 border-rose-200',
    ctaLabel: 'Kitchen Login',
  },
];

export const PortalSelectorView: React.FC<PortalSelectorViewProps> = ({
  onSelectPortal,
  onOpenGuestMenu,
  onBackToHome,
  requireCustomerLogin,
}) => {
  const [previewTable, setPreviewTable] = useState('T1');

  return (
    <div className="min-h-screen bg-[#141518] text-zinc-100 flex flex-col">
      {/* Top Hospitality Masthead */}
      <header className="border-b border-white/10 bg-[#141518]/95">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#C59B27]/15 border border-[#D4AF37]/40 flex items-center justify-center shrink-0">
              <UtensilsCrossed className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div>
              <h1 className="font-display text-xl font-semibold text-white leading-tight">
                Hotel Rudraksh Inn
              </h1>
              <p className="text-xs text-zinc-400">
                Smart Restaurant Management System · Deoghar, Jharkhand
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {onBackToHome && (
              <button
                type="button"
                onClick={onBackToHome}
                className="px-3.5 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-200 transition-colors cursor-pointer"
              >
                Back to Homepage
              </button>
            )}
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5">
              <img
                src={BAIDYANATH_MEDIA_LOGO}
                alt="Baidyanath Media Agency Logo"
                className="w-8 h-8 rounded-lg object-cover bg-[#F4F1EA]"
              />
              <div className="text-left">
                <div className="text-[11px] text-zinc-400 leading-none">Software by</div>
                <div className="text-xs font-semibold text-[#D4AF37] mt-0.5">
                  Baidyanath Media Agency
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-8 lg:py-10 space-y-8">
        {/* Hero Intro Strip */}
        <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-zinc-900">
          <img
            src={HOTEL_HERO_IMAGE}
            alt="Hotel Rudraksh Inn Dining Room"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-30"
          />
          <div className="relative z-10 p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-gradient-to-r from-[#141518]/95 via-[#141518]/80 to-[#141518]/65">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold tracking-wider uppercase text-[#D4AF37]">
                Role-Verified Multi-Portal Architecture
              </p>
              <h2 className="font-display text-3xl sm:text-4xl font-semibold text-white mt-1.5 text-balance">
                Choose your login portal
              </h2>
              <p className="text-sm text-zinc-300 mt-2 leading-relaxed">
                Each portal connects to the unified Hotel Rudraksh Inn Firestore backend with strict
                role-based permissions, dedicated navigation, and isolated dashboards.
              </p>
            </div>

            {/* Instant Guest QR Menu Bar */}
            <div className="bg-[#141518]/90 border border-white/15 rounded-xl p-4 w-full lg:w-88 shrink-0">
              <div className="flex items-center justify-between mb-2.5">
                <div>
                  <div className="text-xs font-semibold text-white">Quick QR Table Menu</div>
                  <div className="text-[11px] text-zinc-400">
                    {requireCustomerLogin
                      ? 'Customer login enabled for ordering'
                      : 'Browse & order without installing an app'}
                  </div>
                </div>
                <QrCode className="w-5 h-5 text-[#D4AF37]" />
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={previewTable}
                  onChange={(e) => setPreviewTable(e.target.value)}
                  aria-label="Select dining table for QR menu"
                  className="flex-1 px-3 py-2 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                >
                  <option value="T1">Table T1 · Main Dining Hall</option>
                  <option value="T2">Table T2 · Main Dining Hall</option>
                  <option value="T5">Table T5 · Courtyard Terrace</option>
                  <option value="T7">Table T7 · Family AC Hall</option>
                  <option value="T9">Table V1 · Rudraksh VIP Lounge</option>
                </select>
                <button
                  type="button"
                  onClick={() => onOpenGuestMenu(previewTable)}
                  className="px-3.5 py-2 rounded-lg bg-[#C59B27] text-[#141518] font-semibold text-xs hover:bg-[#D4AF37] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Open QR
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 6 Portal Selection Cards */}
        <section aria-label="Login portals">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PORTAL_CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.key}
                  className="bg-[#FAFAFA] text-zinc-900 border border-zinc-200 rounded-2xl p-6 flex flex-col justify-between hover:border-[#C59B27] transition-colors"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className={`p-2.5 rounded-xl border ${card.accentClass}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <span className="font-mono-tabular text-[11px] text-zinc-500">
                        {card.route}
                      </span>
                    </div>

                    <h3 className="font-display text-xl font-semibold text-zinc-900 mt-4">
                      {card.title}
                    </h3>
                    <div className="text-xs font-semibold text-[#9A7415] mt-0.5">
                      {card.subtitle}
                    </div>
                    <p className="text-xs text-zinc-600 mt-2.5 leading-relaxed">
                      {card.description}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectPortal(card.key)}
                    className="mt-5 w-full py-2.5 px-4 rounded-xl bg-[#141518] text-[#D4AF37] hover:bg-zinc-800 text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span>{card.ctaLabel}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-zinc-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong className="text-white">Backend Role Verification:</strong> Selecting a login portal
            does not grant privileges. Staff roles and module permissions are verified directly from
            Firestore after sign-in.
          </span>
          <span className="text-zinc-400">Tower Chowk, Station Road, Deoghar</span>
        </div>
      </main>

      {/* Branded Footer */}
      <footer className="border-t border-white/10 bg-[#101114] px-4 sm:px-8 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-400">
          <span>Hotel Rudraksh Inn · Smart Restaurant & Service Management</span>
          <a
            href="https://www.baidyanathmedia.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2.5 text-zinc-300 hover:text-[#D4AF37] transition-colors"
          >
            <img
              src={BAIDYANATH_MEDIA_LOGO}
              alt="Baidyanath Media"
              className="w-6 h-6 rounded object-cover bg-[#F4F1EA]"
            />
            <span>
              Designed & Developed by <strong className="text-white">Baidyanath Media Agency</strong>
            </span>
          </a>
        </div>
      </footer>
    </div>
  );
};
