import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  createDocId,
  db,
  emailToInviteId,
  getProvisionerAuth,
  handleFirestoreError,
  OperationType,
  sanitizeId,
} from '../firebase';
import {
  DEFAULT_HOTEL_SETTINGS,
  SEED_CATEGORIES,
  SEED_INVENTORY,
  SEED_MENU_ITEMS,
  SEED_SUPPLIERS,
  SEED_TABLES,
} from '../data/seedCatalog';
import {
  ROLE_ALLOWED_MODULES,
  type AppNotification,
  type Bill,
  type CustomerProfile,
  type Feedback,
  type HotelSettings,
  type InventoryItem,
  type MenuCategory,
  type MenuItem,
  type Order,
  type OrderItem,
  type OrderPriority,
  type OrderSource,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type RestaurantTable,
  type RoomFolio,
  type ServiceRequest,
  type SplitPayment,
  type StaffInvite,
  type StaffProfile,
  type StaffRole,
  type Supplier,
  type TableStatus,
  type TaxBreakdownItem,
  type WorkspaceModule,
} from '../types';
import { calculateSubtotal } from '../utils/format';

// ------------------------------------------------------------------
// Immutable Admin Audit Logs
// ------------------------------------------------------------------
export async function recordAuditLog(params: {
  action: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  targetType: string;
  targetId?: string;
  summary: string;
}): Promise<void> {
  const id = createDocId('audit');
  try {
    await setDoc(doc(db, 'audit_logs', id), {
      id,
      action: params.action.slice(0, 80),
      actorUid: params.actorUid.slice(0, 128),
      actorName: params.actorName.slice(0, 80),
      actorRole: params.actorRole.slice(0, 32),
      targetType: params.targetType.slice(0, 40),
      ...(params.targetId ? { targetId: params.targetId.slice(0, 128) } : {}),
      summary: params.summary.slice(0, 300),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn('Audit log skipped:', error);
  }
}

// ------------------------------------------------------------------
// Staff Profile Resolution & Management
// ------------------------------------------------------------------
export async function resolveOrProvisionStaffProfile(user: {
  uid: string;
  email: string | null;
  displayName: string | null;
}): Promise<StaffProfile | null> {
  const email = (user.email || '').trim().toLowerCase();
  const profilePath = `staff_profiles/${user.uid}`;
  try {
    const existingSnap = await getDoc(doc(db, 'staff_profiles', user.uid));
    if (existingSnap.exists()) {
      const data = existingSnap.data() as StaffProfile;
      if (!data.active) return null;
      try {
        await updateDoc(doc(db, 'staff_profiles', user.uid), {
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch {
        // non-blocking lastLoginAt touch
      }
      return data;
    }

    if (email === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
      const adminProfile = {
        uid: user.uid,
        email,
        displayName: (user.displayName || 'Super Admin').slice(0, 80),
        role: 'super_admin' as StaffRole,
        active: true,
        shift: 'All Shifts',
        permissions: ROLE_ALLOWED_MODULES.super_admin,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'staff_profiles', user.uid), adminProfile);
      return { ...adminProfile, createdAt: new Date(), updatedAt: new Date() };
    }

    const inviteId = emailToInviteId(email);
    const inviteSnap = await getDoc(doc(db, 'staff_invites', inviteId));
    if (!inviteSnap.exists()) {
      return null;
    }
    const invite = inviteSnap.data() as StaffInvite;
    if (!invite.active || invite.email.toLowerCase() !== email) {
      return null;
    }

    const newProfile: Record<string, unknown> = {
      uid: user.uid,
      email,
      displayName: (invite.displayName || user.displayName || email.split('@')[0]).slice(0, 80),
      role: invite.role,
      active: true,
      phone: invite.phone || '',
      shift: invite.shift || 'Day Shift',
      inviteId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (invite.permissions && invite.permissions.length > 0) {
      newProfile.permissions = invite.permissions;
    }
    await setDoc(doc(db, 'staff_profiles', user.uid), newProfile);
    return { ...(newProfile as unknown as StaffProfile), createdAt: new Date(), updatedAt: new Date() };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, profilePath);
  }
}

export async function provisionStaffAuthCredentials(params: {
  email: string;
  password: string;
  displayName: string;
}): Promise<{ ok: boolean; message: string }> {
  const provAuth = getProvisionerAuth();
  try {
    const cred = await createUserWithEmailAndPassword(
      provAuth,
      params.email.trim().toLowerCase(),
      params.password
    );
    await updateProfile(cred.user, { displayName: params.displayName.trim().slice(0, 80) });
    try {
      await sendEmailVerification(cred.user);
    } catch {
      // ignore if verification email throttled
    }
    await signOut(provAuth);
    return {
      ok: true,
      message: `Login credentials created for ${params.email} and verification email dispatched.`,
    };
  } catch (err) {
    try {
      await signOut(provAuth);
    } catch {
      // ignore
    }
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/email-already-in-use') {
      return {
        ok: true,
        message: `${params.email} already exists in Firebase Auth. Role & portal authorization synced.`,
      };
    }
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
      return {
        ok: false,
        message:
          'Email/Password sign-in is disabled in Firebase Console. Staff role is still authorized for Google Sign-In.',
      };
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Unable to create auth credentials.',
    };
  }
}

export async function sendAccountPasswordReset(
  email: string,
  actor?: StaffProfile
): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
  if (actor) {
    await recordAuditLog({
      action: 'STAFF_PASSWORD_RESET',
      actorUid: actor.uid,
      actorName: actor.displayName,
      actorRole: actor.role,
      targetType: 'staff',
      summary: `Triggered secure Firebase password reset email for ${email.trim().toLowerCase()}`,
    });
  }
}

export async function upsertStaffInvite(params: {
  email: string;
  displayName: string;
  role: StaffRole;
  active: boolean;
  phone?: string;
  shift?: string;
  permissions?: WorkspaceModule[];
  createdBy: string;
  actor?: StaffProfile;
}): Promise<void> {
  const normalizedEmail = params.email.trim().toLowerCase().slice(0, 120);
  const inviteId = emailToInviteId(normalizedEmail);
  const path = `staff_invites/${inviteId}`;
  const resolvedPermissions =
    params.permissions && params.permissions.length > 0
      ? params.permissions
      : ROLE_ALLOWED_MODULES[params.role];

  try {
    const existing = await getDoc(doc(db, 'staff_invites', inviteId));
    if (existing.exists()) {
      await updateDoc(doc(db, 'staff_invites', inviteId), {
        displayName: params.displayName.trim().slice(0, 80),
        role: params.role,
        active: params.active,
        phone: (params.phone || '').trim().slice(0, 20),
        shift: (params.shift || 'Day Shift').trim().slice(0, 40),
        permissions: resolvedPermissions,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'staff_invites', inviteId), {
        inviteId,
        email: normalizedEmail,
        displayName: params.displayName.trim().slice(0, 80),
        role: params.role,
        active: params.active,
        phone: (params.phone || '').trim().slice(0, 20),
        shift: (params.shift || 'Day Shift').trim().slice(0, 40),
        permissions: resolvedPermissions,
        createdBy: params.createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const q = query(collection(db, 'staff_profiles'), where('email', '==', normalizedEmail));
    const matched = await getDocs(q);
    for (const docSnap of matched.docs) {
      await updateDoc(doc(db, 'staff_profiles', docSnap.id), {
        displayName: params.displayName.trim().slice(0, 80),
        role: params.role,
        active: params.active,
        phone: (params.phone || '').trim().slice(0, 20),
        shift: (params.shift || 'Day Shift').trim().slice(0, 40),
        permissions: resolvedPermissions,
        updatedAt: serverTimestamp(),
      });
    }

    if (params.actor) {
      await recordAuditLog({
        action: existing.exists() ? 'STAFF_UPDATED' : 'STAFF_PROVISIONED',
        actorUid: params.actor.uid,
        actorName: params.actor.displayName,
        actorRole: params.actor.role,
        targetType: 'staff',
        targetId: inviteId,
        summary: `${existing.exists() ? 'Updated' : 'Authorized'} ${params.displayName} (${normalizedEmail}) as ${params.role}`,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateStaffMemberRoleStatus(
  uid: string,
  email: string,
  updates: {
    role?: StaffRole;
    active?: boolean;
    shift?: string;
    phone?: string;
    displayName?: string;
    permissions?: WorkspaceModule[];
  },
  actor?: StaffProfile
): Promise<void> {
  try {
    const batch = writeBatch(db);
    const profileRef = doc(db, 'staff_profiles', uid);
    const cleanUpdates: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.role) {
      cleanUpdates.role = updates.role;
      if (!updates.permissions) {
        cleanUpdates.permissions = ROLE_ALLOWED_MODULES[updates.role];
      }
    }
    if (updates.permissions) cleanUpdates.permissions = updates.permissions;
    if (typeof updates.active === 'boolean') cleanUpdates.active = updates.active;
    if (updates.shift !== undefined) cleanUpdates.shift = updates.shift.slice(0, 40);
    if (updates.phone !== undefined) cleanUpdates.phone = updates.phone.slice(0, 20);
    if (updates.displayName !== undefined) cleanUpdates.displayName = updates.displayName.slice(0, 80);
    batch.update(profileRef, cleanUpdates);

    const inviteId = emailToInviteId(email);
    const inviteSnap = await getDoc(doc(db, 'staff_invites', inviteId));
    if (inviteSnap.exists()) {
      batch.update(doc(db, 'staff_invites', inviteId), cleanUpdates);
    }
    await batch.commit();

    if (actor) {
      await recordAuditLog({
        action: updates.role
          ? 'STAFF_ROLE_CHANGED'
          : updates.permissions
          ? 'STAFF_PERMISSIONS_UPDATED'
          : typeof updates.active === 'boolean'
          ? updates.active
            ? 'STAFF_ACTIVATED'
            : 'STAFF_DEACTIVATED'
          : 'STAFF_PROFILE_UPDATED',
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        targetType: 'staff',
        targetId: uid,
        summary: `Updated staff member ${email}: ${Object.keys(updates).join(', ')}`,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `staff_profiles/${uid}`);
  }
}

export async function updateOwnStaffProfile(
  uid: string,
  updates: { displayName: string; phone?: string }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'staff_profiles', uid), {
      displayName: updates.displayName.trim().slice(0, 80),
      phone: (updates.phone || '').trim().slice(0, 20),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `staff_profiles/${uid}`);
  }
}

export async function deleteStaffInvite(inviteId: string, actor?: StaffProfile): Promise<void> {
  try {
    await deleteDoc(doc(db, 'staff_invites', inviteId));
    if (actor) {
      await recordAuditLog({
        action: 'STAFF_INVITE_REMOVED',
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        targetType: 'staff_invite',
        targetId: inviteId,
        summary: `Removed staff invitation authorization ${inviteId}`,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `staff_invites/${inviteId}`);
  }
}

// ------------------------------------------------------------------
// Customer Profile Resolution & Management
// ------------------------------------------------------------------
export async function resolveOrCreateCustomerProfile(user: {
  uid: string;
  email: string | null;
  displayName: string | null;
  phoneNumber?: string | null;
}): Promise<CustomerProfile | null> {
  const path = `customer_profiles/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'customer_profiles', user.uid));
    if (snap.exists()) {
      const profile = snap.data() as CustomerProfile;
      return profile.active ? profile : null;
    }

    const created: Record<string, unknown> = {
      uid: user.uid,
      email: (user.email || '').trim().toLowerCase().slice(0, 120),
      displayName: (
        user.displayName ||
        (user.email ? user.email.split('@')[0] : '') ||
        user.phoneNumber ||
        'Hotel Guest'
      )
        .trim()
        .slice(0, 80),
      phone: (user.phoneNumber || '').slice(0, 20),
      dietaryPreference: 'all',
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'customer_profiles', user.uid), created);
    return { ...(created as unknown as CustomerProfile), createdAt: new Date(), updatedAt: new Date() };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateCustomerProfile(
  uid: string,
  updates: {
    displayName: string;
    phone?: string;
    preferredTable?: string;
    dietaryPreference?: 'all' | 'veg' | 'nonveg';
  }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'customer_profiles', uid), {
      displayName: updates.displayName.trim().slice(0, 80),
      phone: (updates.phone || '').trim().slice(0, 20),
      preferredTable: (updates.preferredTable || '').trim().slice(0, 20),
      dietaryPreference: updates.dietaryPreference || 'all',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `customer_profiles/${uid}`);
  }
}

export async function setCustomerActiveStatus(
  uid: string,
  active: boolean,
  actor?: StaffProfile
): Promise<void> {
  try {
    await updateDoc(doc(db, 'customer_profiles', uid), {
      active,
      updatedAt: serverTimestamp(),
    });
    if (actor) {
      await recordAuditLog({
        action: active ? 'CUSTOMER_ACTIVATED' : 'CUSTOMER_DEACTIVATED',
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        targetType: 'customer',
        targetId: uid,
        summary: `${active ? 'Activated' : 'Deactivated'} customer account ${uid}`,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `customer_profiles/${uid}`);
  }
}

// ------------------------------------------------------------------
// Seed Initial Hotel Rudraksh Inn Catalog
// ------------------------------------------------------------------
export async function seedInitialHotelCatalog(): Promise<void> {
  try {
    const batch = writeBatch(db);

    batch.set(doc(db, 'hotel_settings', 'main'), {
      ...DEFAULT_HOTEL_SETTINGS,
      updatedAt: serverTimestamp(),
    });

    for (const table of SEED_TABLES) {
      batch.set(doc(db, 'tables', table.id), {
        ...table,
        updatedAt: serverTimestamp(),
      });
    }

    for (const cat of SEED_CATEGORIES) {
      batch.set(doc(db, 'menu_categories', cat.id), {
        ...cat,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const sup of SEED_SUPPLIERS) {
      batch.set(doc(db, 'suppliers', sup.id), {
        ...sup,
        createdAt: serverTimestamp(),
      });
    }

    for (const inv of SEED_INVENTORY) {
      batch.set(doc(db, 'inventory', inv.id), {
        ...inv,
        updatedAt: serverTimestamp(),
      });
    }

    for (const item of SEED_MENU_ITEMS) {
      batch.set(doc(db, 'menu_items', item.id), {
        ...item,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seed_initial_catalog');
  }
}

// ------------------------------------------------------------------
// Orders (QR Guest, Waiter, POS, Room Service)
// ------------------------------------------------------------------
function generateOrderNumber(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${num}`;
}

export async function placeQrOrder(params: {
  table: RestaurantTable;
  items: OrderItem[];
  guestName?: string;
  guestSessionId?: string;
  customerId?: string;
  specialInstructions?: string;
}): Promise<string> {
  const orderId = createDocId('ord');
  const orderNumber = generateOrderNumber();
  const subtotal = calculateSubtotal(params.items);
  const notifId = createDocId('notif');

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'orders', orderId), {
      id: orderId,
      orderNumber,
      source: 'qr' as OrderSource,
      tableId: params.table.id,
      tableNumber: params.table.tableNumber,
      guestName: (params.guestName || 'Table Guest').trim().slice(0, 80),
      guestSessionId: (params.guestSessionId || 'qr_guest').slice(0, 128),
      ...(params.customerId ? { customerId: params.customerId.slice(0, 128) } : {}),
      status: 'New' as OrderStatus,
      priority: 'Normal' as OrderPriority,
      items: params.items.slice(0, 50),
      specialInstructions: (params.specialInstructions || '').trim().slice(0, 300),
      subtotal,
      billed: false,
      inventoryDeducted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'tables', params.table.id), {
      status: 'Ordered' as TableStatus,
      currentOrderId: orderId,
      orderTime: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      type: 'qr_order',
      title: `New QR Order · Table ${params.table.tableNumber}`,
      message: `${orderNumber} (${params.items.reduce((s, i) => s + i.qty, 0)} items) placed via table QR menu.`,
      targetRoles: ['super_admin', 'manager', 'waiter', 'kitchen'],
      relatedId: orderId,
      read: false,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return orderId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `orders/${orderId}`);
  }
}

export async function placeStaffOrder(params: {
  source: OrderSource;
  items: OrderItem[];
  table?: RestaurantTable;
  roomNumber?: string;
  guestName?: string;
  waiterId: string;
  waiterName: string;
  priority?: OrderPriority;
  specialInstructions?: string;
  folioId?: string;
}): Promise<string> {
  const orderId = createDocId('ord');
  const orderNumber = generateOrderNumber();
  const subtotal = calculateSubtotal(params.items);
  const notifId = createDocId('notif');

  try {
    const batch = writeBatch(db);
    const orderPayload: Record<string, unknown> = {
      id: orderId,
      orderNumber,
      source: params.source,
      guestName: (params.guestName || 'Guest').trim().slice(0, 80),
      waiterId: params.waiterId,
      waiterName: params.waiterName.slice(0, 80),
      status: 'New' as OrderStatus,
      priority: params.priority || 'Normal',
      items: params.items.slice(0, 50),
      specialInstructions: (params.specialInstructions || '').trim().slice(0, 300),
      subtotal,
      billed: false,
      inventoryDeducted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (params.table) {
      orderPayload.tableId = params.table.id;
      orderPayload.tableNumber = params.table.tableNumber;
      batch.update(doc(db, 'tables', params.table.id), {
        status: 'Ordered' as TableStatus,
        currentOrderId: orderId,
        currentBillTotal: subtotal,
        assignedWaiterId: params.waiterId,
        assignedWaiterName: params.waiterName.slice(0, 80),
        orderTime: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (params.roomNumber) {
      orderPayload.roomNumber = params.roomNumber.trim().slice(0, 20);
    }

    batch.set(doc(db, 'orders', orderId), orderPayload);

    if (params.folioId) {
      const folioSnap = await getDoc(doc(db, 'room_folios', params.folioId));
      if (folioSnap.exists()) {
        const folio = folioSnap.data() as RoomFolio;
        batch.update(doc(db, 'room_folios', params.folioId), {
          orderIds: [...(folio.orderIds || []), orderId].slice(0, 50),
          totalAmount: Math.round(((folio.totalAmount || 0) + subtotal) * 100) / 100,
          updatedAt: serverTimestamp(),
        });
      }
    }

    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      type: 'waiter_order',
      title: params.table
        ? `New Order · Table ${params.table.tableNumber}`
        : params.roomNumber
        ? `Room Service · Room ${params.roomNumber}`
        : `New POS Order · ${orderNumber}`,
      message: `${orderNumber} created by ${params.waiterName} (${params.items.length} dishes).`,
      targetRoles: ['super_admin', 'manager', 'kitchen', 'cashier'],
      relatedId: orderId,
      read: false,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return orderId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `orders/${orderId}`);
  }
}

export async function addItemsToExistingOrder(
  order: Order,
  newItems: OrderItem[],
  additionalInstructions?: string
): Promise<void> {
  const merged = [...order.items];
  for (const incoming of newItems) {
    const idx = merged.findIndex(
      (i) => i.itemId === incoming.itemId && (i.notes || '') === (incoming.notes || '')
    );
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], qty: merged[idx].qty + incoming.qty };
    } else {
      merged.push(incoming);
    }
  }
  const finalItems = merged.slice(0, 50);
  const subtotal = calculateSubtotal(finalItems);
  const combinedNotes = [order.specialInstructions, additionalInstructions]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 300);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', order.id), {
      items: finalItems,
      subtotal,
      specialInstructions: combinedNotes,
      status: order.status === 'Served' ? 'Accepted' : order.status,
      updatedAt: serverTimestamp(),
    });

    if (order.tableId) {
      batch.update(doc(db, 'tables', order.tableId), {
        currentBillTotal: subtotal,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
  }
}

export async function updateOrderStatusAndInventory(params: {
  order: Order;
  newStatus: OrderStatus;
  menuItems: MenuItem[];
  inventory: InventoryItem[];
  performedBy: string;
}): Promise<void> {
  const { order, newStatus, menuItems, inventory, performedBy } = params;
  try {
    const batch = writeBatch(db);
    const shouldDeduct = newStatus === 'Completed' && !order.inventoryDeducted;

    batch.update(doc(db, 'orders', order.id), {
      status: newStatus,
      ...(shouldDeduct ? { inventoryDeducted: true } : {}),
      updatedAt: serverTimestamp(),
    });

    if (order.tableId) {
      const tableStatusMap: Partial<Record<OrderStatus, TableStatus>> = {
        New: 'Ordered',
        Accepted: 'Ordered',
        Preparing: 'Preparing',
        Ready: 'Ready',
        Served: 'Served',
      };
      const mappedTableStatus = tableStatusMap[newStatus];
      if (mappedTableStatus) {
        batch.update(doc(db, 'tables', order.tableId), {
          status: mappedTableStatus,
          updatedAt: serverTimestamp(),
        });
      } else if (newStatus === 'Cancelled' && !order.billed) {
        batch.update(doc(db, 'tables', order.tableId), {
          status: 'Available' as TableStatus,
          currentOrderId: '',
          currentBillTotal: 0,
          orderTime: null,
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (newStatus === 'Ready') {
      const notifId = createDocId('notif');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        type: 'order_ready',
        title: order.tableNumber
          ? `Order Ready · Table ${order.tableNumber}`
          : order.roomNumber
          ? `Order Ready · Room ${order.roomNumber}`
          : `Order Ready · ${order.orderNumber}`,
        message: `${order.orderNumber} is ready at the kitchen pass for pickup.`,
        targetRoles: ['waiter', 'manager', 'super_admin'],
        relatedId: order.id,
        read: false,
        createdAt: serverTimestamp(),
      });
    }

    if (newStatus === 'Cancelled') {
      const notifId = createDocId('notif');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        type: 'cancelled',
        title: `Order Cancelled · ${order.orderNumber}`,
        message: `${order.orderNumber} was marked cancelled by ${performedBy}.`,
        targetRoles: ['super_admin', 'manager', 'cashier'],
        relatedId: order.id,
        read: false,
        createdAt: serverTimestamp(),
      });
    }

    if (shouldDeduct) {
      const usageMap = new Map<string, number>();
      for (const line of order.items) {
        const dish = menuItems.find((m) => m.id === line.itemId);
        if (dish?.recipe) {
          for (const ing of dish.recipe) {
            const totalUsed = (ing.quantityPerServing || 0) * line.qty;
            if (totalUsed > 0) {
              usageMap.set(
                ing.inventoryItemId,
                (usageMap.get(ing.inventoryItemId) || 0) + totalUsed
              );
            }
          }
        }
      }

      for (const [invId, usedQty] of usageMap.entries()) {
        const invItem = inventory.find((i) => i.id === invId);
        if (!invItem) continue;
        const nextQty = Math.max(0, Math.round((invItem.quantity - usedQty) * 1000) / 1000);
        batch.update(doc(db, 'inventory', invId), {
          quantity: nextQty,
          updatedAt: serverTimestamp(),
        });

        const logId = createDocId('invlog');
        batch.set(doc(db, 'inventory_logs', logId), {
          id: logId,
          itemId: invId,
          itemName: invItem.name,
          type: 'consumption',
          quantityDelta: -Math.round(usedQty * 1000) / 1000,
          unit: invItem.unit,
          note: `Auto-deducted for ${order.orderNumber}`,
          performedBy: performedBy.slice(0, 80),
          createdAt: serverTimestamp(),
        });

        if (nextQty <= invItem.minThreshold) {
          const lowNotifId = createDocId('notif');
          batch.set(doc(db, 'notifications', lowNotifId), {
            id: lowNotifId,
            type: 'low_stock',
            title: `Low Stock · ${invItem.name}`,
            message: `${invItem.name} dropped to ${nextQty} ${invItem.unit} (threshold: ${invItem.minThreshold} ${invItem.unit}).`,
            targetRoles: ['super_admin', 'manager', 'kitchen'],
            relatedId: invId,
            read: false,
            createdAt: serverTimestamp(),
          });
        }
      }
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
  }
}

export async function toggleOrderPriority(order: Order): Promise<void> {
  const next: OrderPriority = order.priority === 'Urgent' ? 'Normal' : 'Urgent';
  try {
    await updateDoc(doc(db, 'orders', order.id), {
      priority: next,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
  }
}

export async function transferTableOrder(
  sourceTable: RestaurantTable,
  targetTable: RestaurantTable,
  order: Order
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', order.id), {
      tableId: targetTable.id,
      tableNumber: targetTable.tableNumber,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'tables', targetTable.id), {
      status: sourceTable.status,
      currentOrderId: order.id,
      currentBillTotal: order.subtotal,
      assignedWaiterId: sourceTable.assignedWaiterId || '',
      assignedWaiterName: sourceTable.assignedWaiterName || '',
      orderTime: sourceTable.orderTime || serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'tables', sourceTable.id), {
      status: 'Available' as TableStatus,
      currentOrderId: '',
      currentBillTotal: 0,
      orderTime: null,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `tables/${sourceTable.id}`);
  }
}

export async function mergeTableOrders(
  primaryTable: RestaurantTable,
  primaryOrder: Order,
  secondaryTable: RestaurantTable,
  secondaryOrder: Order
): Promise<void> {
  const combined = [...primaryOrder.items];
  for (const item of secondaryOrder.items) {
    const idx = combined.findIndex((i) => i.itemId === item.itemId);
    if (idx >= 0) {
      combined[idx] = { ...combined[idx], qty: combined[idx].qty + item.qty };
    } else {
      combined.push(item);
    }
  }
  const finalItems = combined.slice(0, 50);
  const newSubtotal = calculateSubtotal(finalItems);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', primaryOrder.id), {
      items: finalItems,
      subtotal: newSubtotal,
      specialInstructions: [
        primaryOrder.specialInstructions,
        `Merged from Table ${secondaryTable.tableNumber}: ${secondaryOrder.specialInstructions || ''}`,
      ]
        .filter(Boolean)
        .join(' | ')
        .slice(0, 300),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'orders', secondaryOrder.id), {
      status: 'Completed' as OrderStatus,
      billed: true,
      billId: primaryOrder.id,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'tables', primaryTable.id), {
      currentBillTotal: newSubtotal,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'tables', secondaryTable.id), {
      status: 'Available' as TableStatus,
      currentOrderId: '',
      currentBillTotal: 0,
      orderTime: null,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${primaryOrder.id}`);
  }
}

// ------------------------------------------------------------------
// POS Billing & Invoices
// ------------------------------------------------------------------
export async function createAndSettleBill(params: {
  invoicePrefix: string;
  order?: Order;
  tableId?: string;
  tableNumber?: string;
  roomNumber?: string;
  guestName?: string;
  source?: OrderSource;
  items: OrderItem[];
  subtotal: number;
  discountType: 'none' | 'flat' | 'percent';
  discountValue: number;
  discountAmount: number;
  taxBreakdown: TaxBreakdownItem[];
  taxAmount: number;
  totalAmount: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  splitPayments?: SplitPayment[];
  cashierId: string;
  cashierName: string;
  menuItems?: MenuItem[];
  inventory?: InventoryItem[];
}): Promise<Bill> {
  const billId = createDocId('bill');
  const seq = Math.floor(10000 + Math.random() * 90000);
  const invoiceNumber = `${params.invoicePrefix || 'RUD'}-${seq}`;

  try {
    const batch = writeBatch(db);
    const billData: Record<string, unknown> = {
      id: billId,
      invoiceNumber,
      items: params.items.slice(0, 50),
      subtotal: params.subtotal,
      discountType: params.discountType,
      discountValue: params.discountValue,
      discountAmount: params.discountAmount,
      taxBreakdown: params.taxBreakdown,
      taxAmount: params.taxAmount,
      totalAmount: params.totalAmount,
      paymentStatus: params.paymentStatus,
      paymentMethod: params.paymentMethod,
      cashierId: params.cashierId,
      cashierName: params.cashierName.slice(0, 80),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (params.order) {
      billData.orderId = params.order.id;
      billData.orderNumber = params.order.orderNumber;
      billData.source = params.order.source;
    } else if (params.source) {
      billData.source = params.source;
    }

    if (params.tableId) billData.tableId = params.tableId;
    if (params.tableNumber) billData.tableNumber = params.tableNumber;
    if (params.roomNumber) billData.roomNumber = params.roomNumber;
    if (params.guestName) billData.guestName = params.guestName.slice(0, 80);
    if (params.splitPayments && params.splitPayments.length > 0) {
      billData.splitPayments = params.splitPayments;
    }

    batch.set(doc(db, 'bills', billId), billData);

    if (params.order) {
      batch.update(doc(db, 'orders', params.order.id), {
        billed: true,
        billId,
        status: params.paymentStatus === 'Paid' ? ('Completed' as OrderStatus) : params.order.status,
        updatedAt: serverTimestamp(),
      });
    }

    if (params.tableId && params.paymentStatus === 'Paid') {
      batch.update(doc(db, 'tables', params.tableId), {
        status: 'Available' as TableStatus,
        currentOrderId: '',
        currentBillTotal: 0,
        orderTime: null,
        updatedAt: serverTimestamp(),
      });
    } else if (params.tableId && params.paymentStatus === 'Unpaid') {
      batch.update(doc(db, 'tables', params.tableId), {
        status: 'Billing' as TableStatus,
        currentBillTotal: params.totalAmount,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return {
      ...(billData as unknown as Bill),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `bills/${billId}`);
  }
}

export async function settleExistingBill(params: {
  bill: Bill;
  paymentMethod: PaymentMethod;
  splitPayments?: SplitPayment[];
}): Promise<void> {
  try {
    const batch = writeBatch(db);
    const updates: Record<string, unknown> = {
      paymentStatus: 'Paid' as PaymentStatus,
      paymentMethod: params.paymentMethod,
      updatedAt: serverTimestamp(),
    };
    if (params.splitPayments && params.splitPayments.length > 0) {
      updates.splitPayments = params.splitPayments;
    }
    batch.update(doc(db, 'bills', params.bill.id), updates);

    if (params.bill.orderId) {
      batch.update(doc(db, 'orders', params.bill.orderId), {
        status: 'Completed' as OrderStatus,
        billed: true,
        updatedAt: serverTimestamp(),
      });
    }
    if (params.bill.tableId) {
      batch.update(doc(db, 'tables', params.bill.tableId), {
        status: 'Available' as TableStatus,
        currentOrderId: '',
        currentBillTotal: 0,
        orderTime: null,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `bills/${params.bill.id}`);
  }
}

export async function cancelBillAuthorized(bill: Bill, reason: string, cancelledBy: string): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'bills', bill.id), {
      paymentStatus: 'Cancelled' as PaymentStatus,
      cancelReason: reason.trim().slice(0, 250),
      updatedAt: serverTimestamp(),
    });
    const notifId = createDocId('notif');
    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      type: 'cancelled',
      title: `Bill Cancelled · ${bill.invoiceNumber}`,
      message: `${bill.invoiceNumber} cancelled by ${cancelledBy}: ${reason.slice(0, 120)}`,
      targetRoles: ['super_admin', 'manager'],
      relatedId: bill.id,
      read: false,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `bills/${bill.id}`);
  }
}

// ------------------------------------------------------------------
// Room Service & Guest Folios
// ------------------------------------------------------------------
export async function createRoomFolio(params: {
  roomNumber: string;
  guestName: string;
  guestPhone?: string;
  checkInRef?: string;
}): Promise<string> {
  const id = createDocId('folio');
  try {
    await setDoc(doc(db, 'room_folios', id), {
      id,
      roomNumber: params.roomNumber.trim().slice(0, 20),
      guestName: params.guestName.trim().slice(0, 80),
      guestPhone: (params.guestPhone || '').trim().slice(0, 20),
      checkInRef: (params.checkInRef || '').trim().slice(0, 40),
      status: 'Active',
      orderIds: [],
      totalAmount: 0,
      paidAmount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `room_folios/${id}`);
  }
}

export async function settleRoomFolio(folio: RoomFolio, paidAmount: number): Promise<void> {
  try {
    await updateDoc(doc(db, 'room_folios', folio.id), {
      status: 'Settled',
      paidAmount,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `room_folios/${folio.id}`);
  }
}

// ------------------------------------------------------------------
// Tables Management
// ------------------------------------------------------------------
export async function saveTable(
  table: Omit<RestaurantTable, 'updatedAt'> & { isNew?: boolean }
): Promise<void> {
  const id = table.isNew ? sanitizeId(table.tableNumber || createDocId('tbl')) : table.id;
  try {
    const payload = {
      id,
      tableNumber: table.tableNumber.trim().slice(0, 20),
      name: table.name.trim().slice(0, 50),
      section: table.section.trim().slice(0, 50),
      capacity: Math.max(1, Math.min(30, Number(table.capacity) || 4)),
      status: table.status,
      assignedWaiterId: table.assignedWaiterId || '',
      assignedWaiterName: table.assignedWaiterName || '',
      updatedAt: serverTimestamp(),
    };
    if (table.isNew) {
      await setDoc(doc(db, 'tables', id), payload);
    } else {
      await updateDoc(doc(db, 'tables', id), payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `tables/${id}`);
  }
}

export async function updateTableStatus(
  tableId: string,
  status: TableStatus,
  extra?: { assignedWaiterId?: string; assignedWaiterName?: string }
): Promise<void> {
  try {
    const updates: Record<string, unknown> = {
      status,
      updatedAt: serverTimestamp(),
    };
    if (status === 'Available') {
      updates.currentOrderId = '';
      updates.currentBillTotal = 0;
      updates.orderTime = null;
    }
    if (extra?.assignedWaiterId !== undefined) updates.assignedWaiterId = extra.assignedWaiterId;
    if (extra?.assignedWaiterName !== undefined) updates.assignedWaiterName = extra.assignedWaiterName;
    await updateDoc(doc(db, 'tables', tableId), updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `tables/${tableId}`);
  }
}

export async function deleteTable(tableId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'tables', tableId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `tables/${tableId}`);
  }
}

// ------------------------------------------------------------------
// Menu Categories & Dishes
// ------------------------------------------------------------------
export async function saveMenuCategory(
  category: Omit<MenuCategory, 'createdAt' | 'updatedAt'> & { isNew?: boolean }
): Promise<void> {
  const id = category.isNew ? createDocId('cat') : category.id;
  try {
    if (category.isNew) {
      await setDoc(doc(db, 'menu_categories', id), {
        id,
        name: category.name.trim().slice(0, 60),
        sortOrder: Number(category.sortOrder) || 1,
        active: category.active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'menu_categories', id), {
        name: category.name.trim().slice(0, 60),
        sortOrder: Number(category.sortOrder) || 1,
        active: category.active,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `menu_categories/${id}`);
  }
}

export async function deleteMenuCategory(categoryId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'menu_categories', categoryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `menu_categories/${categoryId}`);
  }
}

export async function saveMenuItem(
  item: Omit<MenuItem, 'createdAt' | 'updatedAt'> & { isNew?: boolean }
): Promise<void> {
  const id = item.isNew ? createDocId('dish') : item.id;
  try {
    const payload = {
      id,
      name: item.name.trim().slice(0, 100),
      description: (item.description || '').trim().slice(0, 400),
      price: Math.max(0, Number(item.price) || 0),
      categoryId: item.categoryId,
      categoryName: item.categoryName.slice(0, 60),
      isVeg: Boolean(item.isVeg),
      isBestseller: Boolean(item.isBestseller),
      available: Boolean(item.available),
      imageUrl: (item.imageUrl || '').slice(0, 150000),
      sortOrder: Number(item.sortOrder) || 1,
      prepTimeMins: Number(item.prepTimeMins) || 15,
      recipe: (item.recipe || []).slice(0, 20),
      updatedAt: serverTimestamp(),
    };
    if (item.isNew) {
      await setDoc(doc(db, 'menu_items', id), {
        ...payload,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'menu_items', id), payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `menu_items/${id}`);
  }
}

export async function deleteMenuItem(itemId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'menu_items', itemId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `menu_items/${itemId}`);
  }
}

// ------------------------------------------------------------------
// Inventory & Suppliers
// ------------------------------------------------------------------
export async function saveInventoryItem(
  item: Omit<InventoryItem, 'updatedAt'> & { isNew?: boolean },
  performedBy: string
): Promise<void> {
  const id = item.isNew ? createDocId('inv') : item.id;
  try {
    const batch = writeBatch(db);
    const payload = {
      id,
      name: item.name.trim().slice(0, 80),
      category: item.category.trim().slice(0, 50),
      quantity: Math.max(0, Number(item.quantity) || 0),
      unit: item.unit.trim().slice(0, 20),
      minThreshold: Math.max(0, Number(item.minThreshold) || 0),
      unitCost: Math.max(0, Number(item.unitCost) || 0),
      supplierId: item.supplierId || '',
      supplierName: (item.supplierName || '').slice(0, 80),
      updatedAt: serverTimestamp(),
    };

    if (item.isNew) {
      batch.set(doc(db, 'inventory', id), payload);
      const logId = createDocId('invlog');
      batch.set(doc(db, 'inventory_logs', logId), {
        id: logId,
        itemId: id,
        itemName: payload.name,
        type: 'purchase',
        quantityDelta: payload.quantity,
        unit: payload.unit,
        note: 'Initial stock entry',
        performedBy: performedBy.slice(0, 80),
        createdAt: serverTimestamp(),
      });
    } else {
      batch.update(doc(db, 'inventory', id), payload);
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `inventory/${id}`);
  }
}

export async function recordStockMovement(params: {
  item: InventoryItem;
  type: 'purchase' | 'adjustment';
  delta: number;
  note: string;
  performedBy: string;
}): Promise<void> {
  const nextQty = Math.max(0, Math.round((params.item.quantity + params.delta) * 1000) / 1000);
  const logId = createDocId('invlog');
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'inventory', params.item.id), {
      quantity: nextQty,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'inventory_logs', logId), {
      id: logId,
      itemId: params.item.id,
      itemName: params.item.name,
      type: params.type,
      quantityDelta: params.delta,
      unit: params.item.unit,
      note: params.note.trim().slice(0, 200),
      performedBy: params.performedBy.slice(0, 80),
      createdAt: serverTimestamp(),
    });

    if (nextQty <= params.item.minThreshold) {
      const notifId = createDocId('notif');
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        type: 'low_stock',
        title: `Low Stock Alert · ${params.item.name}`,
        message: `Current stock ${nextQty} ${params.item.unit} is at/below threshold (${params.item.minThreshold} ${params.item.unit}).`,
        targetRoles: ['super_admin', 'manager', 'kitchen'],
        relatedId: params.item.id,
        read: false,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `inventory/${params.item.id}`);
  }
}

export async function saveSupplier(sup: Omit<Supplier, 'createdAt'> & { isNew?: boolean }): Promise<void> {
  const id = sup.isNew ? createDocId('sup') : sup.id;
  try {
    if (sup.isNew) {
      await setDoc(doc(db, 'suppliers', id), {
        id,
        name: sup.name.trim().slice(0, 80),
        contactPerson: (sup.contactPerson || '').trim().slice(0, 80),
        phone: (sup.phone || '').trim().slice(0, 25),
        category: (sup.category || '').trim().slice(0, 50),
        address: (sup.address || '').trim().slice(0, 200),
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'suppliers', id), {
        name: sup.name.trim().slice(0, 80),
        contactPerson: (sup.contactPerson || '').trim().slice(0, 80),
        phone: (sup.phone || '').trim().slice(0, 25),
        category: (sup.category || '').trim().slice(0, 50),
        address: (sup.address || '').trim().slice(0, 200),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `suppliers/${id}`);
  }
}

// ------------------------------------------------------------------
// Guest Service Requests, Feedback, Notifications, Settings
// ------------------------------------------------------------------
export async function createGuestServiceRequest(params: {
  table: RestaurantTable;
  type: 'call_waiter' | 'request_bill';
  note?: string;
}): Promise<void> {
  const reqId = createDocId('sreq');
  const notifId = createDocId('notif');
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'service_requests', reqId), {
      id: reqId,
      tableId: params.table.id,
      tableNumber: params.table.tableNumber,
      type: params.type,
      status: 'Pending',
      note: (params.note || '').trim().slice(0, 200),
      createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      type: params.type === 'call_waiter' ? 'waiter_call' : 'bill_request',
      title:
        params.type === 'call_waiter'
          ? `Waiter Call · Table ${params.table.tableNumber}`
          : `Bill Requested · Table ${params.table.tableNumber}`,
      message:
        params.type === 'call_waiter'
          ? `Guest at Table ${params.table.tableNumber} requested assistance.`
          : `Guest at Table ${params.table.tableNumber} requested the bill.`,
      targetRoles: ['waiter', 'cashier', 'manager', 'super_admin'],
      relatedId: params.table.id,
      read: false,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `service_requests/${reqId}`);
  }
}

export async function resolveServiceRequest(req: ServiceRequest): Promise<void> {
  try {
    await updateDoc(doc(db, 'service_requests', req.id), {
      status: 'Resolved',
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `service_requests/${req.id}`);
  }
}

export async function submitGuestFeedback(
  data: Omit<Feedback, 'id' | 'createdAt'>
): Promise<void> {
  const id = createDocId('fb');
  try {
    const payload: Record<string, unknown> = {
      id,
      foodRating: Math.min(5, Math.max(1, Number(data.foodRating) || 5)),
      serviceRating: Math.min(5, Math.max(1, Number(data.serviceRating) || 5)),
      ambianceRating: Math.min(5, Math.max(1, Number(data.ambianceRating) || 5)),
      overallRating: Math.min(5, Math.max(1, Number(data.overallRating) || 5)),
      googleConsent: Boolean(data.googleConsent),
      createdAt: serverTimestamp(),
    };
    if (data.orderId) payload.orderId = data.orderId;
    if (data.orderNumber) payload.orderNumber = data.orderNumber;
    if (data.tableNumber) payload.tableNumber = data.tableNumber;
    if (data.guestName) payload.guestName = data.guestName.slice(0, 80);
    if (data.comment) payload.comment = data.comment.slice(0, 500);
    await setDoc(doc(db, 'feedback', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `feedback/${id}`);
  }
}

export async function markNotificationRead(notifId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', notifId), { read: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notifId}`);
  }
}

export async function markAllNotificationsRead(notifications: AppNotification[]): Promise<void> {
  try {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    for (const n of unread.slice(0, 100)) {
      batch.update(doc(db, 'notifications', n.id), { read: true });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'notifications');
  }
}

export async function saveHotelSettings(settings: Omit<HotelSettings, 'updatedAt'>): Promise<void> {
  try {
    await setDoc(doc(db, 'hotel_settings', settings.id || 'main'), {
      ...settings,
      id: 'main',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'hotel_settings/main');
  }
}
