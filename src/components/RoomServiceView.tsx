import React, { useMemo, useState } from 'react';
import {
  BedDouble,
  CheckCircle2,
  Minus,
  Plus,
  Receipt,
  Send,
} from 'lucide-react';
import {
  createAndSettleBill,
  createRoomFolio,
  placeStaffOrder,
  settleRoomFolio,
} from '../services/firestoreService';
import type {
  Bill,
  HotelSettings,
  MenuItem,
  Order,
  OrderItem,
  PaymentMethod,
  RoomFolio,
  StaffProfile,
} from '../types';
import { calculateBillTotals, formatDateTime, formatINR } from '../utils/format';
import { InvoiceModal } from './InvoiceModal';

interface RoomServiceViewProps {
  currentUser: StaffProfile;
  folios: RoomFolio[];
  orders: Order[];
  menuItems: MenuItem[];
  settings: HotelSettings;
}

export const RoomServiceView: React.FC<RoomServiceViewProps> = ({
  currentUser,
  folios,
  orders,
  menuItems,
  settings,
}) => {
  const [roomNumber, setRoomNumber] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [checkInRef, setCheckInRef] = useState('');
  const [selectedFolioId, setSelectedFolioId] = useState<string>('');
  const [items, setItems] = useState<OrderItem[]>([]);
  const [notes, setNotes] = useState('');
  const [postingMode, setPostingMode] = useState<'folio' | 'cash_now'>('folio');
  const [submitting, setSubmitting] = useState(false);
  const [checkoutFolio, setCheckoutFolio] = useState<RoomFolio | null>(null);
  const [checkoutMethod, setCheckoutMethod] = useState<PaymentMethod>('Cash');
  const [invoiceBill, setInvoiceBill] = useState<Bill | null>(null);

  const activeFolios = useMemo(
    () => folios.filter((f) => f.status === 'Active'),
    [folios]
  );

  const roomOrders = useMemo(
    () => orders.filter((o) => o.source === 'room_service'),
    [orders]
  );

  const adjustItem = (dish: MenuItem, delta: number) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.itemId === dish.id);
      if (idx === -1 && delta > 0) {
        return [
          ...prev,
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
      if (idx >= 0) {
        const nextQty = prev[idx].qty + delta;
        if (nextQty <= 0) return prev.filter((i) => i.itemId !== dish.id);
        return prev.map((it, i) => (i === idx ? { ...it, qty: nextQty } : it));
      }
      return prev;
    });
  };

  const handleCreateFolio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomNumber.trim() || !guestName.trim()) return;
    setSubmitting(true);
    try {
      const id = await createRoomFolio({
        roomNumber,
        guestName,
        guestPhone,
        checkInRef,
      });
      setSelectedFolioId(id);
      setRoomNumber('');
      setGuestName('');
      setGuestPhone('');
      setCheckInRef('');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePlaceRoomOrder = async () => {
    const folio = folios.find((f) => f.id === selectedFolioId);
    const targetRoom = folio?.roomNumber || roomNumber.trim();
    const targetGuest = folio?.guestName || guestName.trim() || 'Hotel Guest';
    if (!targetRoom || items.length === 0) return;

    setSubmitting(true);
    try {
      await placeStaffOrder({
        source: 'room_service',
        items,
        roomNumber: targetRoom,
        guestName: targetGuest,
        waiterId: currentUser.uid,
        waiterName: currentUser.displayName,
        specialInstructions: notes,
        folioId: postingMode === 'folio' && folio ? folio.id : undefined,
      });
      setItems([]);
      setNotes('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSettleFolioCheckout = async () => {
    if (!checkoutFolio) return;
    setSubmitting(true);
    try {
      const linkedOrders = roomOrders.filter((o) =>
        checkoutFolio.orderIds.includes(o.id)
      );
      const aggregatedItems: OrderItem[] = [];
      linkedOrders.forEach((o) => {
        o.items.forEach((it) => {
          const ex = aggregatedItems.find((a) => a.itemId === it.itemId);
          if (ex) ex.qty += it.qty;
          else aggregatedItems.push({ ...it });
        });
      });
      const fallbackItems =
        aggregatedItems.length > 0
          ? aggregatedItems
          : [
              {
                itemId: 'room_folio',
                name: `Room Service Charges (Room ${checkoutFolio.roomNumber})`,
                price: checkoutFolio.totalAmount,
                qty: 1,
                isVeg: true,
              },
            ];
      const totals = calculateBillTotals(fallbackItems, 'none', 0, settings.taxes);
      const bill = await createAndSettleBill({
        invoicePrefix: settings.invoicePrefix || 'RUD',
        roomNumber: checkoutFolio.roomNumber,
        guestName: checkoutFolio.guestName,
        source: 'room_service',
        items: fallbackItems,
        subtotal: totals.subtotal,
        discountType: 'none',
        discountValue: 0,
        discountAmount: 0,
        taxBreakdown: totals.taxBreakdown,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        paymentStatus: 'Paid',
        paymentMethod: checkoutMethod,
        cashierId: currentUser.uid,
        cashierName: currentUser.displayName,
      });
      await settleRoomFolio(checkoutFolio, totals.totalAmount);
      setCheckoutFolio(null);
      setInvoiceBill(bill);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold text-zinc-900">
          Room Service & Guest Folios
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Standalone hotel room dining with folio charge tracking & checkout settlement
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Open Guest Folio + Room Order Composer */}
        <div className="lg:col-span-7 space-y-5">
          <form
            onSubmit={(e) => void handleCreateFolio(e)}
            className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                <BedDouble className="w-4 h-4 text-[#9A7415]" />
                Register Guest Room Folio
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <input
                required
                maxLength={20}
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                placeholder="Room No (e.g. 204)"
                className="px-3 py-2 rounded-lg border border-zinc-300 text-xs"
              />
              <input
                required
                maxLength={80}
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Guest Full Name"
                className="px-3 py-2 rounded-lg border border-zinc-300 text-xs"
              />
              <input
                maxLength={20}
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="Phone (optional)"
                className="px-3 py-2 rounded-lg border border-zinc-300 text-xs"
              />
              <input
                maxLength={40}
                value={checkInRef}
                onChange={(e) => setCheckInRef(e.target.value)}
                placeholder="Check-in Ref #"
                className="px-3 py-2 rounded-lg border border-zinc-300 text-xs"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
            >
              Open Room Folio
            </button>
          </form>

          {/* Take Room Service Order */}
          <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-zinc-900">
              Send Room Service Order to Kitchen
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                value={selectedFolioId}
                onChange={(e) => setSelectedFolioId(e.target.value)}
                className="px-3 py-2 rounded-lg border border-zinc-300 text-xs font-semibold bg-zinc-50"
              >
                <option value="">Select Active Room Folio...</option>
                {activeFolios.map((f) => (
                  <option key={f.id} value={f.id}>
                    Room {f.roomNumber} — {f.guestName} ({formatINR(f.totalAmount)})
                  </option>
                ))}
              </select>

              <select
                value={postingMode}
                onChange={(e) => setPostingMode(e.target.value as 'folio' | 'cash_now')}
                className="px-3 py-2 rounded-lg border border-zinc-300 text-xs bg-zinc-50"
              >
                <option value="folio">Post to Guest Room Folio (Pay at Checkout)</option>
                <option value="cash_now">Bill Immediately via POS</option>
              </select>
            </div>

            <div className="divide-y divide-zinc-100 max-h-60 overflow-y-auto border border-zinc-200 rounded-lg px-3">
              {menuItems
                .filter((m) => m.available)
                .map((dish) => {
                  const qty = items.find((i) => i.itemId === dish.id)?.qty || 0;
                  return (
                    <div key={dish.id} className="py-2 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-semibold text-zinc-900">{dish.name}</span>{' '}
                        <span className="font-mono-tabular text-zinc-500">
                          ({formatINR(dish.price)})
                        </span>
                      </div>
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => adjustItem(dish, -1)}
                          className="p-1 rounded border border-zinc-200 cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-mono-tabular w-4 text-center font-semibold">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => adjustItem(dish, 1)}
                          className="p-1 rounded border border-zinc-200 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>

            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Room delivery notes (cutlery for 2, knock gently...)"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-xs"
            />

            <button
              type="button"
              disabled={submitting || items.length === 0 || (!selectedFolioId && !roomNumber)}
              onClick={() => void handlePlaceRoomOrder()}
              className="w-full py-3 rounded-xl bg-[#141518] text-[#D4AF37] text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              Dispatch Room Service KOT (
              {formatINR(items.reduce((s, i) => s + i.price * i.qty, 0))})
            </button>
          </div>
        </div>

        {/* Right: Active Room Folios & Recent Room Orders */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-zinc-900">
              Active Guest Folios ({activeFolios.length})
            </h3>
            {activeFolios.length === 0 ? (
              <p className="text-xs text-zinc-500 py-4 text-center">
                No open room folios. Register a checked-in room on the left.
              </p>
            ) : (
              <div className="space-y-3">
                {activeFolios.map((f) => (
                  <div
                    key={f.id}
                    className="p-3.5 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm font-bold text-zinc-900">
                        Room {f.roomNumber} · {f.guestName}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {f.orderIds.length} orders · Opened {formatDateTime(f.createdAt)}
                      </div>
                    </div>
                    <div className="text-right space-y-1.5">
                      <div className="font-mono-tabular text-sm font-bold text-[#9A7415]">
                        {formatINR(f.totalAmount)}
                      </div>
                      <button
                        type="button"
                        onClick={() => setCheckoutFolio(f)}
                        className="px-3 py-1 rounded-lg bg-[#141518] text-[#D4AF37] text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Receipt className="w-3 h-3" />
                        Settle Checkout
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-zinc-900">Recent Room Service Orders</h3>
            {roomOrders.length === 0 ? (
              <p className="text-xs text-zinc-500 py-4 text-center">
                No room service orders yet.
              </p>
            ) : (
              <div className="divide-y divide-zinc-100 max-h-72 overflow-y-auto">
                {roomOrders.slice(0, 12).map((o) => (
                  <div key={o.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-zinc-900">
                        Room {o.roomNumber} · <span className="font-mono-tabular">{o.orderNumber}</span>
                      </div>
                      <div className="text-zinc-500">
                        {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono-tabular font-semibold">{formatINR(o.subtotal)}</div>
                      <div className="text-[11px] font-semibold text-[#9A7415]">{o.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Folio Checkout Settlement Modal */}
      {checkoutFolio && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-xl p-5 space-y-4">
            <h3 className="text-base font-bold">
              Checkout Room {checkoutFolio.roomNumber} ({checkoutFolio.guestName})
            </h3>
            <div className="text-xs text-zinc-600">
              Subtotal accrued: <strong className="font-mono-tabular">{formatINR(checkoutFolio.totalAmount)}</strong> (configured taxes added on invoice).
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['Cash', 'UPI', 'Card'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCheckoutMethod(m)}
                  className={`py-2 rounded-lg text-xs font-semibold border cursor-pointer ${
                    checkoutMethod === m
                      ? 'bg-[#141518] text-[#D4AF37] border-[#141518]'
                      : 'bg-white text-zinc-700 border-zinc-200'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCheckoutFolio(null)}
                className="px-4 py-2 rounded-lg border border-zinc-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSettleFolioCheckout()}
                className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Settle & Generate Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      <InvoiceModal
        bill={invoiceBill}
        settings={settings}
        onClose={() => setInvoiceBill(null)}
      />
    </div>
  );
};
