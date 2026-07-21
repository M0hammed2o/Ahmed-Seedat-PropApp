import type { BillStatus } from '@propvault/types';

/**
 * Status is never signalled by colour alone (accessibility requirement in the brief) — every
 * consumer of this map also renders `label` and `icon`, colour is a third reinforcing signal.
 */
export interface StatusPresentation {
  label: string;
  icon: 'check' | 'dot' | 'alert-triangle' | 'eye' | 'spinner' | 'flag' | 'slash';
  colorToken:
    | 'statusPaid'
    | 'statusUnpaid'
    | 'statusOverdue'
    | 'statusNeedsReview'
    | 'statusProcessing'
    | 'statusDisputed'
    | 'statusVoid';
}

export const BILL_STATUS_PRESENTATION: Record<BillStatus, StatusPresentation> = {
  paid: { label: 'Paid', icon: 'check', colorToken: 'statusPaid' },
  unpaid: { label: 'Unpaid', icon: 'dot', colorToken: 'statusUnpaid' },
  partially_paid: { label: 'Partially paid', icon: 'dot', colorToken: 'statusNeedsReview' },
  overdue: { label: 'Overdue', icon: 'alert-triangle', colorToken: 'statusOverdue' },
  needs_review: { label: 'Needs review', icon: 'eye', colorToken: 'statusNeedsReview' },
  processing: { label: 'Processing', icon: 'spinner', colorToken: 'statusProcessing' },
  disputed: { label: 'Disputed', icon: 'flag', colorToken: 'statusDisputed' },
  void: { label: 'Void', icon: 'slash', colorToken: 'statusVoid' },
};
