import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import {
  BellRing,
  CheckCircle2,
  Clock,
  History,
  LogOut,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Star,
  User,
  Utensils,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import {
  createGuestServiceRequest,
  placeQrOrder,
  submitGuestFeedback,
  updateCustomerProfile,
} from '../services/firestoreService';
import {
  DEFAULT_HOTEL_SETTINGS,
  HOTEL_HERO_IMAGE,
  SEED_TABLES,
} from '../data/seedCatalog';
import {
  BAIDYANATH_MEDIA_LOGO,
  type CustomerProfile,
  type HotelSettings,
  type MenuCategory,
  type MenuItem,
  type Order,
  type OrderItem,
  type OrderStatus,
  type RestaurantTable,
} from '../types';
import { formatDateTime, formatINR } from '../utils/format';
import { DishImage } from './DishImage';

interface CustomerDashboardProps {
  customer: CustomerProfile;
  initialTableId?: string | null;
  onProfileUpdated: (next: CustomerProfile) => void;
  onSignOut: () => Promise<void>;
}

const ORDER_STEPS: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready', 'Served'];

export const CustomerDashboard: React.FC<CustomerDashboardProps> = ({
  customer,
  initialTableId,
  onProfileUpdated,
  onSignOut,
}) => {
  const [activeTab, setActiveTab] = useState<'menu' | 'orders' | 'feedback' | 'profile'>('menu');
  const [selectedTableId, setSelectedTableId] = useState<string>(
    initialTableId || customer.preferredTable || 'T1'
  );
  const [table, setTable] = useState<RestaurantTable | null>(null);
  const [tableExistsInDb, setTableExistsInDb] = useState(false);

  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [settings, setSettings] = useState<HotelSettings>({
    ...DEFAULT_HOTEL_SETTINGS,
    updatedAt: new Date(),
  });

  const [selectedCat, setSelectedCat] = useState<string>('all');
  const [dietFilter, setDietFilter] = useState<'all' | 'veg' | 'nonveg' | 'bestseller'>(
    customer.dietaryPreference || 'all'
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Feedback state
  const [foodRating, setFoodRating] = useState(5);
  const [serviceRating, setServiceRating] = useState(5);
  const [ambianceRating, setAmbianceRating] = useState(5);
  const [fbComment, setFbComment] = useState('');
  const [googleConsent, setGoogleConsent] = useState(false);
  const [fbSubmitted, setFbSubmitted] = useState(false);

  // Profile form state
  const [profName, setProfName] = useState(customer.displayName);
  const [profPhone, setProfPhone] = useState(customer.phone || '');
  const [profTable, setProfTable] = useState(customer.preferredTable || 'T1');
  const [profDiet, setProfDiet] = useState<'all' | 'veg' | 'nonveg'>(
    customer.dietaryPreference || 'all'
  );
  const [savingProfile, setSavingProfile] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const unsubTable = onSnapshot(doc(db, 'tables', selectedTableId), (snap) => {
      if (snap.exists()) {
        setTable(snap.data() as RestaurantTable);
        setTableExistsInDb(true);
      } else {
        setTableExistsInDb(false);
        const seedMatch = SEED_TABLES.find((t) => t.id === selectedTableId);
        setTable(
          seedMatch || {
            id: selectedTableId,
            tableNumber: selectedTableId,
            name: `Table ${selectedTableId}`,
            section: 'Main Dining Hall',
            capacity: 4,
            status: 'Available',
          }
        );
      }
    });

    const unsubCats = onSnapshot(
      query(collection(db, 'menu_categories'), orderBy('sortOrder', 'asc')),
      (snap) => {
        setCategories(snap.docs.map((d) => d.data() as MenuCategory).filter((c) => c.active));
      }
    );

    const unsubItems = onSnapshot(
      query(collection(db, 'menu_items'), orderBy('sortOrder', 'asc')),
      (snap) => {
        setMenuItems(snap.docs.map((d) => d.data() as MenuItem));
      }
    );

    const unsubSettings = onSnapshot(doc(db, 'hotel_settings', 'main'), (snap) => {
      if (snap.exists()) setSettings(snap.data() as HotelSettings);
    });

    const unsubOrders = onSnapshot(
      query(
        collection(db, 'orders'),
        where('customerId', '==', customer.uid),
        limit(40)
      ),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as Order)
          .sort(
            (a, b) =>
              new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()
          );
        setCustomerOrders(list);
      },
      (err) => console.warn('Customer orders listener:', err)
    );

    return () => {
      unsubTable();
      unsubCats();
      unsubItems();
      unsubSettings();
      unsubOrders();
    };
  }, [selectedTableId, customer.uid]);

  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (selectedCat !== 'all' && item.categoryId !== selectedCat) return false;
      if (dietFilter === 'veg' && !item.isVeg) return false;
      if (dietFilter === 'nonveg' && item.isVeg) return false;
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
  const cartSubtotal = useMemo(() => cart.reduce((s, i) => s + i.price * i.qty, 0), [cart]);

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
        if (nextQty <= 0) return prev.filter((i) => i.itemId !== dish.id);
        const clone = [...prev];
        clone[idx] = { ...clone[idx], qty: nextQty };
        return clone;
      }
      return prev;
    });
  };

  const getQtyInCart = (itemId: string) => cart.find((i) => i.itemId === itemId)?.qty || 0;

  const handlePlaceOrder = async () => {
    if (!table || cart.length === 0) return;
    if (!tableExistsInDb) {
      showToast('Selected table is not initialized yet. Ask staff to seed tables in Admin.');
      return;
    }
    setSubmitting(true);
    try {
      await placeQrOrder({
        table,
        items: cart,
        guestName: customer.displayName,
        guestSessionId: `cust_${customer.uid}`,
        customerId: customer.uid,
        specialInstructions,
      });
      setCart([]);
      setSpecialInstructions('');
      setCartOpen(false);
      setActiveTab('orders');
      showToast(`Order placed for Table ${table.tableNumber}!`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to place order.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleServiceCall = async (type: 'call_waiter' | 'request_bill') => {
    if (!table || !tableExistsInDb) {
      showToast('Table not initialized yet. Please alert a steward.');
      return;
    }
    try {
      await createGuestServiceRequest({ table, type });
      showToast(
        type === 'call_waiter'
          ? `Waiter called to Table ${table.tableNumber}.`
          : `Bill requested for Table ${table.tableNumber}.`
      );
    } catch {
      showToast('Could not send request.');
    }
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const overall = Math.round(((foodRating + serviceRating + ambianceRating) / 3) * 10) / 10;
    try {
      const latest = customerOrders[0];
      await submitGuestFeedback({
        orderId: latest?.id,
        orderNumber: latest?.orderNumber,
        tableNumber: table?.tableNumber || selectedTableId,
        guestName: customer.displayName,
        foodRating,
        serviceRating,
        ambianceRating,
        overallRating: overall,
        comment: fbComment,
        googleConsent,
      });
      setFbSubmitted(true);
      showToast('Thank you for your review!');
    } catch {
      showToast('Unable to submit feedback right now.');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateCustomerProfile(customer.uid, {
        displayName: profName,
        phone: profPhone,
        preferredTable: profTable,
        dietaryPreference: profDiet,
      });
      onProfileUpdated({
        ...customer,
        displayName: profName,
        phone: profPhone,
        preferredTable: profTable,
        dietaryPreference: profDiet,
      });
      setDietFilter(profDiet);
      setSelectedTableId(profTable);
      showToast('Customer profile updated.');
    } catch {
      showToast('Unable to save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F2] text-zinc-900 pb-24 flex flex-col">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#141518] text-[#D4AF37] border border-[#D4AF37]/40 px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Mobile-First Customer Header */}
      <header className="sticky top-0 z-30 bg-[#141518] text-white border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-display text-base sm:text-lg font-semibold text-white truncate">
              {settings.hotelName}
            </div>
            <div className="text-[11px] text-[#D4AF37] truncate">
              Welcome, {customer.displayName} · Table {table?.tableNumber || selectedTableId}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleServiceCall('call_waiter')}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-100 inline-flex items-center gap-1 cursor-pointer"
            >
              <BellRing className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span className="hidden sm:inline">Waiter</span>
            </button>
            <button
              type="button"
              onClick={() => void handleServiceCall('request_bill')}
              className="px-2.5 py-1.5 rounded-lg bg-[#C59B27] hover:bg-[#D4AF37] text-xs font-semibold text-[#141518] cursor-pointer"
            >
              Bill
            </button>
            <button
              type="button"
              onClick={() => void onSignOut()}
              title="Sign Out"
              className="p-2 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero + Table Selection */}
      <div className="relative h-36 sm:h-44 bg-[#141518] overflow-hidden">
        <img
          src={HOTEL_HERO_IMAGE}
          alt="Hotel Rudraksh Inn Dining"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#141518] via-[#141518]/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 max-w-5xl mx-auto px-4 pb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#D4AF37]">
              Customer Account Portal
            </p>
            <h1 className="font-display text-xl sm:text-2xl font-semibold text-white">
              Order & Live Dining History
            </h1>
          </div>
          <div className="flex items-center gap-2 bg-[#141518]/90 border border-white/15 rounded-xl px-3 py-1.5 text-xs">
            <span className="text-zinc-300">Table:</span>
            <select
              value={selectedTableId}
              onChange={(e) => setSelectedTableId(e.target.value)}
              aria-label="Select dining table"
              className="bg-transparent text-[#D4AF37] font-semibold focus:outline-none"
            >
              {SEED_TABLES.map((t) => (
                <option key={t.id} value={t.id} className="text-zinc-900">
                  {t.tableNumber} · {t.section}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Customer Navigation Tabs */}
      <div className="max-w-5xl w-full mx-auto px-4 pt-4">
        <div className="grid grid-cols-4 gap-1 p-1 bg-zinc-200/80 rounded-xl text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('menu')}
            className={`py-2 px-2 rounded-lg font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'menu' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
            }`}
          >
            <Utensils className="w-3.5 h-3.5" />
            <span>Menu</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`py-2 px-2 rounded-lg font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'orders' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Orders ({customerOrders.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('feedback')}
            className={`py-2 px-2 rounded-lg font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'feedback' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
            }`}
          >
            <Star className="w-3.5 h-3.5" />
            <span>Feedback</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`py-2 px-2 rounded-lg font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'profile' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Profile</span>
          </button>
        </div>
      </div>

      {/* Main Customer Body */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 mt-5">
        {activeTab === 'menu' && (
          <>
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search dishes..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm"
                />
              </div>
              <div className="flex items-center gap-1 p-1 bg-white border border-zinc-200 rounded-xl overflow-x-auto">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'veg', label: 'Pure Veg' },
                    { id: 'nonveg', label: 'Non-Veg' },
                    { id: 'bestseller', label: 'Bestsellers' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setDietFilter(f.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap ${
                      dietFilter === f.id
                        ? 'bg-[#141518] text-[#D4AF37]'
                        : 'text-zinc-600'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-4">
              <button
                type="button"
                onClick={() => setSelectedCat('all')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold border cursor-pointer whitespace-nowrap ${
                  selectedCat === 'all'
                    ? 'bg-[#141518] text-[#D4AF37] border-[#141518]'
                    : 'bg-white text-zinc-700 border-zinc-200'
                }`}
              >
                All Categories
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCat(c.id)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold border cursor-pointer whitespace-nowrap ${
                    selectedCat === c.id
                      ? 'bg-[#141518] text-[#D4AF37] border-[#141518]'
                      : 'bg-white text-zinc-700 border-zinc-200'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredItems.map((dish) => {
                const qty = getQtyInCart(dish.id);
                return (
                  <div
                    key={dish.id}
                    className={`bg-white border border-zinc-200 rounded-xl overflow-hidden flex ${
                      !dish.available ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="w-28 sm:w-36 shrink-0 bg-zinc-900">
                      <DishImage
                        src={dish.imageUrl}
                        alt={dish.name}
                        className="w-full h-full min-h-[130px]"
                      />
                    </div>
                    <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                          <span className={dish.isVeg ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
                            {dish.isVeg ? 'Veg' : 'Non-Veg'}
                          </span>
                          {dish.isBestseller && (
                            <>
                              <span>·</span>
                              <span className="font-semibold text-[#9A7415]">Bestseller</span>
                            </>
                          )}
                        </div>
                        <h3 className="text-sm font-semibold text-zinc-900">{dish.name}</h3>
                        <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{dish.description}</p>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-zinc-100 flex items-center justify-between">
                        <span className="font-mono-tabular text-sm font-semibold">
                          {formatINR(dish.price)}
                        </span>
                        {dish.available ? (
                          qty === 0 ? (
                            <button
                              type="button"
                              onClick={() => updateCartQty(dish, 1)}
                              className="px-3.5 py-1.5 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
                            >
                              Add +
                            </button>
                          ) : (
                            <div className="inline-flex items-center gap-2 bg-[#141518] text-white rounded-lg px-2 py-1">
                              <button
                                type="button"
                                onClick={() => updateCartQty(dish, -1)}
                                className="p-1 text-[#D4AF37] cursor-pointer"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="font-mono-tabular text-xs font-semibold">{qty}</span>
                              <button
                                type="button"
                                onClick={() => updateCartQty(dish, 1)}
                                className="p-1 text-[#D4AF37] cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="text-xs text-zinc-400">Unavailable</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {activeTab === 'orders' && (
          <div className="space-y-4">
            {customerOrders.length === 0 ? (
              <div className="bg-white border border-zinc-200 rounded-xl p-10 text-center">
                <Clock className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
                <h3 className="text-base font-semibold">No orders placed from your account yet</h3>
                <p className="text-xs text-zinc-500 mt-1 mb-4">
                  Orders you place while signed in appear here with live kitchen tracking.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('menu')}
                  className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
                >
                  Explore Menu
                </button>
              </div>
            ) : (
              customerOrders.map((ord) => {
                const currentStep = Math.max(
                  0,
                  ORDER_STEPS.indexOf(ord.status === 'Completed' ? 'Served' : ord.status)
                );
                return (
                  <div key={ord.id} className="bg-white border border-zinc-200 rounded-xl p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-100">
                      <div>
                        <div className="text-xs text-zinc-500">
                          Table {ord.tableNumber || '—'} · {formatDateTime(ord.createdAt)}
                        </div>
                        <h3 className="font-mono-tabular text-base font-bold text-zinc-900">
                          {ord.orderNumber}
                        </h3>
                      </div>
                      <span className="text-xs font-semibold text-[#9A7415]">{ord.status}</span>
                    </div>

                    {ord.status !== 'Cancelled' && (
                      <div className="grid grid-cols-5 gap-2 my-4">
                        {ORDER_STEPS.map((step, idx) => (
                          <div key={step} className="text-center">
                            <div
                              className={`h-1.5 rounded-full mb-1.5 ${
                                idx <= currentStep ? 'bg-[#C59B27]' : 'bg-zinc-200'
                              }`}
                            />
                            <span
                              className={`text-[10px] ${
                                idx <= currentStep ? 'text-zinc-900 font-semibold' : 'text-zinc-400'
                              }`}
                            >
                              {step}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="divide-y divide-zinc-100 text-xs">
                      {ord.items.map((it, idx) => (
                        <div key={`${it.itemId}_${idx}`} className="py-1.5 flex justify-between">
                          <span>
                            <strong className="font-mono-tabular">{it.qty}×</strong> {it.name}
                          </span>
                          <span className="font-mono-tabular">{formatINR(it.price * it.qty)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 pt-2 border-t border-zinc-200 flex justify-between text-xs font-bold">
                      <span>Subtotal</span>
                      <span className="font-mono-tabular">{formatINR(ord.subtotal)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'feedback' && (
          <div className="max-w-xl mx-auto bg-white border border-zinc-200 rounded-xl p-6">
            {fbSubmitted ? (
              <div className="text-center py-6 space-y-2">
                <CheckCircle2 className="w-9 h-9 text-emerald-600 mx-auto" />
                <h3 className="font-display text-xl font-semibold">Thank you for your feedback!</h3>
                <button
                  type="button"
                  onClick={() => {
                    setFbSubmitted(false);
                    setFbComment('');
                  }}
                  className="text-xs font-semibold text-[#9A7415] underline cursor-pointer"
                >
                  Submit another review
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleFeedbackSubmit(e)} className="space-y-4">
                <h3 className="font-display text-xl font-semibold">Rate Your Experience</h3>
                {(
                  [
                    { label: 'Food Quality', val: foodRating, set: setFoodRating },
                    { label: 'Service Speed', val: serviceRating, set: setServiceRating },
                    { label: 'Ambiance', val: ambianceRating, set: setAmbianceRating },
                  ] as const
                ).map((r) => (
                  <div key={r.label} className="flex items-center justify-between text-sm">
                    <span>{r.label}</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => r.set(s)}
                          className="p-1 cursor-pointer"
                        >
                          <Star
                            className={`w-5 h-5 ${
                              s <= r.val ? 'fill-[#C59B27] text-[#C59B27]' : 'text-zinc-300'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <textarea
                  rows={3}
                  value={fbComment}
                  onChange={(e) => setFbComment(e.target.value)}
                  placeholder="Share your comments..."
                  className="w-full px-3 py-2 rounded-xl border border-zinc-300 text-xs"
                />
                <label className="flex items-center gap-2 text-xs text-zinc-600">
                  <input
                    type="checkbox"
                    checked={googleConsent}
                    onChange={(e) => setGoogleConsent(e.target.checked)}
                  />
                  Show Google Review link after submitting
                </label>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
                >
                  Submit Feedback
                </button>
              </form>
            )}
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="max-w-xl mx-auto bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
            <h3 className="font-display text-xl font-semibold">Customer Profile</h3>
            <form onSubmit={(e) => void handleSaveProfile(e)} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-zinc-700 mb-1">Full Name</label>
                <input
                  required
                  value={profName}
                  onChange={(e) => setProfName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300"
                />
              </div>
              <div>
                <label className="block font-semibold text-zinc-700 mb-1">Email</label>
                <input
                  disabled
                  value={customer.email || 'Phone Authenticated'}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-100 text-zinc-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1">Phone Number</label>
                  <input
                    value={profPhone}
                    onChange={(e) => setProfPhone(e.target.value)}
                    placeholder="+91..."
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1">Preferred Table</label>
                  <select
                    value={profTable}
                    onChange={(e) => setProfTable(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300"
                  >
                    {SEED_TABLES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.tableNumber} · {t.section}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-zinc-700 mb-1">
                  Default Dietary Filter
                </label>
                <select
                  value={profDiet}
                  onChange={(e) => setProfDiet(e.target.value as 'all' | 'veg' | 'nonveg')}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300"
                >
                  <option value="all">All Dishes</option>
                  <option value="veg">Pure Veg Only</option>
                  <option value="nonveg">Non-Veg Only</option>
                </select>
              </div>
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => void onSignOut()}
                  className="px-4 py-2 rounded-lg border border-red-200 text-red-700 font-semibold cursor-pointer"
                >
                  Logout
                </button>
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="px-5 py-2 rounded-lg bg-[#141518] text-[#D4AF37] font-semibold cursor-pointer"
                >
                  {savingProfile ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      {/* Sticky Bottom Cart Bar */}
      {cartCount > 0 && !cartOpen && (
        <div className="fixed bottom-4 inset-x-0 z-30 px-4">
          <div className="max-w-5xl mx-auto">
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="w-full bg-[#141518] text-white border border-[#D4AF37]/40 rounded-xl px-5 py-3 shadow-xl flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-3 text-left">
                <ShoppingBag className="w-5 h-5 text-[#D4AF37]" />
                <div>
                  <div className="text-xs font-semibold">
                    {cartCount} {cartCount === 1 ? 'item' : 'items'} · Table {table?.tableNumber || selectedTableId}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono-tabular text-sm font-semibold text-[#D4AF37]">
                  {formatINR(cartSubtotal)}
                </span>
                <span className="px-3 py-1.5 rounded-lg bg-[#C59B27] text-[#141518] text-xs font-semibold">
                  Review Order
                </span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Cart Drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[88vh] flex flex-col">
            <div className="px-5 py-4 bg-[#141518] text-white flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold">Confirm Table Order</h3>
                <p className="text-xs text-zinc-400">
                  {customer.displayName} · Table {table?.tableNumber || selectedTableId}
                </p>
              </div>
              <button type="button" onClick={() => setCartOpen(false)} className="cursor-pointer">
                <X className="w-5 h-5 text-zinc-400" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3 flex-1 text-xs">
              {cart.map((item) => {
                const dish = menuItems.find((m) => m.id === item.itemId);
                return (
                  <div key={item.itemId} className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
                    <div>
                      <div className="font-semibold text-zinc-900">{item.name}</div>
                      <div className="text-zinc-500 font-mono-tabular">{formatINR(item.price)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => dish && updateCartQty(dish, -1)}
                        className="p-1 border border-zinc-300 rounded cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="font-mono-tabular font-semibold">{item.qty}</span>
                      <button
                        type="button"
                        onClick={() => dish && updateCartQty(dish, 1)}
                        className="p-1 border border-zinc-300 rounded cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
              <textarea
                rows={2}
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                placeholder="Special kitchen instructions..."
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
            <div className="p-5 bg-zinc-50 border-t border-zinc-200 space-y-3">
              <div className="flex justify-between text-sm font-bold">
                <span>Order Subtotal</span>
                <span className="font-mono-tabular">{formatINR(cartSubtotal)}</span>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handlePlaceOrder()}
                className="w-full py-3 rounded-xl bg-[#141518] text-[#D4AF37] text-sm font-semibold cursor-pointer"
              >
                {submitting ? 'Placing Order...' : 'Place Order Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="max-w-5xl w-full mx-auto px-4 pt-10 text-xs text-zinc-500 flex flex-wrap items-center justify-between gap-2">
        <span>{settings.hotelName} · Customer Portal</span>
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
