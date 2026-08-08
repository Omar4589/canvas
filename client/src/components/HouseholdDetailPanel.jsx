import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import { formatInTz } from '../lib/datetime.js';
import { actionLabel } from '../lib/statusColors.js';

// The billable knock set — MUST mirror the server's KNOCK_ACTIONS
// (services/reports/aggregations.js) so the inline overlap badge counts collisions the same
// way /overlap-doors (the map ring) does. `restricted` and `note_added` are deliberately out.
const OVERLAP_KNOCK_ACTIONS = new Set(['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped', 'no_soliciting']);

function formatDateTime(d, tz) {
  if (!d) return '—';
  return (
    formatInTz(
      d,
      tz,
      { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' },
      true
    ) || '—'
  );
}

function formatAnswer(answer) {
  if (answer == null || answer === '') return '—';
  if (Array.isArray(answer)) return answer.length ? answer.join(', ') : '—';
  return String(answer);
}

// Address-level "never come back". Set/lift live here rather than on a menu because the door
// panel is where an admin or lead is standing when a canvasser reports the request.
//
// Two things this control deliberately says out loud:
//   - it suppresses the address in EVERY campaign, not just this one (Household rows are
//     per-campaign; the request is not), and
//   - it does not auto-reopen, so lifting it is a human act.
// Both are surprises if discovered later rather than read here.
function DoNotKnockSection({ household, onChanged }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const qc = useQueryClient();
  const on = household.doNotKnock === true;

  const invalidate = () => {
    // Prefix match — the map key carries every filter after these two segments.
    qc.invalidateQueries({ queryKey: ['admin', 'households-map'] });
    qc.invalidateQueries({ queryKey: ['do-not-knock'] });
    onChanged?.();
  };

  const set = useMutation({
    mutationFn: () =>
      api(`/admin/households/${household.id}/do-not-knock`, { method: 'POST', body: { reason: reason.trim() } }),
    onSuccess: (r) => {
      setOpen(false);
      setReason('');
      setErr(null);
      invalidate();
      if ((r?.doorsAffected || 0) > 1) {
        window.alert(
          `Marked do not knock. This address appears in ${r.doorsAffected} campaigns — all of them are now suppressed.`
        );
      }
    },
    onError: (e) => setErr(e?.message || 'Could not mark this address.'),
  });

  const lift = useMutation({
    mutationFn: () => api(`/admin/households/${household.id}/do-not-knock`, { method: 'DELETE' }),
    onSuccess: () => { setErr(null); invalidate(); },
    onError: (e) => setErr(e?.message || 'Could not lift the request.'),
  });

  const busy = set.isPending || lift.isPending;

  if (on) {
    return (
      <div className="border-b border-border px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-fg-muted">Do not knock</div>
        <div className="mt-1 text-sm font-medium text-danger">⛔ Nobody visits this address</div>
        <p className="mt-1 text-xs text-fg-muted">
          Suppressed in every campaign, and it will not reopen on its own — not even when new
          residents are imported here.
        </p>
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Lift the do-not-knock request? This address becomes knockable again in every campaign.')) {
              lift.mutate();
            }
          }}
          className="mt-2 rounded-md border border-border-strong px-2 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-50"
        >
          {lift.isPending ? 'Lifting…' : 'Lift request'}
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-border px-4 py-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-border-strong px-2 py-1 text-xs font-medium text-fg-muted hover:bg-sunken"
        >
          Mark do not knock…
        </button>
      ) : (
        <div>
          <div className="text-xs uppercase tracking-wide text-fg-muted">Mark do not knock</div>
          <p className="mt-1 text-xs text-fg-muted">
            Nobody visits this address again, in this and every other campaign. Individual voters
            keep their own do-not-contact status.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Why? (required — e.g. resident asked us never to return)"
            className="mt-2 w-full rounded-md border border-border bg-card px-2 py-1 text-sm text-fg"
          />
          {err && <p className="mt-1 text-xs text-danger">{err}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy || reason.trim().length < 3}
              onClick={() => set.mutate()}
              className="rounded-md bg-danger px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {set.isPending ? 'Marking…' : 'Mark do not knock'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setOpen(false); setErr(null); }}
              className="rounded-md border border-border-strong px-2 py-1 text-xs font-medium text-fg-muted hover:bg-sunken"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HouseholdDetailPanel({
  household,
  onClose,
  onMovePin,
  onDoNotKnockChanged,
  statusColors,
  statusLabels,
  tz,
  passId,
}) {
  const orgTz = useOrgTimeZone();
  const zone = tz || orgTz;
  const h = household;
  // Survey ANSWERS are lazy-loaded per door — the bulk map payload ships each survey's meta
  // only (its heaviest field stays off the every-20s live poll). Merged by survey id below;
  // the meta list renders instantly and answers fill in on arrival. passId mirrors the map's
  // round scoping so the panel shows the same survey set as the pins.
  const surveysQ = useQuery({
    queryKey: ['household-surveys', h?.id, passId || ''],
    queryFn: () => api(`/admin/households/${h.id}/surveys${passId ? `?passId=${passId}` : ''}`),
    enabled: !!h?.id && (h.surveys?.length || 0) > 0,
  });
  const surveyDetailById = new Map((surveysQ.data?.surveys || []).map((s) => [s.id, s]));
  // Full per-round activity history (so a door worked in multiple rounds shows all).
  const activityQ = useQuery({
    queryKey: ['household-activity', h?.id],
    queryFn: () => api(`/admin/households/${h.id}/activity`),
    enabled: !!h?.id,
  });
  const rounds = activityQ.data?.rounds || [];

  // Overlap detection — day-agnostic, straight from the already-loaded activity rounds (no
  // extra fetch). Counted EXACTLY like the authoritative /overlap-doors ring so the badge and
  // the map can never disagree: distinct canvassers by USER ID (not display name — two
  // same-named volunteers are two canvassers) among KNOCK_ACTIONS only (restricted is a
  // marker, not a knock — excluded, matching the server's KNOCK_ACTIONS). 2+ in one pass = an
  // overlap. Each pass maps id → name (for display).
  const overlapByPass = useMemo(() => {
    const m = new Map();
    for (const r of rounds) {
      const byId = new Map();
      for (const e of r.entries || []) {
        if (!OVERLAP_KNOCK_ACTIONS.has(e.actionType)) continue;
        const id = e.canvasserId || e.canvasser; // fall back to name only if an old server omits the id
        if (id) byId.set(id, e.canvasser || 'Unknown');
      }
      if (byId.size >= 2) m.set(r.passId || 'none', byId);
    }
    return m;
  }, [rounds]);
  const hasOverlap = overlapByPass.size > 0;
  // Name the colliding canvassers other than this door's own status owner (its last action)
  // — "also worked by …" reads relative to whoever owns the door now.
  const primaryId = h.lastAction?.canvasser?.id || null;
  const primaryName = h.lastAction?.canvasser
    ? `${h.lastAction.canvasser.firstName || ''} ${h.lastAction.canvasser.lastName || ''}`.trim()
    : '';
  const overlapOthers = useMemo(() => {
    const s = new Map(); // id → name, so same-named distinct canvassers both appear
    for (const byId of overlapByPass.values()) {
      for (const [id, nm] of byId) {
        if (primaryId ? id !== primaryId : nm !== primaryName) s.set(id, nm);
      }
    }
    return [...s.values()];
  }, [overlapByPass, primaryId, primaryName]);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: statusColors[h.status] }}
            />
            <span className="text-xs uppercase tracking-wide text-fg-muted">
              {statusLabels[h.status]}
            </span>
            {hasOverlap && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-warning-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-fg"
                title="Worked by two or more canvassers in the same pass"
              >
                ⚠ Overlap
              </span>
            )}
            {h.doNotKnock && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-danger-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger"
                title="This address asked that nobody come back — suppressed in every campaign"
              >
                ⛔ Do not knock
              </span>
            )}
          </div>
          <div className="mt-1 truncate font-medium text-fg">{h.addressLine1}</div>
          {h.addressLine2 && (
            <div className="truncate text-sm text-fg-muted">{h.addressLine2}</div>
          )}
          <div className="text-xs text-fg-muted">
            {h.city}, {h.state} {h.zipCode}
          </div>
          {overlapOthers.length > 0 && (
            <div className="mt-1.5 text-[11px] font-medium text-warning-fg">
              ⚠ Also worked by {overlapOthers.join(', ')}{' '}
              {overlapByPass.size > 1 ? 'in the same pass' : 'this pass'}
            </div>
          )}
          {h.coordSource === 'corrected' ? (
            <div className="mt-1.5 inline-flex items-center rounded bg-brand-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-accent">
              Pin corrected{h.correctedAt ? ` · ${formatInTz(h.correctedAt, zone, { month: 'short', day: 'numeric' }, false)}` : ''}
            </div>
          ) : h.coordConfidence === 'interpolated' ? (
            <div className="mt-1.5 inline-flex items-center rounded bg-warning-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-fg">
              Approximate location
            </div>
          ) : null}
          {onMovePin && (
            <div className="mt-2">
              <button
                type="button"
                onClick={onMovePin}
                className="rounded-md border border-border-strong px-2 py-1 text-xs font-medium text-fg-muted hover:bg-sunken"
              >
                Move pin →
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-fg-subtle hover:bg-sunken hover:text-fg-muted"
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" />
          </svg>
        </button>
      </div>

      <DoNotKnockSection household={h} onChanged={onDoNotKnockChanged} />

      {h.lastAction && (
        <div className="border-b border-border px-4 py-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-fg-muted">Last action</div>
          <div className="mt-1 text-fg">{actionLabel(h.lastAction.actionType)}</div>
          <div className="text-xs text-fg-muted">
            {formatDateTime(h.lastAction.timestamp, zone)}
            {h.lastAction.canvasser && (
              <>
                {' · '}
                {h.lastAction.canvasser.firstName} {h.lastAction.canvasser.lastName}
              </>
            )}
          </div>
        </div>
      )}

      {rounds.length > 0 && (
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-fg-muted">History by pass</div>
          <div className="space-y-2">
            {rounds.map((r) => (
              <div key={r.passId || 'none'}>
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-fg">
                  <span>
                    {r.roundNumber != null ? `Pass ${r.roundNumber}` : r.name}
                    {r.roundNumber != null && r.name ? <span className="font-normal text-fg-muted"> · {r.name}</span> : null}
                  </span>
                  {overlapByPass.has(r.passId || 'none') && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-fg">
                      ⚠ Overlap
                    </span>
                  )}
                </div>
                <ul className="mt-0.5 space-y-0.5">
                  {r.entries.map((e, i) => (
                    <li key={i} className="text-xs text-fg-muted">
                      {actionLabel(e.actionType)} · {formatDateTime(e.at, zone)}
                      {e.canvasser ? ` · ${e.canvasser}` : ''}
                      {e.note ? (
                        <div className="mt-0.5 rounded bg-sunken px-2 py-1 italic text-fg-muted">
                          “{e.note}”
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-fg-muted">
          Voters ({h.voters?.length || 0})
        </div>
        {h.voters?.length ? (
          <ul className="space-y-1.5">
            {h.voters.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-fg">{v.fullName}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  {v.party && (
                    <span className="rounded bg-sunken px-1.5 py-0.5 text-fg-muted">
                      {v.party}
                    </span>
                  )}
                  {v.surveyStatus === 'surveyed' ? (
                    <span className="rounded bg-success-tint px-1.5 py-0.5 text-success">
                      surveyed
                    </span>
                  ) : (
                    <span className="rounded bg-sunken px-1.5 py-0.5 text-fg-muted">
                      not surveyed
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-fg-muted">No voters on file.</div>
        )}
      </div>

      <div className="px-4 py-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-fg-muted">
          Surveys ({h.surveys?.length || 0})
        </div>
        {h.surveys?.length ? (
          <div className="space-y-3">
            {h.surveys.map((s) => {
              const answers = surveyDetailById.get(s.id)?.answers || [];
              return (
                <div key={s.id} className="rounded border border-border p-3">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <div className="font-medium text-fg">
                      {s.voter?.fullName || 'Unknown voter'}
                    </div>
                    <div className="text-xs text-fg-muted">
                      {formatDateTime(s.submittedAt, zone)}
                    </div>
                  </div>
                  {s.canvasser && (
                    <div className="mt-0.5 text-xs text-fg-muted">
                      by {s.canvasser.firstName} {s.canvasser.lastName}
                    </div>
                  )}
                  {surveysQ.isLoading && (
                    <div className="mt-2 text-xs text-fg-subtle">Loading answers…</div>
                  )}
                  {answers.length > 0 && (
                    <dl className="mt-2 space-y-1">
                      {answers.map((a, i) => (
                        <div key={i} className="text-sm">
                          <dt className="text-xs text-fg-muted">{a.questionLabel}</dt>
                          <dd className="text-fg">{formatAnswer(a.answer)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {s.note && (
                    <div className="mt-2 rounded bg-sunken px-2 py-1 text-xs italic text-fg-muted">
                      “{s.note}”
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-fg-muted">No surveys at this household yet.</div>
        )}
      </div>
    </div>
  );
}
