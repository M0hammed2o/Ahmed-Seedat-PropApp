'use client';

import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

// Point-in-time occupied/vacant split (UI_REDESIGN_PLAN.md) -- deliberately not a trend line: no
// historical occupancy-snapshot table exists in this schema, so a trend chart here would have to
// fabricate past values. This shows only what's actually knowable right now.
export function OccupancyMeter({ occupied, vacant }: { occupied: number; vacant: number }) {
  const total = occupied + vacant;
  const data = [
    { name: 'Occupied', value: occupied, color: 'var(--chart-3)' },
    { name: 'Vacant', value: vacant, color: 'var(--chart-4)' },
  ];

  if (total === 0) {
    return (
      <div className="flex h-[160px] flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium text-light-textPrimary dark:text-dark-textPrimary">
          No units yet
        </p>
        <p className="text-xs text-light-textMuted dark:text-dark-textMuted">
          Add a property and units to see occupancy.
        </p>
      </div>
    );
  }

  const occupancyPct = Math.round((occupied / total) * 100);

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[132px] w-[132px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={42}
              outerRadius={62}
              paddingAngle={total > 1 ? 3 : 0}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold tabular-nums-feature text-light-textPrimary dark:text-dark-textPrimary">
            {occupancyPct}%
          </span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2.5">
        {data.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-2 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
              <span className="truncate text-light-textSecondary dark:text-dark-textSecondary">
                {d.name}
              </span>
            </span>
            <span className="tabular-nums-feature font-semibold text-light-textPrimary dark:text-dark-textPrimary">
              {d.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
