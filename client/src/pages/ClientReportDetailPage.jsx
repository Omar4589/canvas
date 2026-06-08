import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import ClientReportView from '../components/ClientReportView.jsx';
import ClientReportMap from '../components/ClientReportMap.jsx';

export default function ClientReportDetailPage() {
  const { reportId: id } = useParams();
  const q = useQuery({
    queryKey: ['client', 'report', id],
    queryFn: () => api(`/client/reports/${id}`),
  });
  const report = q.data?.report;

  if (q.isLoading) return <div className="text-sm text-fg-muted">Loading…</div>;
  if (q.isError || !report) return <div className="text-sm text-danger">Report not found.</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/client" className="text-xs text-brand-accent hover:underline">
          ← All reports
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-fg">
          {report.title || `Week of ${report.weekStart}`}
        </h1>
        <div className="text-sm text-fg-muted">
          {report.weekStart} → {report.weekEnd}
        </div>
      </div>

      <ClientReportView report={report} />

      {report.visibility?.showMap && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Where we've been
          </h2>
          <ClientReportMap
            mapDataPath={`/client/reports/${id}/map`}
            tokenPath="/client/config/mapbox-token"
            survey={q.data.survey}
          />
        </section>
      )}
    </div>
  );
}
