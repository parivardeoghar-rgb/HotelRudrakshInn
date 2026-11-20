import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Package,
  Pencil,
  Plus,
  Search,
  Truck,
  X,
} from 'lucide-react';
import {
  recordStockMovement,
  saveInventoryItem,
  saveSupplier,
} from '../services/firestoreService';
import type {
  InventoryItem,
  InventoryLog,
  StaffProfile,
  Supplier,
} from '../types';
import { downloadCSV, formatDateTime, formatINR } from '../utils/format';

interface InventoryViewProps {
  currentUser: StaffProfile;
  inventory: InventoryItem[];
  logs: InventoryLog[];
  suppliers: Supplier[];
}

function getStockHealth(item: InventoryItem) {
  const threshold = Math.max(0, Number(item.minThreshold) || 0);
  const qty = Math.max(0, Number(item.quantity) || 0);
  const isLow = qty <= threshold;
  const isApproaching = !isLow && threshold > 0 && qty <= threshold * 1.25;
  const targetCapacity = threshold > 0 ? threshold * 2 : Math.max(qty, 1);
  const fillPct = Math.min(100, Math.max(0, Math.round((qty / targetCapacity) * 100)));
  const ratio = threshold > 0 ? qty / threshold : qty > 0 ? 2 : 0;

  return {
    isLow,
    isApproaching,
    fillPct,
    targetCapacity,
    ratio,
  };
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  currentUser,
  inventory,
  logs,
  suppliers,
}) => {
  const [tab, setTab] = useState<'stock' | 'history' | 'suppliers'>('stock');
  const [stockFilter, setStockFilter] = useState<'all' | 'low'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingItem, setEditingItem] = useState<
    (Omit<InventoryItem, 'updatedAt'> & { isNew?: boolean }) | null
  >(null);
  const [movementTarget, setMovementTarget] = useState<{
    item: InventoryItem;
    type: 'purchase' | 'adjustment';
  } | null>(null);
  const [deltaQty, setDeltaQty] = useState<number>(5);
  const [movementNote, setMovementNote] = useState('');
  const [editingSupplier, setEditingSupplier] = useState<
    (Omit<Supplier, 'createdAt'> & { isNew?: boolean }) | null
  >(null);

  const canManage =
    currentUser.role === 'super_admin' || currentUser.role === 'manager';

  const showToast = (text: string, tone: 'success' | 'error' = 'success') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 3500);
  };

  const lowStockItems = useMemo(
    () =>
      inventory
        .filter((i) => i.quantity <= i.minThreshold)
        .sort((a, b) => getStockHealth(a).ratio - getStockHealth(b).ratio),
    [inventory]
  );

  const lowStockCount = lowStockItems.length;

  const displayedInventory = useMemo(() => {
    const queryText = searchTerm.trim().toLowerCase();

    return [...inventory]
      .sort((a, b) => {
        const aHealth = getStockHealth(a);
        const bHealth = getStockHealth(b);
        if (aHealth.isLow !== bHealth.isLow) {
          return aHealth.isLow ? -1 : 1;
        }
        if (aHealth.isLow && bHealth.isLow && aHealth.ratio !== bHealth.ratio) {
          return aHealth.ratio - bHealth.ratio;
        }
        if (aHealth.isApproaching !== bHealth.isApproaching) {
          return aHealth.isApproaching ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      })
      .filter((it) => {
        if (stockFilter === 'low' && it.quantity > it.minThreshold) {
          return false;
        }
        if (queryText) {
          return (
            it.name.toLowerCase().includes(queryText) ||
            it.category.toLowerCase().includes(queryText) ||
            (it.supplierName || '').toLowerCase().includes(queryText)
          );
        }
        return true;
      });
  }, [inventory, stockFilter, searchTerm]);

  const handleExportInventoryCSV = () => {
    downloadCSV(
      'hotel-rudraksh-inventory.csv',
      [
        'Ingredient',
        'Category',
        'Quantity',
        'Unit',
        'Min Threshold',
        'Status',
        'Unit Cost (INR)',
        'Valuation (INR)',
        'Supplier',
      ],
      displayedInventory.map((i) => {
        const health = getStockHealth(i);
        const statusLabel = health.isLow
          ? 'Low Stock'
          : health.isApproaching
          ? 'Near Limit'
          : 'Optimal';
        return [
          i.name,
          i.category,
          i.quantity,
          i.unit,
          i.minThreshold,
          statusLabel,
          i.unitCost,
          Math.round(i.quantity * i.unitCost * 100) / 100,
          i.supplierName || '',
        ];
      })
    );
  };

  const handleSaveItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setSaving(true);
    try {
      const sup = suppliers.find((s) => s.id === editingItem.supplierId);
      await saveInventoryItem(
        { ...editingItem, supplierName: sup?.name || '' },
        currentUser.displayName
      );
      showToast(
        editingItem.isNew
          ? `${editingItem.name} added to inventory.`
          : `Updated alert threshold and details for ${editingItem.name}.`
      );
      setEditingItem(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Unable to save ingredient.',
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleMovementSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movementTarget) return;
    setSaving(true);
    try {
      await recordStockMovement({
        item: movementTarget.item,
        type: movementTarget.type,
        delta: deltaQty,
        note: movementNote,
        performedBy: currentUser.displayName,
      });
      showToast(`Stock ledger updated for ${movementTarget.item.name}.`);
      setMovementTarget(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Unable to record stock movement.',
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-2.5 text-xs font-semibold flex items-center gap-2 ${
            toast.tone === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {toast.tone === 'error' ? (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-zinc-900">
            Kitchen Inventory & Suppliers
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">
            {inventory.length} ingredients tracked · {lowStockCount}{' '}
            {lowStockCount === 1 ? 'low-stock alert' : 'low-stock alerts'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-white border border-zinc-200 rounded-xl">
            <button
              type="button"
              onClick={() => setTab('stock')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                tab === 'stock'
                  ? 'bg-[#141518] text-[#D4AF37]'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Stock ({inventory.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('history')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                tab === 'history'
                  ? 'bg-[#141518] text-[#D4AF37]'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Ledger ({logs.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('suppliers')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                tab === 'suppliers'
                  ? 'bg-[#141518] text-[#D4AF37]'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Suppliers ({suppliers.length})
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportInventoryCSV}
            className="px-3 py-2 rounded-lg border border-zinc-300 bg-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer hover:bg-zinc-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>

          {canManage && tab === 'stock' && (
            <button
              type="button"
              onClick={() =>
                setEditingItem({
                  id: '',
                  name: '',
                  category: 'Dairy',
                  quantity: 10,
                  unit: 'kg',
                  minThreshold: 3,
                  unitCost: 100,
                  supplierId: suppliers[0]?.id || '',
                  supplierName: suppliers[0]?.name || '',
                  isNew: true,
                })
              }
              className="px-3.5 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer hover:bg-zinc-800 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Ingredient
            </button>
          )}

          {canManage && tab === 'suppliers' && (
            <button
              type="button"
              onClick={() =>
                setEditingSupplier({
                  id: '',
                  name: '',
                  contactPerson: '',
                  phone: '',
                  category: 'Fresh Produce',
                  address: 'Deoghar, Jharkhand',
                  isNew: true,
                })
              }
              className="px-3.5 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer hover:bg-zinc-800 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Supplier
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: Stock List */}
      {tab === 'stock' && (
        <div className="space-y-4">
          {/* Low-Stock Summary Alert Banner */}
          {lowStockCount > 0 && (
            <div
              role="alert"
              className="bg-amber-50/75 border border-amber-200 rounded-xl px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="text-xs min-w-0">
                  <div className="font-semibold text-amber-900">
                    {lowStockCount}{' '}
                    {lowStockCount === 1
                      ? 'ingredient is at or below minimum stock threshold'
                      : 'ingredients are at or below minimum stock threshold'}
                  </div>
                  <div className="text-amber-800/90 mt-0.5 truncate">
                    Priority restock:{' '}
                    {lowStockItems
                      .slice(0, 3)
                      .map((i) => `${i.name} (${i.quantity}/${i.minThreshold} ${i.unit})`)
                      .join(' · ')}
                    {lowStockCount > 3 ? ` · +${lowStockCount - 3} more` : ''}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setStockFilter((prev) => (prev === 'low' ? 'all' : 'low'))
                }
                className="px-3.5 py-1.5 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer hover:bg-zinc-800 transition-colors"
              >
                {stockFilter === 'low'
                  ? `Show All (${inventory.length})`
                  : `Show Low Stock (${lowStockCount})`}
              </button>
            </div>
          )}

          {/* Search & Stock Status Filter Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search ingredient, category, or supplier..."
                className="w-full pl-9 pr-3 py-2 bg-white border border-zinc-200 rounded-xl text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
              />
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[11px] text-zinc-500 hidden md:inline">
                Low-stock items sorted first
              </span>
              <div className="inline-flex items-center gap-1 p-1 bg-white border border-zinc-200 rounded-xl">
                <button
                  type="button"
                  onClick={() => setStockFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    stockFilter === 'all'
                      ? 'bg-[#141518] text-[#D4AF37]'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  All Stock ({inventory.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStockFilter('low')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    stockFilter === 'low'
                      ? 'bg-amber-600 text-white'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  Low Stock ({lowStockCount})
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            {displayedInventory.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <Package className="w-7 h-7 text-zinc-400 mx-auto" />
                <div className="text-sm font-semibold text-zinc-900">
                  {inventory.length === 0
                    ? 'No ingredients tracked yet'
                    : stockFilter === 'low' && lowStockCount === 0
                    ? 'All ingredients are above minimum thresholds'
                    : 'No ingredients match your current filter'}
                </div>
                <p className="text-xs text-zinc-500 max-w-md mx-auto">
                  {inventory.length === 0
                    ? 'Add kitchen ingredients and minimum alert thresholds to monitor live inventory levels.'
                    : stockFilter === 'low' && lowStockCount === 0
                    ? 'Every stocked item currently exceeds its configured Min Alert quantity.'
                    : 'Clear your search query or switch back to All Stock to view all ingredients.'}
                </p>
                {inventory.length === 0 && canManage ? (
                  <button
                    type="button"
                    onClick={() =>
                      setEditingItem({
                        id: '',
                        name: '',
                        category: 'Dairy',
                        quantity: 10,
                        unit: 'kg',
                        minThreshold: 3,
                        unitCost: 100,
                        supplierId: suppliers[0]?.id || '',
                        supplierName: suppliers[0]?.name || '',
                        isNew: true,
                      })
                    }
                    className="mt-2 px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
                  >
                    Add First Ingredient
                  </button>
                ) : (
                  (stockFilter !== 'all' || searchTerm.trim() !== '') && (
                    <button
                      type="button"
                      onClick={() => {
                        setStockFilter('all');
                        setSearchTerm('');
                      }}
                      className="mt-2 px-4 py-2 rounded-lg border border-zinc-300 bg-white text-zinc-700 text-xs font-semibold cursor-pointer hover:bg-zinc-50"
                    >
                      Show All Stock
                    </button>
                  )
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Ingredient</th>
                      <th className="px-4 py-3 font-semibold">Category</th>
                      <th className="px-4 py-3 font-semibold">Supplier</th>
                      <th className="px-4 py-3 font-semibold">Stock Level</th>
                      <th className="px-4 py-3 font-semibold text-right">Min Alert</th>
                      <th className="px-4 py-3 font-semibold text-right">Unit Cost</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {displayedInventory.map((it) => {
                      const health = getStockHealth(it);
                      const suggestedRestock = Math.max(
                        1,
                        Math.ceil(Math.max(it.minThreshold * 2 - it.quantity, 5))
                      );

                      return (
                        <tr
                          key={it.id}
                          className={`transition-colors ${
                            health.isLow
                              ? 'bg-amber-50/60 shadow-[inset_3px_0_0_0_#D97706] hover:bg-amber-50/90'
                              : 'hover:bg-zinc-50'
                          }`}
                        >
                          <td className="px-4 py-3 font-semibold text-zinc-900">
                            {it.name}
                          </td>
                          <td className="px-4 py-3 text-zinc-600">{it.category}</td>
                          <td className="px-4 py-3 text-zinc-600">
                            {it.supplierName || '—'}
                          </td>
                          <td className="px-4 py-3 min-w-[165px]">
                            <div className="flex items-baseline justify-between gap-2 mb-1">
                              <span
                                className={`font-mono-tabular font-bold ${
                                  health.isLow ? 'text-amber-900' : 'text-zinc-900'
                                }`}
                              >
                                {it.quantity} {it.unit}
                              </span>
                              <span className="font-mono-tabular text-[11px] text-zinc-500">
                                {health.fillPct}%
                              </span>
                            </div>
                            <div
                              role="progressbar"
                              aria-valuenow={health.fillPct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${it.name} stock level ${it.quantity} ${it.unit} against ${it.minThreshold} ${it.unit} minimum threshold`}
                              className={`w-full h-1.5 rounded-full overflow-hidden ${
                                health.isLow ? 'bg-amber-200/70' : 'bg-zinc-100'
                              }`}
                            >
                              <div
                                className={`h-full rounded-full transition-all duration-200 ${
                                  health.isLow
                                    ? 'bg-amber-600'
                                    : health.isApproaching
                                    ? 'bg-amber-400'
                                    : 'bg-emerald-600'
                                }`}
                                style={{ width: `${health.fillPct}%` }}
                              />
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono-tabular text-zinc-600">
                            {it.minThreshold} {it.unit}
                          </td>
                          <td className="px-4 py-3 text-right font-mono-tabular text-zinc-700">
                            {formatINR(it.unitCost)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {health.isLow ? (
                              <span className="inline-flex items-center gap-1.5 text-amber-800 font-semibold">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                <span>Low Stock</span>
                              </span>
                            ) : health.isApproaching ? (
                              <span className="text-zinc-700 font-medium">
                                Near Limit
                              </span>
                            ) : (
                              <span className="text-emerald-700 font-medium">
                                Optimal
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                            {canManage && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMovementTarget({ item: it, type: 'purchase' });
                                    setDeltaQty(suggestedRestock);
                                    setMovementNote('Supplier restock');
                                  }}
                                  className="px-2.5 py-1 rounded bg-[#141518] text-[#D4AF37] font-semibold cursor-pointer hover:bg-zinc-800 transition-colors"
                                >
                                  + Purchase
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMovementTarget({ item: it, type: 'adjustment' });
                                    setDeltaQty(-1);
                                    setMovementNote('Kitchen audit adjustment');
                                  }}
                                  className="px-2.5 py-1 rounded border border-zinc-300 text-zinc-700 font-semibold cursor-pointer hover:bg-zinc-50 transition-colors"
                                >
                                  Adjust
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingItem({
                                      id: it.id,
                                      name: it.name,
                                      category: it.category,
                                      quantity: it.quantity,
                                      unit: it.unit,
                                      minThreshold: it.minThreshold,
                                      unitCost: it.unitCost,
                                      supplierId: it.supplierId || '',
                                      supplierName: it.supplierName || '',
                                      isNew: false,
                                    })
                                  }
                                  title={`Edit threshold and details for ${it.name}`}
                                  aria-label={`Edit ${it.name}`}
                                  className="px-2 py-1 rounded border border-zinc-300 text-zinc-700 font-semibold inline-flex items-center gap-1 cursor-pointer hover:bg-zinc-50 transition-colors"
                                >
                                  <Pencil className="w-3 h-3" />
                                  <span>Edit</span>
                                </button>
                              </>
                            )}
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
      )}

      {/* TAB 2: History Ledger */}
      {tab === 'history' && (
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Timestamp</th>
                  <th className="px-4 py-3 font-semibold">Ingredient</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold text-right">Delta</th>
                  <th className="px-4 py-3 font-semibold">Note</th>
                  <th className="px-4 py-3 font-semibold">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3 font-mono-tabular text-zinc-500">
                      {formatDateTime(l.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-semibold">{l.itemName}</td>
                    <td className="px-4 py-3 uppercase font-semibold">{l.type}</td>
                    <td
                      className={`px-4 py-3 text-right font-mono-tabular font-bold ${
                        l.quantityDelta >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {l.quantityDelta >= 0 ? `+${l.quantityDelta}` : l.quantityDelta} {l.unit}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{l.note || '—'}</td>
                    <td className="px-4 py-3 text-zinc-700">{l.performedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Suppliers */}
      {tab === 'suppliers' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {suppliers.map((s) => (
            <div key={s.id} className="bg-white border border-zinc-200 rounded-xl p-5 space-y-2">
              <div className="flex items-center gap-2 text-[#9A7415]">
                <Truck className="w-4 h-4" />
                <span className="text-xs font-semibold">{s.category}</span>
              </div>
              <h3 className="text-base font-bold text-zinc-900">{s.name}</h3>
              <div className="text-xs text-zinc-600">Contact: {s.contactPerson}</div>
              <div className="text-xs font-mono-tabular text-zinc-600">{s.phone}</div>
              <div className="text-xs text-zinc-500">{s.address}</div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Ingredient & Threshold Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleSaveItemSubmit(e)}
            className="w-full max-w-md bg-white rounded-xl p-5 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <Package className="w-4 h-4 text-[#9A7415]" />
                {editingItem.isNew
                  ? 'Add Kitchen Ingredient'
                  : 'Edit Ingredient & Alert Threshold'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                aria-label="Close ingredient modal"
                className="p-1 text-zinc-500 hover:text-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-zinc-500 mb-1">Ingredient Name</label>
              <input
                required
                placeholder="Ingredient Name"
                value={editingItem.name}
                onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-zinc-500 mb-1">Category</label>
                <input
                  required
                  placeholder="Category (Dairy, Spices)"
                  value={editingItem.category}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, category: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-1">Unit</label>
                <input
                  required
                  placeholder="Unit (kg, L, pcs)"
                  value={editingItem.unit}
                  onChange={(e) => setEditingItem({ ...editingItem, unit: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-zinc-500 mb-1">
                  {editingItem.isNew ? 'Opening Qty' : 'Current Stock'}
                </label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  disabled={!editingItem.isNew}
                  value={editingItem.quantity}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      quantity: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full px-2 py-2 rounded-lg border border-zinc-300 font-mono-tabular disabled:bg-zinc-100 disabled:text-zinc-500"
                />
              </div>
              <div>
                <label className="block text-amber-800 font-semibold mb-1">
                  Min Alert ({editingItem.unit || 'unit'})
                </label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  required
                  value={editingItem.minThreshold}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      minThreshold: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full px-2 py-2 rounded-lg border border-amber-400 bg-amber-50/40 font-mono-tabular focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-1">Cost/Unit (₹)</label>
                <input
                  type="number"
                  min={0}
                  value={editingItem.unitCost}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      unitCost: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full px-2 py-2 rounded-lg border border-zinc-300 font-mono-tabular"
                />
              </div>
            </div>
            {!editingItem.isNew && (
              <p className="text-[11px] text-zinc-500">
                Stock quantities are updated via + Purchase or Adjust to preserve audit ledger history.
              </p>
            )}
            <div>
              <label className="block text-zinc-500 mb-1">Supplier</label>
              <select
                value={editingItem.supplierId || ''}
                onChange={(e) =>
                  setEditingItem({ ...editingItem, supplierId: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              >
                <option value="">No Supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-3 py-2 rounded-lg border border-zinc-300 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] font-semibold cursor-pointer disabled:opacity-50"
              >
                {saving
                  ? 'Saving...'
                  : editingItem.isNew
                  ? 'Save Ingredient'
                  : 'Update Ingredient'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Stock Movement Modal */}
      {movementTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleMovementSubmit(e)}
            className="w-full max-w-sm bg-white rounded-xl p-5 space-y-3 text-xs"
          >
            <h3 className="text-sm font-bold">
              {movementTarget.type === 'purchase' ? 'Record Purchase Entry' : 'Stock Adjustment'} ·{' '}
              {movementTarget.item.name}
            </h3>
            <p className="text-zinc-500 font-mono-tabular">
              Current Stock: {movementTarget.item.quantity} {movementTarget.item.unit} · Min Alert:{' '}
              {movementTarget.item.minThreshold} {movementTarget.item.unit}
            </p>
            <div>
              <label className="block font-semibold mb-1">
                Quantity Change ({movementTarget.item.unit}) — use negative to deduct
              </label>
              <input
                type="number"
                step="0.1"
                required
                value={deltaQty}
                onChange={(e) => setDeltaQty(Number(e.target.value) || 0)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 font-mono-tabular"
              />
            </div>
            <input
              type="text"
              required
              value={movementNote}
              onChange={(e) => setMovementNote(e.target.value)}
              placeholder="Invoice # or adjustment reason"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMovementTarget(null)}
                className="px-3 py-2 rounded-lg border border-zinc-300 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] font-semibold cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Confirm Entry'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Supplier Modal */}
      {editingSupplier && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveSupplier(editingSupplier);
              setEditingSupplier(null);
            }}
            className="w-full max-w-sm bg-white rounded-xl p-5 space-y-3 text-xs"
          >
            <h3 className="text-sm font-bold">Add Supplier</h3>
            <input
              required
              placeholder="Supplier Company Name"
              value={editingSupplier.name}
              onChange={(e) => setEditingSupplier({ ...editingSupplier, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300"
            />
            <input
              placeholder="Contact Person"
              value={editingSupplier.contactPerson || ''}
              onChange={(e) =>
                setEditingSupplier({ ...editingSupplier, contactPerson: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg border border-zinc-300"
            />
            <input
              placeholder="Phone Number"
              value={editingSupplier.phone || ''}
              onChange={(e) => setEditingSupplier({ ...editingSupplier, phone: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300"
            />
            <input
              placeholder="Category"
              value={editingSupplier.category || ''}
              onChange={(e) =>
                setEditingSupplier({ ...editingSupplier, category: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg border border-zinc-300"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingSupplier(null)}
                className="px-3 py-2 rounded-lg border border-zinc-300 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] font-semibold cursor-pointer"
              >
                Save Supplier
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
