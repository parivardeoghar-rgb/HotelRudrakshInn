import React, { useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { setCustomerActiveStatus } from '../services/firestoreService';
import type { CustomerProfile, Order, StaffProfile } from '../types';
import { formatDateTime, formatINR } from '../utils/format';

interface CustomersViewProps {
  currentUser: StaffProfile;
  customers: CustomerProfile[];
  orders: Order[];
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  currentUser,
  customers,
  orders,
}) => {
  const [search, setSearch] = useState('');

  const customerStats = useMemo(() => {
    const map = new Map<string, { count: number; spent: number }>();
    for (const o of orders) {
      if (!o.customerId || o.status === 'Cancelled') continue;
      const cur = map.get(o.customerId) || { count: 0, spent: 0 };
      cur.count += 1;
      cur.spent += o.subtotal || 0;
      map.set(o.customerId, cur);
    }
    return map;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.phone || '').includes(q)
    );
  }, [customers, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-zinc-900">
            Registered Customers
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
            {customers.length} customer portal accounts · Isolated from staff/admin panels
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer name, email, phone..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
          />
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Users className="w-7 h-7 text-zinc-400 mx-auto" />
            <div className="text-sm font-semibold text-zinc-900">
              No registered customers yet
            </div>
            <p className="text-xs text-zinc-500">
              Customers who register or sign in via /customer/login appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Email / Phone</th>
                  <th className="px-4 py-3 font-semibold">Preference</th>
                  <th className="px-4 py-3 font-semibold text-right">Orders</th>
                  <th className="px-4 py-3 font-semibold text-right">Total Spend</th>
                  <th className="px-4 py-3 font-semibold">Joined</th>
                  <th className="px-4 py-3 font-semibold text-right">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map((c) => {
                  const st = customerStats.get(c.uid) || { count: 0, spent: 0 };
                  return (
                    <tr key={c.uid} className="hover:bg-zinc-50">
                      <td className="px-4 py-3 font-semibold text-zinc-900">{c.displayName}</td>
                      <td className="px-4 py-3 text-zinc-600">
                        <div>{c.email || '—'}</div>
                        <div className="font-mono-tabular text-[11px] text-zinc-500">
                          {c.phone || ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {c.dietaryPreference === 'veg'
                          ? 'Pure Veg'
                          : c.dietaryPreference === 'nonveg'
                          ? 'Non-Veg'
                          : 'All'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-tabular font-semibold">
                        {st.count}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-tabular font-semibold">
                        {formatINR(st.spent)}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-zinc-500">
                        {formatDateTime(c.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            void setCustomerActiveStatus(c.uid, !c.active, currentUser)
                          }
                          className={`px-2.5 py-1 rounded font-semibold cursor-pointer ${
                            c.active
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          {c.active ? 'Active' : 'Disabled'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
