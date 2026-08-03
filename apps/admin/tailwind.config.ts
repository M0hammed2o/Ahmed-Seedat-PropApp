import type { Config } from 'tailwindcss';
import { colorLight, colorDark, radii, shadow } from '@propvault/ui';

// Tailwind theme driven by packages/ui tokens — the same source of truth the mobile app uses
// (DESIGN_SYSTEM.md) — rather than an independent, drifting colour scale.
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    // DESIGN_SYSTEM.md's own "Responsive rules" specifies this exact scale (sm 640, md 1024,
    // lg 1280, xl 1536) -- real bug found 2026-08-02 (UI_REDESIGN_PLAN.md): this was never
    // actually configured, so every `md:`/`lg:` utility in the codebase silently used Tailwind's
    // stock defaults (768/1024) instead. Overridden, not extended -- the doc's scale replaces
    // Tailwind's, it doesn't add to it.
    screens: {
      sm: '640px',
      md: '1024px',
      lg: '1280px',
      xl: '1536px',
    },
    extend: {
      colors: {
        light: colorLight,
        dark: colorDark,
      },
      borderRadius: {
        sm: `${radii.sm}px`,
        md: `${radii.md}px`,
        lg: `${radii.lg}px`,
        xl: `${radii.xl}px`,
        card: `${radii.card}px`,
        panel: `${radii.panel}px`,
        pill: `${radii.pill}px`,
      },
      boxShadow: {
        card: shadow.card,
        lift: shadow.lift,
        glow: shadow.glow,
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        rise: 'rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};

export default config;
