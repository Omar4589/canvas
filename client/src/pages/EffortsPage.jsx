import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import StatCard from '../components/StatCard.jsx';
import NextStepBanner from '../components/NextStepBanner.jsx';
import PassManager from '../components/PassManager.jsx';
import { useCampaignTeam } from '../lib/useCampaignTeam.js';
import { Card, Badge, Button, Input, Select, Modal } from '../components/ui';
import WalkListSurveySelect from '../components/WalkListSurveySelect.jsx';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';
import { useJobPoll } from '../lib/useJobPoll.js';

const STATUS_VARIANT = { draft: 'neutral', active: 'success', archived: 'neutral' };
// Compact token field for the tiny in-row / in-panel controls.
const COMPACT = 'rounded border border-border-strong bg-card px-2 py-1 text-xs text-fg focus:border-brand-accent focus:outline-none';

function RosterPanel({ campaignId, effort }) {
  const qc = useQueryClient();
  const crewQ = useQuery({
    queryKey: ['effort-crew', effort._id],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts/${effort._id}/members`),
  });
  // Pre-stage from the campaign team (+ you), not the whole org — mirrors book assignment.
  const { members } = useCampaignTeam(campaignId);
  const [userId, setUserId] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['effort-crew', effort._id] });
    qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] });
  };
  const add = useMutation({
    mutationFn: (uid) => api(`/admin/campaigns/${campaignId}/efforts/${effort._id}/members`, { method: 'POST', body: { userId: uid } }),
    onSuccess: () => { setUserId(''); invalidate(); },
  });
  const remove = useMutation({
    mutationFn: (uid) => api(`/admin/campaigns/${campaignId}/efforts/${effort._id}/members/${uid}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const crew = crewQ.data?.crew || [];
  const crewIds = new Set(crew.map((c) => String(c.user.id)));
  const addable = members.filter((m) => !crewIds.has(String(m.user.id)));

  return (
    <div className="rounded-lg border border-border bg-sunken p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Crew</div>
      <p className="mb-2 text-[11px] text-fg-muted">
        Fills in automatically from book assignments. Add people here to pre-stage them before assigning.
      </p>
      {crew.length === 0 ? (
        <p className="text-xs text-fg-muted">No one yet — assign books on the Turf page, or pre-add someone below.</p>
      ) : (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {crew.map((c) => {
            const manualOnly = c.viaRoster && !c.viaAssignment;
            return (
              <li key={c.user.id} className="flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-xs text-fg ring-1 ring-border">
                {c.user.firstName} {c.user.lastName}
                <span className={c.viaAssignment ? 'text-[10px] font-medium text-success' : 'text-[10px] text-fg-subtle'}>
                  {c.viaAssignment ? 'assigned' : 'added'}
                </span>
                {manualOnly && (
                  <button onClick={() => remove.mutate(c.user.id)} className="text-fg-subtle hover:text-danger" title="Remove (pre-staged only — assigned people leave when unassigned on the Turf page)">×</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className={COMPACT}>
          <option value="">Pre-add from team…</option>
          {addable.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.firstName} {m.user.lastName}{m.role === 'admin' ? ' (admin)' : ''}{m.user.isSelf ? ' — you' : ''}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={() => userId && add.mutate(userId)} disabled={!userId || add.isPending}>Add</Button>
      </div>
      <Link to={`/campaigns/${campaignId}/team`} className="mt-1.5 inline-block text-[11px] font-medium text-brand-accent hover:underline">
        ＋ Add someone to the team →
      </Link>
    </div>
  );
}

// The force-confirm for a door MOVE (re-carve): states the real stakes per donor
// list — how many doors it loses, how many books that guts — plus the snapshot
// promise and the one thing people learn the hard way: moving doors back later
// does NOT rebuild their old books. `data` is the claim 409 body (doors-owned).
function MoveConfirmModal({ effortName, data, pending, onCancel, onConfirm }) {
  return (
    <Modal
      size="md"
      onClose={onCancel}
      title={`Move ${data.conflicts.toLocaleString()} door${data.conflicts === 1 ? '' : 's'} into ${effortName}?`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" size="sm" loading={pending} onClick={onConfirm}>
            Move {data.conflicts.toLocaleString()} door{data.conflicts === 1 ? '' : 's'} (re-carve)
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-sm text-fg-muted">
        <p>These doors already belong to other walk lists. Moving them here pulls them out of those lists' books:</p>
        <ul className="space-y-1">
          {(data.breakdown || []).map((d) => (
            <li key={d.effortId} className="rounded bg-warning-tint px-2 py-1.5 text-xs text-warning-fg">
              <strong>{d.effortName}</strong> loses {d.doors.toLocaleString()} door{d.doors === 1 ? '' : 's'}
              {d.booksAffected > 0 && (
                <> — {d.booksAffected} book{d.booksAffected === 1 ? '' : 's'} affected{d.booksEmptied > 0 ? `, ${d.booksEmptied} emptied` : ''}</>
              )}
            </li>
          ))}
        </ul>
        {data.claimable > 0 && (
          <p className="text-xs">{data.claimable.toLocaleString()} unowned (Intake) door{data.claimable === 1 ? '' : 's'} come along too.</p>
        )}
        <p className="text-xs">
          Each affected list's books are <strong>snapshotted first</strong> — restorable from its Turf page under
          Undo / snapshots. The move runs in the background; progress shows here.
        </p>
        <p className="text-xs font-medium text-danger">
          Moving doors back later will NOT rebuild their old books — they return bookless until you re-cut or restore
          the snapshot.
        </p>
      </div>
    </Modal>
  );
}

// Shared claim-job progress/result line: the claim runs on the worker; this polls
// it and reports "Claimed N (M moved)" when it lands. onDone fires once on completion.
function ClaimJobStatus({ campaignId, jobId, doneLink, onDone }) {
  const job = useJobPoll({ campaignId, jobId });
  const doneRef = useRef(null);
  useEffect(() => {
    if (job.status === 'completed' && doneRef.current !== jobId) {
      doneRef.current = jobId;
      onDone?.();
    }
  }, [job.status, jobId]);
  if (!jobId) return null;
  if (job.status === 'failed') return <p className="mt-2 text-xs text-danger">Move failed: {job.error || 'unknown error'}</p>;
  if (job.status === 'completed') {
    const r = job.result || {};
    return (
      <p className="mt-2 text-xs text-success-fg">
        Claimed {(r.claimed ?? 0).toLocaleString()} door(s)
        {r.reassigned ? ` (${r.reassigned.toLocaleString()} moved from other walk lists)` : ''}.{' '}
        {doneLink}
      </p>
    );
  }
  return (
    <div className="mt-2 text-xs text-fg-muted">
      <div className="mb-1">Moving doors — {job.phase || 'queued'}… {job.pct != null ? `${job.pct}%` : ''}</div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-sunken"><div className="h-full bg-brand-500 transition-all" style={{ width: `${job.pct || 5}%` }} /></div>
    </div>
  );
}

function ClaimPanel({ campaignId, effort, walkLists, intakeCount = 0 }) {
  const qc = useQueryClient();
  const [walkListId, setWalkListId] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [moveConfirm, setMoveConfirm] = useState(null); // the 409 doors-owned body
  const [claimJobId, setClaimJobId] = useState(null);
  const [nothingToClaim, setNothingToClaim] = useState(false);
  const claim = useMutation({
    mutationFn: ({ body }) => api(`/admin/campaigns/${campaignId}/efforts/${effort._id}/claim`, { method: 'POST', body }),
    onSuccess: (res) => {
      setMoveConfirm(null);
      setNothingToClaim(!res.jobId);
      if (res.jobId) setClaimJobId(res.jobId);
    },
    onError: (err) => {
      // The 409 IS the flow, not a failure: it carries the per-donor breakdown
      // the confirm modal renders before anything moves.
      if (err?.data?.code === 'doors-owned') setMoveConfirm(err.data);
    },
  });
  const owned = claim.error?.data?.code === 'doors-owned';

  return (
    <div className="rounded-lg border border-border bg-sunken p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Claim doors</div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={walkListId} onChange={(e) => setWalkListId(e.target.value)} className={COMPACT}>
          <option value="">From a saved search…</option>
          {walkLists.map((w) => (
            <option key={w._id} value={w._id}>{w.name} ({w.householdCount} hh){w.source === 'csv' ? ' · CSV' : ''}</option>
          ))}
        </select>
        <Button size="sm" onClick={() => walkListId && claim.mutate({ body: { walkListId } })} disabled={!walkListId || claim.isPending}>Claim list</Button>
        <span className="text-xs text-fg-subtle">or</span>
        <Button size="sm" variant="secondary" onClick={() => setConfirmAll(true)} disabled={claim.isPending || intakeCount === 0}>
          Claim all Intake{intakeCount ? ` (${intakeCount.toLocaleString()})` : ''}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-fg-muted">
        “Claim all Intake” takes <strong>every</strong> unowned door in the campaign — from any import. To add only this
        walk list’s doors, claim from a saved search.
      </p>
      {confirmAll && (
        <Modal
          size="md"
          onClose={() => setConfirmAll(false)}
          title="Claim all Intake doors?"
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setConfirmAll(false)}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                loading={claim.isPending}
                onClick={() => { setConfirmAll(false); claim.mutate({ body: { all: true } }); }}
              >
                Claim all {intakeCount.toLocaleString()}
              </Button>
            </>
          }
        >
          <p className="text-sm text-fg-muted">
            This claims all {intakeCount.toLocaleString()} unowned door(s) in the campaign into{' '}
            <strong>{effort.name}</strong> — including any door not yet in a walk list, from any import. If you only want
            this walk list’s specific doors (e.g. a precinct you just imported), cancel and claim from a saved search instead.
          </p>
        </Modal>
      )}
      {moveConfirm && (
        <MoveConfirmModal
          effortName={effort.name}
          data={moveConfirm}
          pending={claim.isPending}
          onCancel={() => setMoveConfirm(null)}
          onConfirm={() => claim.mutate({ body: { walkListId: walkListId || undefined, all: walkListId ? undefined : true, force: true } })}
        />
      )}
      <ClaimJobStatus
        campaignId={campaignId}
        jobId={claimJobId}
        doneLink={
          <Link to={`/campaigns/${campaignId}/efforts/${effort._id}/passes`} className="font-semibold underline">
            Manage passes →
          </Link>
        }
        onDone={() => {
          qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] });
          qc.invalidateQueries({ queryKey: ['admin', 'setup-status', campaignId] });
          // Donor lists' books changed shape (or emptied) — refresh any open cut page.
          qc.invalidateQueries({ queryKey: ['turfs', campaignId] });
          qc.invalidateQueries({ queryKey: ['turf-doors', campaignId] });
        }}
      />
      {nothingToClaim && !claimJobId && (
        <p className="mt-2 text-xs text-fg-muted">Nothing to claim — those doors are already in this walk list.</p>
      )}
      {claim.error && !owned && <p className="mt-2 text-xs text-danger">{claim.error.message}</p>}
    </div>
  );
}

function EffortRow({ campaignId, effort, walkLists, surveys, isSurveyType, campaignType, crewNames, tz, intakeCount, onUpdate, onArchive, onDelete }) {
  const [open, setOpen] = useState(false);
  const survey = surveys.find((s) => String(s._id) === String(effort.surveyTemplateId));
  const crewTitle = (crewNames || []).join(', ');
  return (
    <>
      <tr className="border-t border-border transition-colors hover:bg-sunken/60">
        <td className="px-4 py-2.5">
          <span className="font-medium text-fg">{effort.name}</span>
        </td>
        <td className="px-4 py-2">
          <div className="flex flex-col items-start gap-1">
            <Badge variant={STATUS_VARIANT[effort.status] || 'neutral'} dot className="capitalize">{effort.status}</Badge>
            {effort.setup && (effort.setup.complete ? (
              <Badge variant="success" dot>Live</Badge>
            ) : (
              <span className="text-[10px] text-fg-muted">
                Setup {effort.setup.stepsDone}/{effort.setup.stepsTotal}
                {effort.setup.nextStepLabel ? ` · next: ${effort.setup.nextStepLabel}` : ''}
              </span>
            ))}
          </div>
        </td>
        <td className="px-4 py-2 text-right tabular-nums text-fg">{(effort.doorCount || 0).toLocaleString()}</td>
        <td className="px-4 py-2 text-right tabular-nums text-fg">
          <span title={crewTitle || undefined} className={crewTitle ? 'cursor-default border-b border-dotted border-border-strong' : undefined}>
            {effort.crewCount || 0}
          </span>
        </td>
        <td className="px-4 py-2 text-fg">{effort.activeRound ? `Pass ${effort.activeRound.roundNumber} · ${effort.activeRound.name}` : <span className="text-fg-subtle">—</span>}</td>
        <td className="px-4 py-2 text-fg-muted">{isSurveyType ? (survey ? survey.name : <span className="text-fg-subtle">campaign default</span>) : <span className="text-fg-subtle">n/a</span>}</td>
        <td className="px-4 py-2 text-fg-muted">{effort.createdAt ? formatInTz(effort.createdAt, tz, { month: 'short', day: 'numeric', year: 'numeric' }, false) : <span className="text-fg-subtle">—</span>}</td>
        <td className="space-x-2 px-4 py-2 text-right">
          <button onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-brand-accent hover:underline">{open ? 'Close' : 'Manage'}</button>
          {effort.status !== 'archived' && <button onClick={() => onArchive(effort)} className="text-xs text-fg-muted hover:underline">Archive</button>}
          <button onClick={() => onDelete(effort)} className="text-xs text-danger hover:underline">Delete</button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-sunken/50">
          <td colSpan="8" className="px-4 py-3">
            <div className="grid gap-3 md:grid-cols-2">
              <RosterPanel campaignId={campaignId} effort={effort} />
              <ClaimPanel campaignId={campaignId} effort={effort} walkLists={walkLists} intakeCount={intakeCount} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                defaultValue={effort.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== effort.name && onUpdate(effort, { name: e.target.value.trim() })}
                className={COMPACT}
              />
              {isSurveyType && (
                <WalkListSurveySelect
                  value={effort.surveyTemplateId || ''}
                  surveys={surveys}
                  onChange={(id) => onUpdate(effort, { surveyTemplateId: id })}
                  className={COMPACT}
                />
              )}
              {effort.activeRound && (
                <a href={`/campaigns/${campaignId}/turfs?passId=${effort.activeRound._id}`} className="text-xs font-medium text-brand-accent hover:underline">Cut / assign books →</a>
              )}
              <a href={`/campaigns/${campaignId}/map?effortId=${effort._id}`} className="text-xs font-medium text-brand-accent hover:underline">Audit on map →</a>
            </div>
            <div className="mt-4 rounded-lg border border-border bg-sunken/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Passes</div>
                <Link to={`/campaigns/${campaignId}/efforts/${effort._id}/passes`} className="text-xs font-medium text-brand-accent hover:underline">
                  Open full view →
                </Link>
              </div>
              <PassManager campaignId={campaignId} effortId={effort._id} tz={tz} variant="compact" campaignType={campaignType} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function EffortsPage() {
  const qc = useQueryClient();
  const { campaignId } = useParams();
  const { selected } = useCampaignSelection(campaignId);
  const isSurveyType = selected?.type === 'survey';
  const [name, setName] = useState('');
  const [surveyTemplateId, setSurveyTemplateId] = useState('');
  // Door source for the new walk list: '__intake__' (all remaining) | a saved-search id | '' (none).
  const [doorSource, setDoorSource] = useState('__intake__');
  // Deep-link from the import summary: ?seed=<savedSearchId> preselects that walk list as
  // the door source once it has loaded (applied once so the admin can still change it).
  const [searchParams] = useSearchParams();
  const seedParam = searchParams.get('seed');
  const seedAppliedRef = useRef(false);

  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  const walkListsQ = useQuery({
    queryKey: ['admin', 'walklists', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/walklists`),
    enabled: !!campaignId,
  });
  // Same ['surveys'] cache the Surveys page + campaign Survey page use, so archive/
  // duplicate/delete there refresh this picker too.
  const surveysQ = useQuery({ queryKey: ['surveys'], queryFn: () => api('/admin/surveys'), enabled: isSurveyType });

  // Names for the "assigned by" labels below. This page is inside the campaign console, which team
  // leads reach — and /admin/memberships is admin-only, so a lead 403'd and every name rendered
  // blank.
  //
  // They come off the campaign ROSTER, not the crew picker. The roster
  // keeps a row for someone who has since been taken off the campaign (with a `status` saying so),
  // whereas the crew list is only current people — resolving names against that one renders a blank
  // where a departed walker's name should be. Same endpoint for both roles.
  const orgQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/assignments`),
    enabled: !!campaignId,
  });
  const orgTz = useOrgTimeZone();
  const tz = selected?.timeZone || orgTz;

  const efforts = effortsQ.data?.efforts || [];
  const intakeCount = effortsQ.data?.intakeCount || 0;
  const walkLists = walkListsQ.data?.walkLists || [];
  const surveys = surveysQ.data?.surveys || [];

  // Once the walk lists load, honor a ?seed= deep-link (from the import "Create revisit
  // walk list" link) by preselecting that saved search as the new list's door source.
  useEffect(() => {
    if (seedAppliedRef.current || !seedParam) return;
    if (walkLists.some((w) => String(w._id) === String(seedParam))) {
      seedAppliedRef.current = true;
      setDoorSource(seedParam);
    }
  }, [seedParam, walkLists]);

  // userId → "First Last", to render an effort's crewUserIds as a hover list.
  const nameByUserId = useMemo(
    () => new Map((orgQ.data?.assignments || []).map((a) => [String(a.userId), `${a.firstName} ${a.lastName}`])),
    [orgQ.data]
  );
  const totalDoors = useMemo(() => efforts.reduce((sum, e) => sum + (e.doorCount || 0), 0), [efforts]);

  // "All remaining (Intake)" falls back to None once Intake is empty, so the default is honest.
  const effectiveSource = doorSource === '__intake__' && intakeCount === 0 ? '' : doorSource;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] });
  // Create-flow claim state: the seeding claim is a background job now (the server
  // enqueues it), and a REVISIT seed needs the same move-confirm modal as the
  // per-row Claim panel — those doors belong to another list.
  const [createClaimJobId, setCreateClaimJobId] = useState(null);
  const [createMove, setCreateMove] = useState(null); // { effortId, effortName, walkListId, data }
  const revisitClaim = useMutation({
    mutationFn: ({ effortId, walkListId, force }) =>
      api(`/admin/campaigns/${campaignId}/efforts/${effortId}/claim`, { method: 'POST', body: { walkListId, force } }),
    onSuccess: (res) => {
      setCreateMove(null);
      if (res.jobId) setCreateClaimJobId(res.jobId);
    },
    onError: (err, vars) => {
      // The 409 carries the per-donor breakdown; the modal turns it into a real
      // decision instead of the old silent force (which is how 24k doors moved
      // with a one-line confirm).
      if (err?.data?.code === 'doors-owned') {
        setCreateMove({ effortId: vars.effortId, effortName: vars.effortName, walkListId: vars.walkListId, data: err.data });
      }
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      // A revisit list (source:'import') is homes that are ALREADY owned/booked, so the
      // create-time seed (which only claims Intake) would grab none. Create the walk list
      // empty, then claim those owned homes into it — via the move-confirm modal.
      const seedList = walkLists.find((w) => String(w._id) === String(effectiveSource));
      const isRevisitSeed = seedList?.source === 'import';
      const doors =
        effectiveSource === '__intake__' ? { claimAllIntake: true }
        : effectiveSource && !isRevisitSeed ? { seedWalkListId: effectiveSource }
        : {};
      const res = await api(`/admin/campaigns/${campaignId}/efforts`, {
        method: 'POST',
        body: { name, surveyTemplateId: surveyTemplateId || undefined, ...doors },
      });
      return { ...res, revisitWalkListId: isRevisitSeed ? effectiveSource : null };
    },
    onSuccess: (res) => {
      setName('');
      setSurveyTemplateId('');
      setDoorSource('__intake__');
      invalidate();
      qc.invalidateQueries({ queryKey: ['admin', 'walklists', campaignId] });
      setCreateClaimJobId(res.claimJobId || null);
      if (res.revisitWalkListId && res.effort?._id) {
        // No force: the expected 409 opens the move-confirm modal with the stakes.
        revisitClaim.mutate({
          effortId: res.effort._id,
          effortName: res.effort.name,
          walkListId: res.revisitWalkListId,
          force: false,
        });
      }
    },
  });
  const update = useMutation({ mutationFn: ({ id, body }) => api(`/admin/campaigns/${campaignId}/efforts/${id}`, { method: 'PATCH', body }), onSuccess: invalidate });
  const archive = useMutation({ mutationFn: (id) => api(`/admin/campaigns/${campaignId}/efforts/${id}/archive`, { method: 'POST' }), onSuccess: invalidate });
  const del = useMutation({ mutationFn: (id) => api(`/admin/campaigns/${campaignId}/efforts/${id}`, { method: 'DELETE' }), onSuccess: invalidate });

  const fieldLabel = 'mb-1 block text-xs font-medium text-fg';

  return (
    <div>
      <h1 className="mb-5 text-2xl font-semibold tracking-tight text-fg">Walk Lists</h1>

      <p className="mb-4 max-w-3xl text-sm text-fg-muted">
        A walk list is a parallel canvassing operation within a campaign — e.g. an area or a team. Each
        walk list owns a disjoint set of doors, an optional survey, and a roster, and has its own Passes
        (cut on the Turf Cutting page). Doors no one has claimed sit in <strong>Intake</strong>.
      </p>

      {campaignId && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Walk Lists" value={efforts.length.toLocaleString()} />
          <StatCard label="Doors assigned" value={totalDoors.toLocaleString()} />
          <StatCard
            label="In Intake"
            value={intakeCount.toLocaleString()}
            accent={intakeCount > 0 ? 'blue' : undefined}
            hint={intakeCount > 0 ? 'Awaiting assignment' : undefined}
          />
        </div>
      )}

      {intakeCount > 0 && (
        <NextStepBanner tone="info" className="mb-4">
          <strong>{intakeCount.toLocaleString()}</strong> door{intakeCount === 1 ? '' : 's'} in Intake (new addresses awaiting assignment). Open a walk list below → <em>Claim all Intake</em> to assign them.
        </NextStepBanner>
      )}

      <Card as="section" className="mb-6 p-5">
        <h2 className="mb-3 text-base font-semibold text-fg">New walk list</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className={fieldLabel}>Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Dallas" className="w-56" />
          </label>
          <label className="text-sm">
            <span className={fieldLabel}>Doors</span>
            <Select value={effectiveSource} onChange={(e) => setDoorSource(e.target.value)}>
              <option value="__intake__" disabled={intakeCount === 0}>
                All remaining doors (Intake){intakeCount ? ` — ${intakeCount.toLocaleString()}` : ''}
              </option>
              {walkLists.map((w) => <option key={w._id} value={w._id}>From: {w.name} ({w.householdCount} hh){w.source === 'csv' ? ' · CSV' : ''}</option>)}
              <option value="">None — claim doors later</option>
            </Select>
          </label>
          {isSurveyType && (
            <label className="text-sm">
              <span className={fieldLabel}>Survey override</span>
              <WalkListSurveySelect
                value={surveyTemplateId}
                surveys={surveys}
                onChange={(id) => setSurveyTemplateId(id || '')}
              />
            </label>
          )}
          <Button onClick={() => name && create.mutate()} disabled={!name} loading={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create walk list'}
          </Button>
        </div>
        {create.error && <div className="mt-2 text-xs text-danger">{create.error.message}</div>}
        {create.data?.effort && (
          <p className="mt-2 text-xs text-success-fg">
            Created <strong>{create.data.effort.name}</strong>
            {create.data.pass ? ' — Pass 1 is ready.' : '.'}{' '}
            {create.data.pass ? (
              <Link to={`/campaigns/${campaignId}/turfs?passId=${create.data.pass._id}`} className="font-semibold underline">Cut its books →</Link>
            ) : (
              <Link to={`/campaigns/${campaignId}/efforts/${create.data.effort._id}/passes`} className="font-semibold underline">Manage passes →</Link>
            )}
          </p>
        )}
        {create.data?.claimError && (
          <p className="mt-1 text-xs text-warning-fg">
            The door claim couldn't be queued — open the new list below and use <strong>Claim doors</strong>.
          </p>
        )}
        <ClaimJobStatus
          campaignId={campaignId}
          jobId={createClaimJobId}
          doneLink={
            create.data?.pass ? (
              <Link to={`/campaigns/${campaignId}/turfs?passId=${create.data.pass._id}`} className="font-semibold underline">Cut its books →</Link>
            ) : null
          }
          onDone={() => {
            invalidate();
            qc.invalidateQueries({ queryKey: ['admin', 'setup-status', campaignId] });
            qc.invalidateQueries({ queryKey: ['turfs', campaignId] });
            qc.invalidateQueries({ queryKey: ['turf-doors', campaignId] });
          }}
        />
        {revisitClaim.error && revisitClaim.error?.data?.code !== 'doors-owned' && (
          <p className="mt-1 text-xs text-danger">{revisitClaim.error.message}</p>
        )}
        {createMove && (
          <MoveConfirmModal
            effortName={createMove.effortName}
            data={createMove.data}
            pending={revisitClaim.isPending}
            onCancel={() => setCreateMove(null)}
            onConfirm={() => revisitClaim.mutate({ ...createMove, force: true })}
          />
        )}
        <p className="mt-2 text-xs text-fg-muted"><strong>All remaining doors (Intake)</strong> claims every unassigned door in the campaign — the usual whole-district list. Pick a <strong>saved search</strong> to seed only that list's <em>unowned</em> doors, or <strong>None</strong> to create an empty list and claim doors later (open the list → Claim). Saved searches are built from filters or a Voter-ID CSV on the Saved Searches page.</p>
      </Card>

      <Card className="overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-sunken/90 text-[11px] font-semibold uppercase tracking-wider text-fg-muted backdrop-blur">
            <tr>
              <th className="px-4 py-2 text-left">Walk List</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">Doors</th>
              <th className="px-4 py-2 text-right">Crew</th>
              <th className="px-4 py-2 text-left">Active pass</th>
              <th className="px-4 py-2 text-left">Survey</th>
              <th className="px-4 py-2 text-left">Created</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {efforts.map((e) => (
              <EffortRow
                key={e._id}
                campaignId={campaignId}
                effort={e}
                walkLists={walkLists}
                surveys={surveys}
                isSurveyType={isSurveyType}
                campaignType={selected?.type}
                crewNames={(e.crewUserIds || []).map((id) => nameByUserId.get(id)).filter(Boolean)}
                tz={tz}
                intakeCount={intakeCount}
                onUpdate={(eff, body) => update.mutate({ id: eff._id, body })}
                onArchive={(eff) => archive.mutate(eff._id)}
                onDelete={(eff) => { if (window.confirm(`Delete walk list "${eff.name}"? Its doors return to Intake.`)) del.mutate(eff._id); }}
              />
            ))}
            {!efforts.length && <tr><td colSpan="8" className="px-4 py-6 text-center text-fg-muted">No walk lists yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      {del.error && <div className="mt-2 text-sm text-danger">{del.error.message}</div>}
    </div>
  );
}
