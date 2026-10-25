import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Badge, Button, Drawer, Skeleton } from '../ui/index.js';
import { formatInTz } from '../../lib/datetime.js';
import { clientReportHistoryLine, isNotableClientReportRow, reportRowName } from '../../lib/campaignHistory.js';
import { ConfirmDialog, ErrorBanner } from './parts.jsx';
import { historyKey, seriesKey } from './hooks.js';
import { formatDayOf } from './reportDates.js';

// The Client Reports tab's History (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F9, §O8): publishes,
// refreshes, edits, take-downs, deletes, team changes and every link change — kept OUT of the
// campaign's general History and the phone. It asks with ?include=client_reports under its OWN query
// key (the general drawer and the phone share ['admin','campaign-history',id]), and refetches on focus
// and after every action.
//
// An edit row keeps the EARLIER text. Restore applies it as a normal edit (refused once erased);
// Erase (admins) removes it for good — one row, or "all earlier text for this report", beyond this
// page and after the report is deleted. Erase first asks the server what it would touch (a dry run),
// so the confirm can name later drafts Next copied the text into, and warn when it is the report's
// current text. Leads read this history, and a lead can be the client, so it is customer-facing.

const sectionsText = (obs) => (obs || []).map((s) => `${s.heading}${s.body ? `\n${s.body}` : ''}`).join('\n\n');

// Who sees a Restore, and when — in the builder's Update confirm's words (ADMINUX-9). A published
// report's restore is marked Edited and keeps the replaced text here; a taken-down one's client sees
// nothing until it is put back up; a draft's client sees nothing at all (and the server writes no row).
export const RestoreReach = ({ report, tz }) => {
  if (report?.status !== 'published') return null;
  return report.takenDownAt ? (
    <p>This report is taken down, so your client sees the change when you put it back up. The text it replaces is kept here in History.</p>
  ) : (
    <p>
      This report is published: your client sees the change right away, marked “Edited {formatDayOf(new Date(), tz)}”. The text it replaces is kept here in History.
    </p>
  );
};

const HistoryDrawer = ({ campaignId, tz, isAdmin, reportsById = new Map(), onClose, onReportChanged }) => {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: historyKey(campaignId),
    queryFn: () => api(`/admin/campaigns/${campaignId}/history?include=client_reports`),
    enabled: !!campaignId,
    refetchOnWindowFocus: true,
  });
  const items = q.data?.items || [];
  // The tabs' current names, so a report row reads "Oct 13 – Oct 19, 2026 · Paid team report" and an
  // older team row names its team (WALK-3). The page's own series query (same key), so nothing more is
  // fetched; until it answers, rows read as they did, by period.
  const seriesQ = useQuery({
    queryKey: seriesKey(campaignId),
    queryFn: () => api(`/admin/client-reports/series?campaignId=${campaignId}`),
    enabled: !!campaignId,
  });
  const seriesLabels = useMemo(() => new Map((seriesQ.data?.series || []).map((s) => [String(s.id), s.label])), [seriesQ.data]);
  const [open, setOpen] = useState(() => new Set()); // edit rows whose earlier text is expanded
  const [restoring, setRestoring] = useState(null); // the row
  const [erasing, setErasing] = useState(null); // { row?, reportId, all, preview }
  const [alsoDrafts, setAlsoDrafts] = useState(false);
  const [error, setError] = useState(null);
  const refetch = () => qc.invalidateQueries({ queryKey: historyKey(campaignId) });

  const restore = useMutation({
    mutationFn: (row) => api(`/admin/campaigns/${campaignId}/history/${row.id}/restore`, { method: 'POST' }),
    onSuccess: (_res, row) => {
      setRestoring(null);
      setError(null);
      refetch();
      onReportChanged?.(row.clientReportId);
    },
    onError: (e) => {
      setRestoring(null);
      setError(e);
      refetch();
    },
  });
  const erasePath = (target) => (target.all ? `/admin/campaigns/${campaignId}/history/erase` : `/admin/campaigns/${campaignId}/history/${target.row.id}/erase`);
  const eraseBody = (target, extra) => (target.all ? { clientReportId: target.reportId, ...extra } : extra);
  // The dry run first: how many rows, whether it is the report's current text, and which later drafts
  // Next copied it into.
  const preview = useMutation({
    mutationFn: (target) => api(erasePath(target), { method: 'POST', body: eraseBody(target, { dryRun: true }) }).then((p) => ({ ...target, preview: p })),
    onSuccess: (target) => {
      setAlsoDrafts(false);
      setErasing(target);
    },
    onError: setError,
  });
  const erase = useMutation({
    mutationFn: (target) => api(erasePath(target), { method: 'POST', body: eraseBody(target, { alsoDrafts }) }),
    onSuccess: () => {
      setErasing(null);
      setError(null);
      refetch();
      onReportChanged?.(null);
    },
    onError: (e) => {
      setErasing(null);
      setError(e);
      refetch();
    },
  });

  return (
    <Drawer title="Client report history" onClose={onClose} width="max-w-lg">
      <div className="border-b border-border px-5 py-3">
        <p className="text-xs text-fg-muted">
          Publishes, edits, refreshes, take-downs, deletes, team and link changes, newest first. Team leads on this campaign can read it,
          including the earlier text of edits{isAdmin ? ' — you can erase that text' : ''}.
        </p>
      </div>
      {error && (
        <div className="px-5 pt-3">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {q.isLoading ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : q.isError ? (
        <div className="p-5">
          <ErrorBanner title="Couldn’t load the history." error={q.error} />
        </div>
      ) : (
        <>
          {q.data?.truncated && (
            <p className="border-b border-border bg-sunken px-5 py-2 text-xs text-fg-muted">Showing the most recent 200 changes only.</p>
          )}
          {items.length === 0 && <p className="p-5 text-sm text-fg-muted">Nothing has happened to this campaign’s client reports yet.</p>}
          <ul className="divide-y divide-border">
            {items.map((it) => {
              const line = clientReportHistoryLine(it, { seriesLabels });
              const isEdit = it.field === 'clientReport.edited';
              const text = isEdit ? it.fromValue : null;
              const report = it.clientReportId ? reportsById.get(it.clientReportId) : null;
              const gone = it.by?.status && it.by.status !== 'active';
              return (
                <li key={it.id} className={`px-5 py-3.5 ${isNotableClientReportRow(it) ? 'border-l-2 border-l-warning bg-warning-tint/30' : ''}`}>
                  <div className="text-sm text-fg">
                    {line.subject && <span className="font-medium">{line.subject}</span>}
                    {line.subject && <span className="text-fg-muted"> · </span>}
                    <span>{line.headline}</span>
                  </div>
                  {line.detail && <div className="mt-0.5 text-xs text-fg-muted">{line.detail}</div>}
                  {isEdit && text && (
                    <div className="mt-1.5">
                      <button
                        type="button"
                        className="text-xs font-semibold text-brand-accent hover:underline"
                        onClick={() =>
                          setOpen((s) => {
                            const next = new Set(s);
                            if (next.has(it.id)) next.delete(it.id);
                            else next.add(it.id);
                            return next;
                          })
                        }
                      >
                        {open.has(it.id) ? 'Hide the earlier text' : 'Show the earlier text'}
                      </button>
                      {open.has(it.id) && (
                        <div className="mt-1.5 space-y-1.5 rounded-md border border-border bg-sunken/60 p-2.5 text-xs text-fg">
                          {typeof text.title === 'string' && (
                            <p>
                              <span className="text-fg-muted">Title: </span>
                              {text.title || <span className="text-fg-muted">(none)</span>}
                            </p>
                          )}
                          {Array.isArray(text.observations) && (
                            <div>
                              <span className="text-fg-muted">Notes:</span>
                              <p className="mt-0.5 whitespace-pre-line">{sectionsText(text.observations) || '(none)'}</p>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {report && (
                          <Button size="sm" variant="secondary" onClick={() => setRestoring(it)}>
                            Restore
                          </Button>
                        )}
                        {isAdmin && (
                          <Button size="sm" variant="ghost" loading={preview.isPending && preview.variables?.row?.id === it.id} onClick={() => preview.mutate({ row: it, reportId: it.clientReportId, all: false })}>
                            Erase
                          </Button>
                        )}
                        {isAdmin && it.clientReportId && (
                          <Button size="sm" variant="ghost" loading={preview.isPending && preview.variables?.all && preview.variables?.reportId === it.clientReportId} onClick={() => preview.mutate({ reportId: it.clientReportId, all: true, reportName: reportRowName(it, seriesLabels) })}>
                            Erase all earlier text for this report
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {isEdit && it.erasedAt && (
                    <div className="mt-0.5 text-xs text-fg-muted">
                      Erased by {it.erasedBy?.name || 'an admin'} · {formatInTz(it.erasedAt, tz)}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                    <span>{it.by?.name || 'Doorline'}</span>
                    {gone && <Badge variant="neutral">{it.by.status}</Badge>}
                    <span>·</span>
                    <span>{formatInTz(it.at, tz)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {restoring && (
        <ConfirmDialog
          title="Restore this earlier text?"
          confirmLabel="Restore"
          busy={restore.isPending}
          onClose={() => setRestoring(null)}
          onConfirm={() => restore.mutate(restoring)}
        >
          <p>It replaces the report’s current {typeof restoring.fromValue?.title === 'string' && Array.isArray(restoring.fromValue?.observations) ? 'title and notes' : Array.isArray(restoring.fromValue?.observations) ? 'notes' : 'title'}, as an edit.</p>
          <RestoreReach report={reportsById.get(restoring.clientReportId)} tz={tz} />
        </ConfirmDialog>
      )}
      {erasing && (
        <ConfirmDialog
          title={
            !erasing.all
              ? 'Erase this earlier text?'
              : erasing.reportName
                ? `Erase all earlier text for the ${erasing.reportName} report?`
                : 'Erase all earlier text for this report?'
          }
          confirmLabel="Erase for good"
          danger
          busy={erase.isPending}
          onClose={() => setErasing(null)}
          onConfirm={() => erase.mutate(erasing)}
        >
          <p>
            {erasing.all
              ? `${erasing.preview?.rows ?? 0} ${erasing.preview?.rows === 1 ? 'entry holds' : 'entries hold'} earlier text for this report, including any beyond this page.`
              : 'This earlier text is removed from History for good.'}{' '}
            It can’t be restored afterwards.
          </p>
          {erasing.preview?.currentTextMatches && (
            <p className="text-warning-fg">This is also the report’s current text. Erasing removes it from History only — never from the report itself.</p>
          )}
          {erasing.preview?.copiedDrafts > 0 && (
            <label className="flex items-start gap-2 text-fg">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-accent" checked={alsoDrafts} onChange={(e) => setAlsoDrafts(e.target.checked)} />
              <span>
                Next report copied these notes into{' '}
                {(erasing.preview.copiedDraftPeriods || []).length
                  ? `the ${erasing.preview.copiedDraftPeriods.join(', ')} ${erasing.preview.copiedDraftPeriods.length === 1 ? 'draft' : 'drafts'}`
                  : `${erasing.preview.copiedDrafts} later ${erasing.preview.copiedDrafts === 1 ? 'draft' : 'drafts'}`}
                . Also remove them there (marked for review again).
              </span>
            </label>
          )}
        </ConfirmDialog>
      )}
    </Drawer>
  );
};

export default HistoryDrawer;
