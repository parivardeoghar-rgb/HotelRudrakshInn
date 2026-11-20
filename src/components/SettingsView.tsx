import React, { useState } from 'react';
import { CheckCircle2, Plus, Save, Trash2 } from 'lucide-react';
import { saveHotelSettings } from '../services/firestoreService';
import { BAIDYANATH_MEDIA_LOGO, type HotelSettings, type TaxComponent } from '../types';

interface SettingsViewProps {
  settings: HotelSettings;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ settings }) => {
  const [form, setForm] = useState<Omit<HotelSettings, 'updatedAt'>>({
    id: 'main',
    hotelName: settings.hotelName,
    tagline: settings.tagline || '',
    address: settings.address || '',
    phone: settings.phone || '',
    email: settings.email || '',
    gstin: settings.gstin || '',
    currency: settings.currency || 'INR',
    upiId: settings.upiId || '',
    invoicePrefix: settings.invoicePrefix || 'RUD',
    invoiceFooter: settings.invoiceFooter || '',
    operatingHours: settings.operatingHours || '',
    taxes: settings.taxes || [],
    paymentMethods: settings.paymentMethods || ['Cash', 'UPI', 'Card', 'Split', 'Room Folio'],
    googleReviewUrl: settings.googleReviewUrl || '',
    notificationsEnabled: settings.notificationsEnabled ?? true,
    requireCustomerLogin: settings.requireCustomerLogin ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveHotelSettings(form);
      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const updateTax = (idx: number, patch: Partial<TaxComponent>) => {
    const next = form.taxes.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    setForm({ ...form, taxes: next });
  };

  const togglePaymentMethod = (method: string) => {
    const exists = form.paymentMethods.includes(method);
    const next = exists
      ? form.paymentMethods.filter((m) => m !== method)
      : [...form.paymentMethods, method];
    if (next.length > 0) setForm({ ...form, paymentMethods: next });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-display text-2xl font-semibold text-zinc-900">
          Hotel & System Configuration
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Hotel profile, GST/tax rules, QR customer login policy, UPI details, and software credits
        </p>
      </div>

      {savedBanner && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Hotel configuration saved to Firestore.
        </div>
      )}

      <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
        {/* Hotel Identity & Contact */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4 text-xs">
          <h3 className="text-sm font-bold text-zinc-900">Hotel Profile & Invoice Header</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Hotel Name</label>
              <input
                required
                value={form.hotelName}
                onChange={(e) => setForm({ ...form, hotelName: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Tagline</label>
              <input
                value={form.tagline}
                onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold text-zinc-700 mb-1">Address</label>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Contact Email</label>
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">GSTIN</label>
              <input
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 font-mono-tabular"
              />
            </div>
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Operating Hours</label>
              <input
                value={form.operatingHours}
                onChange={(e) => setForm({ ...form, operatingHours: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
          </div>
        </div>

        {/* Configurable Taxes (Non-Hardcoded) */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-zinc-900">Configurable Tax Engine</h3>
              <p className="text-zinc-500">
                POS billing calculates taxes dynamically from these active rows.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setForm({
                  ...form,
                  taxes: [...form.taxes, { name: 'Custom Tax', rate: 0, enabled: true }],
                })
              }
              className="px-3 py-1.5 rounded-lg border border-zinc-300 font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Tax Rule
            </button>
          </div>

          <div className="space-y-2.5">
            {form.taxes.map((tax, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={tax.enabled}
                  onChange={(e) => updateTax(idx, { enabled: e.target.checked })}
                />
                <input
                  value={tax.name}
                  onChange={(e) => updateTax(idx, { name: e.target.value })}
                  className="flex-1 px-3 py-2 rounded-lg border border-zinc-300"
                  placeholder="Tax Name (e.g. CGST)"
                />
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={50}
                  value={tax.rate}
                  onChange={(e) => updateTax(idx, { rate: Number(e.target.value) || 0 })}
                  className="w-24 px-3 py-2 rounded-lg border border-zinc-300 font-mono-tabular"
                />
                <span className="text-zinc-500">%</span>
                <button
                  type="button"
                  onClick={() =>
                    setForm({ ...form, taxes: form.taxes.filter((_, i) => i !== idx) })
                  }
                  className="p-1.5 text-red-600 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Payments, UPI, Invoice, Customer Ordering Policy & Reviews */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4 text-xs">
          <h3 className="text-sm font-bold text-zinc-900">
            Payments, Invoice Format, QR Ordering & Reviews
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Hotel UPI ID</label>
              <input
                value={form.upiId}
                onChange={(e) => setForm({ ...form, upiId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 font-mono-tabular"
              />
            </div>
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Invoice Prefix</label>
              <input
                value={form.invoicePrefix}
                onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 font-mono-tabular"
              />
            </div>
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Currency</label>
              <input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 font-mono-tabular"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-zinc-700 mb-1.5">
              Enabled Payment Methods
            </label>
            <div className="flex flex-wrap gap-3">
              {['Cash', 'UPI', 'Card', 'Split', 'Room Folio'].map((m) => (
                <label key={m} className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.paymentMethods.includes(m)}
                    onChange={() => togglePaymentMethod(m)}
                  />
                  {m}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-semibold text-zinc-700 mb-1">
              Invoice Footer Note
            </label>
            <input
              value={form.invoiceFooter}
              onChange={(e) => setForm({ ...form, invoiceFooter: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300"
            />
          </div>

          <div>
            <label className="block font-semibold text-zinc-700 mb-1">
              Consent-Based Google Review URL
            </label>
            <input
              value={form.googleReviewUrl}
              onChange={(e) => setForm({ ...form, googleReviewUrl: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300"
            />
          </div>

          <div className="space-y-2.5 pt-2 border-t border-zinc-100">
            <label className="flex items-center gap-2 font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={form.notificationsEnabled}
                onChange={(e) =>
                  setForm({ ...form, notificationsEnabled: e.target.checked })
                }
              />
              Enable real-time operational notifications across Kitchen, Waiter & POS
            </label>

            <label className="flex items-center gap-2 font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={form.requireCustomerLogin}
                onChange={(e) =>
                  setForm({ ...form, requireCustomerLogin: e.target.checked })
                }
              />
              Require Customer Login to place QR table orders (guests can still browse menu without logging in)
            </label>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-[#141518] text-[#D4AF37] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving Settings...' : 'Save Configuration'}
        </button>
      </form>

      {/* Software Credits Section with Baidyanath Media Logo */}
      <div className="bg-[#141518] text-zinc-200 rounded-xl p-6 border border-zinc-800 flex flex-col sm:flex-row sm:items-center gap-4 text-xs">
        <img
          src={BAIDYANATH_MEDIA_LOGO}
          alt="Baidyanath Media Agency Logo"
          className="w-16 h-16 rounded-xl object-cover bg-[#F4F1EA] shrink-0"
        />
        <div className="space-y-1.5">
          <div className="text-[#D4AF37] font-semibold uppercase tracking-wider">
            Software Credits & About
          </div>
          <h3 className="font-display text-lg font-semibold text-white">
            Hotel Rudraksh Inn — Smart Restaurant & Hotel Management System
          </h3>
          <p className="text-zinc-400">
            Designed & Developed by <strong className="text-white">Baidyanath Media Agency</strong> ·{' '}
            <a
              href="https://www.baidyanathmedia.com"
              target="_blank"
              rel="noreferrer"
              className="text-[#D4AF37] underline"
            >
              www.baidyanathmedia.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};
