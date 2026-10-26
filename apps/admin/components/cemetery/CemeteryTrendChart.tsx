'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface CemeteryTrendPoint {
  label: string;
  salesValue: number;
  paymentsCollected: number;
}

const zar = (n: number) =>
  new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(n);

/** Monthly grave-site sales value vs payments collected (same chart library and colour tokens as the dashboard). */
export function CemeteryTrendChart({ data }: { data: CemeteryTrendPoint[] }) {
  return (
    <div
      className="h-[260px] w-full"
      role="img"
      aria-label="Monthly grave-site sales and payments collected"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => `R${Math.round(v / 1000)}k`}
          />
          <Tooltip
            formatter={(v) => zar(Number(v ?? 0))}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--card)',
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="salesValue"
            name="Sales value"
            fill="var(--chart-1)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="paymentsCollected"
            name="Payments collected"
            fill="var(--chart-3)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
