import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value ?? '—'}</div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'overview'],
    queryFn: () => api('/admin/reports/overview'),
  });

  if (isLoading) return <div>Loading…</div>;
  if (error) return <div className="text-red-600">Error: {error.message}</div>;

  const r = data || {};
  const geoTotal = (r.geocoded?.success || 0) + (r.geocoded?.failed || 0) + (r.geocoded?.pending || 0);
  const geoPct = geoTotal ? Math.round((100 * (r.geocoded?.success || 0)) / geoTotal) : 0;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Overview</h1>

      <section className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Households" value={r.totals?.households} />
        <StatCard label="Voters" value={r.totals?.voters} />
        <StatCard label="Active users" value={r.totals?.activeUsers} />
        <StatCard
          label="Geocoded"
          value={r.geocoded?.success}
          hint={`${geoPct}% of ${geoTotal} (${r.geocoded?.failed || 0} failed)`}
        />
      </section>

      <h2 className="mb-3 text-lg font-semibold">Canvass status</h2>
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Unknocked" value={r.canvass?.unknocked} />
        <StatCard label="Not home" value={r.canvass?.not_home} />
        <StatCard label="Surveyed" value={r.canvass?.surveyed} />
        <StatCard label="Wrong address" value={r.canvass?.wrong_address} />
      </section>
    </div>
  );
}
