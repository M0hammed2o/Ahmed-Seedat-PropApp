import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { BIOMETRIC_LOCK_DEFAULT_TIMEOUT_SECONDS } from '@propvault/config';
import {
  initialLockState,
  reduceLockState,
  type LockConfig,
  type LockState,
} from './lockStateMachine';

interface BiometricLockContextValue {
  lockState: LockState;
  biometricEnabled: boolean;
  setBiometricEnabled: (enabled: boolean) => void;
  attemptBiometricUnlock: () => Promise<boolean>;
  completeFullAuth: () => void;
  invalidateSession: () => void;
}

const BiometricLockContext = createContext<BiometricLockContextValue | null>(null);

/**
 * Wraps the pure state machine with the actual OS calls. Gracefully handles devices without
 * biometrics (brief requirement): `attemptBiometricUnlock` simply reports unavailable rather
 * than throwing, and callers fall back to a password/full-auth prompt.
 */
export function BiometricLockProvider({ children }: { children: React.ReactNode }) {
  const [biometricEnabled, setBiometricEnabled] = React.useState(false);
  const [lockState, dispatch] = useReducer(
    (state: LockState, event: Parameters<typeof reduceLockState>[1]) =>
      reduceLockState(state, event, config.current),
    initialLockState,
  );

  const config = useRef<LockConfig>({
    biometricEnabled,
    timeoutSeconds: BIOMETRIC_LOCK_DEFAULT_TIMEOUT_SECONDS,
  });
  config.current.biometricEnabled = biometricEnabled;

  useEffect(() => {
    const handleChange = (nextState: AppStateStatus) => {
      const atMs = Date.now();
      if (nextState === 'background') {
        dispatch({ type: 'APP_BACKGROUNDED', atMs });
      } else if (nextState === 'active') {
        dispatch({ type: 'APP_FOREGROUNDED', atMs });
      }
    };
    const sub = AppState.addEventListener('change', handleChange);
    return () => sub.remove();
  }, []);

  const attemptBiometricUnlock = useCallback(async (): Promise<boolean> => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHardware || !isEnrolled) {
      // Device without biometrics configured — handled gracefully, caller shows full-auth UI.
      dispatch({ type: 'BIOMETRIC_UNLOCK_FAILURE' });
      return false;
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock PropVault',
      disableDeviceFallback: false, // system passcode fallback is acceptable per the brief
    });
    dispatch({ type: result.success ? 'BIOMETRIC_UNLOCK_SUCCESS' : 'BIOMETRIC_UNLOCK_FAILURE' });
    return result.success;
  }, []);

  const completeFullAuth = useCallback(() => dispatch({ type: 'FULL_AUTH_SUCCESS' }), []);
  const invalidateSession = useCallback(() => dispatch({ type: 'SESSION_INVALIDATED' }), []);

  const value = useMemo(
    () => ({
      lockState,
      biometricEnabled,
      setBiometricEnabled,
      attemptBiometricUnlock,
      completeFullAuth,
      invalidateSession,
    }),
    [lockState, biometricEnabled, attemptBiometricUnlock, completeFullAuth, invalidateSession],
  );

  return <BiometricLockContext.Provider value={value}>{children}</BiometricLockContext.Provider>;
}

export function useBiometricLock(): BiometricLockContextValue {
  const ctx = useContext(BiometricLockContext);
  if (!ctx) throw new Error('useBiometricLock must be used within BiometricLockProvider');
  return ctx;
}
