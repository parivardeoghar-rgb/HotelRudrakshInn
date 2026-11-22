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
  ArrowRightLeft,
  Award,
  BedDouble,
  Bell,
  BellRing,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  History,
  LogOut,
  Minus,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingBag,
  Star,
  User,
  Utensils,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import {
  changeCustomerOrderTable,
  createGuestServiceRequest,
  placeGuestRoomOrder,
  placeQrOrder,
  submitGuestFeedback,
  updateCustomerProfile,
} from '../services/firestoreService';
import {
  DEFAULT_HOTEL_SETTINGS,
  HOTEL_HERO_IMAGE,
  SEED_HOTEL_ROOMS,
  SEED_TABLES,
} from '../data/seedCatalog';
import {
  BAIDYANATH_MEDIA_LOGO,
  type Bill,
  type CustomerProfile,
  type DietaryTag,
  type HotelSettings,
  type MealSession,
  type MenuCategory,
  type MenuItem,
  type Order,
  type OrderItem,
  type OrderSource,
  type OrderStatus,
  type RestaurantTable,
} from '../types';
import {
  calculateBillTotals,
  formatDateTime,
  formatINR,
  toDate,
} from '../utils/format';
import {
  getDefaultMealSessionForHour,
  getMealSessionMeta,
  matchesMealSession,
  MEAL_SESSION_OPTIONS,
} from '../utils/mealSessions';
import { useOrderReadyNotifications } from '../hooks/useOrderReadyNotifications';
import { deriveTableOrderStatus } from '../hooks/useTableOrderStatus';
import { DietaryPreferenceField } from './DietaryPreferenceField';
import { DishImage } from './DishImage';
import { MealPhotoUploadModal } from './MealPhotoUploadModal';

interface CustomerDashboardProps {
  customer: CustomerProfile;
  initialTableId?: string | null;
  initialRoomNumber?: string | null;
  onProfileUpdated: (next: CustomerProfile) => void;
  onSignOut: () => Promise<void>;
}

const ORDER_STEPS: OrderStatus[] = ['New', 'Accepted', 'Preparing', 'Ready', 'Served'];

const LOYALTY_TIERS = [
  {
    name: 'Bronze Guest',
    minPoints: 0,
    perk: 'Earn 1 point for every ₹10 spent on dining & room orders',
  },
  {
    name: 'Silver Member',
    minPoints: 250,
    perk: 'Complimentary welcome beverage on dine-in visits',
  },
  {
    name: 'Gold Patron',
    minPoints: 750,
    perk: 'Priority table seating & 5% festive dining privilege',
  },
  {
    name: 'Rudraksh Royal',
    minPoints: 2000,
    perk: '10% dining privilege & priority room service delivery',
  },
] as const;

export const CustomerDashboard: React.FC<CustomerDashboardProps> = ({
  customer,
  initialTableId,
  initialRoomNumber,
  onProfileUpdated,
  onSignOut,
}) => {
  const [activeTab, setActiveTab] = useState<'menu' | 'orders' | 'feedback' | 'profile'>('menu');
  const [orderMode, setOrderMode] = useState<'table' | 'room'>(
    initialRoomNumber ? 'room' : 'table'
  );
  const [selectedTableId, setSelectedTableId] = useState<string>(
    initialTableId || customer.preferredTable || 'T1'
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
  const [table, setTable] = useState<RestaurantTable | null>(null);
  const [tableExistsInDb, setTableExistsInDb] = useState(false);

  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [billsById, setBillsById] = useState<Record<string, Bill>>({});
  const [orderHistoryFilter, setOrderHistoryFilter] = useState<'all' | 'previous' | 'active'>('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [settings, setSettings] = useState<HotelSettings>({
    ...DEFAULT_HOTEL_SETTINGS,
    updatedAt: new Date(),
  });

  const [selectedCat, setSelectedCat] = useState<string>('all');
  const [dietFilter, setDietFilter] = useState<'all' | 'bestseller'>('all');
  const [mealFilter, setMealFilter] = useState<MealSession | null>(null);
  const [orderMealSession, setOrderMealSession] = useState<MealSession>(() =>
    getDefaultMealSessionForHour()
  );
  const [deliverySlot, setDeliverySlot] = useState<string>('ASAP (Now)');
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [dietaryTags, setDietaryTags] = useState<DietaryTag[]>([]);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [transferTargets, setTransferTargets] = useState<Record<string, string>>({});
  const [transferBusyOrderId, setTransferBusyOrderId] = useState<string | null>(null);
  const [transferRequestedMap, setTransferRequestedMap] = useState<Record<string, string>>({});
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [photoModalTarget, setPhotoModalTarget] = useState<string | null>(null);

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
  const [profDiet, setProfDiet] = useState<'all' | 'veg'>(
    customer.dietaryPreference === 'veg' ? 'veg' : 'all'
  );
  const [savingProfile, setSavingProfile] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    if (!detailOrderId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDetailOrderId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detailOrderId]);

  const detailOrder = useMemo(
    () => (detailOrderId ? customerOrders.find((o) => o.id === detailOrderId) || null : null),
    [detailOrderId, customerOrders]
  );

  const { isNotifyEnabled, toggleNotifyForOrder } = useOrderReadyNotifications(
    customerOrders,
    (readyOrd) => {
      showToast(`Order ${readyOrd.orderNumber} is Ready!`);
    }
  );

  const tableStatusInfo = useMemo(
    () =>
      deriveTableOrderStatus(
        selectedTableId,
        tableExistsInDb ? table : null,
        customerOrders
      ),
    [selectedTableId, tableExistsInDb, table, customerOrders]
  );

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
        limit(50)
      ),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as Order)
          .sort(
            (a, b) =>
              toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()
          );
        setCustomerOrders(list);
        setLoadingOrders(false);
      },
      (err) => {
        console.warn('Customer orders listener:', err);
        setLoadingOrders(false);
      }
    );

    return () => {
      unsubTable();
      unsubCats();
      unsubItems();
      unsubSettings();
      unsubOrders();
    };
  }, [selectedTableId, customer.uid]);

  const linkedBillIds = useMemo(
    () =>
      Array.from(
        new Set(
          customerOrders
            .map((o) => o.billId)
            .filter((id): id is string => Boolean(id && id.startsWith('bill_')))
        )
      ),
    [customerOrders]
  );

  useEffect(() => {
    if (linkedBillIds.length === 0) {
      setBillsById({});
      return;
    }
    const unsubs = linkedBillIds.map((billId) =>
      onSnapshot(
        doc(db, 'bills', billId),
        (snap) => {
          if (snap.exists()) {
            const bill = snap.data() as Bill;
            setBillsById((prev) => ({ ...prev, [bill.id]: bill }));
          }
        },
        () => {
          // non-blocking if bill is not accessible or pending
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [linkedBillIds]);

  const effectiveRoomNumber =
    selectedRoomNumber === '__custom__'
      ? customRoomNumber.trim().slice(0, 20)
      : selectedRoomNumber;

  const selectedSessionMeta = useMemo(
    () => getMealSessionMeta(orderMealSession),
    [orderMealSession]
  );

  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (item.isVeg === false) return false;
      if (selectedCat !== 'all' && item.categoryId !== selectedCat) return false;
      if (dietFilter === 'bestseller' && !item.isBestseller) return false;
      if (mealFilter && !matchesMealSession(item, mealFilter)) return false;
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
  }, [menuItems, selectedCat, dietFilter, mealFilter, searchTerm]);

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

  const isHistoricalOrder = (ord: Order) =>
    ord.status === 'Completed' || ord.status === 'Cancelled' || ord.billed === true;

  const getOrderSourceLabel = (source: OrderSource) => {
    switch (source) {
      case 'qr':
        return 'QR Dine-In';
      case 'waiter':
        return 'Table Service';
      case 'pos':
        return 'Counter POS';
      case 'room_service':
        return 'Room Service';
      default:
        return 'Dining Order';
    }
  };

  const formatOrderItemsSummary = (items: OrderItem[]) => {
    const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
    if (items.length === 0) {
      return { totalQty: 0, text: 'No items listed' };
    }
    const preview = items
      .slice(0, 2)
      .map((item) => `${item.qty}× ${item.name}`)
      .join(', ');
    const remaining = items.length - 2;
    const text = remaining > 0 ? `${preview} + ${remaining} more` : preview;
    return { totalQty, text };
  };

  const getOrderDisplayTotals = (ord: Order) => {
    const bill = ord.billId ? billsById[ord.billId] : undefined;
    const estimated = calculateBillTotals(ord.items, 'none', 0, settings.taxes);
    return {
      bill,
      subtotal: bill ? bill.subtotal : ord.subtotal,
      discount: bill ? bill.discountAmount : 0,
      tax: bill ? bill.taxAmount : estimated.taxAmount,
      total:
        ord.status === 'Cancelled'
          ? 0
          : bill
          ? bill.totalAmount
          : estimated.totalAmount,
    };
  };

  const orderHistorySummary = useMemo(() => {
    let activeCount = 0;
    let previousCount = 0;
    let totalSpent = 0;

    for (const ord of customerOrders) {
      if (isHistoricalOrder(ord)) {
        previousCount += 1;
      } else {
        activeCount += 1;
      }
      if (ord.status === 'Cancelled') continue;
      const bill = ord.billId ? billsById[ord.billId] : undefined;
      if (bill && bill.paymentStatus !== 'Cancelled') {
        totalSpent += bill.totalAmount;
      } else {
        totalSpent += calculateBillTotals(ord.items, 'none', 0, settings.taxes).totalAmount;
      }
    }

    return {
      totalOrders: customerOrders.length,
      activeCount,
      previousCount,
      totalSpent: Math.round(totalSpent * 100) / 100,
      lastOrderAt: customerOrders[0]?.createdAt ? formatDateTime(customerOrders[0].createdAt) : 'No orders yet',
    };
  }, [customerOrders, billsById, settings.taxes]);

  const loyaltySummary = useMemo(() => {
    const points = Math.max(0, Math.floor(orderHistorySummary.totalSpent / 10));
    let currentTierIndex = 0;
    for (let i = LOYALTY_TIERS.length - 1; i >= 0; i -= 1) {
      if (points >= LOYALTY_TIERS[i].minPoints) {
        currentTierIndex = i;
        break;
      }
    }
    const currentTier = LOYALTY_TIERS[currentTierIndex];
    const nextTier =
      currentTierIndex < LOYALTY_TIERS.length - 1
        ? LOYALTY_TIERS[currentTierIndex + 1]
        : null;

    if (!nextTier) {
      return {
        points,
        currentTier,
        nextTier: null,
        pointsToNext: 0,
        progressPercent: 100,
      };
    }

    const tierSpan = Math.max(1, nextTier.minPoints - currentTier.minPoints);
    const tierEarned = Math.max(0, points - currentTier.minPoints);
    const progressPercent = Math.min(100, Math.round((tierEarned / tierSpan) * 100));
    const pointsToNext = Math.max(0, nextTier.minPoints - points);

    return {
      points,
      currentTier,
      nextTier,
      pointsToNext,
      progressPercent,
    };
  }, [orderHistorySummary.totalSpent]);

  const filteredOrderHistory = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return customerOrders.filter((ord) => {
      const historical = isHistoricalOrder(ord);
      if (orderHistoryFilter === 'previous' && !historical) return false;
      if (orderHistoryFilter === 'active' && historical) return false;
      if (q) {
        const bill = ord.billId ? billsById[ord.billId] : undefined;
        const matchesOrder = ord.orderNumber.toLowerCase().includes(q);
        const matchesInvoice = bill?.invoiceNumber.toLowerCase().includes(q) || false;
        const matchesTable = (ord.tableNumber || '').toLowerCase().includes(q);
        const matchesRoom = (ord.roomNumber || '').toLowerCase().includes(q);
        const matchesItem = ord.items.some((it) => it.name.toLowerCase().includes(q));
        return matchesOrder || matchesInvoice || matchesTable || matchesRoom || matchesItem;
      }
      return true;
    });
  }, [customerOrders, orderHistoryFilter, orderSearch, billsById]);

  const handleReorderFromHistory = (ord: Order) => {
    const skipped: string[] = [];
    const nextCart: OrderItem[] = [];

    for (const prevItem of ord.items) {
      const liveDish = menuItems.find((m) => m.id === prevItem.itemId);
      if (menuItems.length > 0) {
        if (!liveDish || !liveDish.available || liveDish.isVeg === false) {
          skipped.push(prevItem.name);
          continue;
        }
        nextCart.push({
          itemId: liveDish.id,
          name: liveDish.name,
          price: liveDish.price,
          qty: prevItem.qty,
          isVeg: true,
          categoryName: liveDish.categoryName,
          ...(prevItem.notes ? { notes: prevItem.notes } : {}),
        });
      } else {
        nextCart.push({ ...prevItem, isVeg: true });
      }
    }

    if (nextCart.length === 0) {
      showToast(`Items from ${ord.orderNumber} are currently unavailable.`);
      return;
    }

    setCart(nextCart);
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
    if (ord.mealSession) {
      setOrderMealSession(ord.mealSession);
    }
    if (ord.deliverySlot) {
      setDeliverySlot(ord.deliverySlot);
    }
    setDietaryTags(ord.dietaryTags ? [...ord.dietaryTags] : []);
    if (ord.specialInstructions) {
      setSpecialInstructions(ord.specialInstructions);
    }
    setCartOpen(true);
    showToast(
      skipped.length > 0
        ? `Cart pre-filled from ${ord.orderNumber}. Unavailable skipped: ${skipped.join(', ')}.`
        : `Cart pre-filled with items from ${ord.orderNumber}.`
    );
  };

  const handlePlaceOrder = async () => {
    if (cart.length === 0) return;

    if (orderMode === 'room') {
      if (!effectiveRoomNumber) {
        showToast('Please select or enter your hotel room number.');
        return;
      }
      setSubmitting(true);
      try {
        await placeGuestRoomOrder({
          roomNumber: effectiveRoomNumber,
          items: cart,
          guestName: customer.displayName,
          guestSessionId: `cust_${customer.uid}`,
          customerId: customer.uid,
          mealSession: orderMealSession,
          deliverySlot,
          dietaryTags,
          specialInstructions,
        });
        setCart([]);
        setDietaryTags([]);
        setSpecialInstructions('');
        setCartOpen(false);
        setActiveTab('orders');
        showToast(`Room service order placed for Room ${effectiveRoomNumber} (${orderMealSession})!`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Unable to place room order.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!table) return;
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
        mealSession: orderMealSession,
        deliverySlot,
        dietaryTags,
        specialInstructions,
      });
      setCart([]);
      setDietaryTags([]);
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
      setSelectedTableId(profTable);
      showToast('Customer profile updated.');
    } catch {
      showToast('Unable to save profile.');
    } finally {
      setSavingProfile(false);
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
        customerUid: customer.uid,
      });
      if (res.mode === 'transferred') {
        setSelectedTableId(targetTableId);
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
          : 'Unable to change table right now. Please notify your steward.'
      );
    } finally {
      setTransferBusyOrderId(null);
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
              Welcome, {customer.displayName} ·{' '}
              {orderMode === 'room'
                ? `Room ${effectiveRoomNumber || '—'}`
                : `Table ${table?.tableNumber || selectedTableId}`}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {orderMode === 'table' && (
              <>
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
              </>
            )}
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

      {/* Hero + Table / Hotel Room Selection */}
      <div className="relative h-40 sm:h-48 bg-[#141518] overflow-hidden">
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
              100% Pure Vegetarian · Customer Portal
            </p>
            <h1 className="font-display text-xl sm:text-2xl font-semibold text-white">
              Order & Live Dining History
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-[#141518]/90 border border-white/15 rounded-xl px-2.5 py-1.5 text-xs">
            <div className="inline-flex items-center p-0.5 rounded-lg bg-black/30 border border-white/10">
              <button
                type="button"
                onClick={() => setOrderMode('table')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  orderMode === 'table'
                    ? 'bg-[#C59B27] text-[#141518]'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Dining Table
              </button>
              <button
                type="button"
                onClick={() => setOrderMode('room')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer ${
                  orderMode === 'room'
                    ? 'bg-[#C59B27] text-[#141518]'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                <BedDouble className="w-3 h-3" />
                <span>Hotel Room</span>
              </button>
            </div>

            {orderMode === 'table' ? (
              <>
                <select
                  value={selectedTableId}
                  onChange={(e) => setSelectedTableId(e.target.value)}
                  aria-label="Select dining table"
                  className="bg-transparent text-[#D4AF37] font-semibold focus:outline-none cursor-pointer"
                >
                  {SEED_TABLES.map((t) => (
                    <option key={t.id} value={t.id} className="text-zinc-900">
                      {t.tableNumber} · {t.section}
                    </option>
                  ))}
                </select>
                <span aria-hidden="true" className="h-3.5 w-px bg-white/15" />
                <span
                  role="status"
                  aria-live="polite"
                  title={tableStatusInfo.detail}
                  className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap ${
                    tableStatusInfo.isOccupied ? 'text-amber-300' : 'text-emerald-300'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      tableStatusInfo.isOccupied ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                  />
                  <span>{tableStatusInfo.label}</span>
                  {tableStatusInfo.stageLabel && (
                    <span className="font-normal text-zinc-400">
                      · {tableStatusInfo.stageLabel}
                    </span>
                  )}
                </span>
              </>
            ) : (
              <>
                <select
                  value={selectedRoomNumber}
                  onChange={(e) => setSelectedRoomNumber(e.target.value)}
                  aria-label="Select hotel room"
                  className="bg-transparent text-[#D4AF37] font-semibold focus:outline-none cursor-pointer"
                >
                  {SEED_HOTEL_ROOMS.map((r) => (
                    <option key={r.id} value={r.roomNumber} className="text-zinc-900">
                      Room {r.roomNumber} · {r.type}
                    </option>
                  ))}
                  <option value="__custom__" className="text-zinc-900">
                    Other Room #
                  </option>
                </select>
                {selectedRoomNumber === '__custom__' && (
                  <input
                    type="text"
                    maxLength={20}
                    value={customRoomNumber}
                    onChange={(e) => setCustomRoomNumber(e.target.value)}
                    placeholder="Room #"
                    aria-label="Enter custom room number"
                    className="w-20 px-2 py-0.5 rounded bg-black/30 border border-white/20 text-[#D4AF37] text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#C59B27]"
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Customer Navigation Tabs */}
      <div className="max-w-5xl w-full mx-auto px-4 pt-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-zinc-200/80 rounded-xl text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('menu')}
            className={`py-2 px-2 rounded-lg font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'menu' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
            }`}
          >
            <Utensils className="w-3.5 h-3.5 shrink-0" />
            <span>Menu</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`py-2 px-2 rounded-lg font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'orders' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
            }`}
          >
            <History className="w-3.5 h-3.5 shrink-0" />
            <span>Order History ({customerOrders.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('feedback')}
            className={`py-2 px-2 rounded-lg font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'feedback' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
            }`}
          >
            <Star className="w-3.5 h-3.5 shrink-0" />
            <span>Feedback</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`py-2 px-2 rounded-lg font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'profile' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
            }`}
          >
            <User className="w-3.5 h-3.5 shrink-0" />
            <span>Profile</span>
          </button>
        </div>
      </div>

      {/* Main Customer Body */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 mt-5">
        {/* Loyalty Points Summary Card */}
        <section
          aria-labelledby="loyalty-points-heading"
          className="bg-white border border-zinc-200 rounded-xl p-5 mb-5"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-[#9A7415] shrink-0" />
                <h2
                  id="loyalty-points-heading"
                  className="text-sm font-semibold text-zinc-900"
                >
                  Loyalty Points
                </h2>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono-tabular text-2xl font-bold text-zinc-900">
                  {loyaltySummary.points.toLocaleString('en-IN')}
                </span>
                <span className="text-xs font-medium text-zinc-500">pts earned</span>
              </div>
              <div className="text-xs text-zinc-500 flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-[#9A7415]">
                  {loyaltySummary.currentTier.name}
                </span>
                <span aria-hidden="true">·</span>
                <span>1 pt per ₹10 spent</span>
                <span aria-hidden="true">·</span>
                <span>{loyaltySummary.currentTier.perk}</span>
              </div>
            </div>

            <div className="w-full md:max-w-sm space-y-2 shrink-0">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-zinc-600">
                  {loyaltySummary.nextTier ? (
                    <>
                      Next tier:{' '}
                      <strong className="text-zinc-900">
                        {loyaltySummary.nextTier.name}
                      </strong>
                    </>
                  ) : (
                    <strong className="text-emerald-700">
                      Highest reward tier unlocked
                    </strong>
                  )}
                </span>
                <span className="font-mono-tabular font-semibold text-zinc-900 whitespace-nowrap">
                  {loyaltySummary.nextTier
                    ? `${loyaltySummary.pointsToNext.toLocaleString('en-IN')} pts to go (${loyaltySummary.progressPercent}%)`
                    : '100%'}
                </span>
              </div>

              <div
                role="progressbar"
                aria-valuenow={loyaltySummary.progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress toward next loyalty reward tier"
                className="w-full h-2.5 bg-zinc-100 rounded-full overflow-hidden"
              >
                <div
                  className="h-full bg-[#C59B27] rounded-full transition-all duration-300"
                  style={{ width: `${loyaltySummary.progressPercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                <span className="font-mono-tabular">
                  {loyaltySummary.currentTier.minPoints.toLocaleString('en-IN')} pts
                </span>
                {loyaltySummary.nextTier ? (
                  <span className="truncate text-right">
                    Unlock: {loyaltySummary.nextTier.perk} ·{' '}
                    <span className="font-mono-tabular">
                      {loyaltySummary.nextTier.minPoints.toLocaleString('en-IN')} pts
                    </span>
                  </span>
                ) : (
                  <span>All dining &amp; room service rewards active</span>
                )}
              </div>
            </div>
          </div>
        </section>

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
                    { id: 'all', label: 'All Pure Veg' },
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

            {/* Meal Time / Daypart Bar */}
            <div
              role="group"
              aria-label="Meal session filter"
              className="flex flex-wrap items-center gap-2 mb-3"
            >
              <span className="text-xs font-semibold text-zinc-500 mr-1">Meal Time:</span>
              <button
                type="button"
                onClick={() => setMealFilter(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer whitespace-nowrap ${
                  mealFilter === null
                    ? 'bg-[#C59B27] text-[#141518] border-[#C59B27]'
                    : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300'
                }`}
              >
                All Day
              </button>
              {MEAL_SESSION_OPTIONS.map((session) => {
                const active = mealFilter === session.id;
                return (
                  <button
                    key={session.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      if (active) {
                        setMealFilter(null);
                      } else {
                        setMealFilter(session.id);
                        setOrderMealSession(session.id);
                        setDeliverySlot('ASAP (Now)');
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-[#C59B27] text-[#141518] border-[#C59B27]'
                        : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300'
                    }`}
                  >
                    {session.label}
                  </button>
                );
              })}
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
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <span className="w-2.5 h-2.5 border border-emerald-700 flex items-center justify-center rounded-[2px]">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-700" />
                            </span>
                            Pure Veg
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

            {/* Order History Overview Section on Dashboard */}
            <section
              aria-labelledby="dashboard-order-history-heading"
              className="mt-8 bg-white border border-zinc-200 rounded-xl overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-zinc-100 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2
                    id="dashboard-order-history-heading"
                    className="font-display text-lg font-semibold text-zinc-900"
                  >
                    Order History
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Past and recent orders with item summaries, total cost, and live order status
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {customerOrders.some((o) => o.status !== 'Cancelled') && (
                    <button
                      type="button"
                      onClick={() => setPhotoModalTarget('__pick__')}
                      className="px-3.5 py-2 rounded-lg bg-[#141518] hover:bg-zinc-800 text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Upload Meal Photo</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveTab('orders')}
                    className="px-3.5 py-2 rounded-lg border border-zinc-300 bg-white hover:border-[#C59B27] text-xs font-semibold text-zinc-900 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    View All Orders ({customerOrders.length})
                  </button>
                </div>
              </div>

              {loadingOrders ? (
                <div className="p-5 space-y-3">
                  {[1, 2].map((n) => (
                    <div key={n} className="h-16 bg-zinc-50 rounded-lg" />
                  ))}
                </div>
              ) : customerOrders.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-500">
                  No past orders recorded yet. Your dining and room service orders will appear here once placed.
                </div>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {customerOrders.slice(0, 4).map((ord) => {
                    const summary = formatOrderItemsSummary(ord.items);
                    const totals = getOrderDisplayTotals(ord);
                    const statusColor =
                      ord.status === 'Completed' || ord.status === 'Served'
                        ? 'text-emerald-700'
                        : ord.status === 'Cancelled'
                        ? 'text-red-700'
                        : 'text-[#9A7415]';

                    return (
                      <div
                        key={ord.id}
                        className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          {ord.mealPhotoUrl && (
                            <button
                              type="button"
                              onClick={() => setPhotoModalTarget(ord.id)}
                              title="View or update uploaded meal photo"
                              className="w-12 h-12 rounded-lg overflow-hidden border border-zinc-200 bg-zinc-900 shrink-0 cursor-pointer"
                            >
                              <img
                                src={ord.mealPhotoUrl}
                                alt={`Meal photo for ${ord.orderNumber}`}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          )}
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                              <span className="font-mono-tabular font-bold text-zinc-900">
                                {ord.orderNumber}
                              </span>
                              <span aria-hidden="true" className="text-zinc-300">
                                ·
                              </span>
                              <span className="font-mono-tabular text-zinc-500">
                                {formatDateTime(ord.createdAt)}
                              </span>
                              <span aria-hidden="true" className="text-zinc-300">
                                ·
                              </span>
                              <span className="text-zinc-600">
                                {ord.tableNumber
                                  ? `Table ${ord.tableNumber}`
                                  : ord.roomNumber
                                  ? `Room ${ord.roomNumber}`
                                  : 'Counter / Takeaway'}
                              </span>
                              <span aria-hidden="true" className="text-zinc-300">
                                ·
                              </span>
                              <span className={`font-semibold ${statusColor}`}>{ord.status}</span>
                              {ord.mealPhotoUrl && (
                                <>
                                  <span aria-hidden="true" className="text-zinc-300">
                                    ·
                                  </span>
                                  <span className="font-medium text-zinc-600">
                                    Photo: {ord.mealPhotoStatus || 'Pending Review'}
                                  </span>
                                </>
                              )}
                            </div>
                            <p className="text-xs text-zinc-700 truncate">
                              <span className="font-mono-tabular font-semibold text-zinc-900">
                                {summary.totalQty} {summary.totalQty === 1 ? 'item' : 'items'}
                              </span>{' '}
                              <span aria-hidden="true" className="text-zinc-400">
                                ·
                              </span>{' '}
                              <span>{summary.text}</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 shrink-0">
                          <div className="text-left sm:text-right">
                            <div className="text-[11px] text-zinc-500">
                              {totals.bill ? 'Total Cost' : 'Estimated Total'}
                            </div>
                            <div className="font-mono-tabular text-sm font-bold text-zinc-900">
                              {formatINR(totals.total)}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {ord.status !== 'Cancelled' && (
                              <button
                                type="button"
                                onClick={() => setPhotoModalTarget(ord.id)}
                                className="px-3 py-1.5 rounded-lg border border-zinc-300 bg-white hover:border-[#C59B27] text-xs font-semibold text-zinc-900 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                              >
                                <Camera className="w-3.5 h-3.5 text-[#9A7415]" />
                                <span>{ord.mealPhotoUrl ? 'Meal Photo' : 'Add Photo'}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setDetailOrderId(ord.id)}
                              className="px-3 py-1.5 rounded-lg border border-zinc-300 bg-white hover:border-[#C59B27] text-xs font-semibold text-zinc-900 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5 text-[#9A7415]" />
                              <span>View Details</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReorderFromHistory(ord)}
                              className="px-3 py-1.5 rounded-lg bg-[#141518] hover:bg-zinc-800 text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
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
              )}
            </section>
          </>
        )}

        {activeTab === 'orders' && (
          <section aria-labelledby="order-history-heading" className="space-y-5">
            {/* Order History Header & Summary Metrics */}
            <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="order-history-heading" className="font-display text-xl font-semibold text-zinc-900">
                    Order History
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Review your previous dining orders, ordered dishes, timestamps, and final tax-inclusive bills.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {customerOrders.some((o) => o.status !== 'Cancelled') && (
                    <button
                      type="button"
                      onClick={() => setPhotoModalTarget('__pick__')}
                      className="px-3.5 py-2 rounded-lg border border-zinc-300 bg-white hover:border-[#C59B27] text-zinc-900 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5 text-[#9A7415]" />
                      <span>Upload Meal Photo</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveTab('menu')}
                    className="px-3.5 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    New Order
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-zinc-100">
                <div>
                  <div className="text-xs text-zinc-500">Total Orders</div>
                  <div className="font-mono-tabular text-xl font-bold text-zinc-900 mt-0.5">
                    {orderHistorySummary.totalOrders}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {orderHistorySummary.previousCount} previous · {orderHistorySummary.activeCount} active
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Cumulative Dining Spend</div>
                  <div className="font-mono-tabular text-xl font-bold text-zinc-900 mt-0.5">
                    {formatINR(orderHistorySummary.totalSpent)}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Includes billed invoices &amp; active estimates
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Latest Activity</div>
                  <div className="font-mono-tabular text-sm font-semibold text-zinc-900 mt-1">
                    {orderHistorySummary.lastOrderAt}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5 truncate">
                    Account: {customer.displayName}
                  </div>
                </div>
              </div>
            </div>

            {/* Search & Filter Toolbar */}
            {customerOrders.length > 0 && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="Search order #, invoice #, dish, or table..."
                    className="w-full pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-white border border-zinc-200 rounded-xl overflow-x-auto">
                  {(
                    [
                      { id: 'all', label: `All (${orderHistorySummary.totalOrders})` },
                      { id: 'previous', label: `Previous (${orderHistorySummary.previousCount})` },
                      { id: 'active', label: `Active (${orderHistorySummary.activeCount})` },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setOrderHistoryFilter(tab.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        orderHistoryFilter === tab.id
                          ? 'bg-[#141518] text-[#D4AF37]'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Orders List / Loading / Empty States */}
            {loadingOrders ? (
              <div className="space-y-3">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-44 bg-white border border-zinc-200 rounded-xl" />
                ))}
              </div>
            ) : customerOrders.length === 0 ? (
              <div className="bg-white border border-zinc-200 rounded-xl p-10 text-center">
                <Clock className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-zinc-900">
                  No orders placed from your account yet
                </h3>
                <p className="text-xs text-zinc-500 mt-1 mb-4 max-w-md mx-auto">
                  Every order you place while signed in is recorded here with itemized dishes, timestamps, and final bills.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('menu')}
                  className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
                >
                  Explore Menu
                </button>
              </div>
            ) : filteredOrderHistory.length === 0 ? (
              <div className="bg-white border border-zinc-200 rounded-xl p-10 text-center">
                <ReceiptText className="w-8 h-8 text-zinc-400 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-zinc-900">
                  No matching orders in your history
                </h3>
                <p className="text-xs text-zinc-500 mt-1 mb-4">
                  Adjust your search query or status filter to view other dining orders.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setOrderSearch('');
                    setOrderHistoryFilter('all');
                  }}
                  className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
                >
                  Clear Filters
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredOrderHistory.map((ord) => {
                  const totals = getOrderDisplayTotals(ord);
                  const summary = formatOrderItemsSummary(ord.items);
                  const canNotify =
                    ord.status === 'New' ||
                    ord.status === 'Accepted' ||
                    ord.status === 'Preparing';
                  const notifyOn = isNotifyEnabled(ord.id);

                  const statusTextColor =
                    ord.status === 'Completed' || ord.status === 'Served'
                      ? 'text-emerald-700'
                      : ord.status === 'Cancelled'
                      ? 'text-red-700'
                      : 'text-[#9A7415]';

                  return (
                    <article
                      key={ord.id}
                      className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-mono-tabular text-base font-bold text-zinc-900">
                              {ord.orderNumber}
                            </h3>
                            {totals.bill && (
                              <span className="font-mono-tabular text-xs text-zinc-500">
                                · Invoice {totals.bill.invoiceNumber}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-500 flex flex-wrap items-center gap-1.5">
                            <span className="font-mono-tabular">
                              {formatDateTime(ord.createdAt)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {ord.tableNumber
                                ? `Table ${ord.tableNumber}`
                                : ord.roomNumber
                                ? `Room ${ord.roomNumber}`
                                : 'Counter / Takeaway'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{getOrderSourceLabel(ord.source)}</span>
                            {ord.mealSession && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-medium text-zinc-700">
                                  {ord.mealSession}
                                  {ord.deliverySlot ? ` (${ord.deliverySlot})` : ''}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="text-left sm:text-right shrink-0">
                          <div className={`text-xs font-semibold ${statusTextColor}`}>
                            Status: {ord.status}
                          </div>
                          <div className="text-[11px] text-zinc-500 mt-0.5">
                            {totals.bill
                              ? `${totals.bill.paymentStatus} · ${totals.bill.paymentMethod}`
                              : ord.status === 'Cancelled'
                              ? 'Order cancelled'
                              : ord.billed
                              ? 'Billed'
                              : 'Pending final bill'}
                          </div>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="text-xs text-zinc-800">
                            <span className="font-mono-tabular font-semibold text-zinc-900">
                              {summary.totalQty} {summary.totalQty === 1 ? 'item' : 'items'} ordered
                            </span>{' '}
                            <span aria-hidden="true" className="text-zinc-400">
                              ·
                            </span>{' '}
                            <span className="text-zinc-600">{summary.text}</span>
                          </div>
                          {(ord.dietaryTags && ord.dietaryTags.length > 0) && (
                            <div className="text-[11px] font-medium text-emerald-800">
                              Dietary preference: {ord.dietaryTags.join(' · ')}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 shrink-0">
                          <div className="text-left sm:text-right">
                            <div className="text-[11px] text-zinc-500">
                              {totals.bill
                                ? 'Total Cost'
                                : ord.status === 'Cancelled'
                                ? 'Total Cost'
                                : 'Estimated Total'}
                            </div>
                            <div className="font-mono-tabular text-base font-bold text-zinc-900">
                              {formatINR(totals.total)}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
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

                            {ord.status !== 'Cancelled' && (
                              <button
                                type="button"
                                onClick={() => setPhotoModalTarget(ord.id)}
                                className="px-3.5 py-1.5 rounded-lg border border-zinc-300 bg-white hover:border-[#C59B27] text-zinc-900 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Camera className="w-3.5 h-3.5 text-[#9A7415]" />
                                <span>{ord.mealPhotoUrl ? 'Update Photo' : 'Add Meal Photo'}</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setDetailOrderId(ord.id)}
                              className="px-3.5 py-1.5 rounded-lg border border-zinc-300 bg-white hover:border-[#C59B27] text-zinc-900 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5 text-[#9A7415]" />
                              <span>View Details</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleReorderFromHistory(ord)}
                              className="px-3.5 py-1.5 rounded-lg bg-[#141518] hover:bg-zinc-800 text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Reorder</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {ord.mealPhotoUrl && (
                        <div className="pt-3 border-t border-zinc-100 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setPhotoModalTarget(ord.id)}
                            className="w-16 h-16 rounded-lg overflow-hidden border border-zinc-200 bg-zinc-900 shrink-0 cursor-pointer"
                          >
                            <img
                              src={ord.mealPhotoUrl}
                              alt={`Meal photo for ${ord.orderNumber}`}
                              className="w-full h-full object-cover"
                            />
                          </button>
                          <div className="min-w-0 text-xs space-y-0.5">
                            <div className="font-semibold text-zinc-900">
                              Guest Meal Photo ·{' '}
                              <span
                                className={
                                  ord.mealPhotoStatus === 'Featured'
                                    ? 'text-[#9A7415]'
                                    : ord.mealPhotoStatus === 'Reviewed'
                                    ? 'text-emerald-700'
                                    : ord.mealPhotoStatus === 'Flagged'
                                    ? 'text-red-700'
                                    : 'text-zinc-600'
                                }
                              >
                                {ord.mealPhotoStatus || 'Pending Review'}
                              </span>
                            </div>
                            {ord.mealPhotoCaption && (
                              <p className="text-zinc-600 truncate">{ord.mealPhotoCaption}</p>
                            )}
                            {ord.mealPhotoUploadedAt ? (
                              <p className="text-[11px] font-mono-tabular text-zinc-400">
                                Uploaded {formatDateTime(ord.mealPhotoUploadedAt)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
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
                  onChange={(e) => setProfDiet(e.target.value as 'all' | 'veg')}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300"
                >
                  <option value="all">All Pure Veg Dishes</option>
                  <option value="veg">Pure Veg Only</option>
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
                    {cartCount} {cartCount === 1 ? 'item' : 'items'} ·{' '}
                    {orderMode === 'room'
                      ? `Room ${effectiveRoomNumber || '—'}`
                      : `Table ${table?.tableNumber || selectedTableId}`}
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
                <h3 className="font-display text-lg font-semibold">
                  {orderMode === 'room' ? 'Confirm Room Service Order' : 'Confirm Table Order'}
                </h3>
                <p className="text-xs text-zinc-400">
                  {customer.displayName} ·{' '}
                  {orderMode === 'room'
                    ? `Room ${effectiveRoomNumber || '—'} · ${orderMealSession}`
                    : `Table ${table?.tableNumber || selectedTableId}`}
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label
                    htmlFor="cust-meal-session"
                    className="block font-semibold text-zinc-700 mb-1"
                  >
                    Meal Session
                  </label>
                  <select
                    id="cust-meal-session"
                    value={orderMealSession}
                    onChange={(e) => {
                      setOrderMealSession(e.target.value as MealSession);
                      setDeliverySlot('ASAP (Now)');
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 bg-white font-semibold"
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
                    htmlFor="cust-delivery-slot"
                    className="block font-semibold text-zinc-700 mb-1"
                  >
                    Serving / Room Time
                  </label>
                  <select
                    id="cust-delivery-slot"
                    value={deliverySlot}
                    onChange={(e) => setDeliverySlot(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 bg-white font-semibold"
                  >
                    {selectedSessionMeta.deliverySlots.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <DietaryPreferenceField value={dietaryTags} onChange={setDietaryTags} />
              <textarea
                rows={2}
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                placeholder={
                  orderMode === 'room'
                    ? 'Room instructions (cutlery for 2, knock gently, extra tea)...'
                    : 'Special kitchen instructions...'
                }
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
                {submitting
                  ? 'Placing Order...'
                  : orderMode === 'room'
                  ? `Place Room Order · Room ${effectiveRoomNumber || '—'}`
                  : `Place Order Now · Table ${table?.tableNumber || selectedTableId}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Details & Status Modal */}
      {detailOrder &&
        (() => {
          const totals = getOrderDisplayTotals(detailOrder);
          const showProgress =
            detailOrder.status !== 'Completed' && detailOrder.status !== 'Cancelled';
          const currentStep = Math.max(0, ORDER_STEPS.indexOf(detailOrder.status));
          const canNotify =
            detailOrder.status === 'New' ||
            detailOrder.status === 'Accepted' ||
            detailOrder.status === 'Preparing';
          const notifyOn = isNotifyEnabled(detailOrder.id);
          const canChangeTable =
            !detailOrder.billed &&
            detailOrder.status !== 'Completed' &&
            detailOrder.status !== 'Cancelled' &&
            Boolean(detailOrder.tableId);
          const otherTables = SEED_TABLES.filter((t) => t.id !== detailOrder.tableId);
          const selectedTargetId =
            transferTargets[detailOrder.id] && transferTargets[detailOrder.id] !== detailOrder.tableId
              ? transferTargets[detailOrder.id]
              : otherTables[0]?.id || '';
          const statusColor =
            detailOrder.status === 'Completed' || detailOrder.status === 'Served'
              ? 'text-emerald-700'
              : detailOrder.status === 'Cancelled'
              ? 'text-red-700'
              : 'text-[#9A7415]';

          return (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="order-details-modal-title"
              onClick={() => setDetailOrderId(null)}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-xl bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden max-h-[90vh] flex flex-col border border-zinc-200 shadow-2xl"
              >
                <div className="px-5 py-4 bg-[#141518] text-white flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-[#D4AF37]">
                      Order Details &amp; Status
                    </div>
                    <h3
                      id="order-details-modal-title"
                      className="font-mono-tabular text-lg font-bold text-white"
                    >
                      {detailOrder.orderNumber}
                      {totals.bill ? (
                        <span className="text-xs font-normal text-zinc-300 ml-2">
                          · Invoice {totals.bill.invoiceNumber}
                        </span>
                      ) : null}
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {formatDateTime(detailOrder.createdAt)} ·{' '}
                      {detailOrder.tableNumber
                        ? `Table ${detailOrder.tableNumber}`
                        : detailOrder.roomNumber
                        ? `Room ${detailOrder.roomNumber}`
                        : 'Counter / Takeaway'}{' '}
                      · {getOrderSourceLabel(detailOrder.source)}
                      {detailOrder.mealSession ? ` · ${detailOrder.mealSession}` : ''}
                      {detailOrder.deliverySlot ? ` (${detailOrder.deliverySlot})` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close order details"
                    onClick={() => setDetailOrderId(null)}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-200 cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-5 overflow-y-auto space-y-5 flex-1 text-xs">
                  {/* Current Order Status */}
                  <div className="pb-4 border-b border-zinc-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-medium text-zinc-500">
                          Current Order Status
                        </div>
                        <div className={`text-base font-bold mt-0.5 ${statusColor}`}>
                          {detailOrder.status}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          {totals.bill
                            ? `${totals.bill.paymentStatus} · ${totals.bill.paymentMethod}`
                            : detailOrder.status === 'Cancelled'
                            ? 'This order was cancelled'
                            : detailOrder.status === 'Completed'
                            ? 'Completed & settled'
                            : detailOrder.billed
                            ? 'Billed'
                            : 'Pending final bill'}
                        </div>
                      </div>

                      {canNotify && (
                        <button
                          type="button"
                          aria-pressed={notifyOn}
                          onClick={async () => {
                            const res = await toggleNotifyForOrder(detailOrder);
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
                    </div>

                    {showProgress && (
                      <div className="grid grid-cols-5 gap-2 pt-1">
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
                  </div>

                  {/* Items Ordered Breakdown */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-zinc-900">
                      Items Ordered ({detailOrder.items.reduce((s, i) => s + i.qty, 0)})
                    </h4>
                    <div className="divide-y divide-zinc-100 border-y border-zinc-100">
                      {detailOrder.items.map((it, idx) => (
                        <div
                          key={`${it.itemId}_${idx}`}
                          className="py-2.5 flex items-start justify-between gap-4"
                        >
                          <div className="min-w-0">
                            <div className="text-zinc-900">
                              <strong className="font-mono-tabular">{it.qty}×</strong>{' '}
                              <span className="font-medium">{it.name}</span>
                              <span className="text-zinc-400 font-mono-tabular ml-1.5">
                                ({formatINR(it.price)} each)
                              </span>
                            </div>
                            {it.notes && (
                              <div className="text-[11px] text-zinc-500 mt-0.5">
                                Note: {it.notes}
                              </div>
                            )}
                          </div>
                          <span className="font-mono-tabular font-semibold text-zinc-900 shrink-0">
                            {formatINR(it.price * it.qty)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {((detailOrder.dietaryTags && detailOrder.dietaryTags.length > 0) ||
                      detailOrder.specialInstructions) && (
                      <div className="pt-2 text-[11px] text-zinc-600 space-y-1">
                        {detailOrder.dietaryTags && detailOrder.dietaryTags.length > 0 && (
                          <div className="font-medium text-emerald-800">
                            Dietary tags: {detailOrder.dietaryTags.join(' · ')}
                          </div>
                        )}
                        {detailOrder.specialInstructions && (
                          <div>Kitchen instructions: {detailOrder.specialInstructions}</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Table Transfer (if active table order) */}
                  {canChangeTable && otherTables.length > 0 && (
                    <div className="pt-3 border-t border-zinc-200 space-y-2">
                      <div className="font-semibold text-zinc-800">Switch Dining Table</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Change table for order ${detailOrder.orderNumber}`}
                          value={selectedTargetId}
                          disabled={transferBusyOrderId === detailOrder.id}
                          onChange={(e) =>
                            setTransferTargets((prev) => ({
                              ...prev,
                              [detailOrder.id]: e.target.value,
                            }))
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-zinc-300 bg-white text-xs font-medium text-zinc-800 focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                        >
                          {otherTables.map((t) => (
                            <option key={t.id} value={t.id}>
                              Table {t.tableNumber} · {t.section}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!selectedTargetId || transferBusyOrderId === detailOrder.id}
                          onClick={() => void handleChangeOrderTable(detailOrder, selectedTargetId)}
                          className="px-3 py-1.5 rounded-lg border border-[#C59B27]/70 bg-[#FDF9EC] hover:bg-[#F7EBC4] text-[#141518] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5 text-[#9A7415]" />
                          <span>
                            {transferBusyOrderId === detailOrder.id ? 'Updating...' : 'Change Table'}
                          </span>
                        </button>
                      </div>
                      {transferRequestedMap[detailOrder.id] && (
                        <div className="text-[11px] font-medium text-amber-800">
                          Transfer to Table {transferRequestedMap[detailOrder.id]} requested · Steward notified.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Meal Photo & Management Review */}
                  <div className="pt-3 border-t border-zinc-200 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-zinc-900">
                          Meal Photo for Management Review
                        </h4>
                        <p className="text-[11px] text-zinc-500">
                          {detailOrder.mealPhotoUrl
                            ? `Status: ${detailOrder.mealPhotoStatus || 'Pending Review'}${
                                detailOrder.mealPhotoReviewedBy &&
                                detailOrder.mealPhotoStatus !== 'Pending Review'
                                  ? ` · Reviewed by ${detailOrder.mealPhotoReviewedBy}`
                                  : ''
                              }`
                            : 'Share a photo from your device or camera linked to this order.'}
                        </p>
                      </div>
                      {detailOrder.status !== 'Cancelled' && (
                        <button
                          type="button"
                          onClick={() => {
                            const targetId = detailOrder.id;
                            setDetailOrderId(null);
                            setPhotoModalTarget(targetId);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#141518] hover:bg-zinc-800 text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>
                            {detailOrder.mealPhotoUrl ? 'Change Photo' : 'Upload / Take Photo'}
                          </span>
                        </button>
                      )}
                    </div>

                    {detailOrder.mealPhotoUrl && (
                      <div className="rounded-xl border border-zinc-200 overflow-hidden bg-zinc-50">
                        <img
                          src={detailOrder.mealPhotoUrl}
                          alt={`Meal photo for ${detailOrder.orderNumber}`}
                          className="w-full max-h-52 object-cover bg-zinc-900"
                        />
                        {(detailOrder.mealPhotoCaption || Boolean(detailOrder.mealPhotoUploadedAt)) && (
                          <div className="px-3.5 py-2 text-[11px] text-zinc-600 border-t border-zinc-200 space-y-0.5">
                            {detailOrder.mealPhotoCaption && (
                              <div className="font-medium text-zinc-800">
                                “{detailOrder.mealPhotoCaption}”
                              </div>
                            )}
                            {detailOrder.mealPhotoUploadedAt ? (
                              <div className="font-mono-tabular text-zinc-400">
                                Uploaded {formatDateTime(detailOrder.mealPhotoUploadedAt)}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Cost Breakdown */}
                  <div className="pt-3 border-t border-zinc-200 space-y-1.5">
                    <div className="flex items-center justify-between text-zinc-600">
                      <span>Items Subtotal</span>
                      <span className="font-mono-tabular">{formatINR(totals.subtotal)}</span>
                    </div>
                    {totals.discount > 0 && (
                      <div className="flex items-center justify-between text-emerald-700">
                        <span>Discount Applied</span>
                        <span className="font-mono-tabular">-{formatINR(totals.discount)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-zinc-600">
                      <span>
                        {totals.bill
                          ? totals.bill.taxBreakdown && totals.bill.taxBreakdown.length > 0
                            ? totals.bill.taxBreakdown
                                .map((t) => `${t.name} (${t.rate}%)`)
                                .join(' + ')
                            : 'Taxes'
                          : 'Estimated Taxes'}
                      </span>
                      <span className="font-mono-tabular">
                        {detailOrder.status === 'Cancelled' ? formatINR(0) : formatINR(totals.tax)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-zinc-200 flex items-center justify-between text-sm font-bold text-zinc-900">
                      <span>
                        {totals.bill
                          ? 'Total Cost'
                          : detailOrder.status === 'Cancelled'
                          ? 'Total Cost'
                          : 'Estimated Total Cost'}
                      </span>
                      <span className="font-mono-tabular">{formatINR(totals.total)}</span>
                    </div>
                  </div>
                </div>

                <div className="px-5 py-4 bg-zinc-50 border-t border-zinc-200 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailOrderId(null)}
                    className="px-4 py-2 rounded-lg border border-zinc-300 bg-white text-xs font-semibold text-zinc-700 hover:text-zinc-900 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailOrderId(null);
                      handleReorderFromHistory(detailOrder);
                    }}
                    className="px-4 py-2 rounded-lg bg-[#141518] hover:bg-zinc-800 text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reorder Items</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      <MealPhotoUploadModal
        open={Boolean(photoModalTarget)}
        orders={customerOrders}
        initialOrderId={photoModalTarget === '__pick__' ? null : photoModalTarget}
        customerUid={customer.uid}
        customerName={customer.displayName}
        onClose={() => setPhotoModalTarget(null)}
        onUploaded={(ord) => {
          setPhotoModalTarget(null);
          showToast(`Meal photo linked to ${ord.orderNumber} for management review.`);
        }}
      />

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
