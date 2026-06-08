import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card } from '../components/ui/index.js';

const num = (n) => (n || 0).toLocaleString();

function Metric({ label, total, delta }) {
  return (
    <span className="text-fg-muted">
      {label} <span className="font-semibold text-fg">{num(total)}</span>
      {delta ? <span className="text-success"> +{num(delta)}</span> : null}
    </span>
  );
}

export default function ClientReportListPage() {
  const q = useQuery({ queryKey: ['client', 'reports'], queryFn: () => api('/client/reports') });
  const reports = q.data?.reports || [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Weekly reports</h1>
        <p className="mt-1 text-sm text-fg-muted">Your campaign's progress, updated each week.</p>
      </div>

      {q.isLoading && <div className="text-sm text-fg-muted">Loading…</div>}
      {!q.isLoading && reports.length === 0 && (
        <Card className="p-6 text-sm text-fg-muted">
          No reports have been published yet. Check back soon.
        </Card>
      )}

      <div className="space-y-2">
        {reports.map((r) => (
          <Link key={r.id} to={`/client/reports/${r.id}`} className="block">
            <Card className="p-4 transition-colors hover:bg-sunken">
              <div className="font-medium text-fg">{r.title || `Week of ${r.weekStart}`}</div>
              <div className="mt-1 text-xs text-fg-muted">
                {r.weekStart} → {r.weekEnd}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <Metric
                  label="Doors knocked"
                  total={r.headline?.cumulative?.doorsKnocked}
                  delta={r.headline?.period?.doorsKnocked}
                />
                <Metric
                  label="Surveys taken"
                  total={r.headline?.cumulative?.surveysTaken}
                  delta={r.headline?.period?.surveysTaken}
                />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
