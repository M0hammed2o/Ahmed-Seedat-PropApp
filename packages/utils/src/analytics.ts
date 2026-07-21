/**
 * Privacy-conscious analytics abstraction (brief: never send document text, addresses, account
 * numbers, payment references, files, passwords, or biometric data). The payload types below
 * are structurally incapable of carrying those fields — extend the union, don't loosen a type,
 * if a new event is needed.
 */
export type AnalyticsEvent =
  | { name: 'registration_completed' }
  | { name: 'subscription_started'; planId: string }
  | { name: 'property_added'; propertyType: string }
  | { name: 'upload_started'; documentType: string }
  | { name: 'upload_completed'; documentType: string; durationMs: number }
  | { name: 'extraction_completed'; confidenceBucket: 'low' | 'medium' | 'high' }
  | { name: 'extraction_corrected'; fieldCount: number }
  | { name: 'payment_match_confirmed'; matchTier: 'strong' | 'possible' }
  | { name: 'search_performed'; resultCount: number }
  | { name: 'reminder_opened'; reminderType: string };

export interface AnalyticsSink {
  track(event: AnalyticsEvent): void;
}

export class NoopAnalyticsSink implements AnalyticsSink {
  track(_event: AnalyticsEvent): void {
    // Phase 1: no analytics backend wired yet. Intentionally a no-op, not a console.log of
    // user event data.
  }
}
