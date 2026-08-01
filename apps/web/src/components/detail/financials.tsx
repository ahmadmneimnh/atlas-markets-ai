import type {
  FmpBalanceSheet,
  FmpCashFlow,
  FmpIncomeStatement,
  FmpPriceTarget,
  InsiderTransaction,
  InstitutionalHolder,
} from '@/lib/service';

/**
 * Financial statement and ownership tables for the stock detail page.
 *
 * One rule holds across all of them: **a figure the filing did not contain
 * renders as an em dash.** Not 0, not "n/a" styled like a number. On a balance
 * sheet the difference between "no debt" and "debt not reported" is the whole
 * analysis, and a zero silently makes an unreported company look pristine.
 *
 * Values are shown in the units the statement reports (usually whole currency
 * units), abbreviated for readability but never rounded to fewer than three
 * significant figures.
 */

function money(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

function num(value: number | undefined, digits = 2): string {
  return value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function StatementTable({
  periods,
  rows,
  source,
}: {
  periods: string[];
  rows: { label: string; values: (number | undefined)[] }[];
  source: string;
}) {
  return (
    <div>
      {/* Wide tables scroll inside their own container so the page body never
          scrolls horizontally on a phone. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-glass-border/60 text-left">
              <th className="py-2 pr-4 font-medium text-ink-faint">Line item</th>
              {periods.map((period) => (
                <th key={period} className="py-2 pl-4 text-right font-medium text-ink-faint">
                  {period}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-glass-border/30 last:border-0">
                <td className="py-2 pr-4 text-ink-muted">{row.label}</td>
                {row.values.map((value, i) => (
                  <td key={i} className="tnum py-2 pl-4 text-right text-ink">
                    {money(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-faint">
        Source: {source} · an em dash means the figure was absent from the filing, not zero
      </p>
    </div>
  );
}

export function IncomeStatementTable({ statements }: { statements: FmpIncomeStatement[] }) {
  const ordered = [...statements].reverse();
  return (
    <StatementTable
      source="fmp"
      periods={ordered.map((s) => s.date.slice(0, 4))}
      rows={[
        { label: 'Revenue', values: ordered.map((s) => s.revenue) },
        { label: 'Cost of revenue', values: ordered.map((s) => s.costOfRevenue) },
        { label: 'Gross profit', values: ordered.map((s) => s.grossProfit) },
        { label: 'Operating income', values: ordered.map((s) => s.operatingIncome) },
        { label: 'EBITDA', values: ordered.map((s) => s.ebitda) },
        { label: 'Net income', values: ordered.map((s) => s.netIncome) },
      ]}
    />
  );
}

export function BalanceSheetTable({ statements }: { statements: FmpBalanceSheet[] }) {
  const ordered = [...statements].reverse();
  return (
    <StatementTable
      source="fmp"
      periods={ordered.map((s) => s.date.slice(0, 4))}
      rows={[
        { label: 'Total assets', values: ordered.map((s) => s.totalAssets) },
        { label: 'Total liabilities', values: ordered.map((s) => s.totalLiabilities) },
        { label: 'Total equity', values: ordered.map((s) => s.totalEquity) },
        { label: 'Cash & equivalents', values: ordered.map((s) => s.cashAndCashEquivalents) },
        { label: 'Total debt', values: ordered.map((s) => s.totalDebt) },
        { label: 'Net debt', values: ordered.map((s) => s.netDebt) },
      ]}
    />
  );
}

export function CashFlowTable({ statements }: { statements: FmpCashFlow[] }) {
  const ordered = [...statements].reverse();
  return (
    <StatementTable
      source="fmp"
      periods={ordered.map((s) => s.date.slice(0, 4))}
      rows={[
        { label: 'Operating cash flow', values: ordered.map((s) => s.operatingCashFlow) },
        { label: 'Capital expenditure', values: ordered.map((s) => s.capitalExpenditure) },
        { label: 'Free cash flow', values: ordered.map((s) => s.freeCashFlow) },
        { label: 'Dividends paid', values: ordered.map((s) => s.dividendsPaid) },
        { label: 'Net change in cash', values: ordered.map((s) => s.netChangeInCash) },
      ]}
    />
  );
}

export function PriceTargetPanel({
  target,
  currentPrice,
}: {
  target: FmpPriceTarget;
  currentPrice?: number;
}) {
  const consensus = target.targetConsensus ?? target.targetMedian;
  const upside =
    consensus !== undefined && currentPrice !== undefined && currentPrice > 0
      ? ((consensus - currentPrice) / currentPrice) * 100
      : undefined;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { label: 'Low', value: target.targetLow },
          { label: 'Consensus', value: consensus },
          { label: 'High', value: target.targetHigh },
        ].map((cell) => (
          <div key={cell.label} className="rounded-lg border border-glass-border px-2 py-3">
            <p className="tnum text-lg text-ink">{num(cell.value)}</p>
            <p className="text-xs text-ink-faint">{cell.label}</p>
          </div>
        ))}
      </div>

      {upside !== undefined ? (
        <p className="text-xs text-ink-muted">
          Consensus implies{' '}
          <span className={upside >= 0 ? 'text-bull' : 'text-bear'}>
            {upside >= 0 ? '+' : ''}
            {upside.toFixed(1)}%
          </span>{' '}
          against the current quote.
        </p>
      ) : null}

      {/* Analyst targets are opinions with incentives attached, and they are
          routinely revised toward the price after it moves. Presenting them
          beside an algorithmic score without that note invites reading both as
          the same kind of claim. */}
      <p className="text-xs text-ink-faint">
        Sell-side analyst estimates, not an Atlas output. They are frequently revised after a price
        move rather than before one. Source: fmp
      </p>
    </div>
  );
}

export function InsiderTable({ rows }: { rows: InsiderTransaction[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-glass-border/60 text-left">
            <th className="py-2 pr-4 font-medium text-ink-faint">Insider</th>
            <th className="py-2 pl-4 text-right font-medium text-ink-faint">Change</th>
            <th className="py-2 pl-4 text-right font-medium text-ink-faint">Held after</th>
            <th className="py-2 pl-4 text-right font-medium text-ink-faint">Filed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={`${row.name}-${row.filingDate.toISOString()}-${i}`}
              className="border-b border-glass-border/30 last:border-0"
            >
              <td className="py-2 pr-4 text-ink">{row.name}</td>
              <td
                className={`tnum py-2 pl-4 text-right ${row.change > 0 ? 'text-bull' : row.change < 0 ? 'text-bear' : 'text-ink-muted'}`}
              >
                {row.change > 0 ? '+' : ''}
                {row.change.toLocaleString('en-US')}
              </td>
              <td className="tnum py-2 pl-4 text-right text-ink-muted">
                {row.share.toLocaleString('en-US')}
              </td>
              <td className="py-2 pl-4 text-right text-xs text-ink-faint">
                {row.filingDate.toISOString().slice(0, 10)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OwnershipTable({ rows }: { rows: InstitutionalHolder[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-glass-border/60 text-left">
            <th className="py-2 pr-4 font-medium text-ink-faint">Holder</th>
            <th className="py-2 pl-4 text-right font-medium text-ink-faint">Shares</th>
            <th className="py-2 pl-4 text-right font-medium text-ink-faint">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.name}-${i}`} className="border-b border-glass-border/30 last:border-0">
              <td className="py-2 pr-4 text-ink">{row.name}</td>
              <td className="tnum py-2 pl-4 text-right text-ink-muted">
                {row.share.toLocaleString('en-US')}
              </td>
              <td
                className={`tnum py-2 pl-4 text-right ${row.change > 0 ? 'text-bull' : row.change < 0 ? 'text-bear' : 'text-ink-muted'}`}
              >
                {row.change > 0 ? '+' : ''}
                {row.change.toLocaleString('en-US')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
