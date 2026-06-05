import { ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';

// Tiny per-status bar. data: [{ label, value, color }] (colors from statusColors).
export default function MiniBars({ data = [], height = 28 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Bar dataKey="value" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
