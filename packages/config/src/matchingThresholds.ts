/** See DECISIONS.md / PAYMENT-PROOF MATCHING in the brief for the reasoning behind these bands. */
export const MATCH_THRESHOLDS = {
  strong: 90,
  possible: 70,
} as const;

export type MatchTier = 'strong' | 'possible' | 'none';

export function tierForScore(score: number): MatchTier {
  if (score >= MATCH_THRESHOLDS.strong) return 'strong';
  if (score >= MATCH_THRESHOLDS.possible) return 'possible';
  return 'none';
}
