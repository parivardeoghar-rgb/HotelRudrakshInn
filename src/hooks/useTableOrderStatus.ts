import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { Order, RestaurantTable } from '../types';

export interface TableOrderStatusInfo {
  tableDoc: RestaurantTable | null;
  activeOrder: Order | null;
  isOccupied: boolean;
  label: 'Occupied' | 'Available';
  stageLabel: string | null;
  detail: string;
  loading: boolean;
}

export function deriveTableOrderStatus(
  tableId: string,
  tableDoc: RestaurantTable | null,
  orders: Order[] = [],
  loading = false
): TableOrderStatusInfo {
  const activeOrder =
    orders.find(
      (o) =>
        o.tableId === tableId &&
        !o.billed &&
        o.status !== 'Completed' &&
        o.status !== 'Cancelled'
    ) || null;

  const hasTableOrder = Boolean(tableDoc?.currentOrderId);
  const tableBusy = Boolean(tableDoc && tableDoc.status !== 'Available');
  const isOccupied = Boolean(activeOrder) || hasTableOrder || tableBusy;

  const label: 'Occupied' | 'Available' = isOccupied ? 'Occupied' : 'Available';

  let stageLabel: string | null = null;
  if (isOccupied) {
    if (activeOrder) {
      stageLabel =
        activeOrder.status === 'New' || activeOrder.status === 'Accepted'
          ? 'Ordered'
          : activeOrder.status;
    } else if (
      tableDoc &&
      tableDoc.status !== 'Available' &&
      tableDoc.status !== 'Occupied'
    ) {
      stageLabel = tableDoc.status;
    } else if (hasTableOrder) {
      stageLabel = 'Active order';
    }
  }

  let detail = 'No active order on this table';
  if (activeOrder) {
    detail = `Active order ${activeOrder.orderNumber} · ${activeOrder.status}`;
  } else if (isOccupied) {
    detail = hasTableOrder
      ? `Table currently has an active order (${tableDoc?.status || 'Ordered'})`
      : 'Table is currently occupied';
  }

  return {
    tableDoc,
    activeOrder,
    isOccupied,
    label,
    stageLabel,
    detail,
    loading,
  };
}

export function useTableOrderStatus(
  tableId: string,
  orders: Order[] = []
): TableOrderStatusInfo {
  const [tableDoc, setTableDoc] = useState<RestaurantTable | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(tableId));

  useEffect(() => {
    if (!tableId) {
      setTableDoc(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    const unsub = onSnapshot(
      doc(db, 'tables', tableId),
      (snap) => {
        if (!active) return;
        setTableDoc(snap.exists() ? (snap.data() as RestaurantTable) : null);
        setLoading(false);
      },
      () => {
        if (!active) return;
        setTableDoc(null);
        setLoading(false);
      }
    );

    return () => {
      active = false;
      unsub();
    };
  }, [tableId]);

  return useMemo(
    () => deriveTableOrderStatus(tableId, tableDoc, orders, loading),
    [tableId, tableDoc, orders, loading]
  );
}
