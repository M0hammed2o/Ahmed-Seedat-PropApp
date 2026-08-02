import type { LucideIcon } from 'lucide-react';

// Small helper so every layout.tsx doesn't repeat the same size/stroke/aria props per icon.
// Returns a rendered element, never the component reference itself -- see AppShell.tsx's own
// comment on why that distinction is load-bearing (a raw reference can't cross the Server
// Component -> Client Component boundary; a rendered element can).
export function navIcon(Icon: LucideIcon) {
  return <Icon size={17} strokeWidth={2} aria-hidden="true" className="shrink-0" />;
}
