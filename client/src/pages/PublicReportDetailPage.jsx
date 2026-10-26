import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { Button, Card } from '../components/ui/index.js';
import { IconDownload } from '../components/ui/icons.jsx';
import ClientReportView, { ClientReportHeading } from '../components/ClientReportView.jsx';
import ClientReportMap from '../components/ClientReportMap.jsx';
import { deriveReportSections } from '../lib/reportDerive.js';
import { classifyShareError, endsShareSession, shareRetry, SHARE_COPY } from '../lib/shareErrors.js';
import { markOpenedToday, wasOpenedToday } from '../lib/shareAccess.js';

// One report as the client reads it (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §H3): its scope and
// dates, "Numbers as of …" when they stopped early, the earlier-totals line, Older / Newer within its
// series, the team note on a team report, the PDF, and the map. A report taken down or removed says
// so and keeps the session; the map's own answers (no map, a newer snapshot) stay inside the map.
//
// On a link to this report only (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D) nothing points at
// another report: no "‹ All reports", no Older / Newer (the server sends `nav: null`), the heading
// says "This link opens this report only.", the earlier-totals line names no other report (its
// `before` form, worded in reportDerive), and taken down reads "Ask the person who sent it." with no
// "see all reports".

const allReportsPath = (token, report) =>
  report?.scope?.seriesKey ? `/r/${token}?tab=${encodeURIComponent(report.scope.seriesKey)}` : `/r/${token}`;

function SeriesNav({ token, report }) {
  const older = report.nav?.olderId || null;
  const newer = report.nav?.newerId || null;
  const step = (id, text) =>
    id ? (
      <Link to={`/r/${token}/reports/${id}`} className="font-medium text-brand-accent hover:underline">
        {text}
      </Link>
    ) : (
      <span className="text-fg-subtle" aria-disabled="true">
        {text}
      </span>
    );
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
      <Link to={allReportsPath(token, report)} className="font-medium text-brand-accent hover:underline">
        ‹ All reports
      </Link>
      {(older || newer) && (
        <span className="flex items-center gap-2">
          {step(older, '‹ Older')}
          <span className="text-fg-subtle" aria-hidden="true">
            ·
          </span>
          {step(newer, 'Newer ›')}
        </span>
      )}
    </div>
  );
}

function ReportPage({ data, outlet, onReload, single }) {
  const { token, session, accessToken, hub, logo } = outlet;
  const { report, survey } = data;
  const sections = useMemo(() => deriveReportSections(report), [report]);
  // "No map" from the map's own fetches hides the section for THIS copy of the report — which is out
  // of date, so it is re-fetched (onMapError). A re-fetch that brings a different report (React
  // Query keeps the same object when nothing changed) gives the map another look: a map switched off
  // and back on comes back without a reload (PUBUX-1). It can't loop — only new content re-mounts it.
  const [mapOffFor, setMapOffFor] = useState(null);
  const mapHidden = mapOffFor === report;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(null);

  // "Opened" (§F7): one ping per report per browser per day, sent with the visitor's Doorline
  // sign-in if this browser has one (identifyIfSignedIn), so the org's own people count apart from
  // the link. Fire and forget; the day is marked only once the server took it.
  useEffect(() => {
    if (!report?.id || wasOpenedToday(token, report.id)) return undefined;
    const ctrl = new AbortController();
    api(`/share/${token}/reports/${report.id}/opened`, {
      method: 'POST',
      public: true,
      shareToken: accessToken,
      identifyIfSignedIn: true,
      signal: ctrl.signal,
    })
      .then(() => markOpenedToday(token, report.id))
      .catch(() => {});
    return () => ctrl.abort();
  }, [token, report?.id, accessToken]);

  // The map's failures go through the one handler too; "no map" hides the section and reloads the
  // report, whose copy here still says there is one.
  const onMapError = useCallback(
    (err) => {
      if (session.handleError(err, accessToken).kind !== 'map-off') return;
      setMapOffFor(report);
      onReload?.();
    },
    [session, accessToken, report, onReload]
  );

  const downloadPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const { generateReportPdf, blobToDataUrl } = await import('../lib/reportPdf.js');
      const logoDataUrl = await blobToDataUrl(logo?.blob);
      await generateReportPdf(report, { campaignName: hub?.campaignName, orgName: hub?.orgName, logoDataUrl });
    } catch (err) {
      console.error('PDF export failed', err);
      setPdfError("Couldn't make the PDF — try again.");
    } finally {
      setPdfBusy(false);
    }
  };

  const pdfButton = (
    <Button variant="secondary" size="sm" loading={pdfBusy} onClick={downloadPdf}>
      <IconDownload size={14} />
      <span className="hidden sm:inline">Download PDF</span>
      <span className="sm:hidden">PDF</span>
    </Button>
  );

  return (
    <div className="space-y-6">
      <ClientReportHeading
        report={report}
        nav={single ? null : <SeriesNav token={token} report={report} />}
        note={single ? 'This link opens this report only.' : null}
        actions={pdfButton}
      />
      {pdfError && (
        <p role="alert" className="text-sm text-danger-fg">
          {pdfError}
        </p>
      )}
      <ClientReportView report={report} />
      {report.visibility?.showMap && !mapHidden && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">Where we&apos;ve been</h2>
          <ClientReportMap
            mapPath={`/share/${token}/reports/${report.id}/map`}
            doorsPath={`/share/${token}/reports/${report.id}/map/doors`}
            areasPath={`/share/${token}/reports/${report.id}/areas`}
            tokenPath={`/share/${token}/mapbox-token`}
            survey={survey}
            campaignType={report.campaignType}
            mapMode={report.visibility.mapMode}
            // What the map serves, as of this copy of the report (C7): a re-fetched report with a
            // new version re-fetches its map at once — pins, areas, and the questions it filters by.
            mapVersion={report.visibility.mapVersion ?? null}
            requestOpts={{ public: true, shareToken: accessToken }}
            emptyText={sections.mapEmptyText}
            onError={onMapError}
            onUpdated={onReload}
            fullBleedOnPhone
          />
        </section>
      )}
    </div>
  );
}

export default function PublicReportDetailPage() {
  const { reportId } = useParams();
  const outlet = useOutletContext();
  const { token, session, accessToken, hub, hubQ } = outlet;
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['share', token, accessToken, 'report', reportId],
    queryFn: ({ signal }) => session.get(`/reports/${reportId}`, { signal }),
    retry: shareRetry,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const kind = q.error ? classifyShareError(q.error).kind : null;
  // Which kind of link this is (§D): the report's read says, and so does the hub — the only one that
  // can once the report is gone. null until one of them has answered.
  const single = q.data?.single ?? hub?.single ?? null;

  // A report taken down or removed: the hub's list is out of date too.
  useEffect(() => {
    if (kind === 'report-gone') qc.invalidateQueries({ queryKey: ['share', token, accessToken, 'reports'] });
  }, [kind, qc, token, accessToken]);

  if (q.isLoading) return <div className="text-sm text-fg-muted">Loading…</div>;
  if (kind === 'report-gone') {
    // The way out depends on the link, so a moment's Loading… while the hub is still on its way
    // rather than "see all reports" on a link that has none.
    if (single === null && hubQ?.isLoading) return <div className="text-sm text-fg-muted">Loading…</div>;
    if (single) return <Card className="p-6 text-sm text-fg-muted">{SHARE_COPY.reportGoneSingle}</Card>;
    return (
      <Card className="p-6 text-sm text-fg-muted">
        {SHARE_COPY.reportGone} —{' '}
        <Link to={`/r/${token}`} className="font-medium text-brand-accent hover:underline">
          see all reports
        </Link>
        .
      </Card>
    );
  }
  if (q.error) {
    // A 401 or a dead link already took the page to the gate or the notice.
    if (endsShareSession(kind)) return null;
    return (
      <Card className="p-6 text-sm text-fg-muted">
        {SHARE_COPY.retry} this report.{' '}
        <Button variant="secondary" size="sm" className="ml-2" onClick={() => q.refetch()}>
          Try again
        </Button>
      </Card>
    );
  }
  if (!q.data?.report) return null;
  return <ReportPage key={reportId} data={q.data} outlet={outlet} onReload={() => q.refetch()} single={!!single} />;
}
