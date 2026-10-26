import type { ReactNode } from 'react';
import Link from 'next/link';

// KPI tile in the dashboard's own "panel" style (app/(dashboard)/dashboard/page.tsx stats row).
export function StatTile({
  label,
  value,
  foot,
  swatch,
  href,
  icon,
}: {
  label: string;
  value: ReactNode;
  foot?: string;
  swatch?: string;
  href?: string;
  icon?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        {swatch ? <span className={`h-2.5 w-2.5 rounded-sm ${swatch}`} aria-hidden="true" /> : null}
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="tabular mt-1.5 font-display text-[22px] font-bold leading-tight text-foreground">
        {value}
      </p>
      {foot ? <p className="mt-0.5 text-[11px] text-muted-foreground">{foot}</p> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="panel block p-4 transition-shadow hover:shadow-lift">
        {body}
      </Link>
    );
  }
  return <div className="panel p-4">{body}</div>;
}

export function DemoNotice({ children }: { children?: ReactNode }) {
  return (
    <div
      className="rounded-xl border border-warning/60 bg-warning/10 px-4 py-2.5 text-xs text-foreground"
      role="note"
    >
      <strong>Demonstration data.</strong>{' '}
      {children ??
        'Every person, grave site, sale, payment and burial in this cemetery is fictional. Payments are recorded as demonstration transactions — no money is taken, requested or sent, and no messages go to anyone.'}
    </div>
  );
}
