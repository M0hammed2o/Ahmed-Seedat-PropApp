import { initialLockState, reduceLockState, type LockConfig } from '../lockStateMachine';

const config: LockConfig = { biometricEnabled: true, timeoutSeconds: 60 };

describe('reduceLockState', () => {
  it('does not lock when foregrounded before the timeout elapses', () => {
    let state = reduceLockState(initialLockState, { type: 'APP_BACKGROUNDED', atMs: 0 }, config);
    state = reduceLockState(state, { type: 'APP_FOREGROUNDED', atMs: 30_000 }, config);
    expect(state.phase).toBe('unlocked');
  });

  it('locks when foregrounded after the timeout elapses', () => {
    let state = reduceLockState(initialLockState, { type: 'APP_BACKGROUNDED', atMs: 0 }, config);
    state = reduceLockState(state, { type: 'APP_FOREGROUNDED', atMs: 61_000 }, config);
    expect(state.phase).toBe('locked');
  });

  it('never locks on background/foreground when biometrics are disabled', () => {
    const disabledConfig: LockConfig = { biometricEnabled: false, timeoutSeconds: 60 };
    let state = reduceLockState(
      initialLockState,
      { type: 'APP_BACKGROUNDED', atMs: 0 },
      disabledConfig,
    );
    state = reduceLockState(state, { type: 'APP_FOREGROUNDED', atMs: 999_999 }, disabledConfig);
    expect(state.phase).toBe('unlocked');
  });

  it('unlocks on successful biometric unlock', () => {
    const locked = { phase: 'locked' as const, requiresFullAuth: false, backgroundedAtMs: null };
    const state = reduceLockState(locked, { type: 'BIOMETRIC_UNLOCK_SUCCESS' }, config);
    expect(state.phase).toBe('unlocked');
  });

  it('stays locked on failed biometric unlock', () => {
    const locked = { phase: 'locked' as const, requiresFullAuth: false, backgroundedAtMs: null };
    const state = reduceLockState(locked, { type: 'BIOMETRIC_UNLOCK_FAILURE' }, config);
    expect(state.phase).toBe('locked');
  });

  it('requires full auth after session invalidation, and biometrics alone cannot clear it', () => {
    let state = reduceLockState(initialLockState, { type: 'SESSION_INVALIDATED' }, config);
    expect(state.phase).toBe('locked');
    expect(state.requiresFullAuth).toBe(true);

    // Biometric success must NOT unlock a session that requires full re-authentication.
    state = reduceLockState(state, { type: 'BIOMETRIC_UNLOCK_SUCCESS' }, config);
    expect(state.phase).toBe('locked');

    state = reduceLockState(state, { type: 'FULL_AUTH_SUCCESS' }, config);
    expect(state.phase).toBe('unlocked');
    expect(state.requiresFullAuth).toBe(false);
  });
});
