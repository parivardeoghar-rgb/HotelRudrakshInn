import React, { useMemo, useState } from 'react';
import { Area, AreaChart, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Copy,
  Download,
  Mail,
  Package,
  Pencil,
  Plus,
  Search,
  Send,
  Truck,
  X,
} from 'lucide-react';
import {
  dispatchSupplierReorderNotification,
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
import { downloadCSV, formatDateTime, formatINR, toDate } from '../utils/format';

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

  const [reorderModalOpen, setReorderModalOpen] = useState(false);
  const [selectedSupplierKey, setSelectedSupplierKey] = useState<string>('');
  const [draftRecipientEmail, setDraftRecipientEmail] = useState<string>('');
  const [draftEmailSubject, setDraftEmailSubject] = useState<string>('');
  const [draftEmailBody, setDraftEmailBody] = useState<string>('');
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [dispatchingReorder, setDispatchingReorder] = useState(false);

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

  const criticalStats = useMemo(() => {
    let outOfStockCount = 0;
    let estimatedReorderCost = 0;
    for (const item of lowStockItems) {
      if (item.quantity <= 0) outOfStockCount += 1;
      const reorderQty = Math.max(1, Math.ceil(Math.max(item.minThreshold * 2 - item.quantity, 5)));
      estimatedReorderCost += reorderQty * (Number(item.unitCost) || 0);
    }
    return {
      outOfStockCount,
      estimatedReorderCost: Math.round(estimatedReorderCost * 100) / 100,
    };
  }, [lowStockItems]);

  const supplierReorderGroups = useMemo(() => {
    type ReorderLine = {
      item: InventoryItem;
      reorderQty: number;
      lineEstimate: number;
    };
    type SupplierGroup = {
      key: string;
      supplier?: Supplier;
      supplierName: string;
      items: ReorderLine[];
      estimatedTotal: number;
    };

    const groupsMap = new Map<string, SupplierGroup>();

    for (const item of lowStockItems) {
      const matchedSupplier =
        suppliers.find((s) => s.id === item.supplierId) ||
        (item.supplierName
          ? suppliers.find(
              (s) => s.name.toLowerCase() === item.supplierName?.trim().toLowerCase()
            )
          : undefined);
      const key = matchedSupplier?.id || item.supplierId || '__unassigned__';
      const supplierName =
        matchedSupplier?.name || item.supplierName || 'Unassigned Supplier';
      const reorderQty = Math.max(
        1,
        Math.ceil(Math.max(item.minThreshold * 2 - item.quantity, 5))
      );
      const lineEstimate = Math.round(reorderQty * (Number(item.unitCost) || 0) * 100) / 100;

      let existing = groupsMap.get(key);
      if (!existing) {
        existing = {
          key,
          supplier: matchedSupplier,
          supplierName,
          items: [],
          estimatedTotal: 0,
        };
        groupsMap.set(key, existing);
      }
      existing.items.push({ item, reorderQty, lineEstimate });
      existing.estimatedTotal =
        Math.round((existing.estimatedTotal + lineEstimate) * 100) / 100;
    }

    return Array.from(groupsMap.values()).sort((a, b) => {
      if (a.key === '__unassigned__') return 1;
      if (b.key === '__unassigned__') return -1;
      return b.items.length - a.items.length;
    });
  }, [lowStockItems, suppliers]);

  const activeReorderGroup = useMemo(
    () =>
      supplierReorderGroups.find((g) => g.key === selectedSupplierKey) ||
      supplierReorderGroups[0] ||
      null,
    [supplierReorderGroups, selectedSupplierKey]
  );

  const buildSupplierDraft = (group: (typeof supplierReorderGroups)[number]) => {
    const recipient = group.supplier?.email || '';
    const count = group.items.length;
    const subject = `Reorder Request: ${count} Critical Inventory ${
      count === 1 ? 'Item' : 'Items'
    } — Hotel Rudraksh Inn`;
    const greetingName = group.supplier?.contactPerson || group.supplierName;
    const itemLines = group.items
      .map(
        ({ item, reorderQty, lineEstimate }, idx) =>
          `${idx + 1}. ${item.name} — Current: ${item.quantity} ${item.unit} (Min Alert: ${item.minThreshold} ${item.unit}) | Reorder Qty: +${reorderQty} ${item.unit} (Est. ${formatINR(lineEstimate)})`
      )
      .join('\n');

    const body = [
      `Dear ${greetingName},`,
      '',
      'Please arrange an immediate restock delivery for Hotel Rudraksh Inn (Tower Chowk, Station Road, Deoghar, Jharkhand 814112) for the following critical low-stock items:',
      '',
      itemLines,
      '',
      `Estimated Reorder Total: ${formatINR(group.estimatedTotal)}`,
      '',
      'Kindly confirm availability and expected dispatch time.',
      '',
      'Regards,',
      currentUser.displayName,
      'Kitchen & Inventory Operations · Hotel Rudraksh Inn',
    ].join('\n');

    return { recipient, subject, body };
  };

  const selectSupplierGroup = (group: (typeof supplierReorderGroups)[number]) => {
    const { recipient, subject, body } = buildSupplierDraft(group);
    setSelectedSupplierKey(group.key);
    setDraftRecipientEmail(recipient);
    setDraftEmailSubject(subject);
    setDraftEmailBody(body);
    setCopiedDraft(false);
  };

  const openSupplierReorderModal = () => {
    const firstGroup = supplierReorderGroups[0];
    if (!firstGroup) return;
    selectSupplierGroup(firstGroup);
    setReorderModalOpen(true);
  };

  const handleCopyReorderDraft = async () => {
    const fullText = [
      draftRecipientEmail ? `To: ${draftRecipientEmail}` : '',
      `Subject: ${draftEmailSubject}`,
      '',
      draftEmailBody,
    ]
      .filter((line, idx) => idx > 0 || line !== '')
      .join('\n');
    try {
      await navigator.clipboard.writeText(fullText);
      setCopiedDraft(true);
      showToast('Reorder email draft copied to clipboard.');
      setTimeout(() => setCopiedDraft(false), 2500);
    } catch {
      showToast('Unable to copy automatically — please copy from the text box.', 'error');
    }
  };

  const handleTriggerReorderNotification = async () => {
    if (!activeReorderGroup) return;
    setDispatchingReorder(true);
    try {
      await dispatchSupplierReorderNotification({
        supplierId: activeReorderGroup.supplier?.id,
        supplierName: activeReorderGroup.supplierName,
        recipientEmail: draftRecipientEmail,
        itemNames: activeReorderGroup.items.map((line) => line.item.name),
        estimatedCost: activeReorderGroup.estimatedTotal,
        actor: currentUser,
      });
      showToast(
        `Reorder notification sent for ${activeReorderGroup.supplierName} (${activeReorderGroup.items.length} items).`
      );
      setReorderModalOpen(false);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to send reorder notification.',
        'error'
      );
    } finally {
      setDispatchingReorder(false);
    }
  };

  const handleSaveSupplierEmail = async () => {
    if (!activeReorderGroup?.supplier) return;
    const cleanEmail = draftRecipientEmail.trim().toLowerCase();
    try {
      await saveSupplier({
        ...activeReorderGroup.supplier,
        email: cleanEmail,
        isNew: false,
      });
      showToast(`Saved email ${cleanEmail || '(cleared)'} for ${activeReorderGroup.supplier.name}.`);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Unable to save supplier email.',
        'error'
      );
    }
  };

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

  // Aggregate last 7 calendar days of consumption per ingredient
  const consumptionWindow = useMemo(() => {
    const toLocalKey = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const today = new Date();
    const days: { key: string; day: string }[] = [];
    const dayKeySet = new Set<string>();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = toLocalKey(d);
      dayKeySet.add(key);
      days.push({
        key,
        day: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      });
    }

    const perItemDayTotals = new Map<string, Map<string, number>>();
    for (const log of logs) {
      if (log.type !== 'consumption') continue;
      const d = toDate(log.createdAt);
      const key = toLocalKey(d);
      if (!dayKeySet.has(key)) continue;

      const consumed = Math.abs(Number(log.quantityDelta) || 0);
      if (consumed <= 0) continue;

      let dayMap = perItemDayTotals.get(log.itemId);
      if (!dayMap) {
        dayMap = new Map<string, number>();
        perItemDayTotals.set(log.itemId, dayMap);
      }
      dayMap.set(key, (dayMap.get(key) || 0) + consumed);
    }

    return { days, perItemDayTotals };
  }, [logs]);

  const getItemConsumptionSeries = (itemId: string) => {
    const dayMap = consumptionWindow.perItemDayTotals.get(itemId);
    let total = 0;
    const series = consumptionWindow.days.map((slot) => {
      const raw = dayMap?.get(slot.key) || 0;
      const rounded = Math.round(raw * 1000) / 1000;
      total += rounded;
      return { day: slot.day, consumed: rounded };
    });
    return {
      series,
      total: Math.round(total * 1000) / 1000,
    };
  };

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
        '7d Consumption',
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
        const usage7d = getItemConsumptionSeries(i.id).total;
        return [
          i.name,
          i.category,
          i.quantity,
          i.unit,
          i.minThreshold,
          statusLabel,
          usage7d,
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
                  email: '',
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
          {/* Critical Items Summary Card */}
          <section
            aria-label="Critical Items Summary"
            className={`rounded-xl border p-4 sm:p-5 transition-colors ${
              lowStockCount > 0
                ? 'bg-amber-50/70 border-amber-300'
                : 'bg-white border-zinc-200'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className={`p-2 rounded-lg shrink-0 ${
                    lowStockCount > 0
                      ? 'bg-amber-100 text-amber-800 border border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}
                >
                  {lowStockCount > 0 ? (
                    <AlertTriangle className="w-4 h-4" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-zinc-900">Critical Items</h3>
                    <span className="text-xs font-mono-tabular font-semibold text-zinc-600">
                      · {lowStockCount} {lowStockCount === 1 ? 'item' : 'items'} needing immediate reorder
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    {lowStockCount > 0
                      ? `${criticalStats.outOfStockCount} out of stock · Estimated restock budget ${formatINR(criticalStats.estimatedReorderCost)}`
                      : `All ${inventory.length} tracked ingredients are above their configured Min Alert thresholds.`}
                  </p>
                </div>
              </div>

              {lowStockCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={openSupplierReorderModal}
                    className="px-3.5 py-1.5 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer hover:bg-zinc-800 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5 shrink-0" />
                    <span>Send to Supplier</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setStockFilter((prev) => (prev === 'low' ? 'all' : 'low'))
                    }
                    className={`px-3.5 py-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      stockFilter === 'low'
                        ? 'bg-amber-600 border-amber-600 text-white hover:bg-amber-700'
                        : 'bg-white border-amber-300 text-amber-900 hover:bg-amber-100/70'
                    }`}
                  >
                    {stockFilter === 'low'
                      ? `Show All (${inventory.length})`
                      : `Filter Critical (${lowStockCount})`}
                  </button>
                </div>
              )}
            </div>

            {lowStockCount > 0 && (
              <div className="mt-4 pt-3.5 border-t border-amber-200/80 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {lowStockItems.slice(0, 6).map((item) => {
                  const reorderQty = Math.max(
                    1,
                    Math.ceil(Math.max(item.minThreshold * 2 - item.quantity, 5))
                  );
                  return (
                    <div
                      key={item.id}
                      className="bg-white border border-amber-200 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-900 truncate">
                          {item.name}
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono-tabular mt-0.5 truncate">
                          {item.quantity} / {item.minThreshold} {item.unit}
                          {item.supplierName ? ` · ${item.supplierName}` : ''}
                        </div>
                      </div>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => {
                            setMovementTarget({ item, type: 'purchase' });
                            setDeltaQty(reorderQty);
                            setMovementNote('Immediate reorder (Critical Stock)');
                          }}
                          className="px-2.5 py-1 rounded bg-[#141518] text-[#D4AF37] text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer hover:bg-zinc-800 transition-colors"
                        >
                          Reorder +{reorderQty} {item.unit}
                        </button>
                      ) : (
                        <span className="text-[11px] font-mono-tabular font-semibold text-amber-800 shrink-0">
                          Need +{reorderQty} {item.unit}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

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
                      <th className="px-4 py-3 font-semibold">Stock Level &amp; 7d Usage</th>
                      <th className="px-4 py-3 font-semibold text-right">Min Alert</th>
                      <th className="px-4 py-3 font-semibold text-right">Unit Cost</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {displayedInventory.map((it) => {
                      const health = getStockHealth(it);
                      const spark = getItemConsumptionSeries(it.id);
                      const sparkStroke = health.isLow ? '#D97706' : '#9A7415';
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
                          <td className="px-4 py-3 min-w-[275px]">
                            <div className="flex items-center gap-4">
                              <div className="flex-1 min-w-[130px]">
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
                              </div>

                              <div
                                className="w-[100px] shrink-0"
                                aria-label={`${it.name} last 7 days consumption sparkline: ${spark.total} ${it.unit} used`}
                              >
                                <div className="flex items-baseline justify-between gap-1 text-[10px] mb-0.5">
                                  <span className="text-zinc-500">7d use</span>
                                  <span className="font-mono-tabular font-semibold text-zinc-700">
                                    {spark.total} {it.unit}
                                  </span>
                                </div>
                                <div className="w-[96px] h-[26px]">
                                  <AreaChart
                                    width={96}
                                    height={26}
                                    data={spark.series}
                                    margin={{ top: 3, right: 2, bottom: 2, left: 2 }}
                                  >
                                    <defs>
                                      <linearGradient
                                        id={`spark-${it.id}`}
                                        x1="0"
                                        y1="0"
                                        x2="0"
                                        y2="1"
                                      >
                                        <stop
                                          offset="0%"
                                          stopColor={sparkStroke}
                                          stopOpacity={0.28}
                                        />
                                        <stop
                                          offset="100%"
                                          stopColor={sparkStroke}
                                          stopOpacity={0.02}
                                        />
                                      </linearGradient>
                                    </defs>
                                    <XAxis dataKey="day" hide />
                                    <YAxis
                                      hide
                                      domain={[0, (dataMax: number) => Math.max(dataMax, 1)]}
                                    />
                                    <Tooltip
                                      cursor={{
                                        stroke: '#D4AF37',
                                        strokeWidth: 1,
                                        strokeDasharray: '2 2',
                                      }}
                                      wrapperStyle={{ zIndex: 40, pointerEvents: 'none' }}
                                      contentStyle={{
                                        backgroundColor: '#141518',
                                        border: '1px solid rgba(212, 175, 55, 0.35)',
                                        borderRadius: 8,
                                        padding: '4px 8px',
                                        fontSize: 11,
                                        color: '#FAFAFA',
                                      }}
                                      itemStyle={{ color: '#D4AF37', padding: 0 }}
                                      labelStyle={{
                                        color: '#A1A1AA',
                                        fontSize: 10,
                                        marginBottom: 1,
                                      }}
                                      formatter={(val) => [`${val} ${it.unit}`, 'Consumed']}
                                    />
                                    <Area
                                      type="monotone"
                                      dataKey="consumed"
                                      stroke={sparkStroke}
                                      strokeWidth={1.75}
                                      fill={`url(#spark-${it.id})`}
                                      dot={false}
                                      activeDot={{
                                        r: 2.5,
                                        fill: '#141518',
                                        stroke: sparkStroke,
                                        strokeWidth: 1.5,
                                      }}
                                      isAnimationActive={false}
                                    />
                                  </AreaChart>
                                </div>
                              </div>
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
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-amber-900 text-[11px] font-semibold">
                                <AlertTriangle className="w-3 h-3 text-amber-700 shrink-0" />
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
            <div key={s.id} className="bg-white border border-zinc-200 rounded-xl p-5 space-y-2 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[#9A7415]">
                    <Truck className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-semibold">{s.category}</span>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditingSupplier({
                          id: s.id,
                          name: s.name,
                          contactPerson: s.contactPerson || '',
                          phone: s.phone || '',
                          email: s.email || '',
                          category: s.category || '',
                          address: s.address || '',
                          isNew: false,
                        })
                      }
                      aria-label={`Edit ${s.name}`}
                      className="px-2 py-1 rounded border border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                  )}
                </div>
                <h3 className="text-base font-bold text-zinc-900">{s.name}</h3>
                <div className="text-xs text-zinc-600">Contact: {s.contactPerson || '—'}</div>
                <div className="text-xs font-mono-tabular text-zinc-600">{s.phone || '—'}</div>
                {s.email && (
                  <div className="text-xs text-zinc-700 flex items-center gap-1.5 truncate">
                    <Mail className="w-3.5 h-3.5 text-[#9A7415] shrink-0" />
                    <span className="truncate">{s.email}</span>
                  </div>
                )}
                <div className="text-xs text-zinc-500">{s.address}</div>
              </div>
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

      {/* Add / Edit Supplier Modal */}
      {editingSupplier && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              try {
                await saveSupplier(editingSupplier);
                showToast(
                  editingSupplier.isNew
                    ? `Supplier ${editingSupplier.name} added.`
                    : `Updated supplier ${editingSupplier.name}.`
                );
                setEditingSupplier(null);
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : 'Unable to save supplier.',
                  'error'
                );
              } finally {
                setSaving(false);
              }
            }}
            className="w-full max-w-sm bg-white rounded-xl p-5 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-1.5">
                <Truck className="w-4 h-4 text-[#9A7415]" />
                {editingSupplier.isNew ? 'Add Supplier' : 'Edit Supplier'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingSupplier(null)}
                aria-label="Close supplier modal"
                className="p-1 text-zinc-500 hover:text-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
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
              type="email"
              placeholder="Supplier Email (for reorder drafts)"
              value={editingSupplier.email || ''}
              onChange={(e) => setEditingSupplier({ ...editingSupplier, email: e.target.value })}
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
            <input
              placeholder="Address"
              value={editingSupplier.address || ''}
              onChange={(e) =>
                setEditingSupplier({ ...editingSupplier, address: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg border border-zinc-300"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingSupplier(null)}
                className="px-3 py-2 rounded-lg border border-zinc-300 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] font-semibold cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Supplier'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Send Critical Reorder to Supplier Modal */}
      {reorderModalOpen && activeReorderGroup && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="send-supplier-title"
            className="w-full max-w-2xl bg-white rounded-2xl border border-zinc-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="px-5 py-4 bg-[#141518] text-white flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-lg bg-[#D4AF37]/15 text-[#D4AF37] shrink-0">
                  <Send className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 id="send-supplier-title" className="text-sm font-bold text-white truncate">
                    Send Immediate Reorder to Supplier
                  </h3>
                  <p className="text-[11px] text-zinc-400 truncate">
                    Draft an email purchase order or dispatch an internal reorder notification
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReorderModalOpen(false)}
                aria-label="Close send to supplier modal"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {/* Supplier Selector Tabs */}
              <div>
                <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                  Assigned Suppliers with Critical Stock ({supplierReorderGroups.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {supplierReorderGroups.map((group) => {
                    const isSelected = group.key === activeReorderGroup.key;
                    return (
                      <button
                        key={group.key}
                        type="button"
                        onClick={() => selectSupplierGroup(group)}
                        className={`px-3 py-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#141518] border-[#141518] text-[#D4AF37]'
                            : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                        }`}
                      >
                        <Truck className="w-3.5 h-3.5 shrink-0" />
                        <span>{group.supplierName}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono-tabular font-bold ${
                            isSelected
                              ? 'bg-[#D4AF37]/20 text-[#D4AF37]'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {group.items.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Critical Items Preview for Selected Supplier */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-900">
                    Items for {activeReorderGroup.supplierName}
                  </span>
                  <span className="font-mono-tabular font-bold text-amber-900">
                    Est. Total: {formatINR(activeReorderGroup.estimatedTotal)}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {activeReorderGroup.items.map(({ item, reorderQty, lineEstimate }) => (
                    <div
                      key={item.id}
                      className="bg-white border border-amber-200/80 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-zinc-900 truncate">{item.name}</div>
                        <div className="text-[11px] text-zinc-500 font-mono-tabular">
                          Now: {item.quantity} / Min: {item.minThreshold} {item.unit}
                        </div>
                      </div>
                      <div className="text-right shrink-0 font-mono-tabular">
                        <div className="font-bold text-amber-900">
                          +{reorderQty} {item.unit}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {formatINR(lineEstimate)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Supplier Contact & Email Field */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-500 font-semibold mb-1">
                    Supplier Recipient Email
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="email"
                      value={draftRecipientEmail}
                      onChange={(e) => setDraftRecipientEmail(e.target.value)}
                      placeholder="supplier@example.com"
                      className="flex-1 px-3 py-2 rounded-lg border border-zinc-300 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                    />
                    {canManage &&
                      activeReorderGroup.supplier &&
                      draftRecipientEmail.trim().toLowerCase() !==
                        (activeReorderGroup.supplier.email || '').trim().toLowerCase() && (
                        <button
                          type="button"
                          onClick={() => void handleSaveSupplierEmail()}
                          className="px-2.5 py-2 rounded-lg border border-zinc-300 bg-zinc-50 hover:bg-zinc-100 text-[11px] font-semibold text-zinc-700 whitespace-nowrap cursor-pointer"
                        >
                          Save Email
                        </button>
                      )}
                  </div>
                </div>
                <div>
                  <label className="block text-zinc-500 font-semibold mb-1">
                    Supplier Contact Info
                  </label>
                  <div className="px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-700 font-mono-tabular truncate">
                    {activeReorderGroup.supplier?.contactPerson || 'No contact name'} ·{' '}
                    {activeReorderGroup.supplier?.phone || 'No phone on file'}
                  </div>
                </div>
              </div>

              {/* Email Subject & Body */}
              <div>
                <label className="block text-zinc-500 font-semibold mb-1">Email Subject</label>
                <input
                  type="text"
                  value={draftEmailSubject}
                  onChange={(e) => setDraftEmailSubject(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-zinc-900 font-medium focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>

              <div>
                <label className="block text-zinc-500 font-semibold mb-1">
                  Drafted Reorder Email Content
                </label>
                <textarea
                  rows={8}
                  value={draftEmailBody}
                  onChange={(e) => setDraftEmailBody(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 text-zinc-900 font-mono text-[11px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 bg-zinc-50 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void handleCopyReorderDraft()}
                className="px-3 py-2 rounded-lg border border-zinc-300 bg-white text-zinc-800 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedDraft ? 'Copied!' : 'Copy Email Draft'}</span>
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`mailto:${encodeURIComponent(
                    draftRecipientEmail.trim()
                  )}?subject=${encodeURIComponent(
                    draftEmailSubject
                  )}&body=${encodeURIComponent(draftEmailBody)}`}
                  className="px-3.5 py-2 rounded-lg border border-zinc-300 bg-white text-zinc-900 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap hover:bg-zinc-100 transition-colors"
                >
                  <Mail className="w-3.5 h-3.5 text-[#9A7415]" />
                  <span>Open Email Draft</span>
                </a>

                <button
                  type="button"
                  disabled={dispatchingReorder}
                  onClick={() => void handleTriggerReorderNotification()}
                  className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>
                    {dispatchingReorder ? 'Sending...' : 'Trigger Reorder Notification'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
