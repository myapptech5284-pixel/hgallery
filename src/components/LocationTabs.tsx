import React from 'react';
import { Store, BookOpen, Wrench } from 'lucide-react';
import { LocationType, LOCATION_TYPES, LOCATION_LABEL, LOCATION_ACTIVE } from '../types.ts';

interface LocationTabsProps {
  activeLocation: LocationType;
  onLocationChange: (loc: LocationType) => void;
  /**
   * Builds the button caption for a branch, e.g.
   *   (loc) => `مخزون ${LOCATION_LABEL[loc]}`
   */
  label: (loc: LocationType) => string;
  className?: string;
}

/**
 * Branch switcher.
 *
 * Every branch gets a button, driven by LOCATION_TYPES in types.ts — so a
 * fourth branch would appear here automatically, with the right colour and
 * the right caption, without touching this file.
 */
export const LocationTabs: React.FC<LocationTabsProps> = ({
  activeLocation,
  onLocationChange,
  label,
  className = 'flex items-center bg-slate-200/80 p-1 rounded-xl',
}) => {
  return (
    <div className={className}>
      {LOCATION_TYPES.map((loc) => (
        <button
          key={loc}
          onClick={() => onLocationChange(loc)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeLocation === loc ? LOCATION_ACTIVE[loc] : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {loc === 'gallery' ? (
            <Store className="w-3.5 h-3.5" />
          ) : loc === 'stationery' ? (
            <BookOpen className="w-3.5 h-3.5" />
          ) : (
            <Wrench className="w-3.5 h-3.5" />
          )}
          <span>{label(loc)}</span>
        </button>
      ))}
    </div>
  );
};
