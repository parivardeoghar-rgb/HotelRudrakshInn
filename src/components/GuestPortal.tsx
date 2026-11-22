import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import {
  ArrowLeft,
  ArrowRightLeft,
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Minus,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
  Star,
  Utensils,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  changeCustomerOrderTable,
  createGuestServiceRequest,
  placeQrOrder,
  submitGuestFeedback,
} from '../services/firestoreService';
import { DEFAULT_HOTEL_SETTINGS, HOTEL_HERO_IMAGE, SEED_TABLES } from '../data/seedCatalog';
import {
  BAIDYANATH_MEDIA_LOGO,
  type DietaryTag,
  type HotelSettings,
  type MenuCategory,
  type MenuItem,
  type Order,
  type OrderItem,
  type OrderStatus,
  type RestaurantTable,
} from '../types';
import { formatINR, formatTime, toDate } from '../utils/format';
import { useOrderReadyNotifications } from '../hooks/useOrderReadyNotifications';
import { DietaryPreferenceField } from './DietaryPreferenceField';
import { DishImage } from './DishImage';

interface GuestPortalProps {
  tableId: string;
  customerUid?: string | null;
  customerName?: string | null;
  onRequestCustomerLogin?: (tableId: string) => void;
  onExitToStaffLogin?: () => void;
}

const ORDER_STEPS: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready', 'Served'];

export const GuestPortal: React.FC<GuestPortalProps> = ({
  tableId,
  customerUid,
  customerName,
  onRequestCustomerLogin,
  onExitToStaffLogin,
}) => {
  const [table, setTable] = useState<RestaurantTable | null>(null);
  const [tableExistsInDb, setTableExistsInDb] = useState(false);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [settings, setSettings] = useState<HotelSettings>({
    ...DEFAULT_HOTEL_SETTINGS,
    updatedAt: new Date(),
  });
  const [loading, setLoading] = useState(true);

  const [selectedCat, setSelectedCat] = useState<string>('all');
  const [dietFilter, setDietFilter] = useState<'all' | 'bestseller'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [cart, setCart] = useState<OrderItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [guestName, setGuestName] = useState(customerName || '');
  const [dietaryTags, setDietaryTags] = useState<DietaryTag[]>([]);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [transferTargets, setTransferTargets] = useState<Record<string, string>>({});
  const [transferBusyOrderId, setTransferBusyOrderId] = useState<string | null>(null);
  const [transferRequestedMap, setTransferRequestedMap] = useState<Record<string, string>>({});

  const storageKey = `rudraksh_guest_orders_${tableId}`;
  const [trackedOrderIds, setTrackedOrderIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [trackedOrders, setTrackedOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<'menu' | 'tracking' | 'feedback'>('menu');

  // Feedback form state
  const [foodRating, setFoodRating] = useState(5);
  const [serviceRating, setServiceRating] = useState(5);
  const [ambianceRating, setAmbianceRating] = useState(5);
  const [fbComment, setFbComment] = useState('');
  const [googleConsent, setGoogleConsent] = useState(false);
  const [fbSubmitted, setFbSubmitted] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const { isNotifyEnabled, toggleNotifyForOrder } = useOrderReadyNotifications(
    trackedOrders,
    (readyOrd) => {
      showToast(`Order ${readyOrd.orderNumber} is Ready!`);
    }
  );

  // Subscribe to public menu, categories, table, and hotel settings
  useEffect(() => {
    const unsubTable = onSnapshot(
      doc(db, 'tables', tableId),
      (snap) => {
        if (snap.exists()) {
          setTable(snap.data() as RestaurantTable);
          setTableExistsInDb(true);
        } else {
          setTableExistsInDb(false);
          setTable({
            id: tableId,
            tableNumber: tableId,
            name: `Table ${tableId}`,
            section: 'Main Dining Hall',
            capacity: 4,
            status: 'Available',
          });
        }
        setLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `tables/${tableId}`)
    );

    const unsubCats = onSnapshot(
      query(collection(db, 'menu_categories'), orderBy('sortOrder', 'asc')),
      (snap) => {
        setCategories(
          snap.docs.map((d) => d.data() as MenuCategory).filter((c) => c.active)
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'menu_categories')
    );

    const unsubItems = onSnapshot(
      query(collection(db, 'menu_items'), orderBy('sortOrder', 'asc')),
      (snap) => {
        setMenuItems(snap.docs.map((d) => d.data() as MenuItem));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'menu_items')
    );

    const unsubSettings = onSnapshot(
      doc(db, 'hotel_settings', 'main'),
      (snap) => {
        if (snap.exists()) {
          setSettings(snap.data() as HotelSettings);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, 'hotel_settings/main')
    );

    return () => {
      unsubTable();
      unsubCats();
      unsubItems();
      unsubSettings();
    };
  }, [tableId]);

  // Listen in real time to guest's tracked orders by explicit doc ID
  useEffect(() => {
    if (trackedOrderIds.length === 0) {
      setTrackedOrders([]);
      return;
    }
    const unsubs = trackedOrderIds.slice(-6).map((oid) =>
      onSnapshot(
        doc(db, 'orders', oid),
        (snap) => {
          if (snap.exists()) {
            const ord = snap.data() as Order;
            setTrackedOrders((prev) => {
              const filtered = prev.filter((p) => p.id !== ord.id);
              return [ord, ...filtered].sort(
                (a, b) =>
                  toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()
              );
            });
          }
        },
        (err) => console.warn('Order track listener:', err)
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [trackedOrderIds]);

  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (item.isVeg === false) return false;
      if (selectedCat !== 'all' && item.categoryId !== selectedCat) return false;
      if (dietFilter === 'bestseller' && !item.isBestseller) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.categoryName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [menuItems, selectedCat, dietFilter, searchTerm]);

  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);
  const cartSubtotal = useMemo(
    () => cart.reduce((s, i) => s + i.price * i.qty, 0),
    [cart]
  );

  const updateCartQty = (dish: MenuItem, delta: number) => {
    if (!dish.available && delta > 0) return;
    setCart((prev) => {
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
        if (nextQty <= 0) {
          return prev.filter((i) => i.itemId !== dish.id);
        }
        const clone = [...prev];
        clone[idx] = { ...clone[idx], qty: nextQty };
        return clone;
      }
      return prev;
    });
  };

  const getQtyInCart = (itemId: string) =>
    cart.find((i) => i.itemId === itemId)?.qty || 0;

  const mustLoginBeforeOrder = Boolean(settings.requireCustomerLogin && !customerUid);

  const handlePlaceOrder = async () => {
    if (!table || cart.length === 0) return;
    if (mustLoginBeforeOrder) {
      onRequestCustomerLogin?.(tableId);
      return;
    }
    if (!tableExistsInDb) {
      showToast('This table is not registered yet. Ask staff to initialize the catalog in Admin Dashboard.');
      return;
    }
    setSubmitting(true);
    try {
      const orderId = await placeQrOrder({
        table,
        items: cart,
        guestName: guestName || customerName || 'Table Guest',
        guestSessionId: customerUid ? `cust_${customerUid}` : `session_${table.id}`,
        customerId: customerUid || undefined,
        dietaryTags,
        specialInstructions,
      });
      const updated = [...trackedOrderIds, orderId].slice(-6);
      setTrackedOrderIds(updated);
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch {
        // ignore storage quota errors
      }
      setCart([]);
      setDietaryTags([]);
      setSpecialInstructions('');
      setCartOpen(false);
      setActiveTab('tracking');
      showToast('Order sent to Hotel Rudraksh Inn kitchen!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to place order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleServiceCall = async (type: 'call_waiter' | 'request_bill') => {
    if (!table) return;
    if (!tableExistsInDb) {
      showToast('This table is not registered yet. Please alert a steward directly.');
      return;
    }
    try {
      await createGuestServiceRequest({ table, type });
      showToast(
        type === 'call_waiter'
          ? `Waiter notified for Table ${table.tableNumber}.`
          : `Bill request sent to Cashier for Table ${table.tableNumber}.`
      );
    } catch {
      showToast('Could not send request. Please alert a steward.');
    }
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const overall = Math.round(((foodRating + serviceRating + ambianceRating) / 3) * 10) / 10;
    try {
      const latestOrder = trackedOrders[0];
      await submitGuestFeedback({
        orderId: latestOrder?.id,
        orderNumber: latestOrder?.orderNumber,
        tableNumber: table?.tableNumber || tableId,
        guestName: guestName || 'Dining Guest',
        foodRating,
        serviceRating,
        ambianceRating,
        overallRating: overall,
        comment: fbComment,
        googleConsent,
      });
      setFbSubmitted(true);
      showToast('Thank you for sharing your dining feedback!');
    } catch {
      showToast('Could not submit feedback right now.');
    }
  };

  const handleChangeOrderTable = async (ord: Order, targetTableId: string) => {
    if (!targetTableId || targetTableId === ord.tableId) return;
    const targetMeta = SEED_TABLES.find((t) => t.id === targetTableId);
    setTransferBusyOrderId(ord.id);
    try {
      const res = await changeCustomerOrderTable({
        order: ord,
        targetTableId,
        targetTableNumberFallback: targetMeta?.tableNumber || targetTableId,
        customerUid,
      });
      if (res.mode === 'transferred') {
        showToast(`Order ${ord.orderNumber} synced to Table ${res.targetTableNumber}.`);
      } else {
        setTransferRequestedMap((prev) => ({
          ...prev,
          [ord.id]: res.targetTableNumber,
        }));
        showToast(
          `Transfer request to Table ${res.targetTableNumber} sent to your steward.`
        );
      }
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Unable to request table transfer right now.'
      );
    } finally {
      setTransferBusyOrderId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F2] text-zinc-900 pb-24">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#141518] text-[#D4AF37] border border-[#D4AF37]/40 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-[#141518] text-white border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {onExitToStaffLogin && (
              <button
                type="button"
                onClick={onExitToStaffLogin}
                className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:text-white transition-colors shrink-0 cursor-pointer"
                title="Back to Homepage"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <span className="font-display text-lg font-semibold text-white whitespace-nowrap truncate">
              {settings.hotelName}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-300 shrink-0">
            <span className="font-semibold text-[#D4AF37]">
              Table {table?.tableNumber || tableId}
            </span>
            <span aria-hidden="true">·</span>
            <span className="hidden sm:inline">{table?.section || 'Dining Hall'}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleServiceCall('call_waiter')}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-100 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BellRing className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>Waiter</span>
            </button>
            <button
              type="button"
              onClick={() => void handleServiceCall('request_bill')}
              className="px-3 py-1.5 rounded-lg bg-[#C59B27] hover:bg-[#D4AF37] text-xs font-semibold text-[#141518] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>Bill</span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero Banner */}
      <div className="relative h-44 sm:h-52 bg-[#141518] overflow-hidden">
        <img
          src={HOTEL_HERO_IMAGE}
          alt="Hotel Rudraksh Inn Dining"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#141518] via-[#141518]/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 max-w-5xl mx-auto px-4 pb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-[#D4AF37]">
              100% Pure Veg · {settings.tagline || 'Pure Vegetarian Dining & Hospitality'}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white mt-0.5">
              Digital Table Menu · Table {table?.tableNumber || tableId}
            </h1>
          </div>
          <div className="text-xs text-zinc-300">
            {settings.operatingHours || '07:00 AM – 11:00 PM'} · No app required
          </div>
        </div>
      </div>

      {/* Mode Switch Tabs */}
      <div className="max-w-5xl mx-auto px-4 pt-4">
        <div className="inline-flex items-center gap-1 p-1 bg-zinc-200/80 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('menu')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'menu'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Browse Menu ({menuItems.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tracking')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'tracking'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Order Tracking ({trackedOrders.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('feedback')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'feedback'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Feedback & Review
          </button>
        </div>
      </div>

      {/* Main Tab View */}
      <main className="max-w-5xl mx-auto px-4 mt-5">
        {activeTab === 'menu' && (
          <>
            {/* Search + Dietary Filter Row */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search paneer, biryani, naan, lassi..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>

              <div className="flex items-center gap-1 p-1 bg-white border border-zinc-200 rounded-xl overflow-x-auto">
                {(
                  [
                    { id: 'all', label: 'All Pure Veg' },
                    { id: 'bestseller', label: 'Bestsellers' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setDietFilter(f.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      dietFilter === f.id
                        ? 'bg-[#141518] text-[#D4AF37]'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Bar */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-5">
              <button
                type="button"
                onClick={() => setSelectedCat('all')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedCat === 'all'
                    ? 'bg-[#141518] text-[#D4AF37] border-[#141518]'
                    : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300'
                }`}
              >
                All Categories
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCat(cat.id)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedCat === cat.id
                      ? 'bg-[#141518] text-[#D4AF37] border-[#141518]'
                      : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-36 bg-white border border-zinc-200 rounded-xl animate-pulse"
                  />
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="bg-white border border-zinc-200 rounded-xl p-10 text-center">
                <Utensils className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-zinc-900">
                  {menuItems.length === 0
                    ? 'Menu is being prepared'
                    : 'No dishes match your filter'}
                </h3>
                <p className="text-sm text-zinc-500 mt-1">
                  {menuItems.length === 0
                    ? 'Ask the restaurant manager to initialize the digital catalog in Admin Dashboard.'
                    : 'Try clearing your search or switching dietary filters.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredItems.map((dish) => {
                  const qty = getQtyInCart(dish.id);
                  return (
                    <div
                      key={dish.id}
                      className={`bg-white border border-zinc-200 rounded-xl overflow-hidden flex transition-opacity ${
                        !dish.available ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="w-32 sm:w-36 shrink-0 bg-zinc-900">
                        <DishImage
                          src={dish.imageUrl}
                          alt={dish.name}
                          className="w-full h-full min-h-[140px]"
                        />
                      </div>

                      <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
                        <div>
                          <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                              <span className="w-2.5 h-2.5 border border-emerald-700 flex items-center justify-center rounded-[2px]">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-700" />
                              </span>
                              Pure Veg
                            </span>
                            {dish.isBestseller && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-semibold text-[#9A7415]">Bestseller</span>
                              </>
                            )}
                            {!dish.available && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-semibold text-red-600">Unavailable</span>
                              </>
                            )}
                          </div>

                          <h3 className="text-sm sm:text-base font-semibold text-zinc-900 leading-snug">
                            {dish.name}
                          </h3>
                          <p className="text-xs text-zinc-500 mt-1 line-clamp-2 leading-relaxed">
                            {dish.description}
                          </p>
                        </div>

                        <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center justify-between gap-2">
                          <span className="font-mono-tabular text-sm font-semibold text-zinc-900">
                            {formatINR(dish.price)}
                          </span>

                          {dish.available ? (
                            qty === 0 ? (
                              <button
                                type="button"
                                onClick={() => updateCartQty(dish, 1)}
                                className="px-3.5 py-1.5 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold hover:bg-zinc-800 transition-colors cursor-pointer whitespace-nowrap"
                              >
                                Add +
                              </button>
                            ) : (
                              <div className="inline-flex items-center gap-2 bg-[#141518] text-white rounded-lg px-2 py-1">
                                <button
                                  type="button"
                                  onClick={() => updateCartQty(dish, -1)}
                                  aria-label={`Remove one ${dish.name}`}
                                  className="p-1 text-[#D4AF37] hover:text-white cursor-pointer"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <span className="font-mono-tabular text-xs font-semibold min-w-[16px] text-center">
                                  {qty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => updateCartQty(dish, 1)}
                                  aria-label={`Add one ${dish.name}`}
                                  className="p-1 text-[#D4AF37] hover:text-white cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )
                          ) : (
                            <span className="text-xs font-medium text-zinc-400">Sold out</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Order Tracking View */}
        {activeTab === 'tracking' && (
          <div className="space-y-4">
            {trackedOrders.length === 0 ? (
              <div className="bg-white border border-zinc-200 rounded-xl p-10 text-center">
                <Clock className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-zinc-900">No active orders yet</h3>
                <p className="text-sm text-zinc-500 mt-1 mb-4">
                  Add dishes from the menu to place an order and track live kitchen progress here.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('menu')}
                  className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-sm font-semibold cursor-pointer"
                >
                  Browse Menu
                </button>
              </div>
            ) : (
              trackedOrders.map((ord) => {
                const currentStep = Math.max(
                  0,
                  ORDER_STEPS.indexOf(ord.status === 'Completed' ? 'Served' : ord.status)
                );
                const canNotify =
                  ord.status === 'New' ||
                  ord.status === 'Accepted' ||
                  ord.status === 'Preparing';
                const notifyOn = isNotifyEnabled(ord.id);
                const canChangeTable =
                  !ord.billed &&
                  ord.status !== 'Completed' &&
                  ord.status !== 'Cancelled' &&
                  Boolean(ord.tableId);
                const otherTables = SEED_TABLES.filter((t) => t.id !== ord.tableId);
                const selectedTargetId =
                  transferTargets[ord.id] && transferTargets[ord.id] !== ord.tableId
                    ? transferTargets[ord.id]
                    : otherTables[0]?.id || '';

                return (
                  <div
                    key={ord.id}
                    className="bg-white border border-zinc-200 rounded-xl p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-zinc-100">
                      <div>
                        <div className="text-xs text-zinc-500">
                          Table {ord.tableNumber || tableId} · {formatTime(ord.createdAt)}
                        </div>
                        <h3 className="font-mono-tabular text-lg font-semibold text-zinc-900 mt-0.5">
                          {ord.orderNumber}
                        </h3>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {canNotify && (
                          <button
                            type="button"
                            aria-pressed={notifyOn}
                            onClick={async () => {
                              const res = await toggleNotifyForOrder(ord);
                              if (res.message) showToast(res.message);
                            }}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              notifyOn
                                ? 'bg-emerald-50 border-emerald-700/40 text-emerald-900'
                                : 'bg-white border-zinc-300 text-zinc-700 hover:border-[#C59B27]'
                            }`}
                          >
                            {notifyOn ? (
                              <BellRing className="w-3.5 h-3.5 text-emerald-700" />
                            ) : (
                              <Bell className="w-3.5 h-3.5 text-zinc-500" />
                            )}
                            <span>{notifyOn ? 'Notify on' : 'Notify me'}</span>
                          </button>
                        )}
                        <div className="text-right">
                          <div className="text-xs text-zinc-500">Status</div>
                          <div className="text-sm font-semibold text-[#9A7415]">
                            {ord.status}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Live Progress Stepper */}
                    {ord.status !== 'Cancelled' ? (
                      <div className="grid grid-cols-5 gap-2 my-5">
                        {ORDER_STEPS.map((step, idx) => {
                          const done = idx <= currentStep;
                          return (
                            <div key={step} className="text-center">
                              <div
                                className={`h-1.5 rounded-full mb-2 ${
                                  done ? 'bg-[#C59B27]' : 'bg-zinc-200'
                                }`}
                              />
                              <span
                                className={`text-[11px] font-medium ${
                                  done ? 'text-zinc-900 font-semibold' : 'text-zinc-400'
                                }`}
                              >
                                {step}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="my-4 p-3 rounded-lg bg-red-50 text-red-700 text-xs font-medium">
                        This order was cancelled. Please contact your steward if you need assistance.
                      </div>
                    )}

                    <div className="divide-y divide-zinc-100">
                      {ord.items.map((item, i) => (
                        <div
                          key={`${item.itemId}_${i}`}
                          className="py-2 flex items-center justify-between text-sm"
                        >
                          <span>
                            <span className="font-mono-tabular font-semibold">{item.qty}×</span>{' '}
                            {item.name}
                          </span>
                          <span className="font-mono-tabular text-zinc-700">
                            {formatINR(item.price * item.qty)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 pt-3 border-t border-zinc-200 flex items-center justify-between text-sm font-semibold">
                      <span>Order Subtotal (excl. taxes)</span>
                      <span className="font-mono-tabular">{formatINR(ord.subtotal)}</span>
                    </div>

                    {canChangeTable && otherTables.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-zinc-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5 text-zinc-600 font-medium">
                          <ArrowRightLeft className="w-3.5 h-3.5 text-[#9A7415] shrink-0" />
                          <label htmlFor={`guest-change-table-${ord.id}`}>
                            Switched seats? Move order:
                          </label>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            id={`guest-change-table-${ord.id}`}
                            value={selectedTargetId}
                            disabled={transferBusyOrderId === ord.id}
                            onChange={(e) =>
                              setTransferTargets((prev) => ({
                                ...prev,
                                [ord.id]: e.target.value,
                              }))
                            }
                            className="px-2.5 py-1.5 rounded-lg border border-zinc-300 bg-white text-xs font-semibold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                          >
                            {otherTables.map((t) => (
                              <option key={t.id} value={t.id}>
                                Table {t.tableNumber} · {t.section}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={!selectedTargetId || transferBusyOrderId === ord.id}
                            onClick={() => void handleChangeOrderTable(ord, selectedTargetId)}
                            className="px-3 py-1.5 rounded-lg border border-[#C59B27]/70 bg-[#FDF9EC] hover:bg-[#F7EBC4] text-[#141518] text-xs font-semibold transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {transferBusyOrderId === ord.id ? 'Updating...' : 'Change Table'}
                          </button>
                        </div>
                        {transferRequestedMap[ord.id] && (
                          <div className="w-full text-[11px] font-medium text-amber-800">
                            Transfer to Table {transferRequestedMap[ord.id]} requested · Steward notified.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Feedback & Consent-Based Review View */}
        {activeTab === 'feedback' && (
          <div className="max-w-xl mx-auto bg-white border border-zinc-200 rounded-xl p-6">
            {fbSubmitted ? (
              <div className="text-center py-6">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
                <h3 className="font-display text-xl font-semibold text-zinc-900">
                  Thank you for dining with us
                </h3>
                <p className="text-sm text-zinc-600 mt-1">
                  Your feedback helps Hotel Rudraksh Inn serve you better every day.
                </p>

                {googleConsent && settings.googleReviewUrl && (
                  <div className="mt-6 p-4 rounded-xl bg-zinc-50 border border-zinc-200 text-left">
                    <div className="text-xs font-semibold text-zinc-800 mb-1">
                      Optional Google Review Link
                    </div>
                    <p className="text-xs text-zinc-600 mb-3">
                      Reviews are never posted automatically. You may copy your note and share it
                      directly on Google if you wish.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {fbComment && (
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(fbComment);
                            showToast('Review text copied to clipboard');
                          }}
                          className="px-3 py-2 rounded-lg border border-zinc-300 bg-white text-xs font-medium text-zinc-800 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copy My Note
                        </button>
                      )}
                      <a
                        href={settings.googleReviewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3.5 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open Google Review Page
                      </a>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setFbSubmitted(false);
                    setFbComment('');
                  }}
                  className="mt-6 text-xs font-semibold text-[#9A7415] underline cursor-pointer"
                >
                  Submit another response
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleFeedbackSubmit(e)} className="space-y-5">
                <div>
                  <h3 className="font-display text-xl font-semibold text-zinc-900">
                    Share Your Dining Feedback
                  </h3>
                  <p className="text-xs text-zinc-500 mt-1">
                    Table {table?.tableNumber || tableId} · Hotel Rudraksh Inn, Deoghar
                  </p>
                </div>

                {(
                  [
                    { label: 'Food Quality & Taste', val: foodRating, set: setFoodRating },
                    { label: 'Service & Hospitality', val: serviceRating, set: setServiceRating },
                    { label: 'Ambiance & Cleanliness', val: ambianceRating, set: setAmbianceRating },
                  ] as const
                ).map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-zinc-800">{row.label}</span>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => row.set(star)}
                          className="p-1 cursor-pointer"
                          aria-label={`Rate ${row.label} ${star} stars`}
                        >
                          <Star
                            className={`w-5 h-5 ${
                              star <= row.val
                                ? 'fill-[#C59B27] text-[#C59B27]'
                                : 'text-zinc-300'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                    Comments or Suggestions
                  </label>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={fbComment}
                    onChange={(e) => setFbComment(e.target.value)}
                    placeholder="Tell us what you enjoyed or how we can improve..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                  />
                </div>

                <label className="flex items-start gap-2.5 text-xs text-zinc-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={googleConsent}
                    onChange={(e) => setGoogleConsent(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 accent-[#141518]"
                  />
                  <span>
                    I would also like a direct link to optionally post my review on Google (never
                    posted automatically).
                  </span>
                </label>

                <button
                  type="submit"
                  className="w-full py-3 rounded-xl bg-[#141518] text-[#D4AF37] font-semibold text-sm hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Submit Feedback
                </button>
              </form>
            )}
          </div>
        )}
      </main>

      {/* Sticky Bottom Cart Bar (<= 15% mobile height) */}
      {cartCount > 0 && !cartOpen && (
        <div className="fixed bottom-4 inset-x-0 z-30 px-4">
          <div className="max-w-5xl mx-auto">
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="w-full bg-[#141518] text-white border border-[#D4AF37]/40 rounded-xl px-5 py-3.5 shadow-xl flex items-center justify-between cursor-pointer hover:bg-zinc-900 transition-colors"
            >
              <div className="flex items-center gap-3">
                <ShoppingBag className="w-5 h-5 text-[#D4AF37]" />
                <div className="text-left">
                  <div className="text-sm font-semibold">
                    {cartCount} {cartCount === 1 ? 'item' : 'items'} in Cart
                  </div>
                  <div className="text-xs text-zinc-400">Table {table?.tableNumber || tableId}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono-tabular text-base font-semibold text-[#D4AF37]">
                  {formatINR(cartSubtotal)}
                </span>
                <span className="px-3 py-1.5 rounded-lg bg-[#C59B27] text-[#141518] text-xs font-semibold">
                  View Cart
                </span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Cart Drawer Modal */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 bg-[#141518] text-white flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold">Your Table Order</h3>
                <p className="text-xs text-zinc-400">
                  Table {table?.tableNumber || tableId} · {settings.hotelName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
                aria-label="Close cart"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {cart.map((item) => {
                const dish = menuItems.find((m) => m.id === item.itemId);
                return (
                  <div
                    key={item.itemId}
                    className="flex items-center justify-between gap-3 pb-3 border-b border-zinc-100"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900 truncate">
                        {item.name}
                      </div>
                      <div className="font-mono-tabular text-xs text-zinc-500">
                        {formatINR(item.price)} each
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="inline-flex items-center gap-2 border border-zinc-300 rounded-lg px-2 py-1">
                        <button
                          type="button"
                          onClick={() => dish && updateCartQty(dish, -1)}
                          className="p-0.5 text-zinc-700 cursor-pointer"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="font-mono-tabular text-xs font-semibold min-w-[16px] text-center">
                          {item.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => dish && updateCartQty(dish, 1)}
                          className="p-0.5 text-zinc-700 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="font-mono-tabular text-sm font-semibold w-20 text-right">
                        {formatINR(item.price * item.qty)}
                      </span>
                    </div>
                  </div>
                );
              })}

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Guest Name (Optional)
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="e.g. Amit Kumar"
                  className="w-full px-3.5 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>

              <DietaryPreferenceField value={dietaryTags} onChange={setDietaryTags} />

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Special Kitchen Instructions (Optional)
                </label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={specialInstructions}
                  onChange={(e) => setSpecialInstructions(e.target.value)}
                  placeholder="Less spicy, extra chutney..."
                  className="w-full px-3.5 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>
            </div>

            <div className="p-5 bg-zinc-50 border-t border-zinc-200 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-600">Subtotal (applicable taxes at billing)</span>
                <span className="font-mono-tabular text-lg font-bold text-zinc-900">
                  {formatINR(cartSubtotal)}
                </span>
              </div>
              {mustLoginBeforeOrder ? (
                <div className="space-y-2">
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Customer sign-in is enabled for table orders. Sign in or register to submit your order.
                  </p>
                  <button
                    type="button"
                    onClick={() => onRequestCustomerLogin?.(tableId)}
                    className="w-full py-3.5 rounded-xl bg-[#141518] text-[#D4AF37] font-semibold text-sm hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    Customer Login to Place Order
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={submitting || cart.length === 0}
                  onClick={() => void handlePlaceOrder()}
                  className="w-full py-3.5 rounded-xl bg-[#141518] text-[#D4AF37] font-semibold text-sm hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Sending Order to Kitchen...' : 'Place Order Now'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Branded Footer */}
      <footer className="max-w-5xl mx-auto px-4 pt-10 text-xs text-zinc-500 flex flex-wrap items-center justify-between gap-2">
        <span>{settings.hotelName} · QR Table Menu</span>
        <span className="inline-flex items-center gap-2">
          <img
            src={BAIDYANATH_MEDIA_LOGO}
            alt="Baidyanath Media"
            className="w-5 h-5 rounded object-cover bg-[#F4F1EA]"
          />
          <span>Powered by Baidyanath Media Agency</span>
        </span>
      </footer>
    </div>
  );
};
