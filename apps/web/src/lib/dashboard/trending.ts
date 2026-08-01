import type { AssetScore } from '@/lib/analysis/types';

/**
 * Ranking logic for the "trending" panels, kept out of the component file so it
 * can be unit-tested — Vitest runs with `jsx: preserve` and cannot parse a .tsx
 * module, and pure ranking rules are exactly the part worth testing.
 */
const VOLUME_LABEL = 'volume vs 20-bar average';

/**
 * Reads the volume ratio out of an asset's cited signals.
 *
 * Returns undefined when the signal is absent or unparseable — the caller drops
 * the asset rather than substituting a value.
 */
export function volumeRatioOf(score: AssetScore): { ratio: number; source: string } | undefined {
  for (const factor of score.breakdown) {
    for (const signal of factor.signals) {
      if (signal.label.toLowerCase().includes(VOLUME_LABEL)) {
        const match = /-?\d+(\.\d+)?/.exec(signal.value);
        if (!match) return undefined;
        const ratio = Number(match[0]);
        if (!Number.isFinite(ratio)) return undefined;
        return { ratio, source: signal.source };
      }
    }
  }
  return undefined;
}
