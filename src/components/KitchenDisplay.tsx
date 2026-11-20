import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChefHat, Clock, Flame } from 'lucide-react';
import {
  toggleOrderPriority,
  updateOrderStatusAndInventory,
} from '../services/firestoreService';
import type {
  InventoryItem,
  MenuItem,
  Order,
  OrderStatus,
  StaffProfile,
} from '../types';
import { formatTime, getElapsedMinutes } from '../utils/format';

interface KitchenDisplayProps {
  currentUser: StaffProfile;
  orders: Order[];
  menuItems: MenuItem[];
  inventory: InventoryItem[];
}

const KDS_STATUSES: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready'];

export const KitchenDisplay: React.FC<KitchenDisplayProps> = ({
  currentUser,
  orders,
  menuItems,
  inventory,
}) => {
  const [filterStatus, setFilterStatus] = useState<'active' | OrderStatus>('active');
  const [, setTick] = useState(0);

  // Refresh elapsed minutes timer every 15 seconds
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const kdsOrders = useMemo(() => {
    return orders
      .filter((o) => {
        if (filterStatus === 'active') {
          return KDS_STATUSES.includes(o.status);
        }
        return o.status === filterStatus;
      })
      .sort((a, b) => {
        if (a.priority === 'Urgent' && b.priority !== 'Urgent') return -1;
        if (b.priority === 'Urgent' && a.priority !== 'Urgent') return 1;
        return 0;
      });
  }, [orders, filterStatus]);

  const advanceOrder = async (order: Order, nextStatus: OrderStatus) => {
    await updateOrderStatusAndInventory({
      order,
      newStatus: nextStatus,
      menuItems,
      inventory,
      performedBy: currentUser.displayName,
    });
  };

  return (
    <div className="bg-[#121316] text-white rounded-2xl p-5 sm:p-6 min-h-[75vh] space-y-6 border border-zinc-800">
      {/* KDS Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#C59B27]/15 text-[#D4AF37] flex items-center justify-center">
            <ChefHat className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-white">
              Kitchen Display System (KDS)
            </h2>
            <p className="text-xs text-zinc-400">
              Real-time KOT queue · Completing an order deducts linked recipe inventory
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 bg-[#1C1E22] p-1 rounded-xl border border-zinc-800">
          {(
            [
              { id: 'active', label: `Active Queue (${orders.filter((o) => KDS_STATUSES.includes(o.status)).length})` },
              { id: 'New', label: 'New' },
              { id: 'Accepted', label: 'Accepted' },
              { id: 'Preparing', label: 'Preparing' },
              { id: 'Ready', label: 'Ready' },
              { id: 'Completed', label: 'Completed' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterStatus(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                filterStatus === tab.id
                  ? 'bg-[#C59B27] text-[#141518]'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Live Tickets Grid */}
      {kdsOrders.length === 0 ? (
        <div className="py-20 text-center text-zinc-400">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3 opacity-80" />
          <div className="text-base font-semibold text-zinc-200">Kitchen Pass Clear</div>
          <p className="text-xs text-zinc-400 mt-1">
            New QR, Waiter, POS, and Room Service tickets appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {kdsOrders.map((ord) => {
            const mins = getElapsedMinutes(ord.createdAt);
            const isUrgent = ord.priority === 'Urgent';
            return (
              <div
                key={ord.id}
                className={`rounded-xl border p-5 flex flex-col justify-between gap-4 ${
                  isUrgent
                    ? 'bg-[#21191A] border-red-500/60'
                    : 'bg-[#1A1C21] border-zinc-800'
                }`}
              >
                <div className="space-y-3">
                  {/* Ticket Meta */}
                  <div className="flex items-start justify-between gap-2 pb-3 border-b border-zinc-800">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span className="font-mono-tabular font-bold text-white text-base">
                          {ord.orderNumber}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="uppercase">{ord.source}</span>
                      </div>
                      <div className="text-sm font-semibold text-[#D4AF37] mt-0.5">
                        {ord.tableNumber
                          ? `Table ${ord.tableNumber}`
                          : ord.roomNumber
                          ? `Room ${ord.roomNumber}`
                          : 'Takeaway / Counter'}
                      </div>
                    </div>

                    <div className="text-right space-y-1">
                      <div className="inline-flex items-center gap-1 font-mono-tabular text-xs font-semibold text-zinc-300">
                        <Clock className="w-3.5 h-3.5 text-zinc-400" />
                        {mins}m ({formatTime(ord.createdAt)})
                      </div>
                      <div>
                        <button
                          type="button"
                          onClick={() => void toggleOrderPriority(ord)}
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                            isUrgent
                              ? 'bg-red-600 text-white'
                              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                          }`}
                        >
                          <Flame className="w-3 h-3" />
                          {ord.priority}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Items List */}
                  <div className="space-y-2">
                    {ord.items.map((it, idx) => (
                      <div
                        key={`${it.itemId}_${idx}`}
                        className="flex items-start justify-between gap-2 text-sm"
                      >
                        <div className="flex items-start gap-2.5">
                          <span className="font-mono-tabular font-bold text-[#D4AF37] bg-zinc-800 px-2 py-0.5 rounded text-sm">
                            {it.qty}×
                          </span>
                          <span className="font-medium text-zinc-100 leading-snug pt-0.5">
                            {it.name}
                          </span>
                        </div>
                        <span className="text-[11px] font-semibold text-emerald-400 shrink-0 pt-1">
                          PURE VEG
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Special Instructions */}
                  {ord.specialInstructions && (
                    <div className="p-3 rounded-lg bg-amber-950/50 border border-amber-600/40 text-xs text-amber-200">
                      <strong className="text-amber-300">Chef Note:</strong>{' '}
                      {ord.specialInstructions}
                    </div>
                  )}
                </div>

                {/* Large Kitchen Screen Action Buttons */}
                <div className="pt-3 border-t border-zinc-800 grid grid-cols-2 gap-2">
                  {ord.status === 'New' && (
                    <button
                      type="button"
                      onClick={() => void advanceOrder(ord, 'Accepted')}
                      className="col-span-2 py-3.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm cursor-pointer transition-colors"
                    >
                      Accept Order
                    </button>
                  )}
                  {ord.status === 'Accepted' && (
                    <button
                      type="button"
                      onClick={() => void advanceOrder(ord, 'Preparing')}
                      className="col-span-2 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#141518] font-bold text-sm cursor-pointer transition-colors"
                    >
                      Start Preparing
                    </button>
                  )}
                  {ord.status === 'Preparing' && (
                    <button
                      type="button"
                      onClick={() => void advanceOrder(ord, 'Ready')}
                      className="col-span-2 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#141518] font-bold text-sm cursor-pointer transition-colors"
                    >
                      Mark Ready for Pickup
                    </button>
                  )}
                  {ord.status === 'Ready' && (
                    <button
                      type="button"
                      onClick={() => void advanceOrder(ord, 'Completed')}
                      className="col-span-2 py-3.5 rounded-xl bg-[#C59B27] hover:bg-[#D4AF37] text-[#141518] font-bold text-sm cursor-pointer transition-colors"
                    >
                      Complete & Deduct Stock
                    </button>
                  )}
                  {ord.status === 'Completed' && (
                    <div className="col-span-2 text-center py-2 text-xs font-semibold text-emerald-400">
                      Completed · Stock Updated
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
