import type { StatusPresentation } from '@propvault/ui';

// Renders a packages/ui StatusPresentation consistently -- colour dot + label, never colour alone
// (DESIGN_SYSTEM.md's accessibility rule), matching HealthStatusIndicator's established dot+label
// pattern rather than introducing an icon-glyph dependency this codebase doesn't have yet.

const BG_CLASSES: Record<StatusPresentation['colorToken'], string> = {
  statusPaid: 'bg-light-statusPaid dark:bg-dark-statusPaid',
  statusUnpaid: 'bg-light-statusUnpaid dark:bg-dark-statusUnpaid',
  statusOverdue: 'bg-light-statusOverdue dark:bg-dark-statusOverdue',
  statusNeedsReview: 'bg-light-statusNeedsReview dark:bg-dark-statusNeedsReview',
  statusProcessing: 'bg-light-statusProcessing dark:bg-dark-statusProcessing',
  statusDisputed: 'bg-light-statusDisputed dark:bg-dark-statusDisputed',
  statusVoid: 'bg-light-statusVoid dark:bg-dark-statusVoid',
};

const TEXT_CLASSES: Record<StatusPresentation['colorToken'], string> = {
  statusPaid: 'text-light-statusPaid dark:text-dark-statusPaid',
  statusUnpaid: 'text-light-statusUnpaid dark:text-dark-statusUnpaid',
  statusOverdue: 'text-light-statusOverdue dark:text-dark-statusOverdue',
  statusNeedsReview: 'text-light-statusNeedsReview dark:text-dark-statusNeedsReview',
  statusProcessing: 'text-light-statusProcessing dark:text-dark-statusProcessing',
  statusDisputed: 'text-light-statusDisputed dark:text-dark-statusDisputed',
  statusVoid: 'text-light-statusVoid dark:text-dark-statusVoid',
};

export function StatusBadge({ presentation }: { presentation: StatusPresentation }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${TEXT_CLASSES[presentation.colorToken]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${BG_CLASSES[presentation.colorToken]}`} />
      {presentation.label}
    </span>
  );
}
