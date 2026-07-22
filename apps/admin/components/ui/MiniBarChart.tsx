interface MiniBarChartProps {
  bars: { label: string; value: number }[];
  color?: string;
  height?: number;
}

export function MiniBarChart({ bars, color = '#2F5D50', height = 120 }: MiniBarChartProps) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height }}>
      {bars.map((bar) => (
        <div
          key={bar.label}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 28,
              height: Math.max((bar.value / max) * (height - 24), 4),
              backgroundColor: color,
              opacity: 0.85,
              borderRadius: 4,
            }}
          />
          <span style={{ fontSize: 11, color: '#8A8F97' }}>{bar.label}</span>
        </div>
      ))}
    </div>
  );
}
