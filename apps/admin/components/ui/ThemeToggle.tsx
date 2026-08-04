'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';

// DESIGN_SYSTEM.md line 220's "explicit System/Light/Dark override" -- never had an
// implementation until dark mode itself was wired up (2026-08-02, UI_REDESIGN_PLAN.md). A
// three-way segmented control, not a binary switch -- "system" is a real, meaningful third state
// (the visitor's OS preference), not just a default that gets discarded the moment someone picks
// a side.

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const;

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  // next-themes resolves `theme` from localStorage/system only after mount -- rendering it
  // server-side or on the first client render would either mismatch hydration or flash the wrong
  // state, so this stays a neutral placeholder until mounted (next-themes' own documented pattern).
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  if (compact) {
    // Icon-only nav rail has no room for a 3-way control -- a single button cycling
    // light -> dark -> system, its icon and title always naming the *current* state.
    //
    // Real hydration bug found and fixed 2026-08-04 (Lovable-adoption batch): this branch never
    // guarded on `mounted` the way the non-compact branch below already does. `next-themes`
    // resolves `theme` from its no-FOUC inline script before React hydrates, so the client's
    // *first* render already knows the real theme -- but a Server Component render always has
    // `theme === undefined`. Picking `OPTIONS[1]` (System) as that undefined-theme fallback only
    // ever matched the client's first paint by coincidence, while `defaultTheme` was "system"
    // itself; changing the app default to "light" broke that coincidence and surfaced a real
    // server/client mismatch (server guessed System's Monitor icon, client immediately showed
    // Light's Sun icon) -- caught via a real dev-server hydration warning, not assumed. Fixed the
    // same way the non-compact branch already does it: stay on the neutral pre-mount fallback
    // until `mounted` is true, then switch to the real resolved theme.
    const current = mounted ? (OPTIONS.find((o) => o.value === theme) ?? OPTIONS[1]!) : OPTIONS[1]!;
    const nextValue = OPTIONS[(OPTIONS.indexOf(current) + 1) % OPTIONS.length]!.value;
    return (
      <button
        type="button"
        title={`Theme: ${current.label} (click for ${OPTIONS.find((o) => o.value === nextValue)!.label})`}
        onClick={() => setTheme(nextValue)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-light-textMuted hover:bg-light-surface hover:text-light-textSecondary dark:text-dark-textMuted dark:hover:bg-dark-surface dark:hover:text-dark-textSecondary"
      >
        <current.icon size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-md border border-light-border bg-light-surface p-0.5 dark:border-dark-border dark:bg-dark-surface"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
              selected
                ? 'bg-light-surfaceRaised text-light-textPrimary shadow-sm dark:bg-dark-surfaceRaised dark:text-dark-textPrimary'
                : 'text-light-textMuted hover:text-light-textSecondary dark:text-dark-textMuted dark:hover:text-dark-textSecondary'
            }`}
          >
            <Icon size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
