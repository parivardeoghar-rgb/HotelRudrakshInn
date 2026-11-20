import React, { useMemo, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  Download,
  Edit2,
  ExternalLink,
  Plus,
  Printer,
  QrCode,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  deleteTable,
  saveTable,
  updateTableStatus,
} from '../services/firestoreService';
import type {
  Order,
  RestaurantTable,
  StaffProfile,
  TableStatus,
} from '../types';
import { formatINRCompact, formatTime } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';

interface TableManagementProps {
  tables: RestaurantTable[];
  orders: Order[];
  staffList: StaffProfile[];
  canManageTables: boolean;
  onOpenGuestQrPreview: (tableId: string) => void;
}

const ALL_STATUSES: TableStatus[] = [
  'Available',
  'Occupied',
  'Ordered',
  'Preparing',
  'Ready',
  'Served',
  'Billing',
];

const STATUS_STYLE: Record<TableStatus, string> = {
  Available: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Occupied: 'bg-zinc-100 text-zinc-800 border-zinc-300',
  Ordered: 'bg-amber-50 text-amber-800 border-amber-200',
  Preparing: 'bg-orange-50 text-orange-800 border-orange-200',
  Ready: 'bg-sky-50 text-sky-800 border-sky-200',
  Served: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  Billing: 'bg-rose-50 text-rose-800 border-rose-200',
};

export const TableManagement: React.FC<TableManagementProps> = ({
  tables,
  orders,
  staffList,
  canManageTables,
  onOpenGuestQrPreview,
}) => {
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [qrTable, setQrTable] = useState<RestaurantTable | null>(null);
  const [editingTable, setEditingTable] = useState<
    (Omit<RestaurantTable, 'updatedAt'> & { isNew?: boolean }) | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<RestaurantTable | null>(null);
  const [saving, setSaving] = useState(false);

  const qrWrapperRef = useRef<HTMLDivElement | null>(null);

  const sections = useMemo(() => {
    const set = new Set<string>(tables.map((t) => t.section));
    return ['all', ...Array.from(set)];
  }, [tables]);

  const waiters = useMemo(
    () => staffList.filter((s) => s.active && (s.role === 'waiter' || s.role === 'manager' || s.role === 'super_admin')),
    [staffList]
  );

  const visibleTables = useMemo(
    () =>
      tables.filter((t) => sectionFilter === 'all' || t.section === sectionFilter),
    [tables, sectionFilter]
  );

  const getOrderForTable = (table: RestaurantTable): Order | undefined => {
    if (!table.currentOrderId) return undefined;
    return orders.find((o) => o.id === table.currentOrderId);
  };

  const getQrUrl = (tableId: string) => {
    return `${window.location.origin}/?table=${encodeURIComponent(tableId)}`;
  };

  const handleDownloadQrPng = () => {
    if (!qrTable || !qrWrapperRef.current) return;
    const canvas = qrWrapperRef.current.querySelector('canvas');
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `Hotel-Rudraksh-Inn-Table-${qrTable.tableNumber}-QR.png`;
    a.click();
  };

  const handleSaveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTable) return;
    setSaving(true);
    try {
      await saveTable(editingTable);
      setEditingTable(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deleteTable(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Section Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-zinc-900">
            Floor & Table Management
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Live table status, waiter assignment, and printable QR ordering codes
          </p>
        </div>

        <div className="flex items-center gap-3">
          {canManageTables && (
            <button
              type="button"
              onClick={() =>
                setEditingTable({
                  id: '',
                  tableNumber: `T${tables.length + 1}`,
                  name: `Table ${tables.length + 1}`,
                  section: 'Main Dining Hall',
                  capacity: 4,
                  status: 'Available',
                  isNew: true,
                })
              }
              className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-zinc-800 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Add Table
            </button>
          )}
        </div>
      </div>

      {/* Section Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {sections.map((sec) => (
          <button
            key={sec}
            type="button"
            onClick={() => setSectionFilter(sec)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sectionFilter === sec
                ? 'bg-[#141518] text-[#D4AF37] border-[#141518]'
                : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300'
            }`}
          >
            {sec === 'all' ? `All Sections (${tables.length})` : sec}
          </button>
        ))}
      </div>

      {/* Tables Grid */}
      {visibleTables.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-xl p-10 text-center text-sm text-zinc-500">
          No tables configured in this section yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visibleTables.map((table) => {
            const activeOrder = getOrderForTable(table);
            const billTotal = activeOrder ? activeOrder.subtotal : table.currentBillTotal || 0;
            return (
              <div
                key={table.id}
                className="bg-white border border-zinc-200 rounded-xl p-4 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-zinc-500">{table.section}</div>
                      <h3 className="text-base font-bold text-zinc-900 mt-0.5">
                        {table.name}{' '}
                        <span className="font-mono-tabular text-xs font-medium text-zinc-500">
                          ({table.tableNumber})
                        </span>
                      </h3>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-[11px] font-semibold rounded-md border ${
                        STATUS_STYLE[table.status]
                      }`}
                    >
                      {table.status}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-600 pt-3 border-t border-zinc-100">
                    <div className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-zinc-400" />
                      <span className="font-mono-tabular">{table.capacity} seats</span>
                    </div>
                    <div className="text-right font-mono-tabular font-semibold text-zinc-900">
                      {billTotal > 0 ? formatINRCompact(billTotal) : 'No bill'}
                    </div>
                    <div className="truncate">
                      Order: {activeOrder ? activeOrder.orderNumber : '—'}
                    </div>
                    <div className="text-right font-mono-tabular">
                      {table.orderTime ? formatTime(table.orderTime) : '—'}
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div className="space-y-2 pt-2 border-t border-zinc-100">
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      aria-label={`Status for ${table.name}`}
                      value={table.status}
                      onChange={(e) =>
                        void updateTableStatus(table.id, e.target.value as TableStatus)
                      }
                      className="px-2 py-1.5 text-xs bg-zinc-50 border border-zinc-300 rounded-lg text-zinc-800 focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                    >
                      {ALL_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label={`Assign waiter for ${table.name}`}
                      value={table.assignedWaiterId || ''}
                      onChange={(e) => {
                        const w = waiters.find((st) => st.uid === e.target.value);
                        void updateTableStatus(table.id, table.status, {
                          assignedWaiterId: w?.uid || '',
                          assignedWaiterName: w?.displayName || '',
                        });
                      }}
                      className="px-2 py-1.5 text-xs bg-zinc-50 border border-zinc-300 rounded-lg text-zinc-800 focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                    >
                      <option value="">Unassigned</option>
                      {waiters.map((w) => (
                        <option key={w.uid} value={w.uid}>
                          {w.displayName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setQrTable(table)}
                      className="flex-1 py-1.5 px-2.5 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-zinc-800 cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      Table QR
                    </button>

                    {canManageTables && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingTable({ ...table, isNew: false })}
                          className="p-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 cursor-pointer"
                          title="Edit table"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(table)}
                          className="p-1.5 rounded-lg border border-zinc-200 text-red-600 hover:bg-red-50 cursor-pointer"
                          title="Delete table"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* QR Code Generator & Printable Table Tent Modal */}
      {qrTable && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl shadow-2xl overflow-hidden print-area">
            <div className="no-print px-5 py-4 bg-[#141518] text-white flex items-center justify-between">
              <span className="text-sm font-semibold">
                QR Table Card · {qrTable.name}
              </span>
              <button
                type="button"
                onClick={() => setQrTable(null)}
                className="p-1 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 text-center space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-[#9A7415]">
                  Hotel Rudraksh Inn · Deoghar
                </div>
                <h3 className="font-display text-2xl font-bold text-zinc-900 mt-1">
                  Table {qrTable.tableNumber}
                </h3>
                <p className="text-xs text-zinc-500">{qrTable.section}</p>
              </div>

              <div
                ref={qrWrapperRef}
                className="inline-flex p-5 rounded-2xl bg-white border-2 border-[#C59B27] shadow-sm"
              >
                <QRCodeCanvas
                  value={getQrUrl(qrTable.id)}
                  size={200}
                  level="H"
                  bgColor="#FFFFFF"
                  fgColor="#141518"
                />
              </div>

              <div className="text-xs text-zinc-600">
                Scan with phone camera to browse menu, order & track live status.
              </div>
              <div className="text-[11px] font-mono-tabular text-zinc-400 break-all px-2">
                {getQrUrl(qrTable.id)}
              </div>

              <div className="no-print pt-3 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadQrPng}
                  className="px-3.5 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-zinc-800 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PNG
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3.5 py-2 rounded-lg border border-zinc-300 text-zinc-800 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-zinc-100 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Tent
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = qrTable.id;
                    setQrTable(null);
                    onOpenGuestQrPreview(id);
                  }}
                  className="px-3.5 py-2 rounded-lg bg-[#C59B27] text-[#141518] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#D4AF37] cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Test Menu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Table Modal */}
      {editingTable && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleSaveTable(e)}
            className="w-full max-w-md bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 bg-[#141518] text-white flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {editingTable.isNew ? 'Add New Dining Table' : `Edit ${editingTable.name}`}
              </h3>
              <button
                type="button"
                onClick={() => setEditingTable(null)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Table Code
                  </label>
                  <input
                    required
                    maxLength={20}
                    disabled={!editingTable.isNew}
                    value={editingTable.tableNumber}
                    onChange={(e) =>
                      setEditingTable({ ...editingTable, tableNumber: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm disabled:bg-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Seating Capacity
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    required
                    value={editingTable.capacity}
                    onChange={(e) =>
                      setEditingTable({
                        ...editingTable,
                        capacity: Number(e.target.value) || 4,
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Display Name
                </label>
                <input
                  required
                  maxLength={50}
                  value={editingTable.name}
                  onChange={(e) =>
                    setEditingTable({ ...editingTable, name: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Section / Floor Area
                </label>
                <input
                  required
                  maxLength={50}
                  value={editingTable.section}
                  onChange={(e) =>
                    setEditingTable({ ...editingTable, section: e.target.value })
                  }
                  placeholder="Main Dining Hall, Courtyard Terrace, Rudraksh VIP Lounge"
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 bg-zinc-50 border-t border-zinc-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingTable(null)}
                className="px-4 py-2 rounded-lg border border-zinc-300 text-xs font-semibold text-zinc-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Table'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.name || 'Table'}?`}
        description="This removes the table and invalidates its printed QR code. Active orders on this table should be settled first."
        confirmLabel="Delete Table"
        loading={saving}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
