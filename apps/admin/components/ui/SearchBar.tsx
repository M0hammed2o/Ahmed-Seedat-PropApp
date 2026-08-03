'use client';

import { Search } from 'lucide-react';

// Shared search-input styling, extracted from UnitsFilterClient so every list's filter wrapper
// (PWA_V1_COMPLETION_PLAN.md #6) renders an identical box instead of 12 copies of the same markup.
export function SearchBar({
  value,
  onChange,
  placeholder,
  className = 'max-w-sm',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-light-textMuted dark:text-dark-textMuted"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-xl border border-light-border bg-light-surface pr-3 pl-9 text-[13px] text-light-textPrimary outline-none focus:border-light-accent/40 focus:bg-light-surfaceRaised focus:ring-4 focus:ring-light-accent/10 dark:border-dark-border dark:bg-dark-surface dark:text-dark-textPrimary dark:focus:border-dark-accent/40 dark:focus:bg-dark-surfaceRaised dark:focus:ring-dark-accent/10"
      />
    </div>
  );
}
