import { create } from 'zustand';

// Zustand reserved for limited client-side UI state only (brief) — never business/entitlement
// state, which always comes from the server (Supabase/RevenueCat) via TanStack Query.
export type LockState = 'unlocked' | 'locked' | 'unknown';

interface AppState {
  lockState: LockState;
  onboardingStep: string;
  setLockState: (state: LockState) => void;
  setOnboardingStep: (step: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  lockState: 'unknown',
  onboardingStep: 'welcome',
  setLockState: (lockState) => set({ lockState }),
  setOnboardingStep: (onboardingStep) => set({ onboardingStep }),
}));
