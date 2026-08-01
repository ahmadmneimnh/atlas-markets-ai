import 'server-only';

import { fetchJson } from '@/lib/http';
import type { ProviderResult } from '../types';
import { ok, unavailable } from '../types';
import { classifyError } from '../errors';

/**
 * DefiLlama — total value locked, per chain. Free, no key, no registration.
 *
 * Not registered as a `Provider`: TVL is not one of the routed capabilities and
 * DefiLlama is the only source for it, so a capability with a single possible
 * provider would give the registry nothing to route between. The crypto detail
 * page calls this directly.
 *
 * What TVL is *not*: a valuation. It is the dollar value of assets deposited in
 * a chain's protocols, which moves with token prices as much as with adoption —
 * a chain whose token halves shows TVL halving without a single user leaving.
 * The UI states that next to the number, because "TVL down 40%" is otherwise
 * read as an exodus.
 */
const BASE = 'https://api.llama.fi';
const LIMIT = { requests: 30, windowMs: 60_000 };

interface LlamaChain {
  gecko_id: string | null;
  tvl: number | null;
  tokenSymbol: string | null;
  name: string;
  chainId?: number | null;
}

export interface ChainTvl {
  chain: string;
  tvl: number;
  /** Change over the trailing week, as a fraction. Absent when history is thin. */
  change7d?: number;
  asOf: Date;
  source: string;
}

interface LlamaHistoricalPoint {
  date: number;
  tvl: number;
}

/**
 * Symbols whose chain name on DefiLlama differs from the ticker.
 *
 * Only exact, verified mappings belong here. A fuzzy match would silently return
 * one chain's TVL under another's name, and nothing downstream could detect it.
 */
const SYMBOL_TO_CHAIN: Record<string, string> = {
  ETH: 'Ethereum',
  SOL: 'Solana',
  BNB: 'BSC',
  AVAX: 'Avalanche',
  ADA: 'Cardano',
  DOT: 'Polkadot',
  MATIC: 'Polygon',
  ARB: 'Arbitrum',
  OP: 'Optimism',
  TRX: 'Tron',
  NEAR: 'Near',
  APT: 'Aptos',
  SUI: 'Sui',
  TON: 'Ton',
};

export const defillama = {
  isConfigured: () => true,

  /**
   * TVL for the chain a symbol is native to.
   *
   * Returns `not_supported` for assets that have no chain — Bitcoin has no smart
   * contracts and therefore no meaningful TVL, and reporting 0 would read as "no
   * one uses it" rather than "this metric does not apply".
   */
  async chainTvl(symbol: string): Promise<ProviderResult<ChainTvl>> {
    const chain = SYMBOL_TO_CHAIN[symbol.toUpperCase()];
    if (!chain) {
      return unavailable(
        'not_supported',
        `TVL does not apply to ${symbol.toUpperCase()} — it is not a smart-contract chain tracked by DefiLlama.`,
      );
    }

    try {
      const chains = await fetchJson<LlamaChain[]>({
        provider: 'defillama',
        url: `${BASE}/v2/chains`,
        rateLimit: LIMIT,
      });

      const entry = chains.find((c) => c.name.toLowerCase() === chain.toLowerCase());
      if (!entry || typeof entry.tvl !== 'number') {
        return unavailable('not_found', `no TVL published for ${chain}`);
      }

      const result: ChainTvl = {
        chain: entry.name,
        tvl: entry.tvl,
        asOf: new Date(),
        source: 'defillama',
      };

      // The weekly delta is a separate call and a nice-to-have. It is fetched
      // best-effort: failing the whole panel because a sparkline is unavailable
      // would trade a real number for nothing.
      try {
        const history = await fetchJson<LlamaHistoricalPoint[]>({
          provider: 'defillama',
          url: `${BASE}/v2/historicalChainTvl/${encodeURIComponent(entry.name)}`,
          rateLimit: LIMIT,
        });
        const weekAgo = history.at(-8);
        if (weekAgo && weekAgo.tvl > 0) {
          result.change7d = (entry.tvl - weekAgo.tvl) / weekAgo.tvl;
        }
      } catch {
        // Deliberately swallowed — see above.
      }

      return ok(result);
    } catch (error) {
      return classifyError(error);
    }
  },
};
