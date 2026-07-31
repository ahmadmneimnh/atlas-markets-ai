/**
 * Atlas Markets AI — shared Tailwind design-token preset.
 *
 * Two families of tokens live here and they are not interchangeable:
 *
 *  1. **Atlas brand tokens** (`canvas`, `glass`, `gold`, `ink`, `bull`/`bear`/`warn`)
 *     are literal values. They define the product's look and are referenced by
 *     hand-written Atlas components.
 *
 *  2. **Role tokens** (`background`, `foreground`, `primary`, `muted`, `border`, …)
 *     resolve through CSS custom properties. Shadcn/UI generates components against
 *     exactly these names, so a component pasted in by the shadcn CLI inherits the
 *     Atlas palette with no edits. The variables are declared in
 *     `apps/web/src/app/globals.css`.
 *
 * Components must never reference a raw hex value — retuning the palette has to be
 * a one-file change or it will not happen.
 *
 * CommonJS on purpose: Tailwind resolves presets through `require`, and a plain
 * `.cjs` file loads identically from a workspace package on every platform.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        /* ── Atlas brand tokens ─────────────────────────────────────────── */
        canvas: {
          DEFAULT: '#05060a',
          raised: '#0b0d14',
          sunken: '#020308',
        },
        glass: {
          DEFAULT: 'rgba(255,255,255,0.035)',
          strong: 'rgba(255,255,255,0.06)',
          border: 'rgba(255,255,255,0.09)',
        },
        gold: {
          DEFAULT: '#d4af37',
          soft: '#e8cd7a',
          deep: '#a8862a',
          glow: 'rgba(212,175,55,0.18)',
        },
        ink: {
          DEFAULT: '#f4f5f7',
          muted: '#9aa1ae',
          faint: '#5e6572',
        },
        // Directional colors. Deliberately not pure red/green: these sit on a
        // near-black canvas where saturated primaries vibrate.
        bull: '#2ecc8f',
        bear: '#ff5d6c',
        warn: '#f0a95c',

        /* ── Role tokens (Shadcn/UI contract) ───────────────────────────── */
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      backdropBlur: { xs: '2px' },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.55)',
        'gold-glow': '0 0 24px rgba(212,175,55,0.15)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s cubic-bezier(0.16,1,0.3,1) both',
        shimmer: 'shimmer 1.8s linear infinite',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
