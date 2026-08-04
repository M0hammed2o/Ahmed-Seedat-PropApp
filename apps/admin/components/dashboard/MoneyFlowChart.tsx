'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface MoneyFlowPoint {
  month: string;
  billed: number;
  collected: number;
  expenses: number;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-light-border bg-light-surfaceRaised px-3 py-2 text-xs shadow-lift dark:border-dark-border dark:bg-dark-surfaceRaised">
      <p className="mb-1 font-semibold uppercase tracking-wide text-light-textMuted dark:text-dark-textMuted">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5 font-medium tabular-nums-feature text-light-textPrimary dark:text-dark-textPrimary">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: R{p.value.toLocaleString('en-ZA')}
        </p>
      ))}
    </div>
  );
}

// Real 9-month billed/collected/expenses area chart, matching reference/lovable-ui-reference's
// "Income vs collections" panel composition exactly (2026-08-04 Lovable-adoption batch,
// UI_INTEGRATION_PLAN.md: billed=chart-1 solid area, collected=chart-3 solid area,
// expenses=chart-4 dashed line, no fill). Data always comes from the dashboard page's own live
// query, never fabricated here. A genuine empty state (all zero) renders as a flat baseline
// rather than being hidden -- an honest "nothing recorded yet" signal, not a fabricated value.
export function MoneyFlowChart({ data }: { data: MoneyFlowPoint[] }) {
  const hasActivity = data.some((d) => d.billed > 0 || d.collected > 0 || d.expenses > 0);

  if (!hasActivity) {
    return (
      <div className="flex h-[288px] flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">No money activity yet</p>
        <p className="max-w-xs text-xs text-light-textMuted dark:text-dark-textMuted">
          This chart fills in once rent is billed, collected, or an expense is recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[288px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 12, left: -14, bottom: 0 }}>
          <defs>
            <linearGradient id="gBilled" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gCollected" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--chart-muted)' }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--chart-muted)' }} width={48} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--chart-grid)' }} />
          <Area type="monotone" dataKey="billed" name="Billed" stroke="var(--chart-1)" strokeWidth={2.4} fill="url(#gBilled)" />
          <Area type="monotone" dataKey="collected" name="Collected" stroke="var(--chart-3)" strokeWidth={2} fill="url(#gCollected)" />
          <Area
            type="monotone"
            dataKey="expenses"
            name="Expenses"
            stroke="var(--chart-4)"
            strokeWidth={1.8}
            fill="transparent"
            strokeDasharray="4 4"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
