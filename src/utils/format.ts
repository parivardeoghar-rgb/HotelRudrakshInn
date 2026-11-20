import type { OrderItem, TaxBreakdownItem, TaxComponent } from '../types';

export function formatINR(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function formatINRCompact(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(safe);
}

export function toDate(ts: unknown): Date {
  if (!ts) return new Date();
  if (ts instanceof Date) return ts;
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate();
  }
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts && typeof (ts as { seconds: number }).seconds === 'number') {
    return new Date((ts as { seconds: number }).seconds * 1000);
  }
  if (typeof ts === 'string' || typeof ts === 'number') {
    const parsed = new Date(ts);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  return new Date();
}

export function formatTime(ts: unknown): string {
  return toDate(ts).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateTime(ts: unknown): string {
  return toDate(ts).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getElapsedMinutes(ts: unknown): number {
  const ms = Date.now() - toDate(ts).getTime();
  return Math.max(0, Math.floor(ms / 60000));
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function calculateSubtotal(items: OrderItem[]): number {
  return Math.round(
    items.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0) * 100
  ) / 100;
}

export function calculateBillTotals(
  items: OrderItem[],
  discountType: 'none' | 'flat' | 'percent',
  discountValue: number,
  taxes: TaxComponent[]
): {
  subtotal: number;
  discountAmount: number;
  taxBreakdown: TaxBreakdownItem[];
  taxAmount: number;
  totalAmount: number;
} {
  const subtotal = calculateSubtotal(items);
  let discountAmount = 0;
  if (discountType === 'flat') {
    discountAmount = Math.min(subtotal, Math.max(0, Number(discountValue) || 0));
  } else if (discountType === 'percent') {
    const pct = Math.min(100, Math.max(0, Number(discountValue) || 0));
    discountAmount = (subtotal * pct) / 100;
  }
  discountAmount = Math.round(discountAmount * 100) / 100;

  const taxableBase = Math.max(0, subtotal - discountAmount);
  const taxBreakdown: TaxBreakdownItem[] = (taxes || [])
    .filter((t) => t.enabled && t.rate > 0)
    .map((t) => ({
      name: t.name,
      rate: t.rate,
      amount: Math.round(((taxableBase * t.rate) / 100) * 100) / 100,
    }));

  const taxAmount = Math.round(taxBreakdown.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const totalAmount = Math.round((taxableBase + taxAmount) * 100) / 100;

  return { subtotal, discountAmount, taxBreakdown, taxAmount, totalAmount };
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escapeCell = (cell: string | number) => {
    const str = String(cell ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
