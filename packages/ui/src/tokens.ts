/**
 * Central design tokens (see DESIGN_SYSTEM.md). Components reference only these semantic names,
 * never a raw hex/px value, so the palette below can be swapped without touching component code.
 *
 * Palette redesigned 2026-08-03 (UI_REDESIGN_PLAN.md) -- values are precise sRGB conversions
 * (Björn Ottosson's OKLCH->sRGB matrices, CSS Color 4) of reference/lovable-ui-reference's design
 * tokens (a premium-SaaS palette purpose-built as PropertyVault's visual direction, per Mohammed's
 * instruction to treat it as "the PRIMARY VISUAL REFERENCE for the Owner PWA"), not eyeballed --
 * converted to hex (not left as raw oklch() strings) specifically so Tailwind v3's opacity
 * modifiers (`bg-light-accent/10`, used throughout the redesigned components) keep working; a raw
 * oklch() theme value doesn't reliably combine with Tailwind v3's alpha-channel synthesis, hex
 * does. Same key names as before this pass -- every existing `text-light-textPrimary` etc. call
 * site across the whole app keeps working unchanged; only what the names resolve to changed.
 */

export const colorLight = {
  surface: '#F9FAFB',
  surfaceRaised: '#FFFFFF',
  surfaceStrong: '#EBEEF2',
  border: '#E3E5E9',
  borderStrong: '#D1D5D9',
  textPrimary: '#111826',
  textSecondary: '#38404E',
  textMuted: '#656E7A',
  accent: '#106ADD',
  accentContrast: '#FFFFFF',
  accentSoft: '#E6F1FF',
  statusPaid: '#169860',
  statusUnpaid: '#656E7A',
  statusOverdue: '#E2212F',
  statusNeedsReview: '#E79C27',
  statusProcessing: '#0095CA',
  statusDisputed: '#966CD7',
  statusVoid: '#656E7A',
  danger: '#E2212F',
  chart1: '#106ADD',
  chart2: '#00AFB8',
  chart3: '#169860',
  chart4: '#E79C27',
  chart5: '#966CD7',
} as const;

export const colorDark = {
  surface: '#0B0F16',
  surfaceRaised: '#141922',
  surfaceStrong: '#1B212B',
  border: '#212730',
  borderStrong: '#323843',
  textPrimary: '#F1F4F7',
  textSecondary: '#C2C8CF',
  textMuted: '#98A1AD',
  accent: '#4A91F8',
  accentContrast: '#0B0F16',
  accentSoft: '#1C2B47',
  statusPaid: '#3DB87C',
  statusUnpaid: '#98A1AD',
  statusOverdue: '#F05653',
  statusNeedsReview: '#F5AE4B',
  statusProcessing: '#3FABDC',
  statusDisputed: '#AD87ED',
  statusVoid: '#98A1AD',
  danger: '#F05653',
  chart1: '#4A91F8',
  chart2: '#24C1C9',
  chart3: '#3DB87C',
  chart4: '#F5AE4B',
  chart5: '#AD87ED',
} as const;

export type ColorTokens = typeof colorLight;

export const spacing = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;

// sm/md/lg/xl unchanged (existing components already use them); pill unchanged; card/panel are
// new, generous radii for the redesign's elevated card language (reference's --radius: 0.875rem
// base scale), additive only.
export const radii = { sm: 4, md: 8, lg: 12, xl: 16, card: 20, panel: 24, pill: 999 } as const;

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

// Real CSS box-shadow values (elevation above was never wired to actual shadow CSS anywhere --
// checked before adding these, no existing component reads `elevation` as a shadow). Light-mode
// shadows only; dark surfaces read as "elevated" via a lighter surface colour + border instead of
// a visible shadow (a dark shadow is invisible on a dark background) -- same convention the
// reference project itself uses (its shadow custom properties are unconditional, but every panel
// also carries a 1px border that does the actual separation work in dark mode).
export const shadow = {
  card: '0 1px 2px 0 rgba(17, 24, 38, 0.04), 0 8px 24px -12px rgba(17, 24, 38, 0.14)',
  lift: '0 2px 4px -1px rgba(17, 24, 38, 0.06), 0 18px 40px -16px rgba(17, 24, 38, 0.24)',
  glow: '0 10px 34px -12px rgba(16, 106, 221, 0.45)',
} as const;
