import React, { useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';

interface DishImageProps {
  src?: string;
  alt: string;
  className?: string;
}

export const DishImage: React.FC<DishImageProps> = ({ src, alt, className = '' }) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#1C1E22] via-[#262930] to-[#141518] text-[#D4AF37]/80 p-3 text-center select-none ${className}`}
        aria-label={alt}
      >
        <UtensilsCrossed className="w-6 h-6 mb-1.5 opacity-80" />
        <span className="text-[11px] font-medium text-zinc-300 line-clamp-2 max-w-[140px]">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
};
