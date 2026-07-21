/**
 * Pure, dependency-free lock state machine (no React/Expo imports) so it can be unit tested in
 * isolation — the React/AppState/expo-local-authentication glue lives in BiometricLockProvider.
 *
 * Rules encoded here, straight from the brief:
 * - Biometric unlock only unlocks an already-authenticated session — it never establishes one.
 * - Locks when the app returns from background after the configured inactivity timeout.
 * - Requires full account authentication (not just biometrics) after logout, password reset,
 *   or an invalidated session — modelled as `requiresFullAuth`.
 */
export type LockPhase = 'unlocked' | 'locked';

export interface LockState {
  phase: LockPhase;
  requiresFullAuth: boolean;
  backgroundedAtMs: number | null;
}

export type LockEvent =
  | { type: 'APP_BACKGROUNDED'; atMs: number }
  | { type: 'APP_FOREGROUNDED'; atMs: number }
  | { type: 'BIOMETRIC_UNLOCK_SUCCESS' }
  | { type: 'BIOMETRIC_UNLOCK_FAILURE' }
  | { type: 'FULL_AUTH_SUCCESS' }
  | { type: 'SESSION_INVALIDATED' }; // logout, password reset, or a detected invalid session

export interface LockConfig {
  biometricEnabled: boolean;
  timeoutSeconds: number;
}

export const initialLockState: LockState = {
  phase: 'unlocked',
  requiresFullAuth: false,
  backgroundedAtMs: null,
};

export function reduceLockState(state: LockState, event: LockEvent, config: LockConfig): LockState {
  switch (event.type) {
    case 'APP_BACKGROUNDED':
      return { ...state, backgroundedAtMs: event.atMs };

    case 'APP_FOREGROUNDED': {
      if (state.backgroundedAtMs === null) return state;
      const elapsedSeconds = (event.atMs - state.backgroundedAtMs) / 1000;
      const shouldLock = config.biometricEnabled && elapsedSeconds >= config.timeoutSeconds;
      return {
        ...state,
        backgroundedAtMs: null,
        phase: shouldLock ? 'locked' : state.phase,
      };
    }

    case 'BIOMETRIC_UNLOCK_SUCCESS':
      if (state.requiresFullAuth) return state; // biometrics cannot clear a full-auth requirement
      return { ...state, phase: 'unlocked' };

    case 'BIOMETRIC_UNLOCK_FAILURE':
      return state; // stays locked; caller decides on retry/fallback UX

    case 'FULL_AUTH_SUCCESS':
      return { ...state, phase: 'unlocked', requiresFullAuth: false };

    case 'SESSION_INVALIDATED':
      return { ...state, phase: 'locked', requiresFullAuth: true };

    default:
      return state;
  }
}
