import React, { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  EyeOff,
  Flag,
  MessageSquareHeart,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  deleteFeedback,
  reviewOrderMealPhoto,
  setFeedbackApproval,
} from '../services/firestoreService';
import type { Feedback, MealPhotoReviewStatus, Order, StaffProfile } from '../types';
import { formatDateTime, formatINR, toDate } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';

interface FeedbackViewProps {
  feedback: Feedback[];
  orders?: Order[];
  currentUser?: StaffProfile | null;
  canModerate?: boolean;
}

export const FeedbackView: React.FC<FeedbackViewProps> = ({
  feedback,
  orders = [],
  currentUser = null,
  canModerate = true,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'reviews' | 'photos'>('reviews');
  const [photoFilter, setPhotoFilter] = useState<'All' | MealPhotoReviewStatus>('All');
  const [deleteTarget, setDeleteTarget] = useState<Feedback | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightboxOrder, setLightboxOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (!lightboxOrder) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOrder(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOrder]);

  const avg = (key: 'foodRating' | 'serviceRating' | 'ambianceRating' | 'overallRating') => {
    if (feedback.length === 0) return '0.0';
    return (feedback.reduce((s, f) => s + f[key], 0) / feedback.length).toFixed(1);
  };

  const approvedCount = feedback.filter((f) => Boolean(f.approved)).length;

  const mealPhotoOrders = useMemo(
    () =>
      orders
        .filter((o) => Boolean(o.mealPhotoUrl))
        .sort(
          (a, b) =>
            toDate(b.mealPhotoUploadedAt || b.updatedAt || b.createdAt).getTime() -
            toDate(a.mealPhotoUploadedAt || a.updatedAt || a.createdAt).getTime()
        ),
    [orders]
  );

  const pendingPhotoCount = useMemo(
    () =>
      mealPhotoOrders.filter(
        (o) => !o.mealPhotoStatus || o.mealPhotoStatus === 'Pending Review'
      ).length,
    [mealPhotoOrders]
  );

  const filteredMealPhotoOrders = useMemo(() => {
    if (photoFilter === 'All') return mealPhotoOrders;
    return mealPhotoOrders.filter(
      (o) => (o.mealPhotoStatus || 'Pending Review') === photoFilter
    );
  }, [mealPhotoOrders, photoFilter]);

  const handleToggleApproval = async (fb: Feedback) => {
    setBusyId(fb.id);
    try {
      await setFeedbackApproval(fb.id, !fb.approved);
    } finally {
      setBusyId(null);
    }
  };

  const handleReviewPhoto = async (ord: Order, status: MealPhotoReviewStatus) => {
    if (!currentUser) return;
    setBusyId(ord.id);
    try {
      await reviewOrderMealPhoto({ order: ord, status, actor: currentUser });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold text-zinc-900">
            Guest Ratings &amp; Meal Photo Review
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {feedback.length} guest responses ({approvedCount} published) ·{' '}
            {mealPhotoOrders.length} meal photos ({pendingPhotoCount} pending review)
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-white border border-zinc-200 rounded-xl text-xs">
          <button
            type="button"
            onClick={() => setActiveSubTab('reviews')}
            className={`px-3.5 py-1.5 rounded-lg font-semibold whitespace-nowrap cursor-pointer ${
              activeSubTab === 'reviews' ? 'bg-[#141518] text-[#D4AF37]' : 'text-zinc-600'
            }`}
          >
            Guest Reviews ({feedback.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('photos')}
            className={`px-3.5 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeSubTab === 'photos' ? 'bg-[#141518] text-[#D4AF37]' : 'text-zinc-600'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>
              Meal Photos ({mealPhotoOrders.length}
              {pendingPhotoCount > 0 ? ` · ${pendingPhotoCount} new` : ''})
            </span>
          </button>
        </div>
      </div>

      {activeSubTab === 'reviews' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Overall Rating', val: avg('overallRating') },
              { label: 'Food Quality', val: avg('foodRating') },
              { label: 'Service & Staff', val: avg('serviceRating') },
              { label: 'Ambiance', val: avg('ambianceRating') },
            ].map((card) => (
              <div key={card.label} className="bg-white border border-zinc-200 rounded-xl p-4">
                <div className="text-xs text-zinc-500">{card.label}</div>
                <div className="font-mono-tabular text-2xl font-bold text-zinc-900 mt-1 flex items-center gap-1.5">
                  {card.val}
                  <Star className="w-4 h-4 fill-[#C59B27] text-[#C59B27]" />
                </div>
              </div>
            ))}
          </div>

          {feedback.length === 0 ? (
            <div className="bg-white border border-zinc-200 rounded-xl p-10 text-center text-sm text-zinc-500">
              <MessageSquareHeart className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
              Guest reviews submitted through the Homepage or QR Table Menu will appear here.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {feedback.map((fb) => {
                const isApproved = Boolean(fb.approved);
                return (
                  <div
                    key={fb.id}
                    className="bg-white border border-zinc-200 rounded-xl p-5 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="font-bold text-zinc-900">
                          {fb.guestName || 'Dining Guest'}
                          {fb.tableNumber ? ` · Table ${fb.tableNumber}` : ''}
                        </div>
                        <span className="font-mono-tabular text-zinc-500">
                          {formatDateTime(fb.createdAt)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                        <span className="font-semibold text-[#9A7415]">
                          Overall: {fb.overallRating.toFixed(1)}/5
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Food: {fb.foodRating}/5</span>
                        <span aria-hidden="true">·</span>
                        <span>Service: {fb.serviceRating}/5</span>
                        <span aria-hidden="true">·</span>
                        <span>Ambiance: {fb.ambianceRating}/5</span>
                      </div>
                      {fb.comment && (
                        <p className="text-sm text-zinc-700 leading-relaxed pt-1">{fb.comment}</p>
                      )}
                    </div>

                    <div className="pt-3 border-t border-zinc-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="text-[11px] text-zinc-500">
                        {isApproved ? (
                          <span className="text-emerald-700 font-semibold">Visible on Homepage</span>
                        ) : (
                          <span>Pending Moderation</span>
                        )}
                        <span aria-hidden="true"> · </span>
                        <span>{fb.googleConsent ? 'Google Opt-In' : 'Internal'}</span>
                      </div>

                      {canModerate && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busyId === fb.id}
                            onClick={() => void handleToggleApproval(fb)}
                            className={`px-2.5 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                              isApproved
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                                : 'bg-[#141518] text-[#D4AF37] hover:bg-zinc-800'
                            }`}
                          >
                            {isApproved ? (
                              <>
                                <EyeOff className="w-3.5 h-3.5" />
                                <span>Hide</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Approve</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(fb)}
                            className="p-1.5 rounded-lg border border-zinc-200 text-red-600 hover:bg-red-50 cursor-pointer"
                            title="Delete review"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-white border border-zinc-200 rounded-xl text-xs">
              {(
                ['All', 'Pending Review', 'Reviewed', 'Featured', 'Flagged'] as const
              ).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setPhotoFilter(status)}
                  className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap cursor-pointer ${
                    photoFilter === status ? 'bg-[#141518] text-[#D4AF37]' : 'text-zinc-600'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
            <div className="text-xs text-zinc-500">
              Photos uploaded by customers are linked directly to their order record.
            </div>
          </div>

          {filteredMealPhotoOrders.length === 0 ? (
            <div className="bg-white border border-zinc-200 rounded-xl p-10 text-center text-sm text-zinc-500">
              <Camera className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
              {mealPhotoOrders.length === 0
                ? 'Customer meal photos uploaded from the Customer Dashboard will appear here for management review.'
                : `No meal photos with status "${photoFilter}".`}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredMealPhotoOrders.map((ord) => {
                const status = ord.mealPhotoStatus || 'Pending Review';
                const statusColor =
                  status === 'Featured'
                    ? 'text-[#9A7415]'
                    : status === 'Reviewed'
                    ? 'text-emerald-700'
                    : status === 'Flagged'
                    ? 'text-red-700'
                    : 'text-amber-700';

                return (
                  <article
                    key={ord.id}
                    className="bg-white border border-zinc-200 rounded-xl overflow-hidden flex flex-col justify-between"
                  >
                    <div>
                      <button
                        type="button"
                        onClick={() => setLightboxOrder(ord)}
                        className="w-full h-52 bg-zinc-900 block overflow-hidden cursor-pointer"
                        title="Inspect full meal photo"
                      >
                        <img
                          src={ord.mealPhotoUrl}
                          alt={`Guest meal photo for ${ord.orderNumber}`}
                          className="w-full h-full object-cover hover:scale-[1.02] transition-transform duration-200"
                        />
                      </button>

                      <div className="p-4 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono-tabular font-bold text-sm text-zinc-900">
                            {ord.orderNumber}
                          </span>
                          <span className={`font-semibold ${statusColor}`}>{status}</span>
                        </div>

                        <div className="text-zinc-500 flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-zinc-800">
                            {ord.guestName || 'Dining Guest'}
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
                          <span className="font-mono-tabular">{formatINR(ord.subtotal)}</span>
                        </div>

                        <p className="text-zinc-600 line-clamp-2">
                          Dishes: {ord.items.map((it) => `${it.qty}× ${it.name}`).join(', ')}
                        </p>

                        {ord.mealPhotoCaption && (
                          <p className="text-zinc-800 bg-zinc-50 border border-zinc-100 rounded-lg px-2.5 py-1.5">
                            “{ord.mealPhotoCaption}”
                          </p>
                        )}

                        <div className="text-[11px] text-zinc-400 font-mono-tabular">
                          Uploaded {formatDateTime(ord.mealPhotoUploadedAt || ord.updatedAt || ord.createdAt)}
                          {ord.mealPhotoReviewedBy && status !== 'Pending Review'
                            ? ` · By ${ord.mealPhotoReviewedBy}`
                            : ''}
                        </div>
                      </div>
                    </div>

                    {canModerate && currentUser && (
                      <div className="px-4 py-3 bg-zinc-50 border-t border-zinc-200 flex flex-wrap items-center gap-1.5 text-xs">
                        <button
                          type="button"
                          disabled={busyId === ord.id || status === 'Reviewed'}
                          onClick={() => void handleReviewPhoto(ord, 'Reviewed')}
                          className={`px-2.5 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                            status === 'Reviewed'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-white border border-zinc-300 text-zinc-800 hover:border-emerald-400'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Reviewed</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId === ord.id || status === 'Featured'}
                          onClick={() => void handleReviewPhoto(ord, 'Featured')}
                          className={`px-2.5 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                            status === 'Featured'
                              ? 'bg-[#141518] text-[#D4AF37]'
                              : 'bg-white border border-zinc-300 text-zinc-800 hover:border-[#C59B27]'
                          }`}
                        >
                          <Sparkles className="w-3.5 h-3.5 text-[#9A7415]" />
                          <span>Feature</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId === ord.id || status === 'Flagged'}
                          onClick={() => void handleReviewPhoto(ord, 'Flagged')}
                          className={`px-2.5 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                            status === 'Flagged'
                              ? 'bg-red-50 text-red-700 border border-red-200'
                              : 'bg-white border border-zinc-300 text-red-600 hover:bg-red-50'
                          }`}
                        >
                          <Flag className="w-3.5 h-3.5" />
                          <span>Flag</span>
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {lightboxOrder && lightboxOrder.mealPhotoUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Meal photo for ${lightboxOrder.orderNumber}`}
          onClick={() => setLightboxOrder(null)}
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-white rounded-2xl overflow-hidden shadow-2xl"
          >
            <div className="px-5 py-3.5 bg-[#141518] text-white flex items-center justify-between">
              <div className="text-xs">
                <span className="font-mono-tabular font-bold text-sm text-[#D4AF37]">
                  {lightboxOrder.orderNumber}
                </span>{' '}
                · {lightboxOrder.guestName || 'Dining Guest'}
              </div>
              <button
                type="button"
                aria-label="Close photo preview"
                onClick={() => setLightboxOrder(null)}
                className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={lightboxOrder.mealPhotoUrl}
              alt={`Meal photo for ${lightboxOrder.orderNumber}`}
              className="w-full max-h-[70vh] object-contain bg-zinc-950"
            />
            {lightboxOrder.mealPhotoCaption && (
              <div className="px-5 py-3 text-xs text-zinc-700 border-t border-zinc-200">
                “{lightboxOrder.mealPhotoCaption}”
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Guest Feedback?"
        description={`Remove the review from ${deleteTarget?.guestName || 'Dining Guest'} permanently.`}
        confirmLabel="Delete Review"
        onConfirm={() => {
          if (deleteTarget) void deleteFeedback(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

