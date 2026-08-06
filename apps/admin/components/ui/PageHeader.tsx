import type { ReactNode } from 'react';

// Shared page-header shape (UI_REDESIGN_PLAN.md design foundation) -- title + optional subtitle
// on the left, primary/secondary actions on the right, wrapping to a new line below the title on
// narrow widths rather than overflowing. Every redesigned page uses this instead of a one-off
// `<h1>` + ad hoc button row.
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate font-display text-2xl font-bold text-light-textPrimary sm:text-[28px] dark:text-dark-textPrimary">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-light-textSecondary dark:text-dark-textSecondary">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
