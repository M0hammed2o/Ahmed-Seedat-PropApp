import type { Config } from 'tailwindcss';
import { colorLight, colorDark, radii } from '@propvault/ui';

// Tailwind theme driven by packages/ui tokens — the same source of truth the mobile app uses
// (DESIGN_SYSTEM.md) — rather than an independent, drifting colour scale.
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
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
        pill: `${radii.pill}px`,
      },
    },
  },
  plugins: [],
};

export default config;
