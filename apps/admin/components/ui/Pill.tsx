import type { ReactNode } from 'react';

// Adapted from reference/lovable-ui-reference's kit.tsx `Pill` (UI_INTEGRATION_PLAN.md) -- a
// generic tone badge for contexts StatusBadge's fixed StatusPresentation set doesn't cover (filter
// chips, counts, ad hoc labels). Reuses existing DESIGN_SYSTEM.md status tokens for tone colour
// rather than introducing a second colour vocabulary.

export type PillTone = 'neutral' | 'primary' | 'success' | 'warning' | 'destructive' | 'info';

const TONE_CLASSES: Record<PillTone, string> = {
  neutral: 'bg-light-surfaceStrong text-light-textSecondary dark:bg-dark-surfaceStrong dark:text-dark-textSecondary',
  primary: 'bg-light-accentSoft text-light-accent dark:bg-dark-accentSoft dark:text-dark-accent',
  success: 'bg-light-statusPaid/12 text-light-statusPaid dark:bg-dark-statusPaid/12 dark:text-dark-statusPaid',
  warning:
    'bg-light-statusNeedsReview/16 text-light-statusNeedsReview dark:bg-dark-statusNeedsReview/16 dark:text-dark-statusNeedsReview',
  destructive: 'bg-light-statusOverdue/12 text-light-statusOverdue dark:bg-dark-statusOverdue/12 dark:text-dark-statusOverdue',
  info: 'bg-light-statusProcessing/12 text-light-statusProcessing dark:bg-dark-statusProcessing/12 dark:text-dark-statusProcessing',
};

export function Pill({
  children,
  tone = 'neutral',
  dot,
  className = '',
}: {
  children: ReactNode;
  tone?: PillTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1 text-[11px] font-medium ${TONE_CLASSES[tone]} ${className}`}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
