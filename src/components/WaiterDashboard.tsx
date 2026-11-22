import React, { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  BellRing,
  Check,
  GitMerge,
  History,
  Minus,
  Plus,
  Receipt,
  Search,
  Send,
  Utensils,
} from 'lucide-react';
import {
  addItemsToExistingOrder,
  approveTableTransferRequest,
  mergeTableOrders,
  placeStaffOrder,
  resolveServiceRequest,
  transferTableOrder,
  updateOrderStatusAndInventory,
  updateTableStatus,
} from '../services/firestoreService';
import type {
  DietaryTag,
  InventoryItem,
  MenuItem,
  Order,
  OrderItem,
  RestaurantTable,
  ServiceRequest,
  StaffProfile,
} from '../types';
import { formatINR, formatTime } from '../utils/format';
import { DietaryPreferenceField } from './DietaryPreferenceField';

interface WaiterDashboardProps {
  currentUser: StaffProfile;
  tables: RestaurantTable[];
  orders: Order[];
  menuItems: MenuItem[];
  inventory: InventoryItem[];
  serviceRequests: ServiceRequest[];
}

export const WaiterDashboard: React.FC<WaiterDashboardProps> = ({
  currentUser,
  tables,
  orders,
  menuItems,
  inventory,
  serviceRequests,
}) => {
  const [tab, setTab] = useState<'tables' | 'new_order' | 'history'>('tables');
  const [filterScope, setFilterScope] = useState<'all' | 'mine'>('all');

  // Order composer state
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [guestName, setGuestName] = useState('');
  const [dietaryTags, setDietaryTags] = useState<DietaryTag[]>([]);
  const [instructions, setInstructions] = useState('');
  const [searchMenu, setSearchMenu] = useState('');
  const [draftItems, setDraftItems] = useState<OrderItem[]>([]);
  const [existingOrderToAppend, setExistingOrderToAppend] = useState<Order | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  // Transfer / Merge modal state
  const [transferSource, setTransferSource] = useState<RestaurantTable | null>(null);
  const [transferTargetId, setTransferTargetId] = useState<string>('');
  const [mergeSource, setMergeSource] = useState<RestaurantTable | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>('');
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const notify = (msg: string) => {
    setFeedbackBanner(msg);
    setTimeout(() => setFeedbackBanner(null), 3500);
  };

  const pendingCalls = useMemo(
    () => serviceRequests.filter((r) => r.status === 'Pending'),
    [serviceRequests]
  );

  const visibleTables = useMemo(() => {
    if (filterScope === 'mine') {
      const assigned = tables.filter((t) => t.assignedWaiterId === currentUser.uid);
      return assigned.length > 0 ? assigned : tables;
    }
    return tables;
  }, [tables, filterScope, currentUser.uid]);

  const activeQrOrders = useMemo(
    () => orders.filter((o) => o.source === 'qr' && o.status === 'New'),
    [orders]
  );

  const readyOrders = useMemo(
    () => orders.filter((o) => o.status === 'Ready'),
    [orders]
  );

  const filteredMenu = useMemo(() => {
    const q = searchMenu.trim().toLowerCase();
    return menuItems.filter(
      (m) =>
        m.available &&
        m.isVeg !== false &&
        (!q || m.name.toLowerCase().includes(q) || m.categoryName.toLowerCase().includes(q))
    );
  }, [menuItems, searchMenu]);

  const adjustDraftQty = (dish: MenuItem, delta: number) => {
    setDraftItems((prev) => {
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
        const clone = [...prev];
        clone[idx] = { ...clone[idx], qty: nextQty };
        return clone;
      }
      return prev;
    });
  };

  const handleSendOrder = async () => {
    const table = tables.find((t) => t.id === selectedTableId);
    if (!table || draftItems.length === 0) return;
    setSubmitting(true);
    try {
      if (existingOrderToAppend) {
        await addItemsToExistingOrder(
          existingOrderToAppend,
          draftItems,
          instructions,
          dietaryTags
        );
        notify(`Added ${draftItems.length} dish(es) to ${existingOrderToAppend.orderNumber}.`);
      } else {
        await placeStaffOrder({
          source: 'waiter',
          table,
          items: draftItems,
          guestName: guestName || 'Dine-in Guest',
          waiterId: currentUser.uid,
          waiterName: currentUser.displayName,
          dietaryTags,
          specialInstructions: instructions,
        });
        notify(`Order sent to kitchen for Table ${table.tableNumber}.`);
      }
      setDraftItems([]);
      setDietaryTags([]);
      setInstructions('');
      setGuestName('');
      setExistingOrderToAppend(null);
      setTab('tables');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransfer = async () => {
    if (!transferSource || !transferTargetId) return;
    const target = tables.find((t) => t.id === transferTargetId);
    const ord = orders.find((o) => o.id === transferSource.currentOrderId);
    if (!target || !ord) return;
    await transferTableOrder(transferSource, target, ord);
    notify(`Transferred ${ord.orderNumber} from Table ${transferSource.tableNumber} to ${target.tableNumber}.`);
    setTransferSource(null);
    setTransferTargetId('');
  };

  const handleMerge = async () => {
    if (!mergeSource || !mergeTargetId) return;
    const primary = tables.find((t) => t.id === mergeTargetId);
    const primaryOrd = orders.find((o) => o.id === primary?.currentOrderId);
    const secondaryOrd = orders.find((o) => o.id === mergeSource.currentOrderId);
    if (!primary || !primaryOrd || !secondaryOrd) return;
    await mergeTableOrders(primary, primaryOrd, mergeSource, secondaryOrd);
    notify(`Merged Table ${mergeSource.tableNumber} into Table ${primary.tableNumber}.`);
    setMergeSource(null);
    setMergeTargetId('');
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {feedbackBanner && (
        <div className="p-3.5 rounded-xl bg-[#141518] text-[#D4AF37] text-sm font-medium flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{feedbackBanner}</span>
        </div>
      )}

      {/* Header & Smartphone Segmented Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold text-zinc-900">
            Waiter Service Console
          </h2>
          <p className="text-xs text-zinc-500">
            Steward: {currentUser.displayName} · Live kitchen & QR order alerts
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-white border border-zinc-200 rounded-xl self-start">
          <button
            type="button"
            onClick={() => setTab('tables')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap ${
              tab === 'tables' ? 'bg-[#141518] text-[#D4AF37]' : 'text-zinc-600'
            }`}
          >
            Floor Tables
          </button>
          <button
            type="button"
            onClick={() => {
              setExistingOrderToAppend(null);
              if (!selectedTableId && tables[0]) setSelectedTableId(tables[0].id);
              setTab('new_order');
            }}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap ${
              tab === 'new_order' ? 'bg-[#141518] text-[#D4AF37]' : 'text-zinc-600'
            }`}
          >
            Take Order
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap inline-flex items-center gap-1 ${
              tab === 'history' ? 'bg-[#141518] text-[#D4AF37]' : 'text-zinc-600'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            History
          </button>
        </div>
      </div>

      {/* Live Alerts Strip (QR Orders + Ready Pickup + Waiter Calls) */}
      {(pendingCalls.length > 0 || activeQrOrders.length > 0 || readyOrders.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {pendingCalls.map((req) => {
            const isTransfer = req.type === 'table_transfer';
            return (
              <div
                key={req.id}
                className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {isTransfer ? (
                    <ArrowRightLeft className="w-5 h-5 text-amber-700 shrink-0" />
                  ) : (
                    <BellRing className="w-5 h-5 text-amber-700 shrink-0" />
                  )}
                  <div className="text-xs min-w-0">
                    <div className="font-bold text-amber-950">
                      {isTransfer
                        ? `Table Transfer · ${req.orderNumber || 'Order'} · Table ${req.tableNumber} → Table ${
                            req.targetTableNumber || '?'
                          }`
                        : `${req.type === 'call_waiter' ? 'Waiter Call' : 'Bill Requested'} · Table ${
                            req.tableNumber
                          }`}
                    </div>
                    <div className="text-amber-800 truncate">
                      {formatTime(req.createdAt)}
                      {req.note ? ` · ${req.note}` : ''}
                    </div>
                  </div>
                </div>
                {isTransfer ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={busyRequestId === req.id}
                      onClick={async () => {
                        setBusyRequestId(req.id);
                        try {
                          const moved = await approveTableTransferRequest(req, tables, orders);
                          notify(
                            moved
                              ? `Moved ${req.orderNumber || 'order'} from Table ${req.tableNumber} to Table ${
                                  req.targetTableNumber || ''
                                }.`
                              : 'Table transfer request acknowledged.'
                          );
                        } finally {
                          setBusyRequestId(null);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer whitespace-nowrap disabled:opacity-60"
                    >
                      {busyRequestId === req.id ? 'Moving...' : 'Approve & Move'}
                    </button>
                    <button
                      type="button"
                      disabled={busyRequestId === req.id}
                      onClick={() => void resolveServiceRequest(req)}
                      className="px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-950 text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void resolveServiceRequest(req)}
                    className="px-3 py-1.5 rounded-lg bg-amber-900 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Acknowledge
                  </button>
                )}
              </div>
            );
          })}

          {readyOrders.map((ord) => (
            <div
              key={ord.id}
              className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3"
            >
              <div className="text-xs">
                <div className="font-bold text-emerald-950">
                  Ready for Pickup · {ord.orderNumber} (
                  {ord.tableNumber ? `Table ${ord.tableNumber}` : `Room ${ord.roomNumber}`})
                </div>
                <div className="text-emerald-800">
                  {ord.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  void updateOrderStatusAndInventory({
                    order: ord,
                    newStatus: 'Served',
                    menuItems,
                    inventory,
                    performedBy: currentUser.displayName,
                  })
                }
                className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                Mark Served
              </button>
            </div>
          ))}
        </div>
      )}

      {/* TAB 1: Floor Tables */}
      {tab === 'tables' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterScope('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                filterScope === 'all'
                  ? 'bg-[#141518] text-[#D4AF37] border-[#141518]'
                  : 'bg-white text-zinc-700 border-zinc-200'
              }`}
            >
              All Tables ({tables.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterScope('mine')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                filterScope === 'mine'
                  ? 'bg-[#141518] text-[#D4AF37] border-[#141518]'
                  : 'bg-white text-zinc-700 border-zinc-200'
              }`}
            >
              My Assigned Tables
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleTables.map((table) => {
              const ord = orders.find((o) => o.id === table.currentOrderId);
              return (
                <div
                  key={table.id}
                  className="bg-white border border-zinc-200 rounded-xl p-4 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500">{table.section}</span>
                      <span className="text-xs font-bold text-[#9A7415]">{table.status}</span>
                    </div>
                    <h3 className="text-lg font-bold text-zinc-900 mt-0.5">
                      {table.name} ({table.tableNumber})
                    </h3>

                    {ord ? (
                      <div className="mt-2 pt-2 border-t border-zinc-100 text-xs space-y-1">
                        <div className="flex justify-between font-semibold">
                          <span className="font-mono-tabular">{ord.orderNumber}</span>
                          <span className="font-mono-tabular">{formatINR(ord.subtotal)}</span>
                        </div>
                        <div className="text-zinc-500 line-clamp-2">
                          {ord.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                        </div>
                        <div className="text-zinc-500">
                          Kitchen Status: <strong className="text-zinc-800">{ord.status}</strong>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-zinc-400">Table vacant · {table.capacity} seats</p>
                    )}
                  </div>

                  {/* Mobile Touch Action Buttons (>=44px touch friendly) */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-100">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTableId(table.id);
                        setExistingOrderToAppend(ord && !ord.billed ? ord : null);
                        setDraftItems([]);
                        setTab('new_order');
                      }}
                      className="py-2.5 px-3 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Utensils className="w-3.5 h-3.5" />
                      {ord ? 'Add Items' : 'Take Order'}
                    </button>

                    {ord ? (
                      <button
                        type="button"
                        onClick={() => {
                          void updateTableStatus(table.id, 'Billing');
                          notify(`Billing requested for Table ${table.tableNumber}`);
                        }}
                        className="py-2.5 px-3 rounded-lg bg-[#C59B27] text-[#141518] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        Request Bill
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          void updateTableStatus(
                            table.id,
                            table.status === 'Occupied' ? 'Available' : 'Occupied'
                          )
                        }
                        className="py-2.5 px-3 rounded-lg border border-zinc-300 text-zinc-700 text-xs font-semibold cursor-pointer"
                      >
                        {table.status === 'Occupied' ? 'Set Vacant' : 'Seat Guests'}
                      </button>
                    )}

                    {ord && (
                      <>
                        <button
                          type="button"
                          onClick={() => setTransferSource(table)}
                          className="py-2 px-3 rounded-lg border border-zinc-200 text-zinc-700 text-xs font-medium inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                          Transfer
                        </button>
                        <button
                          type="button"
                          onClick={() => setMergeSource(table)}
                          className="py-2 px-3 rounded-lg border border-zinc-200 text-zinc-700 text-xs font-medium inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <GitMerge className="w-3.5 h-3.5" />
                          Merge
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: Take Manual Order / Add Items */}
      {tab === 'new_order' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 bg-white border border-zinc-200 rounded-xl p-4 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={selectedTableId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedTableId(id);
                  const t = tables.find((tbl) => tbl.id === id);
                  const ord = t?.currentOrderId
                    ? orders.find((o) => o.id === t.currentOrderId && !o.billed) || null
                    : null;
                  setExistingOrderToAppend(ord);
                }}
                className="px-3 py-2.5 rounded-lg border border-zinc-300 text-sm font-semibold bg-zinc-50"
              >
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.tableNumber}) — {t.status}
                  </option>
                ))}
              </select>

              <div className="relative flex-1">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchMenu}
                  onChange={(e) => setSearchMenu(e.target.value)}
                  placeholder="Search dishes..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-zinc-300 text-sm"
                />
              </div>
            </div>

            {existingOrderToAppend && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                Appending items to active order{' '}
                <strong className="font-mono-tabular">{existingOrderToAppend.orderNumber}</strong>
              </div>
            )}

            <div className="divide-y divide-zinc-100 max-h-[460px] overflow-y-auto">
              {filteredMenu.map((dish) => {
                const qty = draftItems.find((i) => i.itemId === dish.id)?.qty || 0;
                return (
                  <div key={dish.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900 truncate">
                        {dish.name}
                      </div>
                      <div className="text-xs text-zinc-500">
                        <span className="text-emerald-700 font-medium">Pure Veg</span> ·{' '}
                        <span className="font-mono-tabular font-semibold text-zinc-800">
                          {formatINR(dish.price)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {qty === 0 ? (
                        <button
                          type="button"
                          onClick={() => adjustDraftQty(dish, 1)}
                          className="px-3 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
                        >
                          Add +
                        </button>
                      ) : (
                        <div className="inline-flex items-center gap-2 bg-[#141518] text-white rounded-lg px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => adjustDraftQty(dish, -1)}
                            className="p-1 text-[#D4AF37] cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="font-mono-tabular text-xs font-semibold min-w-[16px] text-center">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => adjustDraftQty(dish, 1)}
                            className="p-1 text-[#D4AF37] cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Order Summary Ticket */}
          <div className="lg:col-span-5 bg-white border border-zinc-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <h3 className="text-base font-bold text-zinc-900">KOT Summary</h3>
              {!existingOrderToAppend && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Guest Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="Dine-in Guest"
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm"
                  />
                </div>
              )}

              <DietaryPreferenceField
                value={dietaryTags}
                onChange={setDietaryTags}
                compact
              />

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Kitchen Special Instructions
                </label>
                <textarea
                  rows={2}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Extra spicy, serve starters first..."
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm"
                />
              </div>

              <div className="divide-y divide-zinc-100">
                {draftItems.length === 0 ? (
                  <p className="text-xs text-zinc-400 py-6 text-center">
                    Tap dishes on the left to build the kitchen order ticket.
                  </p>
                ) : (
                  draftItems.map((it) => (
                    <div key={it.itemId} className="py-2 flex justify-between text-xs">
                      <span>
                        <strong className="font-mono-tabular">{it.qty}×</strong> {it.name}
                      </span>
                      <span className="font-mono-tabular font-semibold">
                        {formatINR(it.price * it.qty)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-zinc-200 space-y-3">
              <div className="flex justify-between text-sm font-bold">
                <span>Items Subtotal</span>
                <span className="font-mono-tabular">
                  {formatINR(draftItems.reduce((s, i) => s + i.price * i.qty, 0))}
                </span>
              </div>
              <button
                type="button"
                disabled={submitting || draftItems.length === 0 || !selectedTableId}
                onClick={() => void handleSendOrder()}
                className="w-full py-3 rounded-xl bg-[#141518] text-[#D4AF37] text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                {submitting
                  ? 'Sending to Kitchen...'
                  : existingOrderToAppend
                  ? 'Add to Active Order'
                  : 'Send Order to Kitchen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Order History */}
      {tab === 'history' && (
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <th className="px-4 py-3 font-semibold">Items</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {orders.slice(0, 30).map((o) => (
                  <tr key={o.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono-tabular font-semibold">{o.orderNumber}</td>
                    <td className="px-4 py-3">
                      {o.tableNumber ? `Table ${o.tableNumber}` : o.roomNumber ? `Room ${o.roomNumber}` : 'Counter'}
                    </td>
                    <td className="px-4 py-3 uppercase">{o.source}</td>
                    <td className="px-4 py-3 max-w-xs truncate">
                      {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                    </td>
                    <td className="px-4 py-3 font-semibold">{o.status}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-semibold">
                      {formatINR(o.subtotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {transferSource && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-xl p-5 space-y-4">
            <h3 className="text-base font-bold">
              Transfer Table {transferSource.tableNumber} Order
            </h3>
            <select
              value={transferTargetId}
              onChange={(e) => setTransferTargetId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 text-sm"
            >
              <option value="">Select vacant target table...</option>
              {tables
                .filter((t) => t.id !== transferSource.id && t.status === 'Available')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.tableNumber})
                  </option>
                ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTransferSource(null)}
                className="px-4 py-2 rounded-lg border border-zinc-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!transferTargetId}
                onClick={() => void handleTransfer()}
                className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                Transfer Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Modal */}
      {mergeSource && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-xl p-5 space-y-4">
            <h3 className="text-base font-bold">
              Merge Table {mergeSource.tableNumber} Into Another Active Table
            </h3>
            <select
              value={mergeTargetId}
              onChange={(e) => setMergeTargetId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 text-sm"
            >
              <option value="">Select primary active table...</option>
              {tables
                .filter((t) => t.id !== mergeSource.id && Boolean(t.currentOrderId))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.tableNumber})
                  </option>
                ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMergeSource(null)}
                className="px-4 py-2 rounded-lg border border-zinc-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!mergeTargetId}
                onClick={() => void handleMerge()}
                className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                Merge Tables
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
