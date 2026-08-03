// Adapted from reference/lovable-ui-reference's kit.tsx `Meter` (UI_INTEGRATION_PLAN.md) -- a
// thin progress/proportion bar for occupancy, completion, and similar real percentages. Never
// used for a fabricated or estimated value; the caller always passes a real computed ratio.

export type MeterTone = 'primary' | 'success' | 'warning' | 'destructive';

const TONE_CLASSES: Record<MeterTone, string> = {
  primary: 'bg-light-accent dark:bg-dark-accent',
  success: 'bg-light-statusPaid dark:bg-dark-statusPaid',
  warning: 'bg-light-statusNeedsReview dark:bg-dark-statusNeedsReview',
  destructive: 'bg-light-statusOverdue dark:bg-dark-statusOverdue',
};

export function Meter({ value, tone = 'primary' }: { value: number; tone?: MeterTone }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-pill bg-light-surfaceStrong dark:bg-dark-surfaceStrong">
      <div
        className={`h-full rounded-pill transition-all ${TONE_CLASSES[tone]}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
