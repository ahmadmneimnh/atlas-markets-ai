# AI scoring engine

Two implementations of one idea, at different stages.

- **`apps/web/src/lib/analysis`** — the working TypeScript engine. Six factors,
  renormalization on missing data, a coverage floor, 70 passing unit tests. This is
  what produces scores today.
- **`services/ai-engine`** — the Python service that will host the model-based
  factors. Phase 1 ships its pipeline seams, its wire contract and its refusals; it
  registers no factor models and answers `501`.

---

## 1. Composite scoring

Each factor produces a 0–100 score and a 0–1 confidence. The composite is the
weighted mean of the factors that could be scored.

| Factor      | Nominal weight | Reads                                                                                |
| ----------- | -------------- | ------------------------------------------------------------------------------------ |
| Technical   | 30%            | OHLCV → RSI, MACD, moving averages, ATR, Bollinger, ADX                              |
| Fundamental | 30%            | Valuation, margins, growth, leverage (equities); supply and network metrics (crypto) |
| News        | 15%            | Headline classification over a rolling window                                        |
| Social      | 10%            | Sentiment and volume — **no provider implemented; reports unavailable**              |
| Macro       | 10%            | Rates, inflation, index regime — **no provider implemented**                         |
| Risk        | 5%             | Realised volatility, drawdown, liquidity                                             |

Weights live in two places today — `apps/web/src/lib/analysis/factors/*.ts` and
`services/ai-engine/app/scoring/registry.py`. That duplication is a known liability,
recorded rather than hidden: a weight that differs between two files is invisible
because both scores still look plausible. It resolves when the TypeScript scorers
move into the Python service, not before.

---

## 2. The rule that shapes everything: missing ≠ neutral

**An unavailable factor is dropped from the denominator and the remaining weights
are renormalized. It is never scored 50.**

If fundamentals are unavailable for an asset, the remaining five factors' weights are
rescaled to sum to 1 and the composite is computed from those. The response reports
each factor's nominal weight alongside the effective weight actually applied.

Scoring an unknown as "neutral" invents evidence. Worse, it makes a genuinely average
asset and a completely unknown one produce the same number, which is the one
distinction a user needs most.

The same rule at the composite level: below **25% coverage** the engine raises
`InsufficientDataError` / `InsufficientCoverage` and the API answers `422` with the
reason for every omitted factor. Refusing is a first-class output, structured as
carefully as a score.

This is the property that is nearly impossible to retrofit. Once a caller has seen a
score for an asset with no data, every consumer downstream has been written to assume
a number is always there.

---

## 3. Confidence is computed independently of score

Confidence combines:

- **Coverage** — how much of the nominal factor weight actually ran, and
- **Depth** — the weighted mean of each factor's own evidence confidence.

A 90/100 score on 30% coverage is a high score with low confidence, and the UI must
be able to say so. Folding confidence into the score would collapse "strong evidence
for a middling asset" and "weak evidence for a strong one" into the same number.

---

## 4. Citations

Every number that influenced a score appears as a `Signal` carrying its label, value,
direction, within-factor weight and **source provider id**. `source` is required at
the type level in both the Zod and Pydantic schemas: a signal whose provenance is
unknown cannot be displayed, so it cannot be constructed.

`topReasons` ranks signals by their contribution to the final score — within-factor
weight scaled by the factor's effective weight — which is what the UI shows as the
"why".

---

## 5. The Python pipeline

`services/ai-engine/app/scoring/pipeline.py` defines three things:

**`FactorModel`** — one scoring dimension, with a `name`, a `nominal_weight` and a
`score(ctx)` method. Adding a factor is a new file plus a registry entry, never an
edit to the composite.

**`FactorScore | Unavailable`** — the return type. A union, not an optional float.
`score()` must never raise for missing input: raising would be indistinguishable from
a bug in the model, and the composite would have to treat both the same way.

**`InsufficientCoverage`** — raised by the composite below the floor.

`registry.py` holds the weights and asserts they sum to 1.0 at import. `REGISTERED`
is empty in Phase 1, `is_operational()` returns False, and `/v1/score` consults it
before agreeing to score anything. An empty registry that returned scores would be
the worst failure mode available: confident numbers derived from nothing.

---

## 6. Recommendation bands

| Score | Recommendation |
| ----- | -------------- |
| ≥ 82  | STRONG_BUY     |
| ≥ 62  | BUY            |
| 39–61 | HOLD           |
| 19–38 | SELL           |
| ≤ 18  | STRONG_SELL    |

Asymmetric on purpose. A symmetric 80/20 split would treat the two errors as equally
costly; a false STRONG_BUY puts capital at risk while a false STRONG_SELL costs an
opportunity, so the bar for the buy bands is higher.

---

## 7. What Phase 4 adds

1. Move the TypeScript factor scorers into `services/ai-engine`, with the BFF calling
   `POST /v1/score` — one implementation, one set of weights.
2. Replace the news lexicon classifier with a transformer (FinBERT or similar). The
   current classifier caps its own confidence precisely because a lexicon cannot read
   negation or sarcasm.
3. Persist `ScoreSnapshot` on every run, which is what makes the weights tunable —
   without stored inputs the engine cannot be backtested and therefore cannot improve.
4. Implement social and macro once providers exist. They report unavailable today,
   which is the correct behaviour, not a gap to paper over.
