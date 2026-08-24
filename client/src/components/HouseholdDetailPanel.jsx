import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import { formatInTz } from '../lib/datetime.js';
import { actionLabel } from '../lib/statusColors.js';
import { pickRound, roundMarkFromEntries, completedInRound, isRestricted, unmarkButtonLabel } from '../lib/restrictMark.js';

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

// "desk" pill for a history line whose row was written from the desk (`via:'bulk'` — a
// book-level bulk mark or a single-home desk mark) rather than recorded at the door. Without
// it the admin who marked the door reads as that door's field canvasser.
const DeskTag = () => (
  <span
    className="ml-1 rounded bg-sunken px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-fg-muted"
    title="Marked from the desk, not at the door"
  >
    desk
  </span>
);

// Single-home desk mark from the Map page: restrict / un-restrict THIS door for ONE round — the
// same `via:'bulk'` row class "Mark book restricted…" writes (never billed, never anyone's work,
// slate on phones). Mirrors the Turf Cutting popup's RestrictSection; the strings are shared.
//
// Which round it speaks for: `passId` (the ?passId= deep link) when set, else the server's
// `currentPassId` — the round a mark with no explicit passId lands on for THIS door (its walk
// list's active round, else its single draft round). Classification (desk / field / completed /
// reached) comes ONLY from that round's entries via lib/restrictMark.js — never from
// `household.status`: in global mode that is the stored status across ALL rounds, and under a
// canvasser filter it is that canvasser's own status, so neither matches the round this mark
// lives in. The header dot keeps reading `status`; this section reads the round.
//
// Pre-checks gate MARK only. The desk-restricted state (who/when + Unmark) always renders, even
// on a do-not-knock or Not-in-books door: neither flag deletes desk rows and the turf page can't
// reach those doors, so this panel is the only undo they have.
function RestrictedSection({ household, campaignId, passId, activity, loading, tz, statusColors, onChanged }) {
  const h = household;
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null); // a server skip, phrased
  // PASS_REQUIRED: the door's walk list has no current round (reason 'no-round') → the admin
  // picks one; 'intake' (no walk list at all) renders as the disabled hint instead.
  const [needPass, setNeedPass] = useState(false);
  const [intake, setIntake] = useState(false);
  const [pickedPassId, setPickedPassId] = useState('');
  // The round a mark made from THIS panel actually landed on (the server's `passId`). Only
  // load-bearing after the picker: a walk list with several draft rounds has no
  // `currentPassId`, so without this the section would forget the mark it just made.
  const [markedPassId, setMarkedPassId] = useState(null);
  const qc = useQueryClient();

  const targetPassId = passId || activity?.currentPassId || markedPassId || null;
  const round = pickRound(activity?.rounds, targetPassId);
  const mark = roundMarkFromEntries(round?.entries);
  const completed = completedInRound(round?.entries);
  const latest = round?.entries?.[0] || null;
  // Reached = a canvasser left it incomplete (not_home/refused/…); the field knock stays counted.
  // `isRestricted(mark)`, never `!mark`: roundMarkFromEntries ALWAYS returns an object now (it has
  // to, so a superseded desk row can still be reported), and a truthiness test here would pin
  // `reached` to false forever and silently swap the confirm copy on every reached door.
  const reached = !!latest && !completed && !isRestricted(mark);
  const day = (at) => formatInTz(at, tz, { month: 'short', day: 'numeric' }, false);
  const dot = (
    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: statusColors?.restricted }} />
  );

  // Round picker, fetched on demand and filtered to the door's own walk list — a pass from
  // another walk list would be skipped as ineligible anyway. `effortId` is a newer /map field;
  // when absent (older server) every non-archived round is listed.
  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes`),
    enabled: !!campaignId && needPass,
  });
  const pickablePasses = (passesQ.data?.passes || []).filter(
    (p) => p.status !== 'archived' && (h.effortId ? String(p.effortId) === String(h.effortId) : true)
  );

  const invalidate = () => {
    // Prefix matches — both map keys carry every filter after these two segments. The
    // cross-page prefixes keep the Turf Cutting page honest if it is open in another tab.
    qc.invalidateQueries({ queryKey: ['admin', 'households-map'] });
    qc.invalidateQueries({ queryKey: ['admin', 'households-map-counts'] });
    qc.invalidateQueries({ queryKey: ['household-activity', h.id] });
    qc.invalidateQueries({ queryKey: ['campaign-rollup'] });
    qc.invalidateQueries({
      predicate: (q) => q.queryKey?.[0] === 'reports' && q.queryKey?.[1] === 'campaign-rollup',
    });
    qc.invalidateQueries({ queryKey: ['turf-doors'] });
    qc.invalidateQueries({ queryKey: ['turf-progress'] });
    qc.invalidateQueries({ queryKey: ['turfs'] });
    onChanged?.();
  };

  const markMut = useMutation({
    // With a deep-linked round the mark goes there; otherwise the server resolves the round
    // (the same rule `currentPassId` reports), unless PASS_REQUIRED made the admin pick one.
    mutationFn: (chosenPassId) =>
      api(`/admin/campaigns/${campaignId}/turfs/restrict-doors`, {
        method: 'POST',
        body: { householdIds: [h.id], ...(chosenPassId ? { passId: chosenPassId } : {}) },
      }),
    onSuccess: (res) => {
      setOpen(false);
      setErr(null);
      setNeedPass(false);
      setPickedPassId('');
      if (res?.passId) setMarkedPassId(String(res.passId));
      const skips = res?.skipped || {};
      if ((res?.marked || 0) >= 1) setNote(null);
      else if (skips.alreadyRestricted) setNote('Already restricted this round.');
      else if (skips.completed) setNote('Not marked — surveyed this round keeps its result.');
      else setNote("Not a knockable door — fully voted, all residents do-not-contact, or not in this round's walk list.");
      invalidate();
    },
    onError: (e) => {
      if (e?.code === 'PASS_REQUIRED') {
        const unresolved = e?.data?.unresolved || [];
        const mine = unresolved.find((u) => String(u.id) === String(h.id)) || unresolved[0];
        if (mine?.reason === 'intake') {
          setIntake(true);
          setOpen(false);
        } else {
          setNeedPass(true);
        }
        setErr(null);
        return;
      }
      setErr(e?.message || 'Could not mark this door.');
    },
  });

  const unmarkMut = useMutation({
    // The mark's OWN round, so a mark whose draft round was later deleted can still be removed.
    mutationFn: () =>
      api(`/admin/campaigns/${campaignId}/turfs/unrestrict-doors`, {
        method: 'POST',
        body: { householdIds: [h.id], passId: mark?.passId || targetPassId },
      }),
    onSuccess: (res) => {
      setErr(null);
      setNote((res?.unmarked || 0) === 0 ? 'No desk mark to remove — field-recorded marks stay.' : null);
      invalidate();
    },
    onError: (e) => setErr(e?.message || 'Could not remove the desk mark.'),
  });

  const busy = markMut.isPending || unmarkMut.isPending;
  const label = 'Restricted access';

  if (loading) {
    return (
      <div className="border-b border-border px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-fg-subtle">
          {dot}
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  if (mark?.kind === 'desk') {
    return (
      <div className="border-b border-border px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
        <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-fg">
          {dot}
          <span>Restricted</span>
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          Marked from the desk by {mark.byName ?? 'a removed user'}{mark.at ? ` · ${day(mark.at)}` : ''}
        </p>
        {note && <p className="mt-1 text-xs text-fg-muted">{note}</p>}
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Remove the desk mark? This door is knockable again this round.')) unmarkMut.mutate();
          }}
          className="mt-2 rounded-md border border-border-strong px-2 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-50"
        >
          {unmarkMut.isPending ? 'Removing…' : unmarkButtonLabel(mark)}
        </button>
      </div>
    );
  }

  if (mark?.kind === 'field') {
    return (
      <div className="border-b border-border px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
        <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-fg">
          {dot}
          <span>Restricted</span>
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          Recorded at the door by {mark.byName ?? 'a removed user'}{mark.at ? ` · ${day(mark.at)}` : ''}
        </p>
        <p className="mt-1 text-xs text-fg-subtle">Only a canvasser re-knocking this door changes it.</p>
      </div>
    );
  }

  // A desk mark that a canvasser's later field row out-voted. The door is NOT restricted any
  // more — that is correct and by design; someone got in and their result is better evidence
  // than the office's prediction. But the row is still on file (the server's deleteMany is
  // scoped to the recording canvasser's own userId, so it never touched the admin's row), it is
  // still counted in the book's "Unmark restricted (N)", and until this block existed there was
  // no way to remove it from the panel where it was made. Informational, never an accusation:
  // it names what happened, not who to blame.
  const supersededNotice = mark.superseded && (
    <div className="mt-2 rounded-md border border-border bg-sunken px-2 py-1.5">
      <p className="text-xs text-fg-muted">
        Marked from the desk by {mark.deskByName ?? 'a removed user'}{mark.deskAt ? ` · ${day(mark.deskAt)}` : ''}
        {' — '}
        {mark.supersededBy
          ? `superseded by ${mark.supersededBy.canvasser || 'a canvasser'}'s ${actionLabel(mark.supersededBy.actionType)}${mark.supersededBy.at ? ` on ${day(mark.supersededBy.at)}` : ''}.`
          : 'no longer in effect.'}
      </p>
      <p className="mt-0.5 text-xs text-fg-subtle">
        {mark.deskRows > 1 ? `${mark.deskRows} desk marks are` : 'The desk mark is'} still on file and still
        counted on this book. If the block turns out to be reachable, remove it.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (window.confirm('Remove the desk mark? It no longer affects this door — this only clears it from the record.')) unmarkMut.mutate();
        }}
        className="mt-1.5 rounded-md border border-border-strong px-2 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-50"
      >
        {unmarkMut.isPending ? 'Removing…' : unmarkButtonLabel(mark)}
      </button>
    </div>
  );

  // Not restricted this round. A do-not-knock address gets no Mark at all — the block above
  // already says nobody visits; a desk mark on top of it would be noise. A superseded mark still
  // gets its notice, though: the row exists and must stay removable wherever it can be seen.
  if (h.doNotKnock) {
    return mark.superseded ? (
      <div className="border-b border-border px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
        {supersededNotice}
        {err && <p className="mt-1 text-xs text-danger">{err}</p>}
      </div>
    ) : null;
  }

  // Pre-checks that make the Mark button honest before the server is asked.
  const blocked = h.excludedFromTurf
    ? "Not in books — can't be marked."
    : h.effortId === null || intake
      ? "Not in a walk list — can't be marked."
      : completed
        ? 'Surveyed this round — keeps its result.'
        : null;

  return (
    <div className="border-b border-border px-4 py-3">
      {!open ? (
        <>
          <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
          <button
            type="button"
            disabled={!!blocked || busy}
            onClick={() => { setNote(null); setErr(null); setOpen(true); }}
            className="mt-1 rounded-md border border-border-strong px-2 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-50"
          >
            Mark restricted…
          </button>
          {blocked && <p className="mt-1 text-xs text-fg-subtle">{blocked}</p>}
          {supersededNotice}
          {note && <p className="mt-1 text-xs text-fg-muted">{note}</p>}
          {err && <p className="mt-1 text-xs text-danger">{err}</p>}
        </>
      ) : (
        <div>
          <div className="text-xs uppercase tracking-wide text-fg-muted">Mark restricted</div>
          <p className="mt-1 text-xs text-fg-muted">
            {reached
              ? `This round's result becomes Restricted; ${latest?.canvasser || 'the canvasser'}'s ${actionLabel(latest?.actionType)} knock stays counted.`
              : 'Canvassers see this door slate and skip it; it stays out of every rate and knock count. Reversible here.'}
          </p>
          {needPass && (
            <div className="mt-2">
              <p className="text-xs text-fg-muted">Pick the round this mark belongs to.</p>
              <select
                value={pickedPassId}
                onChange={(e) => setPickedPassId(e.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-md border border-border-strong bg-card px-2 py-1 text-xs text-fg focus:border-brand-accent focus:outline-none disabled:opacity-60"
              >
                <option value="">{passesQ.isLoading ? 'Loading rounds…' : 'Choose a round…'}</option>
                {pickablePasses.map((p) => (
                  <option key={p._id} value={p._id}>
                    Pass {p.roundNumber}{p.name ? ` · ${p.name}` : ''}{p.status === 'active' ? ' · live' : ''}
                  </option>
                ))}
              </select>
              {passesQ.isSuccess && pickablePasses.length === 0 && (
                <p className="mt-1 text-xs text-fg-subtle">This walk list has no round yet — create one first.</p>
              )}
            </div>
          )}
          {err && <p className="mt-1 text-xs text-danger">{err}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy || (needPass && !pickedPassId)}
              onClick={() => markMut.mutate(needPass ? pickedPassId : passId || null)}
              className="rounded-md bg-brand-600 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {markMut.isPending ? 'Marking…' : 'Mark restricted'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setOpen(false); setErr(null); setNeedPass(false); setPickedPassId(''); }}
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
  campaignId,
  onClose,
  onMovePin,
  onDoNotKnockChanged,
  onRestrictChanged,
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
            {/* Administrative, not a resident request — warning tokens, not danger. The wording
                stays campaign-wide on purpose: the flag records no effort/pass/actor, so it can
                never honestly name the walk list that excluded the door. */}
            {h.excludedFromTurf && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-warning-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-fg"
                title="Held back by Remove apartments when turf was cut — not cut into books, not sent to phones, and not printed, anywhere in this campaign. Clear it from Turf Cutting on the walk list that owns this door."
              >
                🚫 Not in books
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

      {/* Keyed per door + target round so the inline confirm / picker reset with the door. */}
      <RestrictedSection
        key={`${h.id}|${passId || activityQ.data?.currentPassId || ''}`}
        household={h}
        campaignId={campaignId}
        passId={passId}
        activity={activityQ.data}
        loading={activityQ.isLoading}
        tz={zone}
        statusColors={statusColors}
        onChanged={onRestrictChanged}
      />

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
            {/* The lastActivities aggregate does not exclude desk rows, so after a desk mark the
                named admin would otherwise read as this door's field canvasser. */}
            {h.lastAction.via === 'bulk' && <DeskTag />}
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
                      {e.via === 'bulk' && <DeskTag />}
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
              const detail = surveyDetailById.get(s.id);
              const answers = detail?.answers || [];
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
                  {/* Desk-entered: an admin typed these answers converting the door's outcome —
                      provenance, so nobody reads it as a doorstep conversation. */}
                  {detail?.deskEntry && (
                    <div className="mt-0.5 text-xs text-amber-600">Entered at a desk, not at the door</div>
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
