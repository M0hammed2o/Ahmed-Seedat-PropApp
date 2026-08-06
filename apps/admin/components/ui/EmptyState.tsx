import type { ReactNode } from 'react';

// DESIGN_SYSTEM.md "Empty states" -- reused from PropView's formula (icon badge -> headline ->
// subtext -> CTA, PROPVIEW_SCREENSHOT_AUDIT.md §5), modernized: the icon badge is tinted with the
// context's own semantic colour token (via `tone`) rather than a decorative pastel, and the CTA
// is omitted entirely for read-only/derived views instead of always being present.

export type EmptyStateTone =
  'neutral' | 'accent' | 'statusOverdue' | 'statusPaid' | 'statusNeedsReview';

const TONE_CLASSES: Record<EmptyStateTone, string> = {
  neutral: 'bg-light-border text-light-textMuted dark:bg-dark-border dark:text-dark-textMuted',
  accent: 'bg-light-accent/10 text-light-accent dark:bg-dark-accent/10 dark:text-dark-accent',
  statusOverdue:
    'bg-light-statusOverdue/10 text-light-statusOverdue dark:bg-dark-statusOverdue/10 dark:text-dark-statusOverdue',
  statusPaid:
    'bg-light-statusPaid/10 text-light-statusPaid dark:bg-dark-statusPaid/10 dark:text-dark-statusPaid',
  statusNeedsReview:
    'bg-light-statusNeedsReview/10 text-light-statusNeedsReview dark:bg-dark-statusNeedsReview/10 dark:text-dark-statusNeedsReview',
};

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  tone?: EmptyStateTone;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  tone = 'neutral',
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-full ${TONE_CLASSES[tone]}`}
      >
        {icon}
      </div>
      <h2 className="text-base font-semibold text-light-textPrimary dark:text-dark-textPrimary">
        {title}
      </h2>
      {description ? (
        <p className="max-w-sm text-sm text-light-textSecondary dark:text-dark-textSecondary">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
