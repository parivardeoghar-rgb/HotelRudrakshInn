import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  MessageCircle,
  Minus,
  Navigation,
  Phone,
  Plus,
  QrCode,
  RotateCcw,
  Search,
  ShoppingBag,
  Star,
  Trash2,
  User,
  Utensils,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import {
  placeQrOrder,
  submitGuestFeedback,
} from '../services/firestoreService';
import {
  DEFAULT_HOTEL_SETTINGS,
  HOTEL_HERO_IMAGE,
  SEED_TABLES,
} from '../data/seedCatalog';
import {
  BAIDYANATH_MEDIA_LOGO,
  type CustomerProfile,
  type Feedback,
  type HotelSettings,
  type MenuCategory,
  type MenuItem,
  type Order,
  type OrderItem,
  type OrderStatus,
  type RestaurantTable,
} from '../types';
import { formatDateTime, formatINR, formatTime } from '../utils/format';
import { DishImage } from './DishImage';

interface CustomerHomepageProps {
  customerProfile: CustomerProfile | null;
  onOpenCustomerPortal: () => void;
  onOpenStaffPortals: () => void;
  onOpenGuestQrMenu: (tableId: string) => void;
  onRequestCustomerLogin: (tableId?: string) => void;
}

const ORDER_STEPS: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready', 'Served'];
const HOME_ORDERS_STORAGE_KEY = 'rudraksh_homepage_orders';

function toDigitsOnly(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

const VegMark: React.FC<{ label?: string }> = ({ label }) => (
  <span className="inline-flex items-center gap-1.5 text-emerald-800 font-medium">
    <span
      aria-hidden="true"
      className="w-3.5 h-3.5 border border-emerald-700 flex items-center justify-center rounded-[2px] bg-white shrink-0"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-700" />
    </span>
    {label && <span>{label}</span>}
  </span>
);

export const CustomerHomepage: React.FC<CustomerHomepageProps> = ({
  customerProfile,
  onOpenCustomerPortal,
  onOpenStaffPortals,
  onOpenGuestQrMenu,
  onRequestCustomerLogin,
}) => {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [approvedReviews, setApprovedReviews] = useState<Feedback[]>([]);
  const [settings, setSettings] = useState<HotelSettings>({
    ...DEFAULT_HOTEL_SETTINGS,
    updatedAt: new Date(),
  });
  const [loadingMenu, setLoadingMenu] = useState(true);

  const [selectedCat, setSelectedCat] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTableId, setSelectedTableId] = useState<string>(
    customerProfile?.preferredTable || 'T1'
  );

  // Cart & ordering state
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [guestName, setGuestName] = useState(customerProfile?.displayName || '');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [placingOrder, setPlacingOrder] = useState(false);
  const [orderNotice, setOrderNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [confirmedOrderNumber, setConfirmedOrderNumber] = useState<string | null>(null);

  // Tracked orders persisted locally
  const [trackedOrderIds, setTrackedOrderIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(HOME_ORDERS_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [trackedOrders, setTrackedOrders] = useState<Order[]>([]);
  const [trackerOpen, setTrackerOpen] = useState(false);

  // Feedback form state
  const [fbName, setFbName] = useState(customerProfile?.displayName || '');
  const [fbRating, setFbRating] = useState(5);
  const [fbComment, setFbComment] = useState('');
  const [fbSubmitting, setFbSubmitting] = useState(false);
  const [fbSuccess, setFbSuccess] = useState(false);
  const [fbError, setFbError] = useState<string | null>(null);

  useEffect(() => {
    if (customerProfile?.displayName && !guestName) {
      setGuestName(customerProfile.displayName);
    }
    if (customerProfile?.displayName && !fbName) {
      setFbName(customerProfile.displayName);
    }
  }, [customerProfile, guestName, fbName]);

  // Live public subscriptions: categories, pure-veg menu items, hotel settings, approved feedback
  useEffect(() => {
    const unsubCats = onSnapshot(
      query(collection(db, 'menu_categories'), orderBy('sortOrder', 'asc')),
      (snap) => {
        setCategories(
          snap.docs.map((d) => d.data() as MenuCategory).filter((c) => c.active)
        );
      },
      () => {
        setLoadingMenu(false);
      }
    );

    const unsubItems = onSnapshot(
      query(collection(db, 'menu_items'), orderBy('sortOrder', 'asc')),
      (snap) => {
        setMenuItems(
          snap.docs
            .map((d) => d.data() as MenuItem)
            .filter((item) => item.isVeg !== false)
        );
        setLoadingMenu(false);
      },
      () => {
        setLoadingMenu(false);
      }
    );

    const unsubSettings = onSnapshot(
      doc(db, 'hotel_settings', 'main'),
      (snap) => {
        if (snap.exists()) {
          setSettings(snap.data() as HotelSettings);
        }
      },
      () => {
        // default settings already loaded
      }
    );

    const unsubReviews = onSnapshot(
      query(collection(db, 'feedback'), where('approved', '==', true), limit(24)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as Feedback)
          .sort((a, b) => {
            const ta = new Date(String(a.createdAt || 0)).getTime();
            const tb = new Date(String(b.createdAt || 0)).getTime();
            return tb - ta;
          });
        setApprovedReviews(list);
      },
      () => {
        // non-blocking if empty
      }
    );

    return () => {
      unsubCats();
      unsubItems();
      unsubSettings();
      unsubReviews();
    };
  }, []);

  // Subscribe to placed orders in real time by explicit document ID
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
              const others = prev.filter((o) => o.id !== ord.id);
              return [ord, ...others].sort(
                (a, b) =>
                  new Date(String(b.createdAt || 0)).getTime() -
                  new Date(String(a.createdAt || 0)).getTime()
              );
            });
          }
        },
        () => {
          // ignore stale doc IDs
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [trackedOrderIds]);

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return menuItems.filter((item) => {
      if (item.isVeg === false) return false;
      if (selectedCat !== 'all' && item.categoryId !== selectedCat) return false;
      if (q) {
        return (
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.categoryName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [menuItems, selectedCat, searchTerm]);

  const cartCount = useMemo(() => cart.reduce((sum, i) => sum + i.qty, 0), [cart]);
  const cartSubtotal = useMemo(
    () => cart.reduce((sum, i) => sum + i.price * i.qty, 0),
    [cart]
  );

  const getQtyInCart = (itemId: string) =>
    cart.find((i) => i.itemId === itemId)?.qty || 0;

  const updateCartQty = (dish: MenuItem, delta: number) => {
    if (!dish.available && delta > 0) return;
    setOrderNotice(null);
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
            isVeg: true,
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

  const removeFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((i) => i.itemId !== itemId));
  };

  const handleReorder = (order: Order) => {
    const skipped: string[] = [];
    const nextItems: OrderItem[] = [];

    for (const prevItem of order.items) {
      const liveDish = menuItems.find((m) => m.id === prevItem.itemId);
      if (menuItems.length > 0) {
        if (!liveDish || !liveDish.available || liveDish.isVeg === false) {
          skipped.push(prevItem.name);
          continue;
        }
        nextItems.push({
          itemId: liveDish.id,
          name: liveDish.name,
          price: liveDish.price,
          qty: prevItem.qty,
          isVeg: true,
          categoryName: liveDish.categoryName,
          ...(prevItem.notes ? { notes: prevItem.notes } : {}),
        });
      } else {
        nextItems.push({
          ...prevItem,
          isVeg: true,
        });
      }
    }

    if (nextItems.length === 0) {
      setOrderNotice({
        type: 'err',
        text: `None of the dishes from ${order.orderNumber} are currently available to reorder.`,
      });
      return;
    }

    setCart(nextItems);
    if (order.tableId && SEED_TABLES.some((t) => t.id === order.tableId)) {
      setSelectedTableId(order.tableId);
    }
    if (order.specialInstructions) {
      setSpecialInstructions(order.specialInstructions);
    }
    setOrderNotice(
      skipped.length > 0
        ? {
            type: 'ok',
            text: `Cart pre-filled from ${order.orderNumber}. Unavailable item(s) skipped: ${skipped.join(', ')}.`,
          }
        : {
            type: 'ok',
            text: `Cart pre-filled with ${nextItems.length} dish(es) from ${order.orderNumber}.`,
          }
    );
    setCartOpen(true);
  };

  const mustLoginBeforeOrder = Boolean(settings.requireCustomerLogin && !customerProfile);

  const handlePlaceOrder = async () => {
    if (cart.length === 0) return;
    if (mustLoginBeforeOrder) {
      onRequestCustomerLogin(selectedTableId);
      return;
    }

    setPlacingOrder(true);
    setOrderNotice(null);
    try {
      const tableSnap = await getDoc(doc(db, 'tables', selectedTableId));
      if (!tableSnap.exists()) {
        setOrderNotice({
          type: 'err',
          text: 'Selected table is not initialized yet. Please ask our restaurant team to initialize tables in Admin Dashboard.',
        });
        return;
      }
      const targetTable = tableSnap.data() as RestaurantTable;

      const orderId = await placeQrOrder({
        table: targetTable,
        items: cart,
        guestName: guestName || customerProfile?.displayName || 'Dining Guest',
        guestSessionId: customerProfile
          ? `cust_${customerProfile.uid}`
          : `home_${targetTable.id}`,
        customerId: customerProfile?.uid,
        specialInstructions,
      });

      const nextIds = [...trackedOrderIds, orderId].slice(-6);
      setTrackedOrderIds(nextIds);
      try {
        localStorage.setItem(HOME_ORDERS_STORAGE_KEY, JSON.stringify(nextIds));
      } catch {
        // ignore storage quota errors
      }

      const freshSnap = await getDoc(doc(db, 'orders', orderId));
      const ordNo = freshSnap.exists()
        ? (freshSnap.data() as Order).orderNumber
        : 'Confirmed';

      setConfirmedOrderNumber(ordNo);
      setCart([]);
      setSpecialInstructions('');
      setCartOpen(false);
      setTrackerOpen(true);
      setOrderNotice({
        type: 'ok',
        text: `Order ${ordNo} confirmed for Table ${targetTable.tableNumber} and sent to our kitchen.`,
      });
    } catch (err) {
      setOrderNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to submit order right now.',
      });
    } finally {
      setPlacingOrder(false);
    }
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fbComment.trim()) {
      setFbError('Please share a short message about your experience.');
      return;
    }
    setFbError(null);
    setFbSubmitting(true);
    try {
      await submitGuestFeedback({
        guestName: fbName.trim() || 'Dining Guest',
        foodRating: fbRating,
        serviceRating: fbRating,
        ambianceRating: fbRating,
        overallRating: fbRating,
        comment: fbComment.trim(),
        googleConsent: false,
      });
      setFbSuccess(true);
      setFbComment('');
    } catch (err) {
      setFbError(err instanceof Error ? err.message : 'Unable to submit feedback right now.');
    } finally {
      setFbSubmitting(false);
    }
  };

  const phoneRaw = settings.phone || '+91 94310 12345';
  const phoneDigits = toDigitsOnly(phoneRaw);
  const whatsappRaw = settings.whatsappNumber || settings.phone || '+919431012345';
  const whatsappDigits = toDigitsOnly(whatsappRaw);
  const mapsUrl =
    settings.googleMapsUrl ||
    'https://maps.google.com/?q=Hotel+Rudraksh+Inn+Deoghar+Jharkhand';

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#11241B] flex flex-col">
      {/* 1. Header — Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[#0F2E22] text-white border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element Wordmark */}
          <a
            href="#home"
            className="font-display text-lg sm:text-xl font-semibold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            {settings.hotelName || 'Hotel Rudraksh Inn'}
          </a>

          {/* Zone 2: 4 Single-line Navigation Links */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-200"
          >
            <a
              href="#home"
              className="hover:text-[#D4AF37] transition-colors whitespace-nowrap shrink-0"
            >
              Home
            </a>
            <a
              href="#menu"
              className="hover:text-[#D4AF37] transition-colors whitespace-nowrap shrink-0"
            >
              Menu
            </a>
            <a
              href="#feedback"
              className="hover:text-[#D4AF37] transition-colors whitespace-nowrap shrink-0"
            >
              Feedback
            </a>
            <a
              href="#contact"
              className="hover:text-[#D4AF37] transition-colors whitespace-nowrap shrink-0"
            >
              Contact
            </a>
          </nav>

          {/* Zone 3: Compact Customer Profile / Login Icon */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onOpenCustomerPortal}
              aria-label={customerProfile ? 'Customer Account' : 'Customer Login'}
              title={customerProfile ? `Signed in as ${customerProfile.displayName}` : 'Customer Login'}
              className="w-10 h-10 rounded-xl bg-white/10 hover:bg-[#C59B27] text-white hover:text-[#0F2E22] border border-white/15 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <User className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* 2. Hero Section */}
        <section id="home" className="bg-[#0F2E22] text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 py-10 lg:py-16 space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
              <div className="lg:col-span-6 flex flex-col justify-center space-y-5">
                <div className="inline-flex items-center gap-2 text-xs font-medium text-[#D4AF37] tracking-wide">
                  <span
                    aria-hidden="true"
                    className="w-3.5 h-3.5 border border-emerald-400 flex items-center justify-center rounded-[2px] bg-[#0A2118] shrink-0"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  </span>
                  <span>100% Pure Veg · Pure Vegetarian Dining Experience</span>
                </div>

                <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] font-semibold text-white leading-[1.1] text-balance">
                  Hotel Rudraksh Inn
                </h1>

                <p className="text-base sm:text-lg font-medium text-[#E5D399]">
                  Restaurant · Hospitality · Pure Vegetarian Dining
                </p>

                <p className="text-sm sm:text-base text-emerald-100/90 leading-relaxed max-w-xl">
                  Welcome to a delightful dining experience in Deoghar. Explore our freshly crafted
                  pure vegetarian menu, place your table order effortlessly, and share your dining
                  experience with us.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <a
                    href="#menu"
                    className="px-6 py-3 rounded-xl bg-[#C59B27] hover:bg-[#D4AF37] text-[#0F2E22] font-semibold text-sm transition-colors whitespace-nowrap shrink-0"
                  >
                    Explore Menu
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      if (cartCount > 0) {
                        setCartOpen(true);
                      } else {
                        document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' });
                      }
                    }}
                    className="px-6 py-3 rounded-xl border border-[#D4AF37]/60 text-white hover:bg-white/10 font-semibold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Order Now
                  </button>
                </div>
              </div>

              <div className="lg:col-span-6">
                <div className="w-full h-full min-h-[260px] lg:min-h-[400px] rounded-2xl overflow-hidden border border-white/15 bg-[#0A2118]">
                  <img
                    src={HOTEL_HERO_IMAGE}
                    alt="Hotel Rudraksh Inn Pure Vegetarian Dining Table"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            </div>

            {/* 4-Card Quick Action Strip Below Hero Split */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              <a
                href="#menu"
                className="p-4 rounded-xl bg-[#133829] hover:bg-[#194734] border border-white/10 transition-colors"
              >
                <div className="text-sm font-semibold text-[#D4AF37]">Food Menu</div>
                <div className="text-xs text-emerald-100/80 mt-0.5">
                  Explore dishes &amp; prices
                </div>
              </a>
              <button
                type="button"
                onClick={() => {
                  if (cartCount > 0) {
                    setCartOpen(true);
                  } else {
                    document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' });
                  }
                }}
                className="p-4 rounded-xl bg-[#133829] hover:bg-[#194734] border border-white/10 transition-colors text-left cursor-pointer"
              >
                <div className="text-sm font-semibold text-[#D4AF37]">Order Food</div>
                <div className="text-xs text-emerald-100/80 mt-0.5">Place your order</div>
              </button>
              <a
                href="#feedback"
                className="p-4 rounded-xl bg-[#133829] hover:bg-[#194734] border border-white/10 transition-colors"
              >
                <div className="text-sm font-semibold text-[#D4AF37]">Feedback</div>
                <div className="text-xs text-emerald-100/80 mt-0.5">Share your experience</div>
              </a>
              <a
                href="#contact"
                className="p-4 rounded-xl bg-[#133829] hover:bg-[#194734] border border-white/10 transition-colors"
              >
                <div className="text-sm font-semibold text-[#D4AF37]">Contact Us</div>
                <div className="text-xs text-emerald-100/80 mt-0.5">Contact the hotel</div>
              </a>
            </div>
          </div>
        </section>

        {/* 3. Food Menu & Customer Ordering Section */}
        <section id="menu" className="bg-[#F8FAF8] py-12 lg:py-16 border-b border-emerald-950/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-emerald-800 flex items-center gap-2">
                  <VegMark label="100% Pure Vegetarian Kitchen" />
                  <span aria-hidden="true">·</span>
                  <span>Freshly Prepared to Order</span>
                </div>
                <h2 className="font-display text-3xl font-semibold text-[#0F2E22] mt-1">
                  Explore Our Menu
                </h2>
                <p className="text-sm text-zinc-600 mt-1">
                  Discover delicious pure vegetarian dishes &amp; place your table order directly.
                </p>
              </div>

              {/* Ordering & Table Toolbar */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="inline-flex items-center gap-2 bg-white border border-emerald-900/15 rounded-xl px-3 py-2 text-xs">
                  <span className="text-zinc-500 font-medium">Table</span>
                  <select
                    value={selectedTableId}
                    onChange={(e) => setSelectedTableId(e.target.value)}
                    aria-label="Select dining table"
                    className="font-semibold text-[#0F2E22] bg-transparent focus:outline-none cursor-pointer"
                  >
                    {SEED_TABLES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.tableNumber} · {t.section}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenGuestQrMenu(selectedTableId)}
                  className="px-3.5 py-2.5 rounded-xl border border-emerald-900/20 bg-white hover:bg-emerald-50 text-xs font-semibold text-[#0F2E22] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5 text-[#9A7415]" />
                  <span>QR Table View</span>
                </button>

                {trackedOrders.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTrackerOpen((prev) => !prev)}
                    className="px-3.5 py-2.5 rounded-xl border border-[#C59B27]/60 bg-[#FDF9EC] text-xs font-semibold text-[#0F2E22] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Clock className="w-3.5 h-3.5 text-[#9A7415]" />
                    <span>Track Orders ({trackedOrders.length})</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setCartOpen(true)}
                  className="px-4 py-2.5 rounded-xl bg-[#0F2E22] hover:bg-[#133829] text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>
                    Cart ({cartCount}){cartCount > 0 ? ` · ${formatINR(cartSubtotal)}` : ''}
                  </span>
                </button>
              </div>
            </div>

            {/* Order Confirmation / Alert Banner */}
            {orderNotice && (
              <div
                className={`p-4 rounded-xl border text-sm flex items-center justify-between gap-3 ${
                  orderNotice.type === 'ok'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{orderNotice.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setOrderNotice(null)}
                  className="text-xs font-semibold underline cursor-pointer shrink-0"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Live Order Status Tracker */}
            {trackerOpen && trackedOrders.length > 0 && (
              <div className="bg-white border border-emerald-900/15 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                  <div>
                    <h3 className="font-display text-lg font-semibold text-[#0F2E22]">
                      Live Kitchen Order Status
                    </h3>
                    <p className="text-xs text-zinc-500">
                      Real-time preparation updates from Hotel Rudraksh Inn kitchen
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTrackerOpen(false)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 cursor-pointer"
                    aria-label="Close order tracker"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {trackedOrders.map((ord) => {
                    const currentStep = Math.max(
                      0,
                      ORDER_STEPS.indexOf(ord.status === 'Completed' ? 'Served' : ord.status)
                    );
                    return (
                      <div
                        key={ord.id}
                        className="p-4 rounded-xl bg-[#F8FAF8] border border-emerald-900/10 space-y-3"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div>
                            <span className="font-mono-tabular text-sm font-bold text-[#0F2E22]">
                              {ord.orderNumber}
                            </span>
                            <span className="text-zinc-500 ml-2">
                              Table {ord.tableNumber || '—'} · {formatTime(ord.createdAt)}
                            </span>
                          </div>
                          <span className="font-semibold text-[#9A7415]">{ord.status}</span>
                        </div>

                        {ord.status !== 'Cancelled' ? (
                          <div className="grid grid-cols-5 gap-1.5">
                            {ORDER_STEPS.map((step, idx) => {
                              const done = idx <= currentStep;
                              return (
                                <div key={step} className="text-center">
                                  <div
                                    className={`h-1.5 rounded-full mb-1 ${
                                      done ? 'bg-[#0F2E22]' : 'bg-zinc-200'
                                    }`}
                                  />
                                  <span
                                    className={`text-[11px] ${
                                      done ? 'text-[#0F2E22] font-semibold' : 'text-zinc-400'
                                    }`}
                                  >
                                    {step}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-red-700">
                            Order cancelled. Please speak with a steward if you need assistance.
                          </p>
                        )}

                        <div className="text-xs text-zinc-600 flex items-center justify-between gap-3 pt-2 border-t border-zinc-200/70">
                          <span className="truncate min-w-0">
                            {ord.items.map((it) => `${it.qty}× ${it.name}`).join(', ')}
                          </span>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <span className="font-mono-tabular font-bold text-[#0F2E22]">
                              {formatINR(ord.subtotal)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleReorder(ord)}
                              className="px-3 py-1.5 rounded-lg bg-[#0F2E22] hover:bg-[#133829] text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Reorder</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Search + Category Filter Bar */}
            <div className="space-y-3">
              <div className="relative max-w-md">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search breakfast, paneer, biryani, lassi..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-emerald-900/15 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedCat('all')}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedCat === 'all'
                      ? 'bg-[#0F2E22] text-[#D4AF37] border-[#0F2E22]'
                      : 'bg-white text-zinc-700 border-zinc-200 hover:border-emerald-900/30'
                  }`}
                >
                  All
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCat(cat.id)}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedCat === cat.id
                        ? 'bg-[#0F2E22] text-[#D4AF37] border-[#0F2E22]'
                        : 'bg-white text-zinc-700 border-zinc-200 hover:border-emerald-900/30'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Menu Grid */}
            {loadingMenu ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div
                    key={n}
                    className="h-80 bg-white border border-zinc-200 rounded-2xl"
                  />
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="bg-white border border-zinc-200 rounded-2xl p-12 text-center">
                <Utensils className="w-8 h-8 text-emerald-800/60 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-zinc-900">
                  {menuItems.length === 0
                    ? 'Pure vegetarian menu is being prepared'
                    : 'No dishes match your filter'}
                </h3>
                <p className="text-sm text-zinc-500 mt-1">
                  {menuItems.length === 0
                    ? 'Our kitchen catalog will appear here once initialized.'
                    : 'Try clearing your search or choosing another category.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredItems.map((dish) => {
                  const qty = getQtyInCart(dish.id);
                  return (
                    <article
                      key={dish.id}
                      className={`bg-white border border-emerald-950/10 rounded-2xl overflow-hidden flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5 ${
                        !dish.available ? 'opacity-65' : ''
                      }`}
                    >
                      <div>
                        <div className="aspect-[4/3] w-full bg-[#0F2E22] overflow-hidden">
                          <DishImage
                            src={dish.imageUrl}
                            alt={dish.name}
                            className="w-full h-full"
                          />
                        </div>

                        <div className="p-5 pb-3">
                          <div className="flex items-center gap-2 text-xs text-zinc-500">
                            <VegMark label="Pure Veg" />
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{dish.categoryName}</span>
                            {dish.isBestseller && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-semibold text-[#9A7415]">Popular</span>
                              </>
                            )}
                          </div>

                          <h3 className="text-base font-semibold text-zinc-900 mt-2 leading-snug">
                            {dish.name}
                          </h3>
                          <p className="text-xs text-zinc-600 mt-1.5 line-clamp-2 leading-relaxed">
                            {dish.description}
                          </p>
                        </div>
                      </div>

                      <div className="px-5 pb-5 pt-3 border-t border-zinc-100 flex items-center justify-between gap-3">
                        <span className="font-mono-tabular text-base font-bold text-[#0F2E22]">
                          {formatINR(dish.price)}
                        </span>

                        {dish.available ? (
                          qty === 0 ? (
                            <button
                              type="button"
                              onClick={() => updateCartQty(dish, 1)}
                              className="px-4 py-2 rounded-xl bg-[#0F2E22] hover:bg-[#133829] text-[#D4AF37] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Add to Cart
                            </button>
                          ) : (
                            <div className="inline-flex items-center gap-2 bg-[#0F2E22] text-white rounded-xl px-2.5 py-1.5">
                              <button
                                type="button"
                                onClick={() => updateCartQty(dish, -1)}
                                aria-label={`Decrease ${dish.name} quantity`}
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
                                aria-label={`Increase ${dish.name} quantity`}
                                className="p-1 text-[#D4AF37] hover:text-white cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="text-xs font-medium text-zinc-400">Unavailable</span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* 4. Feedback & Approved Guest Reviews Section */}
        <section id="feedback" className="bg-white py-12 lg:py-16 border-b border-emerald-950/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 space-y-8">
            <div>
              <h2 className="font-display text-3xl font-semibold text-[#0F2E22]">
                Guest Experiences &amp; Feedback
              </h2>
              <p className="text-sm text-zinc-600 mt-1">
                Verified dining reviews from our guests and a direct space to share yours.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Approved Guest Reviews */}
              <div className="lg:col-span-7 space-y-4">
                <h3 className="text-sm font-semibold text-zinc-900">
                  Recent Guest Reviews ({approvedReviews.length})
                </h3>
                {approvedReviews.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-[#F8FAF8] border border-emerald-950/10 text-sm text-zinc-600">
                    Guest reviews approved by Hotel Rudraksh Inn will appear here. Be the first
                    to share your dining experience.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {approvedReviews.slice(0, 6).map((rev) => (
                      <div
                        key={rev.id}
                        className="p-5 rounded-2xl bg-[#F8FAF8] border border-emerald-950/10 flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star
                                key={s}
                                className={`w-4 h-4 ${
                                  s <= Math.round(rev.overallRating)
                                    ? 'fill-[#C59B27] text-[#C59B27]'
                                    : 'text-zinc-300'
                                }`}
                              />
                            ))}
                          </div>
                          {rev.comment && (
                            <p className="text-sm text-zinc-700 leading-relaxed">
                              &ldquo;{rev.comment}&rdquo;
                            </p>
                          )}
                        </div>
                        <div className="pt-2 border-t border-zinc-200/70 flex items-center justify-between text-xs text-zinc-500">
                          <span className="font-semibold text-[#0F2E22]">
                            {rev.guestName || 'Dining Guest'}
                          </span>
                          <span className="font-mono-tabular">{formatDateTime(rev.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Submit Feedback Form */}
              <div className="lg:col-span-5 bg-[#F8FAF8] border border-emerald-950/10 rounded-2xl p-6">
                {fbSuccess ? (
                  <div className="text-center py-6 space-y-3">
                    <CheckCircle2 className="w-10 h-10 text-emerald-700 mx-auto" />
                    <h3 className="font-display text-xl font-semibold text-[#0F2E22]">
                      Thank you for your feedback!
                    </h3>
                    <p className="text-xs text-zinc-600 leading-relaxed">
                      Your review has been submitted to Hotel Rudraksh Inn management.
                    </p>
                    <button
                      type="button"
                      onClick={() => setFbSuccess(false)}
                      className="text-xs font-semibold text-[#9A7415] underline cursor-pointer"
                    >
                      Write another review
                    </button>
                  </div>
                ) : (
                  <form onSubmit={(e) => void handleFeedbackSubmit(e)} className="space-y-4">
                    <div>
                      <h3 className="font-display text-xl font-semibold text-[#0F2E22]">
                        Share Your Experience
                      </h3>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Tell us how you enjoyed your meal and hospitality.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Your Name (Optional)
                      </label>
                      <input
                        type="text"
                        maxLength={80}
                        value={fbName}
                        onChange={(e) => setFbName(e.target.value)}
                        placeholder="e.g. Priya Verma"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                        Rating
                      </label>
                      <div className="flex items-center gap-1.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setFbRating(star)}
                            aria-label={`Rate ${star} stars`}
                            className="p-1 cursor-pointer"
                          >
                            <Star
                              className={`w-6 h-6 ${
                                star <= fbRating
                                  ? 'fill-[#C59B27] text-[#C59B27]'
                                  : 'text-zinc-300'
                              }`}
                            />
                          </button>
                        ))}
                        <span className="ml-2 font-mono-tabular text-xs font-semibold text-zinc-600">
                          {fbRating}/5
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Feedback Message
                      </label>
                      <textarea
                        rows={3}
                        required
                        maxLength={500}
                        value={fbComment}
                        onChange={(e) => setFbComment(e.target.value)}
                        placeholder="Share what you loved about the dishes or service..."
                        className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                      />
                    </div>

                    {fbError && <p className="text-xs text-red-700">{fbError}</p>}

                    <button
                      type="submit"
                      disabled={fbSubmitting}
                      className="w-full py-3 rounded-xl bg-[#0F2E22] hover:bg-[#133829] text-[#D4AF37] text-sm font-semibold transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      {fbSubmitting ? 'Submitting...' : 'Submit Feedback'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 5. Contact Section */}
        <section id="contact" className="bg-[#F8FAF8] py-12 lg:py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-8">
            <div className="bg-[#0F2E22] text-white rounded-2xl p-6 sm:p-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
              <div className="space-y-3 max-w-2xl">
                <div className="text-xs font-semibold text-[#D4AF37] tracking-wide">
                  Visit or Reach Out
                </div>
                <h2 className="font-display text-3xl font-semibold text-white">
                  {settings.hotelName || 'Hotel Rudraksh Inn'}
                </h2>
                <div className="space-y-1.5 text-sm text-emerald-100/90">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                    <span>{settings.address || 'Deoghar, Jharkhand 814112'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-[#D4AF37] shrink-0" />
                    <span className="font-mono-tabular">{phoneRaw}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#D4AF37] shrink-0" />
                    <span>{settings.operatingHours || '07:00 AM – 11:00 PM Daily'}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <a
                  href={`tel:+${phoneDigits}`}
                  className="px-5 py-3 rounded-xl bg-[#C59B27] hover:bg-[#D4AF37] text-[#0F2E22] font-semibold text-sm inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                >
                  <Phone className="w-4 h-4" />
                  <span>Call Now</span>
                </a>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-5 py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white font-semibold text-sm inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                >
                  <Navigation className="w-4 h-4 text-[#D4AF37]" />
                  <span>Get Directions</span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </a>
                <a
                  href={`https://wa.me/${whatsappDigits}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-sm inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>WhatsApp</span>
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Slim Sticky Mobile/Bottom Cart Bar when items are in Cart (<= 15% mobile height) */}
      {cartCount > 0 && !cartOpen && (
        <div className="fixed bottom-3 inset-x-0 z-30 px-4 pointer-events-none">
          <div className="max-w-xl mx-auto pointer-events-auto">
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="w-full h-14 bg-[#0F2E22] text-white border border-[#D4AF37]/50 rounded-xl px-4 shadow-xl flex items-center justify-between cursor-pointer hover:bg-[#133829] transition-colors"
            >
              <div className="flex items-center gap-2.5 text-left min-w-0">
                <ShoppingBag className="w-4 h-4 text-[#D4AF37] shrink-0" />
                <span className="text-xs sm:text-sm font-semibold truncate">
                  {cartCount} {cartCount === 1 ? 'dish' : 'dishes'} · Table {selectedTableId}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono-tabular text-sm font-bold text-[#D4AF37]">
                  {formatINR(cartSubtotal)}
                </span>
                <span className="px-3 py-1.5 rounded-lg bg-[#C59B27] text-[#0F2E22] text-xs font-semibold whitespace-nowrap">
                  View Cart
                </span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Cart & Checkout Slide-over Modal */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 bg-[#0F2E22] text-white flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold">Your Table Order</h3>
                <p className="text-xs text-emerald-100/80">
                  100% Pure Vegetarian Kitchen · {settings.hotelName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="p-1.5 rounded-lg text-emerald-100 hover:text-white cursor-pointer"
                aria-label="Close cart"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {cart.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <ShoppingBag className="w-8 h-8 text-zinc-400 mx-auto" />
                  <p className="text-sm font-medium text-zinc-700">Your cart is empty</p>
                  <p className="text-xs text-zinc-500">
                    Add pure vegetarian dishes from the menu to place an order.
                  </p>
                  {confirmedOrderNumber && (
                    <p className="text-xs font-semibold text-emerald-700 pt-2">
                      Latest Order: {confirmedOrderNumber}
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="divide-y divide-zinc-100">
                    {cart.map((item) => {
                      const dish = menuItems.find((m) => m.id === item.itemId);
                      return (
                        <div
                          key={item.itemId}
                          className="py-3 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-zinc-900 truncate">
                              {item.name}
                            </div>
                            <div className="font-mono-tabular text-xs text-zinc-500">
                              {formatINR(item.price)} each
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5 shrink-0">
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
                            <span className="font-mono-tabular text-sm font-semibold w-16 text-right">
                              {formatINR(item.price * item.qty)}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeFromCart(item.itemId)}
                              aria-label={`Remove ${item.name}`}
                              className="p-1 text-zinc-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Table Number
                    </label>
                    <select
                      value={selectedTableId}
                      onChange={(e) => setSelectedTableId(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-zinc-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                    >
                      {SEED_TABLES.map((t) => (
                        <option key={t.id} value={t.id}>
                          Table {t.tableNumber} · {t.section} ({t.capacity} seats)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Your Name (Optional)
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

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Special Instructions (Optional)
                    </label>
                    <textarea
                      rows={2}
                      maxLength={300}
                      value={specialInstructions}
                      onChange={(e) => setSpecialInstructions(e.target.value)}
                      placeholder="Jain preparation, no onion/garlic, mild spice..."
                      className="w-full px-3.5 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                    />
                  </div>
                </>
              )}
            </div>

            {cart.length > 0 && (
              <div className="p-5 bg-[#F8FAF8] border-t border-zinc-200 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-600">Subtotal (taxes applied on bill)</span>
                  <span className="font-mono-tabular text-lg font-bold text-[#0F2E22]">
                    {formatINR(cartSubtotal)}
                  </span>
                </div>

                {mustLoginBeforeOrder ? (
                  <div className="space-y-2">
                    <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Customer login is required by hotel settings before submitting an order.
                    </p>
                    <button
                      type="button"
                      onClick={() => onRequestCustomerLogin(selectedTableId)}
                      className="w-full py-3.5 rounded-xl bg-[#0F2E22] text-[#D4AF37] font-semibold text-sm hover:bg-[#133829] transition-colors cursor-pointer"
                    >
                      Sign In to Place Order
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={placingOrder}
                    onClick={() => void handlePlaceOrder()}
                    className="w-full py-3.5 rounded-xl bg-[#0F2E22] text-[#D4AF37] font-semibold text-sm hover:bg-[#133829] transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    {placingOrder ? 'Placing Order...' : `Place Order · Table ${selectedTableId}`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 7. Footer — Including Discreet Staff Login Link */}
      <footer className="bg-[#0A2118] text-emerald-100/80 border-t border-white/10 px-4 sm:px-8 py-8 pb-20 sm:pb-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 text-xs">
          <div className="space-y-1">
            <div className="font-display text-base font-semibold text-white">
              Hotel Rudraksh Inn
            </div>
            <div className="text-emerald-200/70">
              Restaurant | Hospitality | Dining · 100% Pure Vegetarian
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <a
              href="https://www.baidyanathmedia.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-emerald-100/80 hover:text-[#D4AF37] transition-colors"
            >
              <img
                src={BAIDYANATH_MEDIA_LOGO}
                alt="Baidyanath Media Agency Logo"
                className="w-6 h-6 rounded object-cover bg-[#F4F1EA]"
              />
              <span>
                Designed &amp; Developed by{' '}
                <strong className="text-white">Baidyanath Media Agency</strong>
              </span>
            </a>

            <span aria-hidden="true" className="text-white/20">
              |
            </span>

            <button
              type="button"
              onClick={onOpenStaffPortals}
              className="text-emerald-200/70 hover:text-[#D4AF37] underline underline-offset-4 transition-colors cursor-pointer whitespace-nowrap"
            >
              Staff Login
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
