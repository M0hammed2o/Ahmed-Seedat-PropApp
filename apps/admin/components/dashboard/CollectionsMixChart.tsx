'use client';

import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

interface MixSlice {
  name: string;
  value: number;
  tone: string;
}

// Adapted from reference/lovable-ui-reference's routes/index.tsx "Rent collection" donut + legend
// (2026-08-04 Lovable-adoption batch, UI_INTEGRATION_PLAN.md). Percentages always come from the
// dashboard page's own live rent_schedules query for the current month -- never fabricated here;
// the caller only renders this component when there's real billing to show a mix of.
export function CollectionsMixChart({ data }: { data: MixSlice[] }) {
  return (
    <div className="flex items-center gap-4">
      <div className="h-[132px] w-[132px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={42} outerRadius={62} paddingAngle={3} stroke="none">
              {data.map((slice) => (
                <Cell key={slice.name} fill={slice.tone} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-2.5">
        {data.map((slice) => (
          <li key={slice.name} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-[13px] text-foreground">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.tone }} />
              <span className="truncate">{slice.name}</span>
            </span>
            <span className="tabular text-[13px] font-semibold text-foreground">{slice.value}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
