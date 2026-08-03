import type { ReactNode } from 'react';
import Link from 'next/link';

export interface AdminMetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  /** Optional leading icon (already-rendered element, e.g. <Building2 size={16} />) -- matches
   * the evidenced "Key numbers" card shape (PROPVIEW_SCREENSHOT_AUDIT.md IMG_7987): icon, then a
   * large value, then label/hint. Purely additive -- every existing caller with no icon renders
   * exactly as before. */
  icon?: ReactNode;
  /** Optional link target -- when present, the whole card is clickable through to detail,
   * matching the evidenced trailing-arrow "drill into this number" pattern. */
  href?: string;
}

export function AdminMetricCard({ label, value, hint, icon, href }: AdminMetricCardProps) {
  const classes = `rounded-lg border border-light-border bg-light-surfaceRaised p-5 transition-colors dark:border-dark-border dark:bg-dark-surfaceRaised${href ? ' hover:border-light-accent dark:hover:border-dark-accent' : ''}`;

  const inner = (
    <>
      <div className="flex items-center justify-between">
        {icon ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-light-accent/10 text-light-accent dark:bg-dark-accent/10 dark:text-dark-accent">
            {icon}
          </span>
        ) : (
          <p className="text-xs uppercase tracking-wide text-light-textMuted dark:text-dark-textMuted">{label}</p>
        )}
        {href ? (
          <span className="text-light-textMuted dark:text-dark-textMuted" aria-hidden="true">
            →
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-semibold text-light-textPrimary dark:text-dark-textPrimary">{value}</p>
      {icon ? (
        <p className="mt-1 text-xs uppercase tracking-wide text-light-textMuted dark:text-dark-textMuted">{label}</p>
      ) : null}
      {hint ? (
        <p className="mt-1 text-xs text-light-textSecondary dark:text-dark-textSecondary">{hint}</p>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {inner}
      </Link>
    );
  }
  return <div className={classes}>{inner}</div>;
}
