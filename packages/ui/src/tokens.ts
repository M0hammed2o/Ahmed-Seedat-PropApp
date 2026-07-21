/**
 * Central design tokens (see DESIGN_SYSTEM.md). Every value here is an explicitly documented
 * placeholder — swap freely for final branding without touching component code, since
 * components should only ever reference these semantic names, never a raw hex/px value.
 */

export const colorLight = {
  surface: '#FBFAF7',
  surfaceRaised: '#FFFFFF',
  border: '#E5E2DA',
  textPrimary: '#12151A',
  textSecondary: '#5B6068',
  textMuted: '#8A8F97',
  accent: '#2F5D50',
  accentContrast: '#FFFFFF',
  statusPaid: '#2F6D4C',
  statusUnpaid: '#8A8F97',
  statusOverdue: '#B3432B',
  statusNeedsReview: '#B08900',
  statusProcessing: '#3B6FA0',
  statusDisputed: '#8A3B8F',
  statusVoid: '#5B6068',
  danger: '#B3432B',
} as const;

export const colorDark = {
  surface: '#14161A',
  surfaceRaised: '#1D2025',
  border: '#2C2F35',
  textPrimary: '#F2F1ED',
  textSecondary: '#B7BBC2',
  textMuted: '#82868D',
  accent: '#5B9683',
  accentContrast: '#0C1210',
  statusPaid: '#5FAE81',
  statusUnpaid: '#82868D',
  statusOverdue: '#E08064',
  statusNeedsReview: '#E0BB55',
  statusProcessing: '#7CA9D6',
  statusDisputed: '#C589C9',
  statusVoid: '#82868D',
  danger: '#E08064',
} as const;

export type ColorTokens = typeof colorLight;

export const spacing = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;

export const radii = { sm: 4, md: 8, lg: 12, xl: 16, pill: 999 } as const;

export const typeScale = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
} as const;

export const motionDuration = { fast: 120, base: 200, slow: 320 } as const;

export const iconSize = { sm: 16, md: 20, lg: 24, xl: 32 } as const;

export const elevation = {
  none: 0,
  low: 1,
  medium: 2,
  high: 4,
} as const;
