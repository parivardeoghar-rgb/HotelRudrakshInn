import React from 'react';
import { MessageSquareHeart, Star } from 'lucide-react';
import type { Feedback } from '../types';
import { formatDateTime } from '../utils/format';

interface FeedbackViewProps {
  feedback: Feedback[];
}

export const FeedbackView: React.FC<FeedbackViewProps> = ({ feedback }) => {
  const avg = (key: 'foodRating' | 'serviceRating' | 'ambianceRating' | 'overallRating') => {
    if (feedback.length === 0) return '0.0';
    return (feedback.reduce((s, f) => s + f[key], 0) / feedback.length).toFixed(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold text-zinc-900">
          Guest Ratings & Dining Feedback
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Consent-based review workflow · {feedback.length} guest responses recorded
        </p>
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
          Guest reviews submitted through the QR Table Menu will appear here.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {feedback.map((fb) => (
            <div key={fb.id} className="bg-white border border-zinc-200 rounded-xl p-5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <div className="font-bold text-zinc-900">
                  {fb.guestName || 'Dining Guest'}{' '}
                  {fb.tableNumber ? `· Table ${fb.tableNumber}` : ''}
                </div>
                <span className="font-mono-tabular text-zinc-500">
                  {formatDateTime(fb.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-600">
                <span>Food: {fb.foodRating}/5</span>
                <span aria-hidden="true">·</span>
                <span>Service: {fb.serviceRating}/5</span>
                <span aria-hidden="true">·</span>
                <span>Ambiance: {fb.ambianceRating}/5</span>
              </div>
              {fb.comment && (
                <p className="text-sm text-zinc-700 leading-relaxed pt-1">{fb.comment}</p>
              )}
              <div className="text-[11px] text-zinc-500 pt-1">
                Google Review Opt-In: {fb.googleConsent ? 'Consented' : 'Internal Only'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
