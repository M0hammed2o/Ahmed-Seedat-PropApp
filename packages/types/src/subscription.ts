import type { SubscriptionStatus } from './enums';

export type SubscriptionPlatform = 'ios' | 'android' | 'mock';

export interface Subscription {
  id: string;
  ownerUserId: string;
  planId: string;
  status: SubscriptionStatus;
  platform: SubscriptionPlatform;
  productIdentifier: string | null;
  revenueCatCustomerId: string | null;
  originalPurchaseDate: string | null;
  renewalOrExpiryDate: string | null;
  cancellationReason: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionEvent {
  id: string;
  ownerUserId: string;
  eventType: string;
  idempotencyKey: string;
  rawPayload: unknown;
  createdAt: string;
}

export type EntitlementFeature =
  'add_property' | 'upload_document' | 'ocr_processing' | 'payment_matching' | 'reminders';

export interface PlanLimits {
  maxProperties: number;
  storageAllowanceMb: number;
  maxFileSizeMb: number;
  ocrPagesPerMonth: number;
}

export interface PlanConfig {
  planId: string;
  displayName: string;
  monthlyPrice: string; // placeholder currency string, e.g. "TO_BE_CONFIRMED"
  annualPrice: string | null;
  trialDays: string;
  limits: PlanLimits;
}
