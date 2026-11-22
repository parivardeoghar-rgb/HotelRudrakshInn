import React from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { DIETARY_TAG_OPTIONS, type DietaryTag } from '../types';

interface DietaryPreferenceFieldProps {
  value: DietaryTag[];
  onChange: (next: DietaryTag[]) => void;
  compact?: boolean;
}

export const DietaryPreferenceField: React.FC<DietaryPreferenceFieldProps> = ({
  value,
  onChange,
  compact = false,
}) => {
  const toggle = (tag: DietaryTag) => {
    if (value.includes(tag)) {
      onChange(value.filter((t) => t !== tag));
    } else {
      onChange([...value, tag]);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="block text-xs font-semibold text-zinc-700">
          Dietary &amp; Allergy Preferences (Optional)
        </span>
        {value.length > 0 && (
          <span className="text-[11px] font-medium text-emerald-800">
            Kitchen tag: {value.join(' · ')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {DIETARY_TAG_OPTIONS.map((opt) => {
          const active = value.includes(opt.id);
          const isAllergy = opt.id === 'Nut allergy';
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(opt.id)}
              className={`px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer flex items-start gap-2.5 ${
                active
                  ? isAllergy
                    ? 'bg-rose-50 border-rose-500 text-rose-950'
                    : 'bg-emerald-50 border-emerald-700 text-emerald-950'
                  : 'bg-white border-zinc-300 text-zinc-700 hover:border-zinc-400'
              }`}
            >
              <span className="mt-0.5 shrink-0">
                {isAllergy ? (
                  <AlertTriangle
                    className={`w-4 h-4 ${active ? 'text-rose-600' : 'text-zinc-400'}`}
                  />
                ) : (
                  <Check
                    className={`w-4 h-4 ${active ? 'text-emerald-700' : 'text-zinc-400'}`}
                  />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold leading-tight whitespace-nowrap">
                  {opt.label}
                </span>
                {!compact && (
                  <span className="block text-[11px] opacity-80 mt-0.5 leading-snug">
                    {opt.hint}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
