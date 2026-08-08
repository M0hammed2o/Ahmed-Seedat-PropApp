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
  biometricLabel: string;
  setBiometricEnabled: (enabled: boolean) => void;
  enableBiometricLock: () => Promise<{ success: boolean; message?: string }>;
  attemptBiometricUnlock: () => Promise<boolean>;
  completeFullAuth: () => void;
  invalidateSession: () => void;
}

const BiometricLockContext = createContext<BiometricLockContextValue | null>(null);

/**
 * Wraps the pure state machine with OS calls. Biometrics protect local app access only; the
 * backend remains responsible for identity and authorization.
 */
export function BiometricLockProvider({ children }: { children: React.ReactNode }) {
  const [biometricEnabled, setBiometricEnabled] = React.useState(false);
  const [biometricLabel, setBiometricLabel] = React.useState('biometrics');
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
      if (nextState === 'background') dispatch({ type: 'APP_BACKGROUNDED', atMs });
      else if (nextState === 'active') dispatch({ type: 'APP_FOREGROUNDED', atMs });
    };
    const subscription = AppState.addEventListener('change', handleChange);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    void LocalAuthentication.supportedAuthenticationTypesAsync()
      .then((types) => {
        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) setBiometricLabel('Face ID');
        else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) setBiometricLabel('Touch ID');
      })
      .catch(() => setBiometricLabel('biometrics'));
  }, []);

  const enableBiometricLock = useCallback(async () => {
    try {
      if (!(await LocalAuthentication.hasHardwareAsync())) {
        return { success: false, message: 'Biometric unlock is not available on this device.' };
      }
      if (!(await LocalAuthentication.isEnrolledAsync())) {
        return { success: false, message: `Set up ${biometricLabel} in device settings before enabling it in Proplyst.` };
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Enable ${biometricLabel} for Proplyst`,
        cancelLabel: 'Not now',
        fallbackLabel: 'Use device passcode',
        disableDeviceFallback: false,
      });
      if (!result.success) {
        return { success: false, message: `${biometricLabel} was not enabled. You can try again or continue without it.` };
      }
      setBiometricEnabled(true);
      return { success: true };
    } catch {
      return { success: false, message: `Proplyst could not check ${biometricLabel} on this device.` };
    }
  }, [biometricLabel]);

  const attemptBiometricUnlock = useCallback(async (): Promise<boolean> => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        dispatch({ type: 'BIOMETRIC_UNLOCK_FAILURE' });
        return false;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Proplyst',
        cancelLabel: 'Cancel',
        fallbackLabel: 'Use device passcode',
        disableDeviceFallback: false,
      });
      dispatch({ type: result.success ? 'BIOMETRIC_UNLOCK_SUCCESS' : 'BIOMETRIC_UNLOCK_FAILURE' });
      return result.success;
    } catch {
      dispatch({ type: 'BIOMETRIC_UNLOCK_FAILURE' });
      return false;
    }
  }, []);

  const completeFullAuth = useCallback(() => dispatch({ type: 'FULL_AUTH_SUCCESS' }), []);
  const invalidateSession = useCallback(() => dispatch({ type: 'SESSION_INVALIDATED' }), []);

  const value = useMemo(
    () => ({
      lockState,
      biometricEnabled,
      biometricLabel,
      setBiometricEnabled,
      enableBiometricLock,
      attemptBiometricUnlock,
      completeFullAuth,
      invalidateSession,
    }),
    [lockState, biometricEnabled, biometricLabel, enableBiometricLock, attemptBiometricUnlock, completeFullAuth, invalidateSession],
  );

  return <BiometricLockContext.Provider value={value}>{children}</BiometricLockContext.Provider>;
}

export function useBiometricLock(): BiometricLockContextValue {
  const context = useContext(BiometricLockContext);
  if (!context) throw new Error('useBiometricLock must be used within BiometricLockProvider');
  return context;
}
