import React, { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import type { Bill, InventoryItem, Order } from '../types';
import { downloadCSV, formatDateTime, formatINR, toDate } from '../utils/format';

interface ReportsViewProps {
  orders: Order[];
  bills: Bill[];
  inventory: InventoryItem[];
}

type ReportTab =
  | 'sales'
  | 'items'
  | 'categories'
  | 'payments'
  | 'discounts_cancelled'
  | 'inventory'
  | 'staff';

export const ReportsView: React.FC<ReportsViewProps> = ({
  orders,
  bills,
  inventory,
}) => {
  const [tab, setTab] = useState<ReportTab>('sales');
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'custom'>('month');
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );

  const inRange = (ts: unknown) => {
    const d = toDate(ts);
    const now = new Date();
    if (period === 'today') {
      return d.toDateString() === now.toDateString();
    }
    if (period === 'week') {
      return (now.getTime() - d.getTime()) / 86400000 <= 7;
    }
    if (period === 'month') {
      return (now.getTime() - d.getTime()) / 86400000 <= 30;
    }
    const iso = d.toISOString().slice(0, 10);
    return iso >= startDate && iso <= endDate;
  };

  const rangeBills = useMemo(() => bills.filter((b) => inRange(b.createdAt)), [bills, period, startDate, endDate]);
  const rangeOrders = useMemo(() => orders.filter((o) => inRange(o.createdAt)), [orders, period, startDate, endDate]);

  const paidBills = rangeBills.filter((b) => b.paymentStatus === 'Paid');
  const totalRevenue = paidBills.reduce((s, b) => s + b.totalAmount, 0);
  const totalTax = paidBills.reduce((s, b) => s + b.taxAmount, 0);
  const totalDiscounts = paidBills.reduce((s, b) => s + b.discountAmount, 0);

  const itemSales = useMemo(() => {
    const map = new Map<string, { name: string; category: string; qty: number; revenue: number }>();
    rangeOrders
      .filter((o) => o.status !== 'Cancelled')
      .forEach((o) => {
        o.items.forEach((it) => {
          const cur = map.get(it.itemId) || {
            name: it.name,
            category: it.categoryName || 'General',
            qty: 0,
            revenue: 0,
          };
          cur.qty += it.qty;
          cur.revenue += it.price * it.qty;
          map.set(it.itemId, cur);
        });
      });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [rangeOrders]);

  const categorySales = useMemo(() => {
    const map = new Map<string, { category: string; qty: number; revenue: number }>();
    itemSales.forEach((it) => {
      const cur = map.get(it.category) || { category: it.category, qty: 0, revenue: 0 };
      cur.qty += it.qty;
      cur.revenue += it.revenue;
      map.set(it.category, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [itemSales]);

  const paymentSummary = useMemo(() => {
    const map: Record<string, { method: string; count: number; amount: number }> = {
      Cash: { method: 'Cash', count: 0, amount: 0 },
      UPI: { method: 'UPI', count: 0, amount: 0 },
      Card: { method: 'Card', count: 0, amount: 0 },
      'Room Folio': { method: 'Room Folio', count: 0, amount: 0 },
    };
    paidBills.forEach((b) => {
      if (b.paymentMethod === 'Split' && b.splitPayments) {
        b.splitPayments.forEach((sp) => {
          map[sp.method].count += 1;
          map[sp.method].amount += sp.amount;
        });
      } else {
        const k = b.paymentMethod in map ? b.paymentMethod : 'Cash';
        map[k].count += 1;
        map[k].amount += b.totalAmount;
      }
    });
    return Object.values(map);
  }, [paidBills]);

  const staffSummary = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; bills: number; billedTotal: number }>();
    rangeOrders.forEach((o) => {
      const name = o.waiterName || 'QR Self-Service';
      const cur = map.get(name) || { name, orders: 0, bills: 0, billedTotal: 0 };
      cur.orders += 1;
      map.set(name, cur);
    });
    paidBills.forEach((b) => {
      const name = b.cashierName || 'Cashier';
      const cur = map.get(name) || { name, orders: 0, bills: 0, billedTotal: 0 };
      cur.bills += 1;
      cur.billedTotal += b.totalAmount;
      map.set(name, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.billedTotal - a.billedTotal);
  }, [rangeOrders, paidBills]);

  const handleExportCSV = () => {
    if (tab === 'sales') {
      downloadCSV(
        'rudraksh-sales-report.csv',
        ['Invoice #', 'Date', 'Ref', 'Method', 'Subtotal', 'Discount', 'Tax', 'Total', 'Status'],
        rangeBills.map((b) => [
          b.invoiceNumber,
          formatDateTime(b.createdAt),
          b.tableNumber ? `Table ${b.tableNumber}` : b.roomNumber ? `Room ${b.roomNumber}` : 'Counter',
          b.paymentMethod,
          b.subtotal,
          b.discountAmount,
          b.taxAmount,
          b.totalAmount,
          b.paymentStatus,
        ])
      );
    } else if (tab === 'items') {
      downloadCSV(
        'rudraksh-item-sales.csv',
        ['Dish', 'Category', 'Quantity Sold', 'Revenue (INR)'],
        itemSales.map((i) => [i.name, i.category, i.qty, i.revenue])
      );
    } else if (tab === 'categories') {
      downloadCSV(
        'rudraksh-category-sales.csv',
        ['Category', 'Items Sold', 'Revenue (INR)'],
        categorySales.map((c) => [c.category, c.qty, c.revenue])
      );
    } else if (tab === 'payments') {
      downloadCSV(
        'rudraksh-payment-breakdown.csv',
        ['Payment Method', 'Transactions', 'Collected (INR)'],
        paymentSummary.map((p) => [p.method, p.count, p.amount])
      );
    } else if (tab === 'inventory') {
      downloadCSV(
        'rudraksh-inventory-valuation.csv',
        ['Ingredient', 'Quantity', 'Unit', 'Unit Cost', 'Stock Value (INR)'],
        inventory.map((i) => [i.name, i.quantity, i.unit, i.unitCost, i.quantity * i.unitCost])
      );
    } else if (tab === 'staff') {
      downloadCSV(
        'rudraksh-staff-activity.csv',
        ['Staff Member', 'Orders Taken', 'Bills Settled', 'Revenue Settled (INR)'],
        staffSummary.map((s) => [s.name, s.orders, s.bills, s.billedTotal])
      );
    } else {
      const cancelledOrders = rangeOrders.filter((o) => o.status === 'Cancelled');
      downloadCSV(
        'rudraksh-cancelled-orders.csv',
        ['Order #', 'Date', 'Ref', 'Subtotal'],
        cancelledOrders.map((o) => [
          o.orderNumber,
          formatDateTime(o.createdAt),
          o.tableNumber || o.roomNumber || 'POS',
          o.subtotal,
        ])
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h2 className="font-display text-2xl font-semibold text-zinc-900">
            Financial Reports & Analytics
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Printable management statements & CSV exports from live Firestore records
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as 'today' | 'week' | 'month' | 'custom')}
            className="px-3 py-2 rounded-lg border border-zinc-300 bg-white text-xs font-semibold"
          >
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="custom">Custom Date Range</option>
          </select>

          {period === 'custom' && (
            <>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-zinc-300 bg-white text-xs"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-zinc-300 bg-white text-xs"
              />
            </>
          )}

          <button
            type="button"
            onClick={handleExportCSV}
            className="px-3.5 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3.5 py-2 rounded-lg border border-zinc-300 bg-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
        </div>
      </div>

      {/* Report Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs text-zinc-500">Settled Sales</div>
          <div className="font-mono-tabular text-xl font-bold mt-1">{formatINR(totalRevenue)}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs text-zinc-500">Taxes Collected</div>
          <div className="font-mono-tabular text-xl font-bold mt-1">{formatINR(totalTax)}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs text-zinc-500">Discounts Granted</div>
          <div className="font-mono-tabular text-xl font-bold mt-1">{formatINR(totalDiscounts)}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl p-4">
          <div className="text-xs text-zinc-500">Cancelled Bills / Orders</div>
          <div className="font-mono-tabular text-xl font-bold mt-1">
            {rangeBills.filter((b) => b.paymentStatus === 'Cancelled').length} /{' '}
            {rangeOrders.filter((o) => o.status === 'Cancelled').length}
          </div>
        </div>
      </div>

      {/* Report Tabs */}
      <div className="flex flex-wrap gap-1.5 no-print">
        {(
          [
            { id: 'sales', label: 'Sales Ledger' },
            { id: 'items', label: 'Food Item Sales' },
            { id: 'categories', label: 'Category Sales' },
            { id: 'payments', label: 'Cash / UPI / Card' },
            { id: 'discounts_cancelled', label: 'Discounts & Cancellations' },
            { id: 'inventory', label: 'Inventory Valuation' },
            { id: 'staff', label: 'Staff Activity' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
              tab === t.id
                ? 'bg-[#141518] text-[#D4AF37] border-[#141518]'
                : 'bg-white text-zinc-700 border-zinc-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Report Content Table */}
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden print-area">
        <div className="overflow-x-auto">
          {tab === 'sales' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Invoice</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Method</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Subtotal</th>
                  <th className="px-4 py-3 font-semibold text-right">Tax</th>
                  <th className="px-4 py-3 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rangeBills.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 font-mono-tabular font-semibold">{b.invoiceNumber}</td>
                    <td className="px-4 py-3 font-mono-tabular">{formatDateTime(b.createdAt)}</td>
                    <td className="px-4 py-3">{b.paymentMethod}</td>
                    <td className="px-4 py-3 font-semibold">{b.paymentStatus}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular">{formatINR(b.subtotal)}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular">{formatINR(b.taxAmount)}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-bold">
                      {formatINR(b.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'items' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Dish Name</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold text-right">Qty Sold</th>
                  <th className="px-4 py-3 font-semibold text-right">Gross Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {itemSales.map((i) => (
                  <tr key={i.name}>
                    <td className="px-4 py-3 font-semibold">{i.name}</td>
                    <td className="px-4 py-3 text-zinc-600">{i.category}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular">{i.qty}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-bold">
                      {formatINR(i.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'categories' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold text-right">Units Sold</th>
                  <th className="px-4 py-3 font-semibold text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {categorySales.map((c) => (
                  <tr key={c.category}>
                    <td className="px-4 py-3 font-semibold">{c.category}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular">{c.qty}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-bold">
                      {formatINR(c.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'payments' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Payment Method</th>
                  <th className="px-4 py-3 font-semibold text-right">Transactions</th>
                  <th className="px-4 py-3 font-semibold text-right">Collected Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {paymentSummary.map((p) => (
                  <tr key={p.method}>
                    <td className="px-4 py-3 font-semibold">{p.method}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular">{p.count}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-bold">
                      {formatINR(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'discounts_cancelled' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Ref</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Reason / Details</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rangeBills
                  .filter((b) => b.discountAmount > 0 || b.paymentStatus === 'Cancelled')
                  .map((b) => (
                    <tr key={b.id}>
                      <td className="px-4 py-3 font-mono-tabular font-semibold">
                        {b.invoiceNumber}
                      </td>
                      <td className="px-4 py-3">
                        {b.paymentStatus === 'Cancelled' ? 'Cancelled Bill' : 'Discount'}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {b.cancelReason || `${b.discountType} discount`}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-tabular font-bold">
                        {formatINR(
                          b.paymentStatus === 'Cancelled' ? b.totalAmount : b.discountAmount
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          {tab === 'inventory' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Ingredient</th>
                  <th className="px-4 py-3 font-semibold text-right">Stock</th>
                  <th className="px-4 py-3 font-semibold text-right">Unit Cost</th>
                  <th className="px-4 py-3 font-semibold text-right">Stock Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {inventory.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-3 font-semibold">{i.name}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular">
                      {i.quantity} {i.unit}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular">
                      {formatINR(i.unitCost)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-bold">
                      {formatINR(i.quantity * i.unitCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'staff' && (
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Staff Member</th>
                  <th className="px-4 py-3 font-semibold text-right">Orders Handled</th>
                  <th className="px-4 py-3 font-semibold text-right">Bills Settled</th>
                  <th className="px-4 py-3 font-semibold text-right">Revenue Settled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {staffSummary.map((s) => (
                  <tr key={s.name}>
                    <td className="px-4 py-3 font-semibold">{s.name}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular">{s.orders}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular">{s.bills}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-bold">
                      {formatINR(s.billedTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
