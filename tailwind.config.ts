import type { Config } from 'tailwindcss';

/**
 * Semantic tokens only. Every colour resolves to a CSS variable defined in
 * globals.css for both themes, so a component written once renders correctly in
 * light and dark without a single `dark:` variant on a colour utility.
 *
 * The variables hold space-separated RGB channels rather than hex, which is what
 * keeps Tailwind's opacity syntax working (`bg-surface/60`).
 */
const rgb = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: rgb('--c-canvas'),
        surface: rgb('--c-surface'),
        'surface-raised': rgb('--c-surface-raised'),
        line: rgb('--c-line'),
        ink: {
          DEFAULT: rgb('--c-ink'),
          muted: rgb('--c-ink-muted'),
          faint: rgb('--c-ink-faint'),
        },
        accent: {
          DEFAULT: rgb('--c-accent'),
          soft: rgb('--c-accent-soft'),
        },
        // Directional colours are per-theme tokens: the green that reads as "up"
        // on a white background is too dark to see on a near-black one.
        bull: rgb('--c-bull'),
        bear: rgb('--c-bear'),
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--c-shadow) / 0.06), 0 4px 16px rgb(var(--c-shadow) / 0.05)',
        lift: '0 2px 4px rgb(var(--c-shadow) / 0.08), 0 12px 28px rgb(var(--c-shadow) / 0.10)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s cubic-bezier(0.16,1,0.3,1) both',
        shimmer: 'shimmer 1.6s linear infinite',
        'pulse-dot': 'pulse-dot 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
