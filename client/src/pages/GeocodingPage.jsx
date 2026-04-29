import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{fmt(value)}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

export default function GeocodingPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['geocoding', 'status'],
    queryFn: () => api('/admin/geocoding/status'),
    refetchInterval: (q) => {
      const j = q.state.data?.latestJob;
      return j && (j.status === 'pending' || j.status === 'running') ? 2000 : false;
    },
  });

  const startCensus = useMutation({
    mutationFn: () => api('/admin/geocoding/census/start', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geocoding', 'status'] }),
  });

  const startMapbox = useMutation({
    mutationFn: () => api('/admin/geocoding/mapbox-fallback', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geocoding', 'status'] }),
  });

  const retryFailed = useMutation({
    mutationFn: () => api('/admin/geocoding/retry-failed', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geocoding', 'status'] }),
  });

  if (isLoading) return <div>Loading…</div>;

  const counts = data?.counts || { pending: 0, success: 0, failed: 0 };
  const total = counts.pending + counts.success + counts.failed;
  const successPct = total ? Math.round((100 * counts.success) / total) : 0;
  const job = data?.latestJob;
  const isRunning = job && (job.status === 'pending' || job.status === 'running');

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Geocoding</h1>

      <section className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total households" value={total} />
        <StatCard label="Geocoded" value={counts.success} sub={`${successPct}%`} />
        <StatCard label="Pending" value={counts.pending} />
        <StatCard label="Failed" value={counts.failed} />
      </section>

      <section className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Census matches" value={data?.byProvider?.census} />
        <StatCard label="Mapbox matches" value={data?.byProvider?.mapbox} />
      </section>

      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-base font-medium">Actions</h2>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => startCensus.mutate()}
            disabled={isRunning || startCensus.isPending}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Run Census on pending
          </button>
          <button
            onClick={() => startMapbox.mutate()}
            disabled={isRunning || startMapbox.isPending}
            className="rounded border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            Mapbox fallback on failed
          </button>
          <button
            onClick={() => {
              if (confirm('Reset all failed households to pending?')) retryFailed.mutate();
            }}
            disabled={isRunning || retryFailed.isPending}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Reset failed → pending
          </button>
        </div>

        {[startCensus, startMapbox, retryFailed].map((m, i) =>
          m.error ? (
            <div
              key={i}
              className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {m.error.message}
            </div>
          ) : null
        )}
      </section>

      {job && (
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-base font-medium">Latest job</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 text-sm">
            <div>
              <div className="text-xs text-gray-500">Provider</div>
              <div>{job.provider}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Status</div>
              <div>{job.status}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Progress</div>
              <div>
                {fmt(job.processedHouseholds)} / {fmt(job.totalHouseholds)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Matched / Failed</div>
              <div>
                {fmt(job.matched)} / {fmt(job.failed)}
              </div>
            </div>
          </div>
          {job.errors?.length > 0 && (
            <div className="mt-3 text-xs text-red-700">
              <div className="font-medium">Errors:</div>
              <ul className="ml-4 list-disc">
                {job.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{e.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
