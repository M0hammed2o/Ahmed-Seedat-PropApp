/**
 * Static Phase 1 defaults. Phase 2 replaces this with a real `feature_flags` table read
 * (see DATABASE.md); the shape stays identical so callers don't change.
 */
export interface FeatureFlags {
  verifiedAutomaticPaymentMatching: boolean; // brief: must ship OFF, confirm-required flow only
  pushNotificationsEnabled: boolean;
  adminSupportDocumentAccess: boolean; // brief: disabled by default in V1
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  verifiedAutomaticPaymentMatching: false,
  pushNotificationsEnabled: false,
  adminSupportDocumentAccess: false,
};
