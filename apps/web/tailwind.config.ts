import type { Config } from 'tailwindcss';

const atlasPreset = require('@atlas/config/tailwind.preset');

/**
 * The palette itself lives in `@atlas/config/tailwind.preset`, so any future
 * surface (an email renderer, Storybook, a marketing site) inherits the same
 * tokens instead of drifting a second copy of the brand.
 *
 * This file owns only what is app-specific: which files to scan.
 */
const config: Config = {
  presets: [atlasPreset],
  content: ['./src/**/*.{ts,tsx}'],
};

export default config;
