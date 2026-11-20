import React from 'react';
import { Printer, X } from 'lucide-react';
import type { Bill, HotelSettings } from '../types';
import { formatDateTime, formatINR } from '../utils/format';

interface InvoiceModalProps {
  bill: Bill | null;
  settings: HotelSettings;
  onClose: () => void;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ bill, settings, onClose }) => {
  if (!bill) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-hidden print-area">
        {/* Modal Header (Hidden on Print) */}
        <div className="no-print px-5 py-3.5 bg-[#141518] text-white flex items-center justify-between">
          <span className="text-sm font-semibold">Tax Invoice · {bill.invoiceNumber}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1.5 rounded-lg bg-[#C59B27] text-[#141518] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#D4AF37] cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print / Save PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white cursor-pointer"
              aria-label="Close invoice"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Invoice Content */}
        <div className="p-6 text-zinc-900 space-y-5">
          <div className="text-center border-b border-dashed border-zinc-300 pb-4">
            <h2 className="font-display text-2xl font-bold text-zinc-900">
              {settings.hotelName}
            </h2>
            {settings.address && (
              <p className="text-xs text-zinc-600 mt-1">{settings.address}</p>
            )}
            <div className="text-xs text-zinc-600 mt-1 flex flex-wrap items-center justify-center gap-2">
              {settings.phone && <span>Tel: {settings.phone}</span>}
              {settings.gstin && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular">GSTIN: {settings.gstin}</span>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-zinc-500">Invoice Number</div>
              <div className="font-mono-tabular font-semibold">{bill.invoiceNumber}</div>
            </div>
            <div className="text-right">
              <div className="text-zinc-500">Date & Time</div>
              <div className="font-mono-tabular">{formatDateTime(bill.createdAt)}</div>
            </div>
            <div>
              <div className="text-zinc-500">Service Ref</div>
              <div className="font-medium">
                {bill.tableNumber
                  ? `Table ${bill.tableNumber}`
                  : bill.roomNumber
                  ? `Room ${bill.roomNumber}`
                  : 'Counter / POS'}
                {bill.guestName ? ` · ${bill.guestName}` : ''}
              </div>
            </div>
            <div className="text-right">
              <div className="text-zinc-500">Cashier</div>
              <div className="font-medium">{bill.cashierName}</div>
            </div>
          </div>

          {/* Itemized Table */}
          <table className="w-full text-xs border-t border-b border-zinc-200">
            <thead>
              <tr className="text-left text-zinc-500 border-b border-zinc-200">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 font-medium text-right">Qty</th>
                <th className="py-2 font-medium text-right">Rate</th>
                <th className="py-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {bill.items.map((item, idx) => (
                <tr key={`${item.itemId}_${idx}`}>
                  <td className="py-2 pr-2 font-medium text-zinc-900">{item.name}</td>
                  <td className="py-2 text-right font-mono-tabular">{item.qty}</td>
                  <td className="py-2 text-right font-mono-tabular">{formatINR(item.price)}</td>
                  <td className="py-2 text-right font-mono-tabular font-semibold">
                    {formatINR(item.price * item.qty)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between text-zinc-600">
              <span>Subtotal</span>
              <span className="font-mono-tabular">{formatINR(bill.subtotal)}</span>
            </div>
            {bill.discountAmount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>
                  Discount
                  {bill.discountType === 'percent' && bill.discountValue
                    ? ` (${bill.discountValue}%)`
                    : ''}
                </span>
                <span className="font-mono-tabular">-{formatINR(bill.discountAmount)}</span>
              </div>
            )}
            {(bill.taxBreakdown || []).map((tax) => (
              <div key={tax.name} className="flex justify-between text-zinc-600">
                <span>
                  {tax.name} ({tax.rate}%)
                </span>
                <span className="font-mono-tabular">{formatINR(tax.amount)}</span>
              </div>
            ))}
            {(!bill.taxBreakdown || bill.taxBreakdown.length === 0) && bill.taxAmount > 0 && (
              <div className="flex justify-between text-zinc-600">
                <span>Taxes</span>
                <span className="font-mono-tabular">{formatINR(bill.taxAmount)}</span>
              </div>
            )}

            <div className="pt-2 border-t border-zinc-300 flex justify-between text-base font-bold text-zinc-900">
              <span>Grand Total</span>
              <span className="font-mono-tabular">{formatINR(bill.totalAmount)}</span>
            </div>
          </div>

          {/* Payment Summary */}
          <div className="p-3 rounded-lg bg-zinc-50 border border-zinc-200 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-zinc-500">Payment Status</span>
              <span className="font-semibold text-zinc-900">{bill.paymentStatus}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Payment Method</span>
              <span className="font-semibold text-zinc-900">{bill.paymentMethod}</span>
            </div>
            {bill.splitPayments && bill.splitPayments.length > 0 && (
              <div className="pt-1 border-t border-zinc-200 mt-1 space-y-0.5">
                {bill.splitPayments.map((sp, i) => (
                  <div key={i} className="flex justify-between text-zinc-600">
                    <span>{sp.method}</span>
                    <span className="font-mono-tabular">{formatINR(sp.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {bill.cancelReason && (
              <div className="text-red-600 pt-1">Cancel Reason: {bill.cancelReason}</div>
            )}
          </div>

          <div className="text-center text-[11px] text-zinc-500 pt-2 border-t border-dashed border-zinc-300 space-y-1">
            <p>{settings.invoiceFooter || 'Thank you for dining at Hotel Rudraksh Inn!'}</p>
            <p className="text-zinc-400">
              Software by Baidyanath Media Agency · www.baidyanathmedia.com
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
