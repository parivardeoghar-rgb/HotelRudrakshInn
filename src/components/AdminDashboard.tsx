import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowUpRight,
  Database,
  IndianRupee,
  ShoppingBag,
  Sparkles,
  Users,
} from 'lucide-react';
import { seedInitialHotelCatalog } from '../services/firestoreService';
import type {
  Bill,
  Feedback,
  InventoryItem,
  MenuItem,
  Order,
  RestaurantTable,
  ServiceRequest,
  WorkspaceModule,
} from '../types';
import { formatINR, formatINRCompact, isSameDay, toDate } from '../utils/format';

interface AdminDashboardProps {
  orders: Order[];
  bills: Bill[];
  tables: RestaurantTable[];
  menuItems: MenuItem[];
  inventory: InventoryItem[];
  feedback: Feedback[];
  serviceRequests: ServiceRequest[];
  isAdmin: boolean;
  onNavigate: (mod: WorkspaceModule) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  orders,
  bills,
  tables,
  menuItems,
  inventory,
  feedback,
  serviceRequests,
  isAdmin,
  onNavigate,
}) => {
  const [range, setRange] = useState<'today' | 'week' | 'month'>('today');
  const [seeding, setSeeding] = useState(false);

  const now = new Date();

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const d = toDate(o.createdAt);
      if (range === 'today') return isSameDay(d, now);
      const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
      return range === 'week' ? diffDays <= 7 : diffDays <= 30;
    });
  }, [orders, range]);

  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      const d = toDate(b.createdAt);
      if (range === 'today') return isSameDay(d, now);
      const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
      return range === 'week' ? diffDays <= 7 : diffDays <= 30;
    });
  }, [bills, range]);

  const paidBills = filteredBills.filter((b) => b.paymentStatus === 'Paid');
  const totalSales = paidBills.reduce((s, b) => s + (b.totalAmount || 0), 0);
  const pendingOrders = orders.filter((o) =>
    ['New', 'Accepted', 'Preparing', 'Ready'].includes(o.status)
  );
  const completedOrders = filteredOrders.filter((o) =>
    ['Served', 'Completed'].includes(o.status)
  );
  const occupiedTables = tables.filter((t) => t.status !== 'Available');
  const vacantTables = tables.filter((t) => t.status === 'Available');
  const aov = paidBills.length > 0 ? totalSales / paidBills.length : 0;

  const lowStockItems = inventory.filter((i) => i.quantity <= i.minThreshold);
  const pendingService = serviceRequests.filter((r) => r.status === 'Pending');

  // Daily Sales Trend over the Last 7 Days (always local calendar days)
  const sevenDayTrendData = useMemo(() => {
    const toLocalDateKey = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const map = new Map<
      string,
      { dateKey: string; label: string; fullDate: string; sales: number; orders: number }
    >();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = toLocalDateKey(d);
      const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const fullDate = d.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
      });
      map.set(key, { dateKey: key, label, fullDate, sales: 0, orders: 0 });
    }

    bills
      .filter((b) => b.paymentStatus === 'Paid')
      .forEach((b) => {
        const key = toLocalDateKey(toDate(b.createdAt));
        const entry = map.get(key);
        if (entry) {
          entry.sales = Math.round((entry.sales + (b.totalAmount || 0)) * 100) / 100;
        }
      });

    orders
      .filter((o) => o.status !== 'Cancelled')
      .forEach((o) => {
        const key = toLocalDateKey(toDate(o.createdAt));
        const entry = map.get(key);
        if (entry) {
          entry.orders += 1;
        }
      });

    return Array.from(map.values());
  }, [bills, orders]);

  const sevenDayTotal = useMemo(
    () => sevenDayTrendData.reduce((sum, d) => sum + d.sales, 0),
    [sevenDayTrendData]
  );
  const sevenDayDailyAvg = sevenDayTotal / 7;

  // Popular Dishes
  const popularItems = useMemo(() => {
    const counts = new Map<string, { name: string; qty: number; revenue: number }>();
    filteredOrders
      .filter((o) => o.status !== 'Cancelled')
      .forEach((o) => {
        o.items.forEach((it) => {
          const cur = counts.get(it.itemId) || { name: it.name, qty: 0, revenue: 0 };
          cur.qty += it.qty;
          cur.revenue += it.price * it.qty;
          counts.set(it.itemId, cur);
        });
      });
    return Array.from(counts.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6);
  }, [filteredOrders]);

  // Payment Breakdown
  const paymentBreakdown = useMemo(() => {
    const totals: Record<string, number> = { Cash: 0, UPI: 0, Card: 0, 'Room Folio': 0 };
    paidBills.forEach((b) => {
      if (b.paymentMethod === 'Split' && b.splitPayments) {
        b.splitPayments.forEach((sp) => {
          totals[sp.method] = (totals[sp.method] || 0) + sp.amount;
        });
      } else {
        const key = b.paymentMethod in totals ? b.paymentMethod : 'Cash';
        totals[key] += b.totalAmount || 0;
      }
    });
    return Object.entries(totals).map(([method, amount]) => ({ method, amount }));
  }, [paidBills]);

  // Staff Performance
  const staffPerformance = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; bills: number; revenue: number }>();
    filteredOrders.forEach((o) => {
      const name = o.waiterName || (o.source === 'qr' ? 'QR Self-Order' : 'Staff');
      const cur = map.get(name) || { name, orders: 0, bills: 0, revenue: 0 };
      cur.orders += 1;
      map.set(name, cur);
    });
    paidBills.forEach((b) => {
      const name = b.cashierName || 'Cashier';
      const cur = map.get(name) || { name, orders: 0, bills: 0, revenue: 0 };
      cur.bills += 1;
      cur.revenue += b.totalAmount || 0;
      map.set(name, cur);
    });
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders)
      .slice(0, 6);
  }, [filteredOrders, paidBills]);

  const handleSeedCatalog = async () => {
    setSeeding(true);
    try {
      await seedInitialHotelCatalog();
    } finally {
      setSeeding(false);
    }
  };

  const isEmptyDatabase = tables.length === 0 && menuItems.length === 0;

  return (
    <div className="space-y-6">
      {/* Empty Database Initial Catalog Banner */}
      {isEmptyDatabase && isAdmin && (
        <div className="bg-[#141518] text-white rounded-xl p-6 border border-[#D4AF37]/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#C59B27]/20 text-[#D4AF37] flex items-center justify-center shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold text-white">
                Initialize Hotel Rudraksh Inn Restaurant Catalog
              </h3>
              <p className="text-sm text-zinc-300 mt-1 max-w-2xl">
                Your Firestore database is freshly provisioned. Populate 10 dining tables, 5 menu
                categories, 14 Indian hospitality dishes with recipe links, 10 kitchen ingredients,
                suppliers, and Deoghar GST settings in one click.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={seeding}
            onClick={() => void handleSeedCatalog()}
            className="px-5 py-2.5 rounded-lg bg-[#C59B27] text-[#141518] font-semibold text-sm hover:bg-[#D4AF37] transition-colors shrink-0 cursor-pointer disabled:opacity-60"
          >
            {seeding ? 'Initializing Firestore...' : 'Initialize Catalog Now'}
          </button>
        </div>
      )}

      {/* Top Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-zinc-900">
            Executive Operations Overview
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Live Firestore telemetry · Hotel Rudraksh Inn, Deoghar
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-white border border-zinc-200 rounded-xl">
          {(
            [
              { id: 'today', label: 'Today' },
              { id: 'week', label: '7 Days' },
              { id: 'month', label: '30 Days' },
            ] as const
          ).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                range === r.id
                  ? 'bg-[#141518] text-[#D4AF37]'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs text-zinc-500 flex items-center justify-between">
            <span>{range === 'today' ? "Today's Sales" : 'Period Sales'}</span>
            <IndianRupee className="w-3.5 h-3.5 text-[#9A7415]" />
          </div>
          <div className="font-mono-tabular text-xl font-bold text-zinc-900 mt-2">
            {formatINRCompact(totalSales)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">{paidBills.length} settled bills</div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs text-zinc-500 flex items-center justify-between">
            <span>Total Orders</span>
            <ShoppingBag className="w-3.5 h-3.5 text-zinc-400" />
          </div>
          <div className="font-mono-tabular text-xl font-bold text-zinc-900 mt-2">
            {filteredOrders.length}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            {completedOrders.length} completed
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs text-zinc-500">Pending Kitchen</div>
          <div className="font-mono-tabular text-xl font-bold text-amber-700 mt-2">
            {pendingOrders.length}
          </div>
          <button
            type="button"
            onClick={() => onNavigate('kds')}
            className="text-[11px] font-semibold text-[#9A7415] mt-1 inline-flex items-center gap-0.5 hover:underline cursor-pointer"
          >
            Open KDS <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs text-zinc-500">Active Tables</div>
          <div className="font-mono-tabular text-xl font-bold text-zinc-900 mt-2">
            {occupiedTables.length} / {tables.length}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            {vacantTables.length} vacant now
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs text-zinc-500">Avg Order Value</div>
          <div className="font-mono-tabular text-xl font-bold text-zinc-900 mt-2">
            {formatINRCompact(aov)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">Per paid invoice</div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs text-zinc-500">Alerts</div>
          <div className="font-mono-tabular text-xl font-bold text-red-700 mt-2">
            {lowStockItems.length + pendingService.length}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            {lowStockItems.length} low stock · {pendingService.length} table calls
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                Daily Sales Trend — Last 7 Days (INR)
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Settled daily revenue across the past 7 calendar days
              </p>
            </div>
            <div className="flex items-center gap-5 text-xs">
              <div>
                <div className="text-zinc-500">7-Day Total</div>
                <div className="font-mono-tabular font-bold text-zinc-900">
                  {formatINRCompact(sevenDayTotal)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Daily Avg</div>
                <div className="font-mono-tabular font-bold text-[#9A7415]">
                  {formatINRCompact(sevenDayDailyAvg)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-semibold text-[#9A7415] hover:underline cursor-pointer whitespace-nowrap"
              >
                Full Reports
              </button>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sevenDayTrendData} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#71717A' }}
                  axisLine={{ stroke: '#E4E4E7' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#71717A' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) => (val >= 1000 ? `₹${Math.round(val / 1000)}k` : `₹${val}`)}
                />
                <Tooltip
                  formatter={(value, _name, item) => [
                    `${formatINR(Number(value) || 0)} (${item?.payload?.orders ?? 0} orders)`,
                    'Daily Revenue',
                  ]}
                  labelFormatter={(_label, payload) =>
                    payload?.[0]?.payload?.fullDate || String(_label)
                  }
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid #E4E4E7',
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="sales"
                  stroke="#9A7415"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#141518', stroke: '#C59B27', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: '#C59B27', stroke: '#141518', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Breakdown */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Payment Breakdown</h3>
            <p className="text-xs text-zinc-500 mb-4">Cash, UPI, Card & Room Folio</p>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={paymentBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" vertical={false} />
                  <XAxis dataKey="method" tick={{ fontSize: 11, fill: '#71717A' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#71717A' }} />
                  <Tooltip
                    formatter={(v) => [formatINRCompact(Number(v) || 0), 'Collected']}
                    contentStyle={{ borderRadius: 10, fontSize: 12 }}
                  />
                  <Bar dataKey="amount" fill="#141518" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-100 grid grid-cols-2 gap-2 text-xs">
            {paymentBreakdown.map((p) => (
              <div key={p.method} className="flex items-center justify-between">
                <span className="text-zinc-500">{p.method}</span>
                <span className="font-mono-tabular font-semibold text-zinc-900">
                  {formatINRCompact(p.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Operational Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Popular Dishes */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-zinc-900">Popular Dishes</h3>
            <Sparkles className="w-4 h-4 text-[#9A7415]" />
          </div>
          {popularItems.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">
              No dish sales recorded in this period yet.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {popularItems.map((item) => (
                <div key={item.name} className="py-2.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-800 truncate pr-2">{item.name}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono-tabular text-zinc-500">{item.qty} sold</span>
                    <span className="font-mono-tabular font-semibold text-zinc-900">
                      {formatINRCompact(item.revenue)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Staff Performance */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-zinc-900">Staff Activity</h3>
            <Users className="w-4 h-4 text-zinc-400" />
          </div>
          {staffPerformance.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">
              Staff orders and settlements will appear here.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {staffPerformance.map((st) => (
                <div key={st.name} className="py-2.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-800 truncate pr-2">{st.name}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono-tabular text-zinc-500">
                      {st.orders} ord · {st.bills} bill
                    </span>
                    <span className="font-mono-tabular font-semibold text-zinc-900">
                      {formatINRCompact(st.revenue)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Low Stock & Guest Experience Alerts */}
        <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900">Stock & Guest Rating</h3>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>

          {lowStockItems.length === 0 ? (
            <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 text-xs">
              All {inventory.length} kitchen ingredients are above minimum threshold.
            </div>
          ) : (
            <div className="space-y-2">
              {lowStockItems.slice(0, 4).map((it) => (
                <div
                  key={it.id}
                  className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between text-xs"
                >
                  <span className="font-medium text-amber-900">{it.name}</span>
                  <span className="font-mono-tabular font-semibold text-amber-800">
                    {it.quantity} {it.unit} left
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-zinc-100 flex items-center justify-between text-xs">
            <span className="text-zinc-500">
              Guest Feedback ({feedback.length} reviews)
            </span>
            <span className="font-mono-tabular font-semibold text-zinc-900">
              {feedback.length > 0
                ? `${(
                    feedback.reduce((s, f) => s + f.overallRating, 0) / feedback.length
                  ).toFixed(1)} / 5.0`
                : 'No ratings yet'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
