'use client';

import { Printer } from 'lucide-react';

export function PrintButton({ label = 'Print / save as PDF' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-surface print:hidden"
    >
      <Printer className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </button>
  );
}
