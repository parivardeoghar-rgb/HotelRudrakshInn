import React, { useState } from 'react';
import { CheckCircle2, EyeOff, MessageSquareHeart, Star, Trash2 } from 'lucide-react';
import { deleteFeedback, setFeedbackApproval } from '../services/firestoreService';
import type { Feedback } from '../types';
import { formatDateTime } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';

interface FeedbackViewProps {
  feedback: Feedback[];
  canModerate?: boolean;
}

export const FeedbackView: React.FC<FeedbackViewProps> = ({
  feedback,
  canModerate = true,
}) => {
  const [deleteTarget, setDeleteTarget] = useState<Feedback | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const avg = (key: 'foodRating' | 'serviceRating' | 'ambianceRating' | 'overallRating') => {
    if (feedback.length === 0) return '0.0';
    return (feedback.reduce((s, f) => s + f[key], 0) / feedback.length).toFixed(1);
  };

  const approvedCount = feedback.filter((f) => Boolean(f.approved)).length;

  const handleToggleApproval = async (fb: Feedback) => {
    setBusyId(fb.id);
    try {
      await setFeedbackApproval(fb.id, !fb.approved);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold text-zinc-900">
            Guest Ratings & Homepage Reviews
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {feedback.length} guest responses recorded · {approvedCount} published on customer homepage
          </p>
        </div>
      </div>

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
