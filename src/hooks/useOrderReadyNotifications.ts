import { useCallback, useEffect, useRef, useState } from 'react';
import type { Order, OrderStatus } from '../types';

const NOTIFY_STORAGE_KEY = 'rudraksh_notify_ready_orders';
const NOTIFIED_STORAGE_KEY = 'rudraksh_notified_ready_orders';

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

export interface ToggleNotifyResult {
  enabled: boolean;
  permission: BrowserNotificationPermission;
  message?: string;
}

function readStoredIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string').slice(-30)
      : [];
  } catch {
    return [];
  }
}

function writeStoredIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids.slice(-30)));
  } catch {
    // ignore storage quota errors
  }
}

export function useOrderReadyNotifications(
  orders: Order[],
  onOrderReady?: (order: Order) => void
) {
  const isSupported = typeof window !== 'undefined' && 'Notification' in window;

  const [permission, setPermission] = useState<BrowserNotificationPermission>(() =>
    isSupported ? window.Notification.permission : 'unsupported'
  );

  const [notifyOrderIds, setNotifyOrderIds] = useState<string[]>(() =>
    readStoredIds(NOTIFY_STORAGE_KEY)
  );

  const prevStatusesRef = useRef<Record<string, OrderStatus>>({});
  const notifiedIdsRef = useRef<Set<string>>(
    new Set(readStoredIds(NOTIFIED_STORAGE_KEY))
  );
  const onOrderReadyRef = useRef(onOrderReady);
  onOrderReadyRef.current = onOrderReady;

  // Keep permission synced if changed via browser site settings
  useEffect(() => {
    if (!isSupported) return;
    setPermission(window.Notification.permission);
  }, [isSupported]);

  // Watch tracked orders for 'Preparing' -> 'Ready' transition
  useEffect(() => {
    const prevMap = prevStatusesRef.current;

    for (const ord of orders) {
      const prevStatus = prevMap[ord.id];
      const transitionedToReady =
        prevStatus === 'Preparing' && ord.status === 'Ready';

      if (
        transitionedToReady &&
        notifyOrderIds.includes(ord.id) &&
        !notifiedIdsRef.current.has(ord.id)
      ) {
        notifiedIdsRef.current.add(ord.id);
        writeStoredIds(
          NOTIFIED_STORAGE_KEY,
          Array.from(notifiedIdsRef.current)
        );

        if (isSupported && window.Notification.permission === 'granted') {
          try {
            const locationLabel = ord.tableNumber
              ? `Table ${ord.tableNumber} · `
              : ord.roomNumber
              ? `Room ${ord.roomNumber} · `
              : '';
            const n = new window.Notification(
              `Order ${ord.orderNumber} is Ready!`,
              {
                body: `${locationLabel}Your pure vegetarian dishes from Hotel Rudraksh Inn are ready to be served.`,
                tag: `rudraksh-order-ready-${ord.id}`,
              }
            );
            n.onclick = () => {
              window.focus();
              n.close();
            };
          } catch {
            // fallback gracefully if OS notification constructor is restricted
          }
        }

        onOrderReadyRef.current?.(ord);
      }

      prevMap[ord.id] = ord.status;
    }
  }, [orders, notifyOrderIds, isSupported]);

  const toggleNotifyForOrder = useCallback(
    async (ord: Order): Promise<ToggleNotifyResult> => {
      const currentlyEnabled = notifyOrderIds.includes(ord.id);
      if (currentlyEnabled) {
        const next = notifyOrderIds.filter((id) => id !== ord.id);
        setNotifyOrderIds(next);
        writeStoredIds(NOTIFY_STORAGE_KEY, next);
        return {
          enabled: false,
          permission,
          message: `Ready notification turned off for ${ord.orderNumber}.`,
        };
      }

      if (!isSupported) {
        return {
          enabled: false,
          permission: 'unsupported',
          message: 'Browser notifications are not supported on this device.',
        };
      }

      let currentPermission = window.Notification.permission;
      if (currentPermission === 'default') {
        try {
          currentPermission = await window.Notification.requestPermission();
        } catch {
          currentPermission = window.Notification.permission;
        }
      }
      setPermission(currentPermission);

      if (currentPermission !== 'granted') {
        return {
          enabled: false,
          permission: currentPermission,
          message:
            currentPermission === 'denied'
              ? 'Notifications are blocked by your browser. Please allow notifications in site settings.'
              : 'Notification permission was not granted.',
        };
      }

      const next = Array.from(new Set([...notifyOrderIds, ord.id]));
      setNotifyOrderIds(next);
      writeStoredIds(NOTIFY_STORAGE_KEY, next);
      return {
        enabled: true,
        permission: currentPermission,
        message: `We will alert you when ${ord.orderNumber} moves from Preparing to Ready.`,
      };
    },
    [notifyOrderIds, isSupported, permission]
  );

  const isNotifyEnabled = useCallback(
    (orderId: string) => notifyOrderIds.includes(orderId),
    [notifyOrderIds]
  );

  const wasNotifiedReady = useCallback(
    (orderId: string) => notifiedIdsRef.current.has(orderId),
    []
  );

  return {
    isSupported,
    permission,
    isNotifyEnabled,
    wasNotifiedReady,
    toggleNotifyForOrder,
  };
}
