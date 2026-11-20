import React, { useMemo, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  Ban,
  CheckCircle2,
  CreditCard,
  Minus,
  Plus,
  Printer,
  Receipt,
  Trash2,
} from 'lucide-react';
import {
  cancelBillAuthorized,
  createAndSettleBill,
  settleExistingBill,
} from '../services/firestoreService';
import type {
  Bill,
  HotelSettings,
  MenuItem,
  Order,
  OrderItem,
  PaymentMethod,
  RestaurantTable,
  SplitPayment,
  StaffProfile,
} from '../types';
import { calculateBillTotals, formatDateTime, formatINR } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';
import { InvoiceModal } from './InvoiceModal';

interface PosBillingProps {
  currentUser: StaffProfile;
  orders: Order[];
  bills: Bill[];
  tables: RestaurantTable[];
  menuItems: MenuItem[];
  settings: HotelSettings;
}

export const PosBilling: React.FC<PosBillingProps> = ({
  currentUser,
  orders,
  bills,
  tables,
  menuItems,
  settings,
}) => {
  const [viewTab, setViewTab] = useState<'terminal' | 'history'>('terminal');
  const [selectedOrderId, setSelectedOrderId] = useState<string>('manual');
  const [manualItems, setManualItems] = useState<OrderItem[]>([]);
  const [guestName, setGuestName] = useState('');
  const [discountType, setDiscountType] = useState<'none' | 'flat' | 'percent'>('none');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [paymentStatus, setPaymentStatus] = useState<'Paid' | 'Unpaid'>('Paid');

  // Split payment amounts
  const [splitCash, setSplitCash] = useState<number>(0);
  const [splitUpi, setSplitUpi] = useState<number>(0);
  const [splitCard, setSplitCard] = useState<number>(0);

  const [activeInvoice, setActiveInvoice] = useState<Bill | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Bill | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const unbilledOrders = useMemo(
    () => orders.filter((o) => !o.billed && o.status !== 'Cancelled'),
    [orders]
  );

  const selectedOrder = useMemo(
    () => unbilledOrders.find((o) => o.id === selectedOrderId) || null,
    [unbilledOrders, selectedOrderId]
  );

  // Sync order items into working bill items when order is selected
  const [editedOrderItems, setEditedOrderItems] = useState<OrderItem[] | null>(null);

  const workingItems: OrderItem[] = useMemo(() => {
    if (selectedOrder) {
      return editedOrderItems ?? selectedOrder.items;
    }
    return manualItems;
  }, [selectedOrder, editedOrderItems, manualItems]);

  const totals = useMemo(
    () => calculateBillTotals(workingItems, discountType, discountValue, settings.taxes),
    [workingItems, discountType, discountValue, settings.taxes]
  );

  const updateWorkingQty = (itemId: string, delta: number) => {
    const base = [...workingItems];
    const idx = base.findIndex((i) => i.itemId === itemId);
    if (idx === -1) return;
    const nextQty = base[idx].qty + delta;
    const updated =
      nextQty <= 0
        ? base.filter((i) => i.itemId !== itemId)
        : base.map((it, i) => (i === idx ? { ...it, qty: nextQty } : it));
    if (selectedOrder) {
      setEditedOrderItems(updated);
    } else {
      setManualItems(updated);
    }
  };

  const addDishToBill = (dish: MenuItem) => {
    const base = [...workingItems];
    const idx = base.findIndex((i) => i.itemId === dish.id);
    let updated: OrderItem[];
    if (idx >= 0) {
      updated = base.map((it, i) => (i === idx ? { ...it, qty: it.qty + 1 } : it));
    } else {
      updated = [
        ...base,
        {
          itemId: dish.id,
          name: dish.name,
          price: dish.price,
          qty: 1,
          isVeg: dish.isVeg,
          categoryName: dish.categoryName,
        },
      ];
    }
    if (selectedOrder) {
      setEditedOrderItems(updated);
    } else {
      setManualItems(updated);
    }
  };

  const canCancelBills =
    currentUser.role === 'super_admin' || currentUser.role === 'manager';

  const handleGenerateBill = async () => {
    if (workingItems.length === 0) return;

    const splitPayments: SplitPayment[] = [];
    if (paymentMethod === 'Split') {
      if (splitCash > 0) splitPayments.push({ method: 'Cash', amount: splitCash });
      if (splitUpi > 0) splitPayments.push({ method: 'UPI', amount: splitUpi });
      if (splitCard > 0) splitPayments.push({ method: 'Card', amount: splitCard });
    }

    setProcessing(true);
    try {
      const bill = await createAndSettleBill({
        invoicePrefix: settings.invoicePrefix || 'RUD',
        order: selectedOrder || undefined,
        tableId: selectedOrder?.tableId,
        tableNumber: selectedOrder?.tableNumber,
        roomNumber: selectedOrder?.roomNumber,
        guestName: guestName || selectedOrder?.guestName || 'Walk-in Guest',
        source: selectedOrder?.source || 'pos',
        items: workingItems,
        subtotal: totals.subtotal,
        discountType,
        discountValue,
        discountAmount: totals.discountAmount,
        taxBreakdown: totals.taxBreakdown,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        paymentStatus,
        paymentMethod: paymentStatus === 'Unpaid' ? 'Pending' : paymentMethod,
        splitPayments,
        cashierId: currentUser.uid,
        cashierName: currentUser.displayName,
      });
      setActiveInvoice(bill);
      setSelectedOrderId('manual');
      setEditedOrderItems(null);
      setManualItems([]);
      setGuestName('');
      setDiscountType('none');
      setDiscountValue(0);
    } finally {
      setProcessing(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget || !cancelReason.trim()) return;
    setProcessing(true);
    try {
      await cancelBillAuthorized(cancelTarget, cancelReason, currentUser.displayName);
      setCancelTarget(null);
      setCancelReason('');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-zinc-900">
            POS Billing & GST Invoicing
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Configurable tax calculation, Cash/UPI/Card & Split settlements
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-white border border-zinc-200 rounded-xl">
          <button
            type="button"
            onClick={() => setViewTab('terminal')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              viewTab === 'terminal' ? 'bg-[#141518] text-[#D4AF37]' : 'text-zinc-600'
            }`}
          >
            POS Terminal ({unbilledOrders.length} open)
          </button>
          <button
            type="button"
            onClick={() => setViewTab('history')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              viewTab === 'history' ? 'bg-[#141518] text-[#D4AF37]' : 'text-zinc-600'
            }`}
          >
            Billing History ({bills.length})
          </button>
        </div>
      </div>

      {viewTab === 'terminal' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Select Unbilled Order + Add Dishes */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                1. Load Active Table / Room Order or Create Counter Bill
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOrderId('manual');
                    setEditedOrderItems(null);
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                    selectedOrderId === 'manual'
                      ? 'bg-[#141518] text-[#D4AF37] border-[#141518]'
                      : 'bg-zinc-50 text-zinc-700 border-zinc-200'
                  }`}
                >
                  + New Counter / Manual Bill
                </button>
                {unbilledOrders.map((ord) => {
                  const tbl = tables.find((t) => t.id === ord.tableId);
                  return (
                    <button
                      key={ord.id}
                      type="button"
                      onClick={() => {
                        setSelectedOrderId(ord.id);
                        setEditedOrderItems(null);
                      }}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                        selectedOrderId === ord.id
                          ? 'bg-[#141518] text-[#D4AF37] border-[#141518]'
                          : 'bg-white text-zinc-800 border-zinc-200 hover:border-zinc-300'
                      }`}
                    >
                      {ord.tableNumber
                        ? `Table ${ord.tableNumber}`
                        : ord.roomNumber
                        ? `Room ${ord.roomNumber}`
                        : ord.orderNumber}{' '}
                      · <span className="font-mono-tabular">{formatINR(ord.subtotal)}</span>
                      {tbl?.status === 'Billing' ? ' (Bill Req)' : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Dish Picker */}
            <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                2. Add / Modify Items on Bill
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[380px] overflow-y-auto">
                {menuItems
                  .filter((m) => m.available)
                  .map((dish) => (
                    <button
                      key={dish.id}
                      type="button"
                      onClick={() => addDishToBill(dish)}
                      className="p-3 rounded-lg border border-zinc-200 hover:border-[#C59B27] text-left flex items-center justify-between gap-2 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-900 truncate">
                          {dish.name}
                        </div>
                        <div className="text-[11px] text-zinc-500">{dish.categoryName}</div>
                      </div>
                      <span className="font-mono-tabular text-xs font-bold text-[#9A7415] shrink-0">
                        {formatINR(dish.price)}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {/* Right: Live Bill Calculator & Settlement */}
          <div className="lg:col-span-5 bg-white border border-zinc-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-zinc-900">
                  {selectedOrder
                    ? `Invoice for ${selectedOrder.orderNumber}`
                    : 'Counter / Takeaway Invoice'}
                </h3>
                <p className="text-xs text-zinc-500">
                  Cashier: {currentUser.displayName}
                </p>
              </div>
              <Receipt className="w-5 h-5 text-[#9A7415]" />
            </div>

            <input
              type="text"
              maxLength={80}
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder={selectedOrder?.guestName || 'Guest / Customer Name'}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm"
            />

            {/* Working Line Items */}
            <div className="divide-y divide-zinc-100 max-h-52 overflow-y-auto">
              {workingItems.length === 0 ? (
                <p className="text-xs text-zinc-400 py-6 text-center">
                  Select an order or add dishes to generate a bill.
                </p>
              ) : (
                workingItems.map((it) => (
                  <div key={it.itemId} className="py-2 flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-zinc-900 truncate flex-1">{it.name}</span>
                    <div className="inline-flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateWorkingQty(it.itemId, -1)}
                        className="p-1 rounded border border-zinc-200 hover:bg-zinc-100 cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="font-mono-tabular font-semibold w-5 text-center">
                        {it.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateWorkingQty(it.itemId, 1)}
                        className="p-1 rounded border border-zinc-200 hover:bg-zinc-100 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="font-mono-tabular font-semibold w-20 text-right">
                      {formatINR(it.price * it.qty)}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Discount Control */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-100">
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'none' | 'flat' | 'percent')}
                className="px-2.5 py-2 rounded-lg border border-zinc-300 text-xs"
              >
                <option value="none">No Discount</option>
                <option value="percent">% Discount</option>
                <option value="flat">Flat INR (₹)</option>
              </select>
              <input
                type="number"
                min={0}
                disabled={discountType === 'none'}
                value={discountValue}
                onChange={(e) => setDiscountValue(Math.max(0, Number(e.target.value) || 0))}
                className="col-span-2 px-3 py-2 rounded-lg border border-zinc-300 text-xs disabled:bg-zinc-100 font-mono-tabular"
                placeholder="Discount value"
              />
            </div>

            {/* Tax & Total Summary */}
            <div className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 space-y-1.5 text-xs">
              <div className="flex justify-between text-zinc-600">
                <span>Subtotal</span>
                <span className="font-mono-tabular">{formatINR(totals.subtotal)}</span>
              </div>
              {totals.discountAmount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discount</span>
                  <span className="font-mono-tabular">-{formatINR(totals.discountAmount)}</span>
                </div>
              )}
              {totals.taxBreakdown.map((t) => (
                <div key={t.name} className="flex justify-between text-zinc-600">
                  <span>
                    {t.name} ({t.rate}%)
                  </span>
                  <span className="font-mono-tabular">{formatINR(t.amount)}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-zinc-300 flex justify-between text-base font-bold text-zinc-900">
                <span>Payable Total</span>
                <span className="font-mono-tabular">{formatINR(totals.totalAmount)}</span>
              </div>
            </div>

            {/* Payment Status & Method */}
            <div className="space-y-3">
              <div className="flex gap-2">
                {(['Paid', 'Unpaid'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setPaymentStatus(st)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                      paymentStatus === st
                        ? 'bg-[#141518] text-[#D4AF37] border-[#141518]'
                        : 'bg-white text-zinc-700 border-zinc-200'
                    }`}
                  >
                    {st === 'Paid' ? 'Settle Now (Paid)' : 'Save as Unpaid Bill'}
                  </button>
                ))}
              </div>

              {paymentStatus === 'Paid' && (
                <>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(['Cash', 'UPI', 'Card', 'Split'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(m);
                          if (m === 'Split') {
                            const half = Math.round((totals.totalAmount / 2) * 100) / 100;
                            setSplitCash(half);
                            setSplitUpi(Math.round((totals.totalAmount - half) * 100) / 100);
                            setSplitCard(0);
                          }
                        }}
                        className={`py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                          paymentMethod === m
                            ? 'bg-[#C59B27] text-[#141518] border-[#C59B27]'
                            : 'bg-white text-zinc-700 border-zinc-200'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  {paymentMethod === 'UPI' && settings.upiId && totals.totalAmount > 0 && (
                    <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center gap-3">
                      <QRCodeCanvas
                        value={`upi://pay?pa=${encodeURIComponent(
                          settings.upiId
                        )}&pn=${encodeURIComponent(settings.hotelName)}&am=${totals.totalAmount.toFixed(
                          2
                        )}&cu=INR`}
                        size={64}
                      />
                      <div className="text-xs">
                        <div className="font-semibold text-zinc-900">UPI Dynamic QR</div>
                        <div className="font-mono-tabular text-zinc-600">{settings.upiId}</div>
                        <div className="font-mono-tabular font-bold text-[#9A7415]">
                          {formatINR(totals.totalAmount)}
                        </div>
                      </div>
                    </div>
                  )}

                  {paymentMethod === 'Split' && (
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <label className="block text-zinc-500 mb-1">Cash (₹)</label>
                        <input
                          type="number"
                          min={0}
                          value={splitCash}
                          onChange={(e) => setSplitCash(Number(e.target.value) || 0)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 font-mono-tabular"
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-500 mb-1">UPI (₹)</label>
                        <input
                          type="number"
                          min={0}
                          value={splitUpi}
                          onChange={(e) => setSplitUpi(Number(e.target.value) || 0)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 font-mono-tabular"
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-500 mb-1">Card (₹)</label>
                        <input
                          type="number"
                          min={0}
                          value={splitCard}
                          onChange={(e) => setSplitCard(Number(e.target.value) || 0)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 font-mono-tabular"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <button
              type="button"
              disabled={processing || workingItems.length === 0}
              onClick={() => void handleGenerateBill()}
              className="w-full py-3.5 rounded-xl bg-[#141518] text-[#D4AF37] font-semibold text-sm inline-flex items-center justify-center gap-2 hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
            >
              <CreditCard className="w-4 h-4" />
              {processing
                ? 'Generating Invoice...'
                : paymentStatus === 'Paid'
                ? 'Settle & Print GST Invoice'
                : 'Generate Unpaid Bill'}
            </button>
          </div>
        </div>
      ) : (
        /* Billing History Table */
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Invoice #</th>
                  <th className="px-4 py-3 font-semibold">Date & Time</th>
                  <th className="px-4 py-3 font-semibold">Service Ref</th>
                  <th className="px-4 py-3 font-semibold">Method</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Total</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {bills.map((b) => (
                  <tr key={b.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono-tabular font-semibold">
                      {b.invoiceNumber}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-zinc-500">
                      {formatDateTime(b.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {b.tableNumber
                        ? `Table ${b.tableNumber}`
                        : b.roomNumber
                        ? `Room ${b.roomNumber}`
                        : 'Counter'}{' '}
                      · {b.guestName || 'Guest'}
                    </td>
                    <td className="px-4 py-3">{b.paymentMethod}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-semibold ${
                          b.paymentStatus === 'Paid'
                            ? 'text-emerald-700'
                            : b.paymentStatus === 'Cancelled'
                            ? 'text-red-600'
                            : 'text-amber-700'
                        }`}
                      >
                        {b.paymentStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-bold">
                      {formatINR(b.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                      {b.paymentStatus === 'Unpaid' && (
                        <button
                          type="button"
                          onClick={() =>
                            void settleExistingBill({ bill: b, paymentMethod: 'Cash' })
                          }
                          className="px-2.5 py-1 rounded bg-emerald-700 text-white font-semibold cursor-pointer inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Mark Paid
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setActiveInvoice(b)}
                        className="px-2.5 py-1 rounded border border-zinc-300 text-zinc-700 font-semibold cursor-pointer inline-flex items-center gap-1"
                      >
                        <Printer className="w-3 h-3" />
                        Invoice
                      </button>
                      {canCancelBills && b.paymentStatus !== 'Cancelled' && (
                        <button
                          type="button"
                          onClick={() => setCancelTarget(b)}
                          className="px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer inline-flex items-center gap-1"
                          title="Cancel Bill (Authorized)"
                        >
                          <Ban className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <InvoiceModal
        bill={activeInvoice}
        settings={settings}
        onClose={() => setActiveInvoice(null)}
      />

      {/* Authorized Bill Cancel Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-base font-bold">
                Cancel Invoice {cancelTarget.invoiceNumber}
              </h3>
            </div>
            <p className="text-xs text-zinc-600">
              Manager/Admin authorization required. Enter an audit reason for cancelling this
              invoice ({formatINR(cancelTarget.totalAmount)}).
            </p>
            <input
              type="text"
              required
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Duplicate entry or guest order modification"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCancelTarget(null);
                  setCancelReason('');
                }}
                className="px-4 py-2 rounded-lg border border-zinc-300 text-xs font-semibold cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!cancelReason.trim() || processing}
                onClick={() => void handleConfirmCancel()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                Authorize Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
