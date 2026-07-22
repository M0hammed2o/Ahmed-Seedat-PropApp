import { create } from 'zustand';

// Zustand reserved for limited client-side UI state only (brief) — never business/entitlement
// state, which always comes from the server (Supabase/RevenueCat) via TanStack Query.
export type LockState = 'unlocked' | 'locked' | 'unknown';
export type ColorSchemeOverride = 'system' | 'light' | 'dark';

interface AppState {
  lockState: LockState;
  onboardingStep: string;
  colorSchemeOverride: ColorSchemeOverride;
  notificationsEnabled: boolean;
  setLockState: (state: LockState) => void;
  setOnboardingStep: (step: string) => void;
  setColorSchemeOverride: (value: ColorSchemeOverride) => void;
  setNotificationsEnabled: (value: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  lockState: 'unknown',
  onboardingStep: 'welcome',
  colorSchemeOverride: 'system',
  notificationsEnabled: true,
  setLockState: (lockState) => set({ lockState }),
  setOnboardingStep: (onboardingStep) => set({ onboardingStep }),
  setColorSchemeOverride: (colorSchemeOverride) => set({ colorSchemeOverride }),
  setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
}));
