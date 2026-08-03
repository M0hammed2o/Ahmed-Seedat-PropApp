import type { ReactNode } from 'react';

// Elevated card container (UI_REDESIGN_PLAN.md design foundation) -- the redesign's basic content
// block: rounded-card corners, hairline border, soft layered shadow, optional header with a
// title/description/actions row. Replaces the ad hoc `rounded-lg border p-4/p-5` divs scattered
// through the pre-redesign pages with one consistent shape.
export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = 'p-5',
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-card border border-light-border bg-light-surfaceRaised shadow-card dark:border-dark-border dark:bg-dark-surfaceRaised ${className}`}
    >
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-light-border px-5 py-4 dark:border-dark-border">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-light-textPrimary dark:text-dark-textPrimary">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 truncate text-xs text-light-textMuted dark:text-dark-textMuted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
