import type { Config } from 'tailwindcss';

/**
 * Premium dark theme: near-black canvas, glass surfaces, gold accent.
 * Semantic tokens only — components never reference raw hex, so the palette
 * can be retuned in one place.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
      },
      animation: {
        'fade-up': 'fade-up 0.4s cubic-bezier(0.16,1,0.3,1) both',
        shimmer: 'shimmer 1.8s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
