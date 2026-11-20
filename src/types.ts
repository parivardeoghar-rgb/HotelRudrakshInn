export type StaffRole = 'super_admin' | 'manager' | 'cashier' | 'waiter' | 'kitchen';

export type PortalKey = 'customer' | 'admin' | 'manager' | 'cashier' | 'waiter' | 'kitchen';

export type TableStatus =
  | 'Available'
  | 'Occupied'
  | 'Ordered'
  | 'Preparing'
  | 'Ready'
  | 'Served'
  | 'Billing';

export type OrderSource = 'qr' | 'waiter' | 'pos' | 'room_service';
export type OrderStatus = 'New' | 'Accepted' | 'Preparing' | 'Ready' | 'Served' | 'Completed' | 'Cancelled';
export type OrderPriority = 'Normal' | 'Urgent';

export type PaymentStatus = 'Paid' | 'Unpaid' | 'Cancelled' | 'Folio';
export type PaymentMethod = 'Cash' | 'UPI' | 'Card' | 'Split' | 'Room Folio' | 'Pending';

export type WorkspaceModule =
  | 'dashboard'
  | 'tables'
  | 'waiter'
  | 'kds'
  | 'pos'
  | 'room_service'
  | 'menu'
  | 'inventory'
  | 'reports'
  | 'feedback'
  | 'customers'
  | 'staff'
  | 'audit'
  | 'settings';

export interface StaffProfile {
  uid: string;
  email: string;
  displayName: string;
  role: StaffRole;
  active: boolean;
  phone?: string;
  shift?: string;
  inviteId?: string;
  permissions?: WorkspaceModule[];
  lastLoginAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StaffInvite {
  inviteId: string;
  email: string;
  displayName: string;
  role: StaffRole;
  active: boolean;
  phone?: string;
  shift?: string;
  permissions?: WorkspaceModule[];
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CustomerProfile {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  preferredTable?: string;
  dietaryPreference?: 'all' | 'veg';
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuditLog {
  id: string;
  action: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  targetType: string;
  targetId?: string;
  summary: string;
  createdAt?: unknown;
}

export interface RestaurantTable {
  id: string;
  tableNumber: string;
  name: string;
  section: string;
  capacity: number;
  status: TableStatus;
  currentOrderId?: string;
  currentBillTotal?: number;
  assignedWaiterId?: string;
  assignedWaiterName?: string;
  orderTime?: unknown;
  updatedAt?: unknown;
}

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RecipeIngredient {
  inventoryItemId: string;
  inventoryItemName: string;
  quantityPerServing: number;
  unit: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
  categoryName: string;
  isVeg: boolean;
  isBestseller: boolean;
  available: boolean;
  imageUrl?: string;
  sortOrder: number;
  prepTimeMins?: number;
  recipe?: RecipeIngredient[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface OrderItem {
  itemId: string;
  name: string;
  price: number;
  qty: number;
  isVeg: boolean;
  categoryName?: string;
  notes?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  source: OrderSource;
  tableId?: string;
  tableNumber?: string;
  roomNumber?: string;
  guestName?: string;
  guestSessionId?: string;
  customerId?: string;
  waiterId?: string;
  waiterName?: string;
  status: OrderStatus;
  priority: OrderPriority;
  items: OrderItem[];
  specialInstructions?: string;
  subtotal: number;
  billed: boolean;
  billId?: string;
  inventoryDeducted?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TaxComponent {
  name: string;
  rate: number;
  enabled: boolean;
}

export interface TaxBreakdownItem {
  name: string;
  rate: number;
  amount: number;
}

export interface SplitPayment {
  method: 'Cash' | 'UPI' | 'Card';
  amount: number;
  reference?: string;
}

export interface Bill {
  id: string;
  invoiceNumber: string;
  orderId?: string;
  orderNumber?: string;
  source?: OrderSource;
  tableId?: string;
  tableNumber?: string;
  roomNumber?: string;
  guestName?: string;
  items: OrderItem[];
  subtotal: number;
  discountType?: 'none' | 'flat' | 'percent';
  discountValue?: number;
  discountAmount: number;
  taxBreakdown?: TaxBreakdownItem[];
  taxAmount: number;
  totalAmount: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  splitPayments?: SplitPayment[];
  cashierId: string;
  cashierName: string;
  cancelReason?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RoomFolio {
  id: string;
  roomNumber: string;
  guestName: string;
  guestPhone?: string;
  checkInRef?: string;
  status: 'Active' | 'Settled';
  orderIds: string[];
  totalAmount: number;
  paidAmount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  minThreshold: number;
  unitCost: number;
  supplierId?: string;
  supplierName?: string;
  updatedAt?: unknown;
}

export interface InventoryLog {
  id: string;
  itemId: string;
  itemName: string;
  type: 'purchase' | 'consumption' | 'adjustment';
  quantityDelta: number;
  unit: string;
  note?: string;
  performedBy: string;
  createdAt?: unknown;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  category?: string;
  address?: string;
  createdAt?: unknown;
}

export interface ServiceRequest {
  id: string;
  tableId: string;
  tableNumber: string;
  type: 'call_waiter' | 'request_bill';
  status: 'Pending' | 'Resolved';
  note?: string;
  createdAt?: unknown;
}

export interface Feedback {
  id: string;
  orderId?: string;
  orderNumber?: string;
  tableNumber?: string;
  guestName?: string;
  foodRating: number;
  serviceRating: number;
  ambianceRating: number;
  overallRating: number;
  comment?: string;
  googleConsent: boolean;
  approved?: boolean;
  createdAt?: unknown;
}

export interface AppNotification {
  id: string;
  type:
    | 'qr_order'
    | 'waiter_order'
    | 'kitchen_update'
    | 'order_ready'
    | 'bill_request'
    | 'waiter_call'
    | 'low_stock'
    | 'supplier_reorder'
    | 'cancelled';
  title: string;
  message: string;
  targetRoles: StaffRole[];
  relatedId?: string;
  read: boolean;
  createdAt?: unknown;
}

export interface HotelSettings {
  id: string;
  hotelName: string;
  tagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  currency: string;
  upiId?: string;
  invoicePrefix?: string;
  invoiceFooter?: string;
  operatingHours?: string;
  taxes: TaxComponent[];
  paymentMethods: string[];
  googleReviewUrl?: string;
  whatsappNumber?: string;
  googleMapsUrl?: string;
  notificationsEnabled?: boolean;
  requireCustomerLogin?: boolean;
  updatedAt?: unknown;
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  super_admin: 'Super Admin',
  manager: 'Restaurant Manager',
  cashier: 'Cashier',
  waiter: 'Waiter',
  kitchen: 'Kitchen Staff',
};

export const ROLE_TO_PORTAL: Record<StaffRole, PortalKey> = {
  super_admin: 'admin',
  manager: 'manager',
  cashier: 'cashier',
  waiter: 'waiter',
  kitchen: 'kitchen',
};

export const PORTAL_TO_ROLE: Partial<Record<PortalKey, StaffRole>> = {
  admin: 'super_admin',
  manager: 'manager',
  cashier: 'cashier',
  waiter: 'waiter',
  kitchen: 'kitchen',
};

export const ROLE_ALLOWED_MODULES: Record<StaffRole, WorkspaceModule[]> = {
  super_admin: [
    'dashboard',
    'tables',
    'waiter',
    'kds',
    'pos',
    'room_service',
    'menu',
    'inventory',
    'reports',
    'feedback',
    'customers',
    'staff',
    'audit',
    'settings',
  ],
  manager: [
    'dashboard',
    'tables',
    'waiter',
    'kds',
    'pos',
    'room_service',
    'menu',
    'inventory',
    'reports',
    'feedback',
    'staff',
  ],
  cashier: ['pos', 'tables', 'room_service'],
  waiter: ['waiter', 'tables', 'room_service'],
  kitchen: ['kds', 'inventory'],
};

export const BAIDYANATH_MEDIA_LOGO = '/assets/aistudio/IMG-20260929-WA0002_4c420d5c.jpg';

