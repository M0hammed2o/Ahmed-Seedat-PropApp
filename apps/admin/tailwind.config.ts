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
        // Lovable-adoption batch (2026-08-04, UI_INTEGRATION_PLAN.md): CSS-variable-backed
        // semantic names matching reference/lovable-ui-reference's own Tailwind v4 token names
        // exactly (values defined in app/globals.css, copied verbatim from Lovable's styles.css)
        // -- lets pages adapted from that source keep Lovable's literal className strings
        // (bg-primary, text-muted-foreground, border-border, ...) working unchanged, rather than
        // hand-translating every class into the light-*/dark-* convention above. Additive only:
        // every existing `light-*`/`dark-*` class keeps resolving exactly as before.
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        surface: 'var(--surface)',
        'surface-strong': 'var(--surface-strong)',
        card: 'var(--card)',
        'card-foreground': 'var(--card-foreground)',
        popover: 'var(--popover)',
        'popover-foreground': 'var(--popover-foreground)',
        primary: 'var(--primary)',
        'primary-foreground': 'var(--primary-foreground)',
        'primary-soft': 'var(--primary-soft)',
        secondary: 'var(--secondary)',
        'secondary-foreground': 'var(--secondary-foreground)',
        muted: 'var(--muted)',
        'muted-foreground': 'var(--muted-foreground)',
        accent: 'var(--accent)',
        'accent-foreground': 'var(--accent-foreground)',
        destructive: 'var(--destructive)',
        'destructive-foreground': 'var(--destructive-foreground)',
        success: 'var(--success)',
        'success-foreground': 'var(--success-foreground)',
        warning: 'var(--warning)',
        'warning-foreground': 'var(--warning-foreground)',
        info: 'var(--info)',
        'info-foreground': 'var(--info-foreground)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        'chart-1': 'var(--chart-1)',
        'chart-2': 'var(--chart-2)',
        'chart-3': 'var(--chart-3)',
        'chart-4': 'var(--chart-4)',
        'chart-5': 'var(--chart-5)',
        sidebar: 'var(--sidebar)',
        'sidebar-foreground': 'var(--sidebar-foreground)',
        'sidebar-primary': 'var(--sidebar-primary)',
        'sidebar-primary-foreground': 'var(--sidebar-primary-foreground)',
        'sidebar-accent': 'var(--sidebar-accent)',
        'sidebar-accent-foreground': 'var(--sidebar-accent-foreground)',
        'sidebar-border': 'var(--sidebar-border)',
        'sidebar-ring': 'var(--sidebar-ring)',
      },
      borderRadius: {
        sm: `${radii.sm}px`,
        md: `${radii.md}px`,
        lg: `${radii.lg}px`,
        xl: `${radii.xl}px`,
        card: `${radii.card}px`,
        panel: `${radii.panel}px`,
        pill: `${radii.pill}px`,
        // Lovable-adoption batch: stock Tailwind 2xl/3xl/4xl were never overridden by this
        // project before (grep-confirmed no existing usage anywhere in the app), so matching
        // Lovable's own calc(--radius +/- N) formula here carries zero blast radius to
        // already-shipped pages outside this batch.
        '2xl': 'calc(0.875rem + 8px)',
        '3xl': 'calc(0.875rem + 12px)',
        '4xl': 'calc(0.875rem + 16px)',
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
