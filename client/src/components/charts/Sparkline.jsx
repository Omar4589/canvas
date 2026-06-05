import { ResponsiveContainer, AreaChart, Area } from 'recharts';

// Tiny trend line. data: number[] or {x,y}[]. color: hex (pass a theme-aware value
// + a `key` from the page to re-render on theme change). No axes, no animation.
export default function Sparkline({ data = [], color = '#DC2626', height = 40 }) {
  const points = data.map((v, i) => (typeof v === 'number' ? { i, v } : { i, v: v.y ?? v.value }));
  const id = `spark-${color.replace('#', '')}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${id})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
