import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { formatInTz } from '../../lib/datetime.js';
import { formatDistanceImperial } from '../../lib/flags.js';
import { actionLabel } from '../../lib/statusColors.js';
import { summarySentence, alertLine, statusLine, markLabel, secondsText, mphText, distanceLine } from '../../lib/pacePause.js';

// One automatic pause, opened from the Audit page's list or the alert email
// (/campaigns/:campaignId/audit/pauses/:pauseId; docs/PROPOSAL_PACE_PAUSE.md §G.2).

const TIME = { hour: 'numeric', minute: '2-digit', second: '2-digit' };

// Everything a pause refresh should refresh — the same set a flag review does, plus the pause queries.
export const invalidatePaceCaches = (qc) =>
  qc.invalidateQueries({
    predicate: (q) =>
      (q.queryKey?.[0] === 'admin' && ['pace-pauses', 'campaigns'].includes(q.queryKey?.[1])) ||
      q.queryKey?.[0] === 'memberships' ||
      (q.queryKey?.[0] === 'reports' && q.queryKey?.[1] === 'campaign-rollup'),
  });

// The pure view, rendered from the detail answer (GET /admin/pace-pauses/:id). A row on a campaign the viewer
// doesn't manage arrives as { at, fail, otherCampaign } and is shown as just that.
export const PacePauseDetailView = ({ detail: d, tz, campaignId, busy, confirming, onAsk, onCancel, onUnpause, onDelete }) => {
  const zone = d.timeZone || tz;
  return (
    <section className="mb-6 rounded-lg border border-danger/30 bg-card p-4" aria-label="Automatic pause">
      <Link to={`/campaigns/${campaignId}/audit`} className="text-xs font-medium text-brand-accent hover:underline">
        ← Back to the audit
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-fg">{d.name || 'A canvasser'} was paused for review</h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            {d.campaignName} · {formatInTz(d.firedAt, zone)}
          </p>
          <p className={'mt-1 text-sm font-medium ' + (d.status === 'paused' && d.blocking ? 'text-danger' : 'text-fg-muted')}>{statusLine(d, zone)}</p>
          <p className="mt-1 text-xs text-fg-muted">{alertLine(d.alert, zone)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d.canUnpause && (
            <button type="button" disabled={busy} onClick={() => onAsk('unpause')} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60">
              Unpause
            </button>
          )}
          {d.doorOutcomesUrl && (
            <Link to={d.doorOutcomesUrl} className="rounded-md border border-border-strong bg-card px-3 py-2 text-sm font-medium text-fg hover:bg-sunken">
              Open these doors in Door Outcomes
            </Link>
          )}
          {d.mapUrl && (
            <Link to={d.mapUrl} className="rounded-md border border-border-strong bg-card px-3 py-2 text-sm font-medium text-fg hover:bg-sunken">
              See the day on the map
            </Link>
          )}
          {d.canDelete && (
            <button type="button" disabled={busy} onClick={() => onAsk('delete')} className="rounded-md px-3 py-2 text-sm font-medium text-danger hover:bg-danger-tint disabled:opacity-60">
              Delete record
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-sunken px-3 py-2">
          <p className="text-sm text-fg">
            {confirming === 'unpause'
              ? `Unpause ${d.name || 'this canvasser'}? They can record again right away, and their count starts over. Nothing they saved is changed.`
              : 'Delete this record? It can’t be brought back. Their doors are not changed.'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-card">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={confirming === 'unpause' ? onUnpause : onDelete}
              className={'rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60 ' + (confirming === 'unpause' ? 'bg-brand-600 hover:bg-brand-700' : 'bg-danger hover:opacity-90')}
            >
              {confirming === 'unpause' ? 'Unpause' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 text-sm text-fg">{summarySentence(d.summary)}</p>
      {d.implausible && (
        <p className="mt-1 text-sm text-warning-fg">
          Some hops are faster than any car on these streets. Check that two phones aren&apos;t signed in to one account.
        </p>
      )}
      {distanceLine(d.medianDistanceFromHouseM, formatDistanceImperial) && (
        <p className="mt-1 text-sm text-fg-muted">{distanceLine(d.medianDistanceFromHouseM, formatDistanceImperial)}</p>
      )}

      <h3 className="mt-5 text-sm font-semibold text-fg">The doors behind the pause</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="text-fg-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">Time</th>
              <th className="py-1 pr-3 font-medium">Door</th>
              <th className="py-1 pr-3 font-medium">Result</th>
              <th className="py-1 pr-3 font-medium">Since the last house</th>
              <th className="py-1 pr-3 font-medium">Distance</th>
              <th className="py-1 pr-3 font-medium">Speed</th>
              <th className="py-1 pr-3 font-medium">Needed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(d.window || []).map((v, i) =>
              v.otherCampaign ? (
                <tr key={i} className={v.fail ? 'bg-danger-tint' : ''}>
                  <td className="py-1.5 pr-3 text-fg">{formatInTz(v.at, zone, TIME)}</td>
                  <td className="py-1.5 pr-3 text-fg-muted" colSpan={6}>
                    A door on another campaign{v.fail ? ' — too fast' : ''}
                  </td>
                </tr>
              ) : (
                <tr key={i} className={v.fail ? 'bg-danger-tint' : ''}>
                  <td className="py-1.5 pr-3 text-fg">{formatInTz(v.at, zone, TIME)}</td>
                  <td className="py-1.5 pr-3 text-fg">{v.address || '—'}</td>
                  <td className="py-1.5 pr-3 text-fg">{actionLabel(v.result)}</td>
                  <td className="py-1.5 pr-3 text-fg">{v.gapSec == null ? 'first door' : secondsText(v.gapSec)}</td>
                  <td className="py-1.5 pr-3 text-fg">{v.prevOtherCampaign ? '—' : v.meters == null ? '—' : formatDistanceImperial(v.meters)}</td>
                  <td className="py-1.5 pr-3 text-fg">{v.prevOtherCampaign ? '—' : mphText(v.mph)}</td>
                  <td className="py-1.5 pr-3 text-fg">
                    {v.prevOtherCampaign || v.neededSec == null ? '—' : secondsText(v.neededSec)}
                    {v.surveyCheck?.fail ? ' · survey too soon' : ''}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {(d.dayEntries || []).length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-fg">Every door they saved that day</h3>
          <ul className="mt-2 divide-y divide-border text-xs">
            {d.dayEntries.map((e, i) =>
              e.otherCampaign ? (
                <li key={i} className="flex justify-between gap-3 py-1.5 text-fg-muted">
                  <span>{formatInTz(e.at, zone, TIME)} · a door on another campaign</span>
                </li>
              ) : (
                <li key={i} className="flex flex-wrap justify-between gap-3 py-1.5">
                  <span className="text-fg">
                    {formatInTz(e.at, zone, TIME)} · {e.address || '—'} · {actionLabel(e.result)}
                  </span>
                  <span className={e.mark === 'pause' || e.mark === 'failed' ? 'text-danger' : 'text-fg-muted'}>{markLabel(e.mark, e.why)}</span>
                </li>
              )
            )}
          </ul>
        </>
      )}
    </section>
  );
};

const PacePausePanel = ({ pauseId, campaignId, tz }) => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(null);
  const [notice, setNotice] = useState(null);
  const detailQ = useQuery({
    queryKey: ['admin', 'pace-pauses', 'detail', pauseId],
    queryFn: () => api(`/admin/pace-pauses/${pauseId}`),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    retry: (n, err) => err?.status !== 404 && err?.status !== 403 && n < 2,
  });
  const unpauseM = useMutation({
    mutationFn: () => api(`/admin/pace-pauses/${pauseId}/unpause`, { method: 'POST' }),
    onSuccess: () => {
      setConfirming(null);
      setNotice('Unpaused. They can record again.');
      invalidatePaceCaches(qc);
    },
    onError: (err) => setNotice(err?.message || 'Could not unpause.'),
  });
  const deleteM = useMutation({
    mutationFn: () => api(`/admin/pace-pauses/${pauseId}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidatePaceCaches(qc);
      navigate(`/campaigns/${campaignId}/audit`, { replace: true });
    },
    onError: (err) => setNotice(err?.message || 'Could not delete the record.'),
  });

  if (detailQ.isLoading) return <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">Loading the pause…</div>;
  if (detailQ.error) {
    const gone = detailQ.error.status === 404;
    return (
      <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm">
        <p className="font-medium text-fg">{gone ? 'This pause is no longer here.' : detailQ.error.status === 403 ? 'You no longer manage this campaign.' : detailQ.error.message}</p>
        <Link to={`/campaigns/${campaignId}/audit`} className="mt-2 inline-block text-xs font-semibold text-brand-accent hover:underline">
          Back to the audit
        </Link>
      </div>
    );
  }
  return (
    <>
      {notice && <div className="mb-2 rounded-md border border-border bg-sunken px-3 py-2 text-sm text-fg">{notice}</div>}
      <PacePauseDetailView
        detail={detailQ.data}
        tz={tz}
        campaignId={campaignId}
        busy={unpauseM.isPending || deleteM.isPending}
        confirming={confirming}
        onAsk={(what) => {
          setNotice(null);
          setConfirming(what);
        }}
        onCancel={() => setConfirming(null)}
        onUnpause={() => unpauseM.mutate()}
        onDelete={() => deleteM.mutate()}
      />
    </>
  );
};

export default PacePausePanel;
