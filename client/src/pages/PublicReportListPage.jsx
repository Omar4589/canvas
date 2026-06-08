import { Link, useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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

// The hub: every published weekly report for this campaign, newest first.
export default function PublicReportListPage() {
  const { token, accessToken } = useOutletContext();
  const q = useQuery({
    queryKey: ['share-reports', token, accessToken],
    queryFn: () => api(`/share/${token}/reports`, { public: true, shareToken: accessToken }),
  });
  const reports = q.data?.reports || [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Weekly reports</h1>
        <p className="mt-1 text-sm text-fg-muted">Campaign progress, updated each week.</p>
      </div>

      {q.isLoading && <div className="text-sm text-fg-muted">Loading…</div>}
      {!q.isLoading && reports.length === 0 && (
        <Card className="p-6 text-sm text-fg-muted">No reports have been published yet. Check back soon.</Card>
      )}

      <div className="space-y-2">
        {reports.map((r) => (
          <Link key={r.id} to={`/r/${token}/reports/${r.id}`} className="block">
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
