import { useState } from 'react';
import { Link, useParams, useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { Button } from '../components/ui/index.js';
import ClientReportView from '../components/ClientReportView.jsx';
import ClientReportMap from '../components/ClientReportMap.jsx';
import { formatWeekRange, weekOfTitle } from '../lib/datePresets.js';

export default function PublicReportDetailPage() {
  const { reportId } = useParams();
  const { token, accessToken, meta } = useOutletContext();
  const opts = { public: true, shareToken: accessToken };
  const [pdfBusy, setPdfBusy] = useState(false);

  const q = useQuery({
    queryKey: ['share-report', token, reportId, accessToken],
    queryFn: () => api(`/share/${token}/reports/${reportId}`, opts),
  });
  const report = q.data?.report;

  async function downloadPdf() {
    setPdfBusy(true);
    try {
      const { generateReportPdf } = await import('../lib/reportPdf.js');
      await generateReportPdf(report, { campaignName: meta?.campaignName, orgName: meta?.orgName });
    } catch (err) {
      console.error('PDF export failed', err);
    } finally {
      setPdfBusy(false);
    }
  }

  if (q.isLoading) return <div className="text-sm text-fg-muted">Loading…</div>;
  if (q.isError || !report) return <div className="text-sm text-danger">Report not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/r/${token}`} className="text-xs text-brand-accent hover:underline">
            ← All reports
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-fg">
            {report.title || weekOfTitle(report.weekStart)}
          </h1>
          <div className="text-sm text-fg-muted">
            {formatWeekRange(report.weekStart, report.weekEnd)}
          </div>
        </div>
        <Button variant="secondary" size="sm" loading={pdfBusy} onClick={downloadPdf}>
          ⤓ Download PDF
        </Button>
      </div>

      <ClientReportView report={report} />

      {report.visibility?.showMap && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Where we've been
          </h2>
          <ClientReportMap
            mapDataPath={`/share/${token}/reports/${reportId}/map`}
            tokenPath={`/share/${token}/mapbox-token`}
            survey={q.data.survey}
            campaignType={report.campaignType}
            requestOpts={opts}
          />
        </section>
      )}
    </div>
  );
}
