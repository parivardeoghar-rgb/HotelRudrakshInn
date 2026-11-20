import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { ShieldAlert } from 'lucide-react';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  sanitizeId,
} from './firebase';
import {
  resolveOrCreateCustomerProfile,
  resolveOrProvisionStaffProfile,
} from './services/firestoreService';
import { DEFAULT_HOTEL_SETTINGS } from './data/seedCatalog';
import {
  BAIDYANATH_MEDIA_LOGO,
  PORTAL_TO_ROLE,
  ROLE_ALLOWED_MODULES,
  ROLE_LABELS,
  ROLE_TO_PORTAL,
  type AppNotification,
  type AuditLog,
  type Bill,
  type CustomerProfile,
  type Feedback,
  type HotelSettings,
  type InventoryItem,
  type InventoryLog,
  type MenuCategory,
  type MenuItem,
  type Order,
  type PortalKey,
  type RestaurantTable,
  type RoomFolio,
  type ServiceRequest,
  type StaffInvite,
  type StaffProfile,
  type StaffRole,
  type Supplier,
  type WorkspaceModule,
} from './types';
import { AdminDashboard } from './components/AdminDashboard';
import { AppShell, getEffectiveAllowedModules } from './components/AppShell';
import { AuditLogsView } from './components/AuditLogsView';
import { CustomerDashboard } from './components/CustomerDashboard';
import { CustomersView } from './components/CustomersView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FeedbackView } from './components/FeedbackView';
import { GuestPortal } from './components/GuestPortal';
import { InventoryView } from './components/InventoryView';
import { KitchenDisplay } from './components/KitchenDisplay';
import { MenuManagementView } from './components/MenuManagementView';
import { PortalSelectorView } from './components/PortalSelectorView';
import { PosBilling } from './components/PosBilling';
import { ReportsView } from './components/ReportsView';
import { RoleLoginView } from './components/RoleLoginView';
import { RoomServiceView } from './components/RoomServiceView';
import { SettingsView } from './components/SettingsView';
import { StaffManagementView } from './components/StaffManagementView';
import { TableManagement } from './components/TableManagement';
import { WaiterDashboard } from './components/WaiterDashboard';

type RouteState =
  | { view: 'selector' }
  | { view: 'login'; portal: PortalKey }
  | { view: 'dashboard'; portal: PortalKey };

const LOGIN_ROUTES: Record<string, PortalKey> = {
  '/customer/login': 'customer',
  '/admin/login': 'admin',
  '/manager/login': 'manager',
  '/cashier/login': 'cashier',
  '/waiter/login': 'waiter',
  '/kitchen/login': 'kitchen',
};

const DASHBOARD_ROUTES: Record<string, PortalKey> = {
  '/customer/dashboard': 'customer',
  '/admin/dashboard': 'admin',
  '/manager/dashboard': 'manager',
  '/cashier/dashboard': 'cashier',
  '/waiter/dashboard': 'waiter',
  '/kitchen/dashboard': 'kitchen',
};

function parsePathname(pathname: string): RouteState {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (LOGIN_ROUTES[clean]) {
    return { view: 'login', portal: LOGIN_ROUTES[clean] };
  }
  if (DASHBOARD_ROUTES[clean]) {
    return { view: 'dashboard', portal: DASHBOARD_ROUTES[clean] };
  }
  return { view: 'selector' };
}

function getQueryTable(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('table');
    return raw ? sanitizeId(raw) : null;
  } catch {
    return null;
  }
}

function defaultModuleForRole(role: StaffRole, permissions?: WorkspaceModule[]): WorkspaceModule {
  const base =
    permissions && permissions.length > 0 ? permissions : ROLE_ALLOWED_MODULES[role];
  if (role === 'waiter' && base.includes('waiter')) return 'waiter';
  if (role === 'kitchen' && base.includes('kds')) return 'kds';
  if (role === 'cashier' && base.includes('pos')) return 'pos';
  if (base.includes('dashboard')) return 'dashboard';
  return base[0] || 'dashboard';
}

function AppContent() {
  const [route, setRoute] = useState<RouteState>(() =>
    parsePathname(window.location.pathname)
  );
  const routeRef = useRef<RouteState>(route);
  routeRef.current = route;

  const [guestTableId, setGuestTableId] = useState<string | null>(() => {
    const parsed = parsePathname(window.location.pathname);
    return parsed.view === 'selector' ? getQueryTable() : null;
  });
  const [returnTableAfterCustomerLogin, setReturnTableAfterCustomerLogin] = useState<
    string | null
  >(() => getQueryTable());

  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [staffProfile, setStaffProfile] = useState<StaffProfile | null>(null);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
  const [activeRole, setActiveRole] = useState<StaffRole>('super_admin');
  const [activeModule, setActiveModule] = useState<WorkspaceModule>('dashboard');

  const explicitLoginRef = useRef(false);

  // Real-time Firestore collections
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [roomFolios, setRoomFolios] = useState<RoomFolio[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [staffProfiles, setStaffProfiles] = useState<StaffProfile[]>([]);
  const [staffInvites, setStaffInvites] = useState<StaffInvite[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [settings, setSettings] = useState<HotelSettings>({
    ...DEFAULT_HOTEL_SETTINGS,
    updatedAt: new Date(),
  });

  const navigateTo = useCallback((path: string, replace = false) => {
    try {
      const targetUrl = new URL(path, window.location.origin);
      if (replace) {
        window.history.replaceState({}, '', targetUrl.pathname + targetUrl.search);
      } else {
        window.history.pushState({}, '', targetUrl.pathname + targetUrl.search);
      }
      const nextRoute = parsePathname(targetUrl.pathname);
      setRoute(nextRoute);
      const qTable = new URLSearchParams(targetUrl.search).get('table');
      setReturnTableAfterCustomerLogin(qTable ? sanitizeId(qTable) : null);
      if (nextRoute.view === 'selector' && qTable) {
        setGuestTableId(sanitizeId(qTable));
      } else {
        setGuestTableId(null);
      }
    } catch {
      setRoute(parsePathname(path));
    }
  }, []);

  // Listen to browser back/forward navigation
  useEffect(() => {
    const onPopState = () => {
      const next = parsePathname(window.location.pathname);
      setRoute(next);
      const qTbl = getQueryTable();
      setReturnTableAfterCustomerLogin(qTbl);
      setGuestTableId(next.view === 'selector' ? qTbl : null);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Public subscription to hotel_settings/main so QR login policy is known pre-auth
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'hotel_settings', 'main'),
      (snap) => {
        if (snap.exists()) setSettings(snap.data() as HotelSettings);
      },
      () => {
        // fallback cleanly to defaults if unseeded
      }
    );
    return () => unsub();
  }, []);

  const verifyPortalUser = useCallback(
    async (fbUser: User, targetPortal: PortalKey | null, isExplicitLogin: boolean) => {
      // Case 1: Customer Portal Authentication
      if (targetPortal === 'customer') {
        const cust = await resolveOrCreateCustomerProfile({
          uid: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName,
          phoneNumber: fbUser.phoneNumber,
        });
        if (!cust) {
          setAuthError(
            'This customer account has been deactivated. Contact Hotel Rudraksh Inn reception.'
          );
          await signOut(auth);
          setCustomerProfile(null);
          setStaffProfile(null);
          return;
        }
        setAuthError(null);
        setCustomerProfile(cust);
        setStaffProfile(null);
        if (isExplicitLogin || routeRef.current.view === 'login') {
          if (returnTableAfterCustomerLogin) {
            navigateTo(`/?table=${returnTableAfterCustomerLogin}`, true);
          } else {
            navigateTo('/customer/dashboard', true);
          }
        }
        return;
      }

      // Case 2: Staff / Admin Portal Authentication
      if (!fbUser.emailVerified) {
        setAuthError(
          'Email verification is required for staff portal access. Check your inbox or sign in with Google.'
        );
        if (isExplicitLogin) await signOut(auth);
        setStaffProfile(null);
        return;
      }

      const staff = await resolveOrProvisionStaffProfile({
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName,
      });

      if (!staff) {
        // Fallback check on initial load of "/" when signed in as a customer
        if (!targetPortal) {
          const cust = await resolveOrCreateCustomerProfile({
            uid: fbUser.uid,
            email: fbUser.email,
            displayName: fbUser.displayName,
            phoneNumber: fbUser.phoneNumber,
          });
          if (cust) {
            setCustomerProfile(cust);
            setStaffProfile(null);
            setAuthError(null);
            return;
          }
        }

        setAuthError(
          `Access denied for ${fbUser.email || 'this account'}. Ask the Hotel Rudraksh Inn Super Admin to authorize your email in Staff Management.`
        );
        await signOut(auth);
        setStaffProfile(null);
        setCustomerProfile(null);
        return;
      }

      // Strict portal role check on login portals (/admin/login, /waiter/login, etc.)
      if (targetPortal) {
        const expectedRole = PORTAL_TO_ROLE[targetPortal];
        if (expectedRole && staff.role !== expectedRole) {
          const actualPortal = ROLE_TO_PORTAL[staff.role];
          setAuthError(
            `Role mismatch: ${staff.email} is verified as ${ROLE_LABELS[staff.role]}, not ${ROLE_LABELS[expectedRole]}. Please sign in via /${actualPortal}/login.`
          );
          await signOut(auth);
          setStaffProfile(null);
          setCustomerProfile(null);
          return;
        }
      }

      setAuthError(null);
      setCustomerProfile(null);
      setStaffProfile(staff);
      setActiveRole(staff.role);
      setActiveModule(defaultModuleForRole(staff.role, staff.permissions));

      if (isExplicitLogin || routeRef.current.view === 'login') {
        navigateTo(`/${ROLE_TO_PORTAL[staff.role]}/dashboard`, true);
      }
    },
    [navigateTo, returnTableAfterCustomerLogin]
  );

  // Firebase Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (explicitLoginRef.current) return;
      if (!fbUser) {
        setStaffProfile(null);
        setCustomerProfile(null);
        setAuthReady(true);
        return;
      }

      setAuthLoading(true);
      try {
        const curRoute = routeRef.current;
        const hintPortal: PortalKey | null =
          curRoute.view === 'login' || curRoute.view === 'dashboard'
            ? curRoute.portal
            : null;
        await verifyPortalUser(fbUser, hintPortal, false);
      } catch (err) {
        setAuthError(
          err instanceof Error ? err.message : 'Unable to verify portal credentials.'
        );
      } finally {
        setAuthLoading(false);
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, [verifyPortalUser]);

  const handlePortalAuthenticated = async (fbUser: User, portal: PortalKey) => {
    explicitLoginRef.current = true;
    setAuthLoading(true);
    try {
      await verifyPortalUser(fbUser, portal, true);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Authentication verification failed.'
      );
    } finally {
      explicitLoginRef.current = false;
      setAuthLoading(false);
      setAuthReady(true);
    }
  };

  // Attach real-time Firestore listeners only when verified staff profile is active
  useEffect(() => {
    if (!authReady || !staffProfile) return;

    const unsubs: (() => void)[] = [];

    const listen = <T,>(
      q: ReturnType<typeof query> | ReturnType<typeof collection>,
      path: string,
      setter: (items: T[]) => void
    ) => {
      const u = onSnapshot(
        q,
        (snap) => setter(snap.docs.map((d) => d.data() as T)),
        (err) => handleFirestoreError(err, OperationType.LIST, path)
      );
      unsubs.push(u);
    };

    listen<RestaurantTable>(
      query(collection(db, 'tables'), orderBy('tableNumber', 'asc')),
      'tables',
      setTables
    );
    listen<MenuCategory>(
      query(collection(db, 'menu_categories'), orderBy('sortOrder', 'asc')),
      'menu_categories',
      setCategories
    );
    listen<MenuItem>(
      query(collection(db, 'menu_items'), orderBy('sortOrder', 'asc')),
      'menu_items',
      setMenuItems
    );
    listen<Order>(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(200)),
      'orders',
      setOrders
    );
    listen<InventoryItem>(
      query(collection(db, 'inventory'), orderBy('name', 'asc')),
      'inventory',
      setInventory
    );
    listen<InventoryLog>(
      query(collection(db, 'inventory_logs'), orderBy('createdAt', 'desc'), limit(100)),
      'inventory_logs',
      setInventoryLogs
    );
    listen<ServiceRequest>(
      query(collection(db, 'service_requests'), orderBy('createdAt', 'desc'), limit(50)),
      'service_requests',
      setServiceRequests
    );
    listen<Feedback>(
      query(collection(db, 'feedback'), orderBy('createdAt', 'desc'), limit(100)),
      'feedback',
      setFeedback
    );
    listen<AppNotification>(
      query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(60)),
      'notifications',
      setNotifications
    );

    if (['super_admin', 'manager', 'cashier', 'waiter'].includes(staffProfile.role)) {
      listen<Bill>(
        query(collection(db, 'bills'), orderBy('createdAt', 'desc'), limit(200)),
        'bills',
        setBills
      );
      listen<RoomFolio>(
        query(collection(db, 'room_folios'), orderBy('createdAt', 'desc'), limit(100)),
        'room_folios',
        setRoomFolios
      );
    }

    if (['super_admin', 'manager'].includes(staffProfile.role)) {
      listen<Supplier>(
        query(collection(db, 'suppliers'), orderBy('name', 'asc')),
        'suppliers',
        setSuppliers
      );
      listen<StaffProfile>(
        collection(db, 'staff_profiles'),
        'staff_profiles',
        setStaffProfiles
      );
      listen<StaffInvite>(
        collection(db, 'staff_invites'),
        'staff_invites',
        setStaffInvites
      );
    }

    if (staffProfile.role === 'super_admin') {
      listen<CustomerProfile>(
        query(collection(db, 'customer_profiles'), orderBy('createdAt', 'desc'), limit(200)),
        'customer_profiles',
        setCustomers
      );
      listen<AuditLog>(
        query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(150)),
        'audit_logs',
        setAuditLogs
      );
    }

    return () => unsubs.forEach((u) => u());
  }, [authReady, staffProfile]);

  const handleSignOut = async () => {
    await signOut(auth);
    setStaffProfile(null);
    setCustomerProfile(null);
    setAuthError(null);
    navigateTo('/');
  };

  const handleSwitchPreviewRole = (role: StaffRole) => {
    if (!staffProfile) return;
    setActiveRole(role);
    const allowed = getEffectiveAllowedModules(staffProfile, role);
    if (!allowed.includes(activeModule)) {
      setActiveModule(defaultModuleForRole(role, allowed));
    }
  };

  // 1. QR Guest Menu View (?table=...)
  if (guestTableId) {
    return (
      <GuestPortal
        tableId={guestTableId}
        customerUid={customerProfile?.uid || null}
        customerName={customerProfile?.displayName || null}
        onRequestCustomerLogin={(tbl) => navigateTo(`/customer/login?table=${tbl}`)}
        onExitToStaffLogin={() => {
          setGuestTableId(null);
          if (staffProfile) {
            navigateTo(`/${ROLE_TO_PORTAL[staffProfile.role]}/dashboard`, true);
          } else {
            navigateTo('/', true);
          }
        }}
      />
    );
  }

  // 2. Initial Auth Bootstrap Loading Screen
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#141518] text-white flex items-center justify-center">
        <div className="text-center space-y-3">
          <img
            src={BAIDYANATH_MEDIA_LOGO}
            alt="Baidyanath Media"
            className="w-12 h-12 rounded-xl object-cover bg-[#F4F1EA] mx-auto"
          />
          <div className="font-display text-2xl font-semibold text-[#D4AF37]">
            Hotel Rudraksh Inn
          </div>
          <div className="text-xs text-zinc-400">Connecting to Smart Restaurant System...</div>
        </div>
      </div>
    );
  }

  // 3. Dedicated Role Login Pages (/customer/login, /admin/login, /manager/login, /cashier/login, /waiter/login, /kitchen/login)
  if (route.view === 'login') {
    return (
      <RoleLoginView
        portal={route.portal}
        authLoading={authLoading}
        authError={authError}
        requireCustomerLogin={settings.requireCustomerLogin}
        onBackToPortals={() => {
          setAuthError(null);
          navigateTo('/');
        }}
        onAuthenticated={handlePortalAuthenticated}
        onOpenGuestMenu={(tableId) => {
          setGuestTableId(tableId);
          navigateTo(`/?table=${tableId}`);
        }}
      />
    );
  }

  // 4. Customer Dashboard (/customer/dashboard)
  if (route.view === 'dashboard' && route.portal === 'customer') {
    if (!customerProfile) {
      return (
        <RoleLoginView
          portal="customer"
          authLoading={authLoading}
          authError={
            staffProfile
              ? 'Staff accounts cannot open the Customer Dashboard. Please sign in with a customer account.'
              : authError
          }
          requireCustomerLogin={settings.requireCustomerLogin}
          onBackToPortals={() => {
            setAuthError(null);
            navigateTo('/');
          }}
          onAuthenticated={handlePortalAuthenticated}
          onOpenGuestMenu={(tableId) => {
            setGuestTableId(tableId);
            navigateTo(`/?table=${tableId}`);
          }}
        />
      );
    }

    return (
      <CustomerDashboard
        customer={customerProfile}
        initialTableId={returnTableAfterCustomerLogin}
        onProfileUpdated={(next) => setCustomerProfile(next)}
        onSignOut={handleSignOut}
      />
    );
  }

  // 5. Staff / Admin Dashboards (/admin/dashboard, /manager/dashboard, /cashier/dashboard, /waiter/dashboard, /kitchen/dashboard)
  if (route.view === 'dashboard') {
    const requiredRole = PORTAL_TO_ROLE[route.portal];

    if (!staffProfile) {
      // Customer or unauthenticated user trying to access a staff/admin dashboard
      if (customerProfile) {
        return (
          <div className="min-h-screen bg-[#141518] text-white flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-white text-zinc-900 rounded-2xl p-6 space-y-4 text-center">
              <ShieldAlert className="w-10 h-10 text-red-600 mx-auto" />
              <h2 className="font-display text-2xl font-semibold">Access Restricted</h2>
              <p className="text-xs text-zinc-600 leading-relaxed">
                Customer accounts cannot access staff or administrative dashboards (/{route.portal}/dashboard).
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                <button
                  type="button"
                  onClick={() => navigateTo('/customer/dashboard', true)}
                  className="px-4 py-2.5 rounded-xl bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
                >
                  Go to Customer Portal
                </button>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="px-4 py-2.5 rounded-xl border border-zinc-300 text-xs font-semibold cursor-pointer"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        );
      }

      return (
        <RoleLoginView
          portal={route.portal}
          authLoading={authLoading}
          authError={authError}
          requireCustomerLogin={settings.requireCustomerLogin}
          onBackToPortals={() => {
            setAuthError(null);
            navigateTo('/');
          }}
          onAuthenticated={handlePortalAuthenticated}
          onOpenGuestMenu={(tableId) => {
            setGuestTableId(tableId);
            navigateTo(`/?table=${tableId}`);
          }}
        />
      );
    }

    // Strict Cross-Role Dashboard Isolation:
    // Staff cannot open another role's dashboard URL unless their verified role matches (or Super Admin)
    if (
      requiredRole &&
      staffProfile.role !== requiredRole &&
      staffProfile.role !== 'super_admin'
    ) {
      const ownPortal = ROLE_TO_PORTAL[staffProfile.role];
      return (
        <div className="min-h-screen bg-[#141518] text-white flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white text-zinc-900 rounded-2xl p-6 space-y-4 text-center">
            <ShieldAlert className="w-10 h-10 text-red-600 mx-auto" />
            <h2 className="font-display text-2xl font-semibold">
              Unauthorized Portal Access
            </h2>
            <p className="text-xs text-zinc-600 leading-relaxed">
              You are signed in as <strong>{staffProfile.displayName}</strong> with verified role{' '}
              <strong>{ROLE_LABELS[staffProfile.role]}</strong>. Access to{' '}
              <span className="font-mono-tabular">/{route.portal}/dashboard</span> requires{' '}
              <strong>{ROLE_LABELS[requiredRole]}</strong> authorization.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
              <button
                type="button"
                onClick={() => navigateTo(`/${ownPortal}/dashboard`, true)}
                className="px-4 py-2.5 rounded-xl bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
              >
                Open My {ROLE_LABELS[staffProfile.role]} Dashboard
              </button>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="px-4 py-2.5 rounded-xl border border-zinc-300 text-xs font-semibold cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      );
    }

    const allowedModules = getEffectiveAllowedModules(staffProfile, activeRole);
    const currentModule: WorkspaceModule = allowedModules.includes(activeModule)
      ? activeModule
      : defaultModuleForRole(activeRole, allowedModules);

    return (
      <AppShell
        profile={staffProfile}
        activeRole={activeRole}
        onSwitchPreviewRole={handleSwitchPreviewRole}
        activeModule={currentModule}
        onSelectModule={setActiveModule}
        notifications={notifications}
        onOpenQrMenuPreview={() => {
          const tbl = tables[0]?.id || 'T1';
          setGuestTableId(tbl);
          navigateTo(`/?table=${tbl}`);
        }}
        onProfileUpdated={(updated) => setStaffProfile(updated)}
        onSignOut={handleSignOut}
      >
        {currentModule === 'dashboard' && (
          <AdminDashboard
            orders={orders}
            bills={bills}
            tables={tables}
            menuItems={menuItems}
            inventory={inventory}
            feedback={feedback}
            serviceRequests={serviceRequests}
            isAdmin={staffProfile.role === 'super_admin' || staffProfile.role === 'manager'}
            onNavigate={setActiveModule}
          />
        )}

        {currentModule === 'tables' && (
          <TableManagement
            tables={tables}
            orders={orders}
            staffList={staffProfiles}
            canManageTables={activeRole === 'super_admin' || activeRole === 'manager'}
            onOpenGuestQrPreview={(tblId) => {
              setGuestTableId(tblId);
              navigateTo(`/?table=${tblId}`);
            }}
          />
        )}

        {currentModule === 'waiter' && (
          <WaiterDashboard
            currentUser={staffProfile}
            tables={tables}
            orders={orders}
            menuItems={menuItems}
            inventory={inventory}
            serviceRequests={serviceRequests}
          />
        )}

        {currentModule === 'kds' && (
          <KitchenDisplay
            currentUser={staffProfile}
            orders={orders}
            menuItems={menuItems}
            inventory={inventory}
          />
        )}

        {currentModule === 'pos' && (
          <PosBilling
            currentUser={staffProfile}
            orders={orders}
            bills={bills}
            tables={tables}
            menuItems={menuItems}
            settings={settings}
          />
        )}

        {currentModule === 'room_service' && (
          <RoomServiceView
            currentUser={staffProfile}
            folios={roomFolios}
            orders={orders}
            menuItems={menuItems}
            settings={settings}
          />
        )}

        {currentModule === 'menu' && (
          <MenuManagementView
            categories={categories}
            menuItems={menuItems}
            inventory={inventory}
          />
        )}

        {currentModule === 'inventory' && (
          <InventoryView
            currentUser={staffProfile}
            inventory={inventory}
            logs={inventoryLogs}
            suppliers={suppliers}
          />
        )}

        {currentModule === 'reports' && (
          <ReportsView orders={orders} bills={bills} inventory={inventory} />
        )}

        {currentModule === 'feedback' && <FeedbackView feedback={feedback} />}

        {currentModule === 'customers' && staffProfile.role === 'super_admin' && (
          <CustomersView
            currentUser={staffProfile}
            customers={customers}
            orders={orders}
          />
        )}

        {currentModule === 'staff' && (
          <StaffManagementView
            currentUser={staffProfile}
            staffProfiles={staffProfiles}
            staffInvites={staffInvites}
          />
        )}

        {currentModule === 'audit' && staffProfile.role === 'super_admin' && (
          <AuditLogsView logs={auditLogs} />
        )}

        {currentModule === 'settings' && staffProfile.role === 'super_admin' && (
          <SettingsView settings={settings} />
        )}
      </AppShell>
    );
  }

  // 6. Root Portal Selection Page (/)
  return (
    <PortalSelectorView
      requireCustomerLogin={settings.requireCustomerLogin}
      onSelectPortal={(portal) => {
        setAuthError(null);
        // If user is already verified for the chosen portal, take them straight to their dashboard
        if (portal === 'customer' && customerProfile) {
          navigateTo('/customer/dashboard');
          return;
        }
        if (staffProfile && ROLE_TO_PORTAL[staffProfile.role] === portal) {
          navigateTo(`/${portal}/dashboard`);
          return;
        }
        navigateTo(`/${portal}/login`);
      }}
      onOpenGuestMenu={(tableId) => {
        setGuestTableId(tableId);
        navigateTo(`/?table=${tableId}`);
      }}
    />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
