'use client';

import { useState, type ReactNode } from 'react';

// Minimal client-side tab switcher matching reference/lovable-ui-reference's shadcn Tabs visual
// treatment (2026-08-04 Lovable-adoption batch, UI_INTEGRATION_PLAN.md) without pulling in
// Radix's tabs primitive as a new dependency for one page -- plain useState, no new package,
// same visual result (pill-style TabsList, active tab in a raised card).
export function SimpleTabs({
  tabs,
  defaultTab,
}: {
  tabs: { label: string; content: ReactNode }[];
  defaultTab?: string;
}) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.label ?? '');
  const activeTab = tabs.find((t) => t.label === active) ?? tabs[0];

  return (
    <div className="space-y-4">
      <div className="scrollbar-slim flex h-auto w-full items-center gap-1 overflow-x-auto rounded-xl bg-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setActive(t.label)}
            aria-current={t.label === active}
            className={`shrink-0 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              t.label === active
                ? 'bg-card text-foreground shadow-card'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {activeTab ? <div>{activeTab.content}</div> : null}
    </div>
  );
}
