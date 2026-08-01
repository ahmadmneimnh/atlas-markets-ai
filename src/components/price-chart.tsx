'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { CHART_RANGES, type ChartDTO, type ChartRange, type UnavailableDTO } from '@/lib/dto';
import { formatCurrency, formatDate, formatDateShort, formatPercent } from '@/lib/format';
import { InsufficientData, Provenance } from './ui';
import type { AssetKind } from '@/lib/providers/types';

interface ChartResponse {
  chart: ChartDTO | null;
  unavailable: UnavailableDTO | null;
}

const HEIGHT = 320;
const PAD = { top: 16, right: 16, bottom: 26, left: 58 };

/**
 * Interactive price history.
 *
 * Drawn as plain SVG rather than through a charting library: the whole surface is
 * one line, an area fill and a crosshair, and hand-rolling it keeps the install a
 * single `npm install` with no native build steps — which matters when the person
 * setting this up has never used a terminal before.
 *
 * Gaps are never bridged with invented points. If a provider returns eleven days
 * for a one-month window, eleven days are plotted and the header says so.
 */
export function PriceChart({
  symbol,
  kind,
  initialRange = '3M',
}: {
  symbol: string;
  kind: AssetKind;
  initialRange?: ChartRange;
}) {
  const [range, setRange] = useState<ChartRange>(initialRange);
  const [state, setState] = useState<{ loading: boolean; data: ChartResponse | null }>({
    loading: true,
    data: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));

    fetch(`/api/chart/${kind}/${encodeURIComponent(symbol)}?range=${range}`, {
      signal: controller.signal,
    })
      .then((res) => res.json() as Promise<ChartResponse>)
      .then((body) => setState({ loading: false, data: body }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          data: {
            chart: null,
            unavailable: { reason: 'upstream_error', detail: e instanceof Error ? e.message : 'request failed' },
          },
        });
      });

    return () => controller.abort();
  }, [symbol, kind, range]);

  const chart = state.data?.chart ?? null;
  const points = chart?.points ?? [];
  const first = points[0]?.close;
  const last = points[points.length - 1]?.close;
  const periodChange =
    first !== undefined && last !== undefined && first !== 0 ? ((last - first) / first) * 100 : undefined;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Price history
          </h2>
          {periodChange !== undefined ? (
            <span
              className={clsx(
                'tnum text-xs font-semibold',
                periodChange > 0 ? 'text-bull' : periodChange < 0 ? 'text-bear' : 'text-ink-muted',
              )}
            >
              {formatPercent(periodChange)} over {range}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-line p-0.5" role="group" aria-label="Chart range">
          {CHART_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={r === range}
              className={clsx(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                r === range ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {state.loading && chart === null ? (
        <div className="skeleton" style={{ height: HEIGHT }} aria-busy="true" aria-label="Loading price history" />
      ) : chart === null || points.length < 2 ? (
        <InsufficientData
          what="Price history"
          unavailable={
            state.data?.unavailable ?? { reason: 'not_found', detail: 'fewer than two data points' }
          }
          hint={
            kind === 'equity' ? (
              <>
                Stock charts need a free Alpha Vantage key set as{' '}
                <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[11px]">
                  ALPHA_VANTAGE_API_KEY
                </code>
                . Its free plan allows 25 chart loads per day.
              </>
            ) : undefined
          }
        />
      ) : (
        <>
          <Plot points={points} loading={state.loading} />
          <div className="mt-2 flex items-center justify-between text-[11px] text-ink-faint">
            <Provenance source={chart.source} />
            <span>
              {points.length} daily closes
              {chart.points.length > 0 ? ` · ${formatDate(points[0]!.t)} – ${formatDate(points[points.length - 1]!.t)}` : ''}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Plot ────────────────────────────────────────────────────────────────────────

function Plot({ points, loading }: { points: { t: number; close: number }[]; loading: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [cursor, setCursor] = useState<number | null>(null);

  // Measure rather than rely on a viewBox: `preserveAspectRatio` scaling would
  // stretch the axis text along with the plot.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, entry.contentRect.width));
    });
    observer.observe(el);
    setWidth(Math.max(280, el.clientWidth));
    return () => observer.disconnect();
  }, []);

  const values = points.map((p) => p.close);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // A flat series has zero range, which would divide by zero below.
  const span = rawMax - rawMin || Math.abs(rawMax) * 0.02 || 1;
  const min = rawMin - span * 0.08;
  const max = rawMax + span * 0.08;

  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const x = useCallback(
    (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW),
    [innerW, points.length],
  );
  const y = useCallback((v: number) => PAD.top + (1 - (v - min) / (max - min)) * innerH, [innerH, max, min]);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.close).toFixed(2)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(2)},${(PAD.top + innerH).toFixed(2)} L${x(0).toFixed(2)},${(PAD.top + innerH).toFixed(2)} Z`;

  const rising = (values[values.length - 1] ?? 0) >= (values[0] ?? 0);
  const gradientId = `bb-area-${rising ? 'up' : 'down'}`;

  const ticks = niceTicks(min, max, 4);
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  const active = cursor === null ? null : points[cursor];

  function locate(clientX: number) {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const ratio = (px - PAD.left) / innerW;
    const index = Math.round(ratio * (points.length - 1));
    setCursor(Math.max(0, Math.min(points.length - 1, index)));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setCursor((c) => {
      const start = c ?? points.length - 1;
      return Math.max(0, Math.min(points.length - 1, start + (e.key === 'ArrowRight' ? 1 : -1)));
    });
  }

  return (
    <div
      ref={wrapRef}
      className={clsx('relative select-none', loading && 'opacity-60')}
      onMouseMove={(e) => locate(e.clientX)}
      onMouseLeave={() => setCursor(null)}
      onTouchStart={(e) => e.touches[0] && locate(e.touches[0].clientX)}
      onTouchMove={(e) => e.touches[0] && locate(e.touches[0].clientX)}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="img"
      aria-label={`Price history, ${points.length} points, from ${formatCurrency(values[0] ?? 0)} to ${formatCurrency(values[values.length - 1] ?? 0)}`}
    >
      <svg
        width={width}
        height={HEIGHT}
        className={clsx('overflow-visible', rising ? 'text-bull' : 'text-bear')}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid + price axis */}
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(v)}
              y2={y(v)}
              className="stroke-line"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            <text
              x={PAD.left - 8}
              y={y(v)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-[rgb(var(--c-ink-faint))] text-[10px]"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatCurrency(v)}
            </text>
          </g>
        ))}

        {/* Date axis */}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text
              key={p.t}
              x={x(i)}
              y={HEIGHT - 6}
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
              className="fill-[rgb(var(--c-ink-faint))] text-[10px]"
            >
              {formatDateShort(p.t)}
            </text>
          ) : null,
        )}

        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />

        {active ? (
          <g>
            <line
              x1={x(cursor!)}
              x2={x(cursor!)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              className="stroke-ink-faint"
              strokeWidth="1"
            />
            <circle cx={x(cursor!)} cy={y(active.close)} r="4" fill="currentColor" />
            <circle cx={x(cursor!)} cy={y(active.close)} r="7" fill="currentColor" fillOpacity="0.2" />
          </g>
        ) : null}
      </svg>

      {active ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 shadow-lift"
          style={{
            left: Math.min(Math.max(x(cursor!), 70), width - 70),
            top: Math.max(0, y(active.close) - 56),
          }}
        >
          <p className="tnum text-sm font-semibold text-ink">{formatCurrency(active.close)}</p>
          <p className="text-[11px] text-ink-faint">{formatDate(active.t)}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Round grid values — 12.5, 15.0, 17.5 reads better than 12.37, 15.02, 17.66. */
function niceTicks(min: number, max: number, count: number): number[] {
  const rawStep = (max - min) / count;
  if (!Number.isFinite(rawStep) || rawStep <= 0) return [min];
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;

  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Number(v.toFixed(10)));
  return out;
}
