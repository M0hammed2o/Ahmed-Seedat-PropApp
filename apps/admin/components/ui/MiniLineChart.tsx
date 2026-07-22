interface MiniLineChartProps {
  points: { label: string; value: number }[];
  color?: string;
  height?: number;
}

/**
 * Dependency-free inline SVG line chart — avoids pulling in a full charting library for a
 * handful of simple trend visualisations (see DECISIONS.md, Phase 2 entry on why no chart lib).
 */
export function MiniLineChart({ points, color = '#2F5D50', height = 120 }: MiniLineChartProps) {
  const width = 100;
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(...points.map((p) => p.value));
  const range = max - min || 1;
  const stepX = width / (points.length - 1 || 1);

  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p.value - min) / range) * (height - 24) - 12;
    return { x, y };
  });

  const path = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(' ');
  const areaPath = `${path} L${coords[coords.length - 1]!.x},${height} L${coords[0]!.x},${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <path d={areaPath} fill={color} opacity={0.08} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
      />
      {coords.map((c, i) => (
        <circle key={points[i]!.label} cx={c.x} cy={c.y} r={1.6} fill={color} />
      ))}
    </svg>
  );
}
