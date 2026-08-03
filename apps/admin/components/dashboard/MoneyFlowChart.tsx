'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface MoneyFlowPoint {
  month: string;
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

// Real 6-month rent-collected-vs-expenses area chart (UI_REDESIGN_PLAN.md) -- data always comes
// from the dashboard page's own live query, never fabricated here. A genuine empty state (all
// zero) is left to render as a flat baseline rather than hidden -- an area chart at zero is an
// honest "nothing recorded yet" signal, not a fabricated non-zero value.
export function MoneyFlowChart({ data }: { data: MoneyFlowPoint[] }) {
  const hasActivity = data.some((d) => d.collected > 0 || d.expenses > 0);

  if (!hasActivity) {
    return (
      <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">No money activity yet</p>
        <p className="max-w-xs text-xs text-light-textMuted dark:text-dark-textMuted">
          This chart fills in once rent is collected or an expense is recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gCollected" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gExpenses" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--chart-muted)' }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--chart-muted)' }} width={48} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--chart-grid)' }} />
          <Area type="monotone" dataKey="collected" name="Collected" stroke="var(--chart-1)" strokeWidth={2.2} fill="url(#gCollected)" />
          <Area type="monotone" dataKey="expenses" name="Expenses" stroke="var(--chart-4)" strokeWidth={1.8} fill="url(#gExpenses)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
