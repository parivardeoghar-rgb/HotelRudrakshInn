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
  ArrowRightLeft,
  BedDouble,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  IndianRupee,
  MapPin,
  MessageCircle,
  Minus,
  Navigation,
  Phone,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  Search,
  Share2,
  ShoppingBag,
  Smartphone,
  Star,
  Trash2,
  User,
  Utensils,
  X,
} from 'lucide-react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { db } from '../firebase';
import {
  changeCustomerOrderTable,
  createGuestServiceRequest,
  placeGuestRoomOrder,
  placeQrOrder,
  submitGuestFeedback,
  updateCustomerFavoriteItems,
} from '../services/firestoreService';
import {
  DEFAULT_HOTEL_SETTINGS,
  HOTEL_HERO_IMAGE,
  SEED_HOTEL_ROOMS,
  SEED_TABLES,
} from '../data/seedCatalog';
import {
  BAIDYANATH_MEDIA_LOGO,
  type CustomerProfile,
  type DietaryTag,
  type Feedback,
  type HotelSettings,
  type MealSession,
  type MenuCategory,
  type MenuItem,
  type Order,
  type OrderItem,
  type OrderStatus,
  type RestaurantTable,
} from '../types';
import {
  matchesDietaryPreference,
  MENU_DIETARY_OPTIONS,
  type MenuDietaryPreference,
} from '../utils/dietary';
import {
  getDefaultMealSessionForHour,
  getMealSessionMeta,
  matchesMealSession,
  MEAL_SESSION_OPTIONS,
} from '../utils/mealSessions';
import {
  calculateBillTotals,
  formatDateTime,
  formatINR,
  formatTime,
  toDate,
} from '../utils/format';
import { useOrderReadyNotifications } from '../hooks/useOrderReadyNotifications';
import { useTableOrderStatus } from '../hooks/useTableOrderStatus';
import { DietaryPreferenceField } from './DietaryPreferenceField';
import { DishImage } from './DishImage';

interface CustomerHomepageProps {
  customerProfile: CustomerProfile | null;
  initialRoomNumber?: string | null;
  onCustomerProfileUpdated?: (next: CustomerProfile) => void;
  onOpenCustomerPortal: () => void;
  onOpenStaffPortals: () => void;
  onOpenGuestQrMenu: (tableId: string) => void;
  onRequestCustomerLogin: (tableId?: string) => void;
}

const ORDER_STEPS: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready', 'Served'];
const HOME_ORDERS_STORAGE_KEY = 'rudraksh_homepage_orders';
const GUEST_FAVORITES_STORAGE_KEY = 'rudraksh_guest_favorites';

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
  initialRoomNumber,
  onCustomerProfileUpdated,
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
  const [dietaryFilter, setDietaryFilter] = useState<MenuDietaryPreference | null>(null);
  const [mealFilter, setMealFilter] = useState<MealSession | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [orderMode, setOrderMode] = useState<'table' | 'room'>(
    initialRoomNumber ? 'room' : 'table'
  );
  const [selectedTableId, setSelectedTableId] = useState<string>(
    customerProfile?.preferredTable || 'T1'
  );
  const [selectedRoomNumber, setSelectedRoomNumber] = useState<string>(() => {
    if (!initialRoomNumber) return SEED_HOTEL_ROOMS[0]?.roomNumber || '101';
    return SEED_HOTEL_ROOMS.some((r) => r.roomNumber === initialRoomNumber)
      ? initialRoomNumber
      : '__custom__';
  });
  const [customRoomNumber, setCustomRoomNumber] = useState<string>(() => {
    if (!initialRoomNumber) return '';
    return SEED_HOTEL_ROOMS.some((r) => r.roomNumber === initialRoomNumber)
      ? ''
      : initialRoomNumber;
  });
  const [orderMealSession, setOrderMealSession] = useState<MealSession>(() =>
    getDefaultMealSessionForHour()
  );
  const [deliverySlot, setDeliverySlot] = useState<string>('ASAP (Now)');

  // Cart & ordering state
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [guestName, setGuestName] = useState(customerProfile?.displayName || '');
  const [dietaryTags, setDietaryTags] = useState<DietaryTag[]>([]);
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
  const [notifyFeedback, setNotifyFeedback] = useState<string | null>(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrTargetType, setQrTargetType] = useState<'table' | 'room'>(
    initialRoomNumber ? 'room' : 'table'
  );
  const [qrCopied, setQrCopied] = useState(false);
  const [transferTargets, setTransferTargets] = useState<Record<string, string>>({});
  const [transferBusyOrderId, setTransferBusyOrderId] = useState<string | null>(null);
  const [transferRequestedMap, setTransferRequestedMap] = useState<Record<string, string>>({});
  const [transferFeedback, setTransferFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [customPayAmount, setCustomPayAmount] = useState('');
  const [upiCopied, setUpiCopied] = useState(false);
  const [billRequestBusy, setBillRequestBusy] = useState(false);
  const [billRequestSent, setBillRequestSent] = useState(false);

  const { isNotifyEnabled, toggleNotifyForOrder } = useOrderReadyNotifications(
    trackedOrders,
    (readyOrd) => {
      setOrderNotice({
        type: 'ok',
        text: `Order ${readyOrd.orderNumber} is now Ready!`,
      });
    }
  );

  const tableStatusInfo = useTableOrderStatus(selectedTableId, trackedOrders);

  // Feedback form state
  const [fbName, setFbName] = useState(customerProfile?.displayName || '');
  const [fbRating, setFbRating] = useState(5);
  const [fbComment, setFbComment] = useState('');
  const [fbSubmitting, setFbSubmitting] = useState(false);
  const [fbSuccess, setFbSuccess] = useState(false);
  const [fbError, setFbError] = useState<string | null>(null);

  // Menu favorites state (persisted in customer profile when signed in, localStorage for guests)
  const [guestFavorites, setGuestFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(GUEST_FAVORITES_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string').slice(0, 100)
        : [];
    } catch {
      return [];
    }
  });
  const [favoriteNotice, setFavoriteNotice] = useState<{
    text: string;
    showLoginCta?: boolean;
  } | null>(null);

  useEffect(() => {
    if (customerProfile?.displayName && !guestName) {
      setGuestName(customerProfile.displayName);
    }
    if (customerProfile?.displayName && !fbName) {
      setFbName(customerProfile.displayName);
    }
  }, [customerProfile, guestName, fbName]);

  // Sync any guest favorites into customer profile upon customer sign-in
  useEffect(() => {
    if (!customerProfile || guestFavorites.length === 0) return;
    const existing = customerProfile.favoriteItemIds || [];
    const merged = Array.from(new Set([...guestFavorites, ...existing])).slice(0, 100);
    setGuestFavorites([]);
    try {
      localStorage.removeItem(GUEST_FAVORITES_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    setFavoriteNotice(null);
    if (merged.length !== existing.length || merged.some((id, idx) => existing[idx] !== id)) {
      onCustomerProfileUpdated?.({ ...customerProfile, favoriteItemIds: merged });
      updateCustomerFavoriteItems(customerProfile.uid, merged).catch(() => {
        // non-blocking background merge
      });
    }
  }, [customerProfile, guestFavorites, onCustomerProfileUpdated]);

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
                  toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()
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

  const favoriteIds = useMemo(
    () => (customerProfile ? customerProfile.favoriteItemIds || [] : guestFavorites),
    [customerProfile, guestFavorites]
  );

  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const favoriteCount = useMemo(
    () => menuItems.filter((item) => item.isVeg !== false && favoriteIdSet.has(item.id)).length,
    [menuItems, favoriteIdSet]
  );

  const toggleFavorite = async (dish: MenuItem) => {
    const currentlyFav = favoriteIdSet.has(dish.id);
    const nextIds = currentlyFav
      ? favoriteIds.filter((id) => id !== dish.id)
      : Array.from(new Set([dish.id, ...favoriteIds])).slice(0, 100);

    if (!customerProfile) {
      setGuestFavorites(nextIds);
      try {
        localStorage.setItem(GUEST_FAVORITES_STORAGE_KEY, JSON.stringify(nextIds));
      } catch {
        // ignore storage errors
      }
      if (!currentlyFav) {
        setFavoriteNotice({
          text: `${dish.name} saved on this device. Sign in to keep favorites in your customer profile.`,
          showLoginCta: true,
        });
      } else {
        setFavoriteNotice(null);
      }
      return;
    }

    const previousIds = customerProfile.favoriteItemIds || [];
    setFavoriteNotice(null);
    onCustomerProfileUpdated?.({ ...customerProfile, favoriteItemIds: nextIds });
    try {
      await updateCustomerFavoriteItems(customerProfile.uid, nextIds);
    } catch {
      onCustomerProfileUpdated?.({ ...customerProfile, favoriteItemIds: previousIds });
      setFavoriteNotice({
        text: 'Unable to update favorite in your profile right now. Please try again.',
      });
    }
  };

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return menuItems.filter((item) => {
      if (item.isVeg === false) return false;
      if (selectedCat === 'favorites') {
        if (!favoriteIdSet.has(item.id)) return false;
      } else if (selectedCat !== 'all' && item.categoryId !== selectedCat) {
        return false;
      }
      if (dietaryFilter && !matchesDietaryPreference(item, dietaryFilter)) {
        return false;
      }
      if (mealFilter && !matchesMealSession(item, mealFilter)) {
        return false;
      }
      if (q) {
        return (
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.categoryName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [menuItems, selectedCat, dietaryFilter, mealFilter, searchTerm, favoriteIdSet]);

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
    if (order.source === 'room_service' && order.roomNumber) {
      setOrderMode('room');
      if (SEED_HOTEL_ROOMS.some((r) => r.roomNumber === order.roomNumber)) {
        setSelectedRoomNumber(order.roomNumber);
      } else {
        setSelectedRoomNumber('__custom__');
        setCustomRoomNumber(order.roomNumber);
      }
    } else if (order.tableId && SEED_TABLES.some((t) => t.id === order.tableId)) {
      setOrderMode('table');
      setSelectedTableId(order.tableId);
    }
    if (order.mealSession) {
      setOrderMealSession(order.mealSession);
    }
    if (order.deliverySlot) {
      setDeliverySlot(order.deliverySlot);
    }
    setDietaryTags(order.dietaryTags ? [...order.dietaryTags] : []);
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

  const effectiveRoomNumber =
    selectedRoomNumber === '__custom__'
      ? customRoomNumber.trim().slice(0, 20)
      : selectedRoomNumber;

  const selectedRoomMeta = useMemo(
    () => SEED_HOTEL_ROOMS.find((r) => r.roomNumber === effectiveRoomNumber),
    [effectiveRoomNumber]
  );

  const selectedSessionMeta = useMemo(
    () => getMealSessionMeta(orderMealSession),
    [orderMealSession]
  );

  const mustLoginBeforeOrder = Boolean(settings.requireCustomerLogin && !customerProfile);

  const handlePlaceOrder = async () => {
    if (cart.length === 0) return;
    if (mustLoginBeforeOrder) {
      onRequestCustomerLogin(orderMode === 'table' ? selectedTableId : undefined);
      return;
    }

    if (orderMode === 'room' && !effectiveRoomNumber) {
      setOrderNotice({
        type: 'err',
        text: 'Please select or enter your hotel room number before placing a room service order.',
      });
      return;
    }

    setPlacingOrder(true);
    setOrderNotice(null);
    try {
      let orderId: string;
      let targetLabel: string;

      if (orderMode === 'room') {
        orderId = await placeGuestRoomOrder({
          roomNumber: effectiveRoomNumber,
          items: cart,
          guestName: guestName || customerProfile?.displayName || `Room ${effectiveRoomNumber} Guest`,
          guestSessionId: customerProfile
            ? `cust_${customerProfile.uid}`
            : `home_room_${effectiveRoomNumber}`,
          customerId: customerProfile?.uid,
          mealSession: orderMealSession,
          deliverySlot,
          dietaryTags,
          specialInstructions,
        });
        targetLabel = `Room ${effectiveRoomNumber} (${orderMealSession}${
          deliverySlot && deliverySlot !== 'ASAP (Now)' ? ` · ${deliverySlot}` : ''
        })`;
      } else {
        const tableSnap = await getDoc(doc(db, 'tables', selectedTableId));
        if (!tableSnap.exists()) {
          setOrderNotice({
            type: 'err',
            text: 'Selected table is not initialized yet. Please ask our restaurant team to initialize tables in Admin Dashboard.',
          });
          return;
        }
        const targetTable = tableSnap.data() as RestaurantTable;

        orderId = await placeQrOrder({
          table: targetTable,
          items: cart,
          guestName: guestName || customerProfile?.displayName || 'Dining Guest',
          guestSessionId: customerProfile
            ? `cust_${customerProfile.uid}`
            : `home_${targetTable.id}`,
          customerId: customerProfile?.uid,
          mealSession: orderMealSession,
          deliverySlot,
          dietaryTags,
          specialInstructions,
        });
        targetLabel = `Table ${targetTable.tableNumber}`;
      }

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
      setDietaryTags([]);
      setSpecialInstructions('');
      setCartOpen(false);
      setTrackerOpen(true);
      setOrderNotice({
        type: 'ok',
        text: `Order ${ordNo} confirmed for ${targetLabel} and sent to our kitchen.`,
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

  const menuShareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    if (qrTargetType === 'room') {
      const roomParam = effectiveRoomNumber || '101';
      return `${window.location.origin}/?room=${encodeURIComponent(roomParam)}`;
    }
    return `${window.location.origin}/?table=${encodeURIComponent(selectedTableId)}`;
  }, [qrTargetType, effectiveRoomNumber, selectedTableId]);

  const selectedTableMeta = useMemo(
    () => SEED_TABLES.find((t) => t.id === selectedTableId),
    [selectedTableId]
  );

  const selectedTableNumber =
    tableStatusInfo.tableDoc?.tableNumber ||
    selectedTableMeta?.tableNumber ||
    selectedTableId;

  const activeTableOrders = useMemo(
    () =>
      trackedOrders.filter((o) => {
        if (o.billed || o.status === 'Completed' || o.status === 'Cancelled') return false;
        if (orderMode === 'room') {
          return o.source === 'room_service' && o.roomNumber === effectiveRoomNumber;
        }
        return o.tableId === selectedTableId;
      }),
    [trackedOrders, orderMode, selectedTableId, effectiveRoomNumber]
  );

  const activeBillSummary = useMemo(() => {
    const combinedItems = activeTableOrders.flatMap((o) => o.items);
    if (combinedItems.length > 0) {
      return calculateBillTotals(combinedItems, 'none', 0, settings.taxes);
    }
    if (orderMode === 'table') {
      const tableBill = tableStatusInfo.tableDoc?.currentBillTotal || 0;
      if (tableBill > 0) {
        return calculateBillTotals(
          [
            {
              itemId: 'table_bill',
              name: 'Table Order',
              price: tableBill,
              qty: 1,
              isVeg: true,
            },
          ],
          'none',
          0,
          settings.taxes
        );
      }
    }
    return null;
  }, [activeTableOrders, orderMode, tableStatusInfo.tableDoc, settings.taxes]);

  const businessName = settings.hotelName || 'Hotel Rudraksh Inn';
  const businessUpiId = (
    settings.upiId ||
    DEFAULT_HOTEL_SETTINGS.upiId ||
    'rudrakshinn@okaxis'
  ).trim();

  const parsedPayAmount = useMemo(() => {
    const n = Number(customPayAmount);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  }, [customPayAmount]);

  const upiPayUri = useMemo(() => {
    const locationLabel =
      orderMode === 'room'
        ? `Room ${effectiveRoomNumber || '101'}`
        : `Table ${selectedTableNumber}`;
    const tn = activeTableOrders[0]?.orderNumber
      ? `${locationLabel} - ${activeTableOrders[0].orderNumber}`
      : `${locationLabel} Bill`;
    const base = `upi://pay?pa=${encodeURIComponent(businessUpiId)}&pn=${encodeURIComponent(
      businessName
    )}`;
    const amountPart =
      parsedPayAmount > 0 ? `&am=${parsedPayAmount.toFixed(2)}` : '';
    return `${base}${amountPart}&cu=INR&tn=${encodeURIComponent(tn)}`;
  }, [
    businessUpiId,
    businessName,
    parsedPayAmount,
    activeTableOrders,
    orderMode,
    effectiveRoomNumber,
    selectedTableNumber,
  ]);

  const openPayBillModal = (overrideAmount?: number) => {
    const defaultAmt =
      typeof overrideAmount === 'number' && overrideAmount > 0
        ? overrideAmount
        : activeBillSummary?.totalAmount || 0;
    setCustomPayAmount(defaultAmt > 0 ? defaultAmt.toFixed(2) : '');
    setUpiCopied(false);
    setBillRequestSent(false);
    setPayModalOpen(true);
  };

  useEffect(() => {
    if (!qrModalOpen && !payModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setQrModalOpen(false);
        setPayModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [qrModalOpen, payModalOpen]);

  const handleCopyUpiId = async () => {
    if (!businessUpiId) return;
    try {
      await navigator.clipboard.writeText(businessUpiId);
      setUpiCopied(true);
      setTimeout(() => setUpiCopied(false), 2500);
    } catch {
      // clipboard API unavailable
    }
  };

  const handleNotifyBillPayment = async () => {
    if (!tableStatusInfo.tableDoc) return;
    setBillRequestBusy(true);
    try {
      const note =
        parsedPayAmount > 0
          ? `Guest opened UPI QR to pay ${formatINR(parsedPayAmount)}`
          : 'Guest opened UPI QR to pay table bill';
      await createGuestServiceRequest({
        table: tableStatusInfo.tableDoc,
        type: 'request_bill',
        note,
      });
      setBillRequestSent(true);
    } catch {
      // keep UPI QR usable even if notification write fails
    } finally {
      setBillRequestBusy(false);
    }
  };

  const handleCopyMenuLink = async () => {
    if (!menuShareUrl) return;
    try {
      await navigator.clipboard.writeText(menuShareUrl);
      setQrCopied(true);
      setTimeout(() => setQrCopied(false), 2500);
    } catch {
      // clipboard API unavailable
    }
  };

  const handleShareMenuLink = async () => {
    if (!menuShareUrl || typeof navigator === 'undefined' || !navigator.share) {
      await handleCopyMenuLink();
      return;
    }
    const shareTarget =
      qrTargetType === 'room'
        ? `Room ${effectiveRoomNumber || '101'}`
        : `Table ${selectedTableId}`;
    try {
      await navigator.share({
        title: `${settings.hotelName || 'Hotel Rudraksh Inn'} · Digital Menu`,
        text: `Browse our 100% Pure Vegetarian menu and order for ${shareTarget}:`,
        url: menuShareUrl,
      });
    } catch {
      // user cancelled share sheet
    }
  };

  const handleChangeOrderTable = async (ord: Order, targetTableId: string) => {
    if (!targetTableId || targetTableId === ord.tableId) return;
    const targetMeta = SEED_TABLES.find((t) => t.id === targetTableId);
    setTransferBusyOrderId(ord.id);
    setTransferFeedback(null);
    try {
      const res = await changeCustomerOrderTable({
        order: ord,
        targetTableId,
        targetTableNumberFallback: targetMeta?.tableNumber || targetTableId,
        customerUid: customerProfile?.uid,
      });
      if (res.mode === 'transferred') {
        setSelectedTableId(targetTableId);
        setTransferFeedback({
          type: 'ok',
          text: `Order ${ord.orderNumber} moved to Table ${res.targetTableNumber}. Kitchen and floor display synced.`,
        });
      } else {
        setTransferRequestedMap((prev) => ({
          ...prev,
          [ord.id]: res.targetTableNumber,
        }));
        setTransferFeedback({
          type: 'ok',
          text: `Transfer request for ${ord.orderNumber} to Table ${res.targetTableNumber} sent to your steward.`,
        });
      }
    } catch (err) {
      setTransferFeedback({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : 'Could not transfer table right now. Please inform your steward.',
      });
    } finally {
      setTransferBusyOrderId(null);
    }
  };

  return (
    <>
    <div className={`min-h-screen bg-[#FFFFFF] text-[#11241B] flex flex-col ${qrModalOpen ? 'no-print' : ''}`}>
      {/* 1. Header — Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[#0F2E22] text-white border-b border-white/10">
        <div className="max-w-7xl mx-auto px-3 sm:px-8 h-16 flex items-center justify-between gap-2 sm:gap-8">
          {/* Zone 1: Single-element Wordmark */}
          <a
            href="#home"
            className="font-display text-base sm:text-xl font-semibold tracking-tight text-white whitespace-nowrap shrink-0"
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

          {/* Zone 3: Generate Menu QR + Customer Profile / Login Icon */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setQrModalOpen(true)}
              className="px-2.5 sm:px-3.5 py-2 rounded-xl bg-[#C59B27] hover:bg-[#D4AF37] text-[#0F2E22] text-[11px] sm:text-xs font-semibold inline-flex items-center gap-1 sm:gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>Generate Menu QR</span>
            </button>
            <button
              type="button"
              onClick={onOpenCustomerPortal}
              aria-label={customerProfile ? 'Customer Account' : 'Customer Login'}
              title={customerProfile ? `Signed in as ${customerProfile.displayName}` : 'Customer Login'}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/10 hover:bg-[#C59B27] text-white hover:text-[#0F2E22] border border-white/15 flex items-center justify-center transition-colors cursor-pointer shrink-0"
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

              {/* Ordering & Table / Hotel Room Toolbar */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div
                  role="group"
                  aria-label="Order destination type"
                  className="inline-flex items-center p-1 bg-white border border-emerald-900/15 rounded-xl"
                >
                  <button
                    type="button"
                    onClick={() => setOrderMode('table')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      orderMode === 'table'
                        ? 'bg-[#0F2E22] text-[#D4AF37]'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <Utensils className="w-3.5 h-3.5 shrink-0" />
                    <span>Dining Table</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderMode('room')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      orderMode === 'room'
                        ? 'bg-[#0F2E22] text-[#D4AF37]'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <BedDouble className="w-3.5 h-3.5 shrink-0" />
                    <span>Hotel Room</span>
                  </button>
                </div>

                {orderMode === 'table' ? (
                  <div className="inline-flex flex-wrap items-center gap-2.5 bg-white border border-emerald-900/15 rounded-xl px-3 py-2 text-xs">
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
                    <span aria-hidden="true" className="h-3.5 w-px bg-zinc-200" />
                    <span
                      role="status"
                      aria-live="polite"
                      title={tableStatusInfo.detail}
                      className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap ${
                        tableStatusInfo.isOccupied ? 'text-amber-800' : 'text-emerald-800'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          tableStatusInfo.isOccupied ? 'bg-amber-600' : 'bg-emerald-600'
                        }`}
                      />
                      <span>
                        {tableStatusInfo.loading ? 'Checking...' : tableStatusInfo.label}
                      </span>
                      {!tableStatusInfo.loading && tableStatusInfo.stageLabel && (
                        <span className="font-normal text-zinc-500">
                          · {tableStatusInfo.stageLabel}
                        </span>
                      )}
                    </span>
                  </div>
                ) : (
                  <div className="inline-flex flex-wrap items-center gap-2 bg-white border border-emerald-900/15 rounded-xl px-3 py-2 text-xs">
                    <span className="text-zinc-500 font-medium">Room</span>
                    <select
                      value={selectedRoomNumber}
                      onChange={(e) => setSelectedRoomNumber(e.target.value)}
                      aria-label="Select hotel room"
                      className="font-semibold text-[#0F2E22] bg-transparent focus:outline-none cursor-pointer"
                    >
                      {SEED_HOTEL_ROOMS.map((r) => (
                        <option key={r.id} value={r.roomNumber}>
                          Room {r.roomNumber} · {r.type}
                        </option>
                      ))}
                      <option value="__custom__">Other Room #</option>
                    </select>
                    {selectedRoomNumber === '__custom__' && (
                      <input
                        type="text"
                        maxLength={20}
                        value={customRoomNumber}
                        onChange={(e) => setCustomRoomNumber(e.target.value)}
                        aria-label="Enter custom room number"
                        placeholder="e.g. 205"
                        className="w-20 px-2 py-0.5 rounded border border-zinc-300 text-xs font-semibold text-[#0F2E22] focus:outline-none focus:ring-1 focus:ring-[#C59B27]"
                      />
                    )}
                    <span aria-hidden="true" className="h-3.5 w-px bg-zinc-200" />
                    <span className="font-semibold text-emerald-800 whitespace-nowrap">
                      {activeTableOrders.length > 0
                        ? `Active · ${activeTableOrders[0].status}`
                        : 'Room Service'}
                    </span>
                  </div>
                )}

                {orderMode === 'table' && (
                  <button
                    type="button"
                    onClick={() => onOpenGuestQrMenu(selectedTableId)}
                    className="px-3.5 py-2.5 rounded-xl border border-emerald-900/20 bg-white hover:bg-emerald-50 text-xs font-semibold text-[#0F2E22] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <QrCode className="w-3.5 h-3.5 text-[#9A7415]" />
                    <span>QR Table View</span>
                  </button>
                )}

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

                {(orderMode === 'table'
                  ? tableStatusInfo.isOccupied
                  : activeTableOrders.length > 0) && (
                  <button
                    type="button"
                    onClick={() => openPayBillModal()}
                    className="px-3.5 py-2.5 rounded-xl bg-[#C59B27] hover:bg-[#D4AF37] text-[#0F2E22] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <IndianRupee className="w-3.5 h-3.5 shrink-0" />
                    <span>Pay Bill</span>
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

                {notifyFeedback && (
                  <div className="px-3.5 py-2 rounded-lg bg-[#F8FAF8] border border-emerald-900/15 text-xs text-[#0F2E22] flex items-center justify-between gap-2">
                    <span>{notifyFeedback}</span>
                    <button
                      type="button"
                      onClick={() => setNotifyFeedback(null)}
                      aria-label="Dismiss notification note"
                      className="text-zinc-400 hover:text-zinc-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {transferFeedback && (
                  <div
                    role="status"
                    className={`px-3.5 py-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                      transferFeedback.type === 'ok'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                        : 'bg-red-50 border-red-200 text-red-900'
                    }`}
                  >
                    <span>{transferFeedback.text}</span>
                    <button
                      type="button"
                      onClick={() => setTransferFeedback(null)}
                      aria-label="Dismiss table transfer notice"
                      className="text-zinc-500 hover:text-zinc-800 cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {trackedOrders.map((ord) => {
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
                        className="p-4 rounded-xl bg-[#F8FAF8] border border-emerald-900/10 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div>
                            <span className="font-mono-tabular text-sm font-bold text-[#0F2E22]">
                              {ord.orderNumber}
                            </span>
                            <span className="text-zinc-500 ml-2">
                              {ord.source === 'room_service' || ord.roomNumber
                                ? `Room ${ord.roomNumber || '—'} · Room Service`
                                : `Table ${ord.tableNumber || '—'}`}{' '}
                              · {formatTime(ord.createdAt)}
                              {ord.mealSession ? ` · ${ord.mealSession}` : ''}
                              {ord.deliverySlot ? ` (${ord.deliverySlot})` : ''}
                              {ord.dietaryTags && ord.dietaryTags.length > 0
                                ? ` · ${ord.dietaryTags.join(' · ')}`
                                : ''}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {canNotify && (
                              <button
                                type="button"
                                aria-pressed={notifyOn}
                                onClick={async () => {
                                  const res = await toggleNotifyForOrder(ord);
                                  if (res.message) setNotifyFeedback(res.message);
                                }}
                                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                  notifyOn
                                    ? 'bg-emerald-50 border-emerald-700/40 text-emerald-900'
                                    : 'bg-white border-zinc-300 text-zinc-700 hover:border-[#C59B27]'
                                }`}
                              >
                                {notifyOn ? (
                                  <BellRing className="w-3 h-3 text-emerald-700" />
                                ) : (
                                  <Bell className="w-3 h-3 text-zinc-500" />
                                )}
                                <span>{notifyOn ? 'Notify on' : 'Notify me'}</span>
                              </button>
                            )}
                            <span className="font-semibold text-[#9A7415]">{ord.status}</span>
                          </div>
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

                        {canChangeTable && otherTables.length > 0 && (
                          <div className="pt-2 border-t border-zinc-200/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-1.5 text-zinc-600 font-medium">
                              <ArrowRightLeft className="w-3.5 h-3.5 text-[#9A7415] shrink-0" />
                              <label htmlFor={`home-change-table-${ord.id}`}>
                                Switched seats?
                              </label>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                id={`home-change-table-${ord.id}`}
                                value={selectedTargetId}
                                disabled={transferBusyOrderId === ord.id}
                                onChange={(e) =>
                                  setTransferTargets((prev) => ({
                                    ...prev,
                                    [ord.id]: e.target.value,
                                  }))
                                }
                                className="px-2.5 py-1.5 rounded-lg border border-emerald-900/20 bg-white text-xs font-semibold text-[#0F2E22] focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
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
                                className="px-3 py-1.5 rounded-lg border border-[#C59B27]/70 bg-[#FDF9EC] hover:bg-[#F7EBC4] text-[#0F2E22] text-xs font-semibold transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
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

                        <div className="text-xs text-zinc-600 flex items-center justify-between gap-3 pt-2 border-t border-zinc-200/70">
                          <span className="truncate min-w-0">
                            {ord.items.map((it) => `${it.qty}× ${it.name}`).join(', ')}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono-tabular font-bold text-[#0F2E22]">
                              {formatINR(ord.subtotal)}
                            </span>
                            {!ord.billed && ord.status !== 'Cancelled' && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (ord.source === 'room_service' && ord.roomNumber) {
                                    setOrderMode('room');
                                    if (SEED_HOTEL_ROOMS.some((r) => r.roomNumber === ord.roomNumber)) {
                                      setSelectedRoomNumber(ord.roomNumber);
                                    } else {
                                      setSelectedRoomNumber('__custom__');
                                      setCustomRoomNumber(ord.roomNumber);
                                    }
                                  } else if (ord.tableId && SEED_TABLES.some((t) => t.id === ord.tableId)) {
                                    setOrderMode('table');
                                    setSelectedTableId(ord.tableId);
                                  }
                                  const orderTotal = calculateBillTotals(
                                    ord.items,
                                    'none',
                                    0,
                                    settings.taxes
                                  ).totalAmount;
                                  openPayBillModal(orderTotal);
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-[#C59B27] hover:bg-[#D4AF37] text-[#0F2E22] text-xs font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <IndianRupee className="w-3.5 h-3.5" />
                                <span>Pay Bill</span>
                              </button>
                            )}
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

            {/* Search + Category & Dietary Preferences Filter Bar */}
            <div className="space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search breakfast, paneer, biryani, lassi..."
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-emerald-900/15 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                  />
                </div>

                {/* Dietary Preferences Filter */}
                <div
                  role="group"
                  aria-label="Dietary Preferences"
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <span className="text-xs font-medium text-zinc-600 mr-1 whitespace-nowrap">
                    Dietary Preferences:
                  </span>
                  <button
                    type="button"
                    aria-pressed={dietaryFilter === null}
                    onClick={() => setDietaryFilter(null)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      dietaryFilter === null
                        ? 'bg-[#0F2E22] text-[#D4AF37] border-[#0F2E22]'
                        : 'bg-white text-zinc-700 border-zinc-200 hover:border-emerald-900/30'
                    }`}
                  >
                    All
                  </button>
                  {MENU_DIETARY_OPTIONS.map((opt) => {
                    const active = dietaryFilter === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={active}
                        title={opt.description}
                        onClick={() =>
                          setDietaryFilter((prev) => (prev === opt.id ? null : opt.id))
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          active
                            ? 'bg-[#0F2E22] text-[#D4AF37] border-[#0F2E22]'
                            : 'bg-white text-zinc-700 border-zinc-200 hover:border-emerald-900/30'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Meal Session Filter Bar (Morning Breakfast, Afternoon Lunch, Evening, Dinner) */}
              <div
                role="group"
                aria-label="Meal Session"
                className="flex items-center gap-2 overflow-x-auto pb-1"
              >
                <span className="text-xs font-medium text-zinc-600 mr-1 whitespace-nowrap shrink-0">
                  Meal Time:
                </span>
                <button
                  type="button"
                  aria-pressed={mealFilter === null}
                  onClick={() => setMealFilter(null)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    mealFilter === null
                      ? 'bg-[#0F2E22] text-[#D4AF37] border-[#0F2E22]'
                      : 'bg-white text-zinc-700 border-zinc-200 hover:border-emerald-900/30'
                  }`}
                >
                  All Day
                </button>
                {MEAL_SESSION_OPTIONS.map((sess) => {
                  const active = mealFilter === sess.id;
                  return (
                    <button
                      key={sess.id}
                      type="button"
                      aria-pressed={active}
                      title={sess.windowLabel}
                      onClick={() => {
                        setMealFilter((prev) => {
                          const next = prev === sess.id ? null : sess.id;
                          if (next) {
                            setOrderMealSession(next);
                            setDeliverySlot('ASAP (Now)');
                          }
                          return next;
                        });
                      }}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-[#0F2E22] text-[#D4AF37] border-[#0F2E22]'
                          : 'bg-white text-zinc-700 border-zinc-200 hover:border-emerald-900/30'
                      }`}
                    >
                      {sess.label}
                    </button>
                  );
                })}
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
                <button
                  type="button"
                  onClick={() => setSelectedCat('favorites')}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedCat === 'favorites'
                      ? 'bg-[#0F2E22] text-[#D4AF37] border-[#0F2E22]'
                      : 'bg-white text-zinc-700 border-zinc-200 hover:border-emerald-900/30'
                  }`}
                >
                  <Star
                    className={`w-3.5 h-3.5 ${
                      selectedCat === 'favorites' ? 'fill-[#D4AF37] text-[#D4AF37]' : 'text-[#C59B27]'
                    }`}
                  />
                  <span>Favorites{favoriteCount > 0 ? ` (${favoriteCount})` : ''}</span>
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

              {favoriteNotice && (
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-white border border-amber-200 text-xs text-zinc-700">
                  <div className="flex items-center gap-2">
                    <Star className="w-3.5 h-3.5 fill-[#C59B27] text-[#C59B27] shrink-0" />
                    <span>{favoriteNotice.text}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {favoriteNotice.showLoginCta && (
                      <button
                        type="button"
                        onClick={() => onRequestCustomerLogin(selectedTableId)}
                        className="px-3 py-1 rounded-lg bg-[#0F2E22] text-[#D4AF37] font-semibold hover:bg-[#133829] transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Sign In
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFavoriteNotice(null)}
                      aria-label="Dismiss notice"
                      className="p-1 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
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
                {selectedCat === 'favorites' && favoriteCount === 0 ? (
                  <>
                    <Star className="w-8 h-8 text-[#C59B27] mx-auto mb-3" />
                    <h3 className="text-base font-semibold text-zinc-900">
                      No favorite dishes yet
                    </h3>
                    <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto">
                      Tap the star icon on any pure vegetarian dish to save it to your favorites for quick reordering.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedCat('all')}
                      className="mt-4 px-4 py-2 rounded-xl bg-[#0F2E22] text-[#D4AF37] text-xs font-semibold hover:bg-[#133829] transition-colors cursor-pointer"
                    >
                      Browse All Dishes
                    </button>
                  </>
                ) : (
                  <>
                    <Utensils className="w-8 h-8 text-emerald-800/60 mx-auto mb-3" />
                    <h3 className="text-base font-semibold text-zinc-900">
                      {menuItems.length === 0
                        ? 'Pure vegetarian menu is being prepared'
                        : 'No dishes match your filter'}
                    </h3>
                    <p className="text-sm text-zinc-500 mt-1">
                      {menuItems.length === 0
                        ? 'Our kitchen catalog will appear here once initialized.'
                        : 'Try clearing your search, dietary preference, or category filter.'}
                    </p>
                    {menuItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCat('all');
                          setDietaryFilter(null);
                          setSearchTerm('');
                        }}
                        className="mt-4 px-4 py-2 rounded-xl bg-[#0F2E22] text-[#D4AF37] text-xs font-semibold hover:bg-[#133829] transition-colors cursor-pointer"
                      >
                        Reset Filters
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredItems.map((dish) => {
                  const qty = getQtyInCart(dish.id);
                  const isFavorite = favoriteIdSet.has(dish.id);
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
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs text-zinc-500 min-w-0">
                              <VegMark label="Pure Veg" />
                              <span aria-hidden="true">·</span>
                              <span className="truncate">{dish.categoryName}</span>
                              {dish.isBestseller && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-semibold text-[#9A7415] shrink-0">Popular</span>
                                </>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => void toggleFavorite(dish)}
                              aria-label={
                                isFavorite
                                  ? `Remove ${dish.name} from favorites`
                                  : `Add ${dish.name} to favorites`
                              }
                              aria-pressed={isFavorite}
                              title={isFavorite ? 'Remove from favorites' : 'Save to favorites'}
                              className={`p-1.5 rounded-lg border transition-colors shrink-0 cursor-pointer ${
                                isFavorite
                                  ? 'bg-amber-50 border-[#C59B27]/40 text-[#C59B27]'
                                  : 'bg-zinc-50 border-zinc-200 text-zinc-400 hover:text-[#C59B27] hover:border-[#C59B27]/40'
                              }`}
                            >
                              <Star
                                className={`w-4 h-4 ${isFavorite ? 'fill-[#C59B27]' : ''}`}
                              />
                            </button>
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
                  {cartCount} {cartCount === 1 ? 'dish' : 'dishes'} ·{' '}
                  {orderMode === 'room'
                    ? `Room ${effectiveRoomNumber || '—'}`
                    : `Table ${selectedTableId}`}
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
                <h3 className="font-display text-lg font-semibold">
                  {orderMode === 'room' ? 'Your Hotel Room Order' : 'Your Table Order'}
                </h3>
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
                    <span className="block text-xs font-semibold text-zinc-700 mb-1.5">
                      Deliver To
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setOrderMode('table')}
                        className={`py-2 px-3 rounded-lg border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          orderMode === 'table'
                            ? 'bg-[#0F2E22] text-[#D4AF37] border-[#0F2E22]'
                            : 'bg-white text-zinc-700 border-zinc-300'
                        }`}
                      >
                        <Utensils className="w-3.5 h-3.5" />
                        <span>Dining Table</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrderMode('room')}
                        className={`py-2 px-3 rounded-lg border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          orderMode === 'room'
                            ? 'bg-[#0F2E22] text-[#D4AF37] border-[#0F2E22]'
                            : 'bg-white text-zinc-700 border-zinc-300'
                        }`}
                      >
                        <BedDouble className="w-3.5 h-3.5" />
                        <span>Hotel Room</span>
                      </button>
                    </div>
                  </div>

                  {orderMode === 'table' ? (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="block text-xs font-semibold text-zinc-700">
                          Table Number
                        </label>
                        <span
                          role="status"
                          title={tableStatusInfo.detail}
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${
                            tableStatusInfo.isOccupied ? 'text-amber-800' : 'text-emerald-800'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              tableStatusInfo.isOccupied ? 'bg-amber-600' : 'bg-emerald-600'
                            }`}
                          />
                          <span>
                            {tableStatusInfo.loading ? 'Checking...' : tableStatusInfo.label}
                            {!tableStatusInfo.loading && tableStatusInfo.stageLabel
                              ? ` · ${tableStatusInfo.stageLabel}`
                              : ''}
                          </span>
                        </span>
                      </div>
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
                  ) : (
                    <div className="space-y-2">
                      <label
                        htmlFor="checkout-room-select"
                        className="block text-xs font-semibold text-zinc-700"
                      >
                        Hotel Room Number
                      </label>
                      <select
                        id="checkout-room-select"
                        value={selectedRoomNumber}
                        onChange={(e) => setSelectedRoomNumber(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-lg border border-zinc-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                      >
                        {SEED_HOTEL_ROOMS.map((r) => (
                          <option key={r.id} value={r.roomNumber}>
                            Room {r.roomNumber} · {r.type} ({r.floor})
                          </option>
                        ))}
                        <option value="__custom__">Enter Other Room Number...</option>
                      </select>
                      {selectedRoomNumber === '__custom__' && (
                        <input
                          type="text"
                          maxLength={20}
                          value={customRoomNumber}
                          onChange={(e) => setCustomRoomNumber(e.target.value)}
                          placeholder="Enter your room number (e.g. 205)"
                          className="w-full px-3.5 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                        />
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="checkout-meal-session"
                        className="block text-xs font-semibold text-zinc-700 mb-1"
                      >
                        Meal Session
                      </label>
                      <select
                        id="checkout-meal-session"
                        value={orderMealSession}
                        onChange={(e) => {
                          const next = e.target.value as MealSession;
                          setOrderMealSession(next);
                          setDeliverySlot('ASAP (Now)');
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-xs font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                      >
                        {MEAL_SESSION_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label} ({opt.windowLabel})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="checkout-delivery-slot"
                        className="block text-xs font-semibold text-zinc-700 mb-1"
                      >
                        Serving / Room Delivery Time
                      </label>
                      <select
                        id="checkout-delivery-slot"
                        value={deliverySlot}
                        onChange={(e) => setDeliverySlot(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-xs font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                      >
                        {selectedSessionMeta.deliverySlots.map((slot) => (
                          <option key={slot} value={slot}>
                            {slot}
                          </option>
                        ))}
                      </select>
                    </div>
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

                  <DietaryPreferenceField value={dietaryTags} onChange={setDietaryTags} />

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Special Instructions (Optional)
                    </label>
                    <textarea
                      rows={2}
                      maxLength={300}
                      value={specialInstructions}
                      onChange={(e) => setSpecialInstructions(e.target.value)}
                      placeholder={
                        orderMode === 'room'
                          ? 'Cutlery for 2, knock gently, extra tea...'
                          : 'Extra mild spice, serve starters first...'
                      }
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
                      onClick={() =>
                        onRequestCustomerLogin(orderMode === 'table' ? selectedTableId : undefined)
                      }
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
                    {placingOrder
                      ? 'Placing Order...'
                      : orderMode === 'room'
                      ? `Place Room Order · Room ${effectiveRoomNumber || '—'}`
                      : `Place Order · Table ${selectedTableId}`}
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

      {/* Full-Screen Shareable Menu QR Modal */}
      {qrModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="menu-qr-modal-title"
          className="fixed inset-0 z-50 bg-[#0A2118]/95 backdrop-blur-sm text-white flex flex-col overflow-y-auto"
        >
          <div className="w-full max-w-4xl mx-auto px-4 sm:px-8 py-5 flex items-center justify-between gap-4 border-b border-white/10">
            <div>
              <div className="text-xs font-medium text-[#D4AF37]">
                {settings.hotelName || 'Hotel Rudraksh Inn'} · 100% Pure Vegetarian
              </div>
              <h2 id="menu-qr-modal-title" className="font-display text-xl sm:text-2xl font-semibold text-white">
                {qrTargetType === 'room' ? 'Share Hotel Room Service QR' : 'Share Digital Table Menu'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setQrModalOpen(false)}
              aria-label="Close Menu QR"
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 text-center max-w-lg mx-auto w-full space-y-6">
            <p className="text-sm text-emerald-100/90 leading-relaxed">
              {qrTargetType === 'room'
                ? 'Scan this Room QR code to order breakfast, lunch, evening snacks, or dinner directly to your hotel room.'
                : 'Ask fellow diners at your table to scan this QR code with their phone camera to browse the menu and add dishes directly.'}
            </p>

            <div className="inline-flex items-center p-1 rounded-xl bg-[#133829] border border-white/15">
              <button
                type="button"
                onClick={() => setQrTargetType('table')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  qrTargetType === 'table'
                    ? 'bg-[#C59B27] text-[#0F2E22]'
                    : 'text-emerald-100 hover:text-white'
                }`}
              >
                Dining Table QR
              </button>
              <button
                type="button"
                onClick={() => setQrTargetType('room')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  qrTargetType === 'room'
                    ? 'bg-[#C59B27] text-[#0F2E22]'
                    : 'text-emerald-100 hover:text-white'
                }`}
              >
                Hotel Room QR
              </button>
            </div>

            <div className="w-full max-w-xs text-left">
              {qrTargetType === 'table' ? (
                <>
                  <label
                    htmlFor="qr-table-select"
                    className="block text-xs font-medium text-emerald-200 mb-1.5"
                  >
                    Table for QR Link
                  </label>
                  <select
                    id="qr-table-select"
                    value={selectedTableId}
                    onChange={(e) => setSelectedTableId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#133829] border border-white/20 text-sm font-semibold text-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                  >
                    {SEED_TABLES.map((t) => (
                      <option key={t.id} value={t.id} className="bg-white text-zinc-900">
                        Table {t.tableNumber} · {t.section}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <label
                    htmlFor="qr-room-select"
                    className="block text-xs font-medium text-emerald-200 mb-1.5"
                  >
                    Hotel Room for QR Link
                  </label>
                  <select
                    id="qr-room-select"
                    value={selectedRoomNumber}
                    onChange={(e) => setSelectedRoomNumber(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#133829] border border-white/20 text-sm font-semibold text-[#D4AF37] focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                  >
                    {SEED_HOTEL_ROOMS.map((r) => (
                      <option key={r.id} value={r.roomNumber} className="bg-white text-zinc-900">
                        Room {r.roomNumber} · {r.type}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>

            <div className="p-6 rounded-3xl bg-white border-4 border-[#C59B27] shadow-2xl inline-flex flex-col items-center">
              <QRCodeCanvas
                value={menuShareUrl}
                size={240}
                level="H"
                bgColor="#FFFFFF"
                fgColor="#0F2E22"
              />
              <div className="mt-3 pt-3 border-t border-zinc-200 w-full text-center">
                <div className="text-xs font-bold text-[#0F2E22]">
                  {qrTargetType === 'room'
                    ? `Room ${effectiveRoomNumber || '101'} · In-Room Dining`
                    : `Table ${selectedTableId} · Digital Menu`}
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  Scan to view menu &amp; order
                </div>
              </div>
            </div>

            <div className="w-full space-y-3">
              <div className="px-3.5 py-2.5 rounded-xl bg-[#133829] border border-white/15 font-mono-tabular text-xs text-emerald-100 break-all">
                {menuShareUrl}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleCopyMenuLink()}
                  className="px-4 py-2.5 rounded-xl bg-[#C59B27] hover:bg-[#D4AF37] text-[#0F2E22] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {qrCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{qrCopied ? 'Link Copied' : 'Copy Menu Link'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2.5 rounded-xl bg-white hover:bg-emerald-50 text-[#0F2E22] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-[#0F2E22]" />
                  <span>Print QR Tent</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleShareMenuLink()}
                  className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Share2 className="w-4 h-4 text-[#D4AF37]" />
                  <span>Share Link</span>
                </button>

                <button
                  type="button"
                  onClick={() => setQrModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-white/20 text-emerald-100 hover:text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* UPI Bill Payment Modal */}
      {payModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="upi-pay-modal-title"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white rounded-2xl border border-emerald-950/15 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="px-5 py-4 bg-[#0F2E22] text-white flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-[#D4AF37]">
                  {businessName} · Quick UPI Payment
                </div>
                <h2 id="upi-pay-modal-title" className="font-display text-lg font-semibold text-white">
                  {orderMode === 'room'
                    ? `Pay Room Bill · Room ${effectiveRoomNumber || '101'}`
                    : `Pay Table Bill · Table ${selectedTableNumber}`}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPayModalOpen(false)}
                aria-label="Close Pay Bill Modal"
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {activeBillSummary && (
                <div className="p-3.5 rounded-xl bg-[#F8FAF8] border border-emerald-900/10 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between text-zinc-600">
                    <span>
                      Subtotal
                      {activeTableOrders.length > 0
                        ? ` (${activeTableOrders.length} active ${
                            activeTableOrders.length === 1 ? 'order' : 'orders'
                          })`
                        : ''}
                    </span>
                    <span className="font-mono-tabular font-medium text-zinc-900">
                      {formatINR(activeBillSummary.subtotal)}
                    </span>
                  </div>
                  {activeBillSummary.taxBreakdown.map((tax) => (
                    <div key={tax.name} className="flex items-center justify-between text-zinc-600">
                      <span>
                        {tax.name} ({tax.rate}%)
                      </span>
                      <span className="font-mono-tabular text-zinc-800">
                        {formatINR(tax.amount)}
                      </span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-zinc-200 flex items-center justify-between text-sm font-bold text-[#0F2E22]">
                    <span>Estimated Total Payable</span>
                    <span className="font-mono-tabular">{formatINR(activeBillSummary.totalAmount)}</span>
                  </div>
                </div>
              )}

              <div className="flex flex-col items-center text-center space-y-3">
                <div className="p-4 rounded-2xl bg-white border-2 border-[#C59B27] inline-flex flex-col items-center">
                  <QRCodeCanvas
                    value={upiPayUri}
                    size={208}
                    level="H"
                    bgColor="#FFFFFF"
                    fgColor="#0F2E22"
                  />
                  <div className="mt-2.5 pt-2 border-t border-zinc-200 w-full text-center">
                    <div className="text-xs font-semibold text-[#0F2E22]">
                      Scan with GPay, PhonePe, Paytm or BHIM
                    </div>
                    {parsedPayAmount > 0 && (
                      <div className="font-mono-tabular text-sm font-bold text-[#9A7415] mt-0.5">
                        {formatINR(parsedPayAmount)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-[#F8FAF8] border border-emerald-900/15 text-xs">
                  <div className="text-left min-w-0">
                    <div className="text-[11px] text-zinc-500">Merchant UPI ID</div>
                    <div className="font-mono-tabular font-semibold text-[#0F2E22] truncate">
                      {businessUpiId}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyUpiId()}
                    className="px-3 py-1.5 rounded-lg bg-white border border-emerald-900/20 hover:border-[#C59B27] text-xs font-semibold text-[#0F2E22] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {upiCopied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-zinc-500" />
                    )}
                    <span>{upiCopied ? 'Copied' : 'Copy ID'}</span>
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="upi-pay-amount"
                  className="block text-xs font-semibold text-zinc-700 mb-1"
                >
                  Amount to Pay (₹) {activeBillSummary ? '· Editable for split bill' : '· Optional'}
                </label>
                <input
                  id="upi-pay-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={customPayAmount}
                  onChange={(e) => setCustomPayAmount(e.target.value)}
                  placeholder="Enter bill amount or enter inside UPI app"
                  className="w-full px-3.5 py-2 rounded-lg border border-zinc-300 text-sm font-mono-tabular focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>

              <div className="space-y-2 pt-1">
                <a
                  href={upiPayUri}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#0F2E22] hover:bg-[#133829] text-[#D4AF37] text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <Smartphone className="w-4 h-4 shrink-0" />
                  <span>
                    Open UPI App{parsedPayAmount > 0 ? ` · ${formatINR(parsedPayAmount)}` : ''}
                  </span>
                </a>

                {orderMode === 'table' && tableStatusInfo.tableDoc ? (
                  <button
                    type="button"
                    disabled={billRequestBusy || billRequestSent}
                    onClick={() => void handleNotifyBillPayment()}
                    className="w-full py-2.5 px-4 rounded-xl border border-emerald-900/20 bg-white hover:bg-emerald-50 disabled:opacity-60 text-[#0F2E22] text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>
                      {billRequestSent
                        ? 'Cashier Notified · Table Bill Requested'
                        : billRequestBusy
                        ? 'Notifying Cashier...'
                        : 'I Have Paid / Request Printed Bill'}
                    </span>
                  </button>
                ) : orderMode === 'room' ? (
                  <div className="px-3.5 py-2.5 rounded-xl bg-[#F8FAF8] border border-emerald-900/15 text-[11px] text-zinc-600 text-center">
                    Room service bills can also be posted to your room folio for settlement with Front Desk at check-out.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>

    {qrModalOpen && (
      <div
        aria-hidden="true"
        className="hidden print-only print-area bg-white text-[#11241B]"
      >
        <div className="max-w-[660px] mx-auto py-4 px-6 flex flex-col justify-between min-h-[9.4in]">
          {/* Top Face (Rotated 180° for A-frame folded tent) */}
          <div className="rotate-180 border-2 border-[#0F2E22] rounded-2xl p-6 text-center flex flex-col items-center justify-center space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9A7415]">
              {businessName} · 100% Pure Vegetarian
            </div>
            <div className="font-display text-2xl font-bold text-[#0F2E22]">
              {qrTargetType === 'room'
                ? `Room ${effectiveRoomNumber || '101'}`
                : `Table ${selectedTableNumber}`}
            </div>
            <div className="text-xs text-zinc-600">
              {qrTargetType === 'room'
                ? selectedRoomMeta?.type || 'In-Room Dining'
                : selectedTableMeta?.section ||
                  tableStatusInfo.tableDoc?.section ||
                  'Main Dining Hall'}
            </div>
            <div className="p-3.5 rounded-2xl border-2 border-[#C59B27] bg-white inline-block">
              <QRCodeSVG
                value={menuShareUrl}
                size={148}
                level="H"
                bgColor="#FFFFFF"
                fgColor="#0F2E22"
              />
            </div>
            <div className="space-y-0.5">
              <div className="text-sm font-bold text-[#0F2E22]">
                {qrTargetType === 'room'
                  ? 'Scan to Order In-Room Dining'
                  : 'Scan to View Digital Menu & Order'}
              </div>
              <div className="text-[11px] text-zinc-600">
                {qrTargetType === 'room'
                  ? 'Breakfast · Lunch · Evening · Dinner · Direct to Room'
                  : 'No app required · Instant table & kitchen sync'}
              </div>
            </div>
            <div className="font-mono-tabular text-[10px] text-zinc-500 break-all max-w-md">
              {menuShareUrl}
            </div>
          </div>

          {/* Center Fold Guide */}
          <div className="my-4 flex items-center gap-3">
            <div className="flex-1 border-t-2 border-dashed border-zinc-400" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 whitespace-nowrap">
              {qrTargetType === 'room'
                ? 'Fold Here · Room Tent Crease'
                : 'Fold Here · Table Tent Crease'}
            </span>
            <div className="flex-1 border-t-2 border-dashed border-zinc-400" />
          </div>

          {/* Bottom Face (Upright) */}
          <div className="border-2 border-[#0F2E22] rounded-2xl p-6 text-center flex flex-col items-center justify-center space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9A7415]">
              {businessName} · 100% Pure Vegetarian
            </div>
            <div className="font-display text-2xl font-bold text-[#0F2E22]">
              {qrTargetType === 'room'
                ? `Room ${effectiveRoomNumber || '101'}`
                : `Table ${selectedTableNumber}`}
            </div>
            <div className="text-xs text-zinc-600">
              {qrTargetType === 'room'
                ? selectedRoomMeta?.type || 'In-Room Dining'
                : selectedTableMeta?.section ||
                  tableStatusInfo.tableDoc?.section ||
                  'Main Dining Hall'}
            </div>
            <div className="p-3.5 rounded-2xl border-2 border-[#C59B27] bg-white inline-block">
              <QRCodeSVG
                value={menuShareUrl}
                size={148}
                level="H"
                bgColor="#FFFFFF"
                fgColor="#0F2E22"
              />
            </div>
            <div className="space-y-0.5">
              <div className="text-sm font-bold text-[#0F2E22]">
                {qrTargetType === 'room'
                  ? 'Scan to Order In-Room Dining'
                  : 'Scan to View Digital Menu & Order'}
              </div>
              <div className="text-[11px] text-zinc-600">
                {qrTargetType === 'room'
                  ? 'Breakfast · Lunch · Evening · Dinner · Direct to Room'
                  : 'No app required · Instant table & kitchen sync'}
              </div>
            </div>
            <div className="font-mono-tabular text-[10px] text-zinc-500 break-all max-w-md">
              {menuShareUrl}
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
};
