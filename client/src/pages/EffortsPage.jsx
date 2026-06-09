import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import CampaignSelector, { useCampaignSelection, setStoredCampaignId } from '../components/CampaignSelector.jsx';
import StatCard from '../components/StatCard.jsx';
import NextStepBanner from '../components/NextStepBanner.jsx';
import { Card, Badge, Button, Input, Select } from '../components/ui';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';

const STATUS_VARIANT = { draft: 'neutral', active: 'success', archived: 'neutral' };
// Compact token field for the tiny in-row / in-panel controls.
const COMPACT = 'rounded border border-border-strong bg-card px-2 py-1 text-xs text-fg focus:border-brand-accent focus:outline-none';

function RosterPanel({ campaignId, effort }) {
  const qc = useQueryClient();
  const crewQ = useQuery({
    queryKey: ['effort-crew', effort._id],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts/${effort._id}/members`),
  });
  const orgQ = useQuery({ queryKey: ['memberships'], queryFn: () => api('/admin/memberships') });
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
  const members = (orgQ.data?.members || []).filter((m) => m.user.isActive && m.isActive);
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
          <option value="">Pre-add person…</option>
          {addable.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.firstName} {m.user.lastName}{m.role === 'admin' ? ' (admin)' : ''}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={() => userId && add.mutate(userId)} disabled={!userId || add.isPending}>Add</Button>
      </div>
    </div>
  );
}

function ClaimPanel({ campaignId, effort, walkLists }) {
  const qc = useQueryClient();
  const [walkListId, setWalkListId] = useState('');
  const claim = useMutation({
    mutationFn: ({ body }) => api(`/admin/campaigns/${campaignId}/efforts/${effort._id}/claim`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] });
      qc.invalidateQueries({ queryKey: ['admin', 'setup-status', campaignId] });
    },
  });
  const owned = claim.error?.data?.code === 'doors-owned' ? claim.error.data : null;

  return (
    <div className="rounded-lg border border-border bg-sunken p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Claim doors</div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={walkListId} onChange={(e) => setWalkListId(e.target.value)} className={COMPACT}>
          <option value="">From a walk list…</option>
          {walkLists.map((w) => (
            <option key={w._id} value={w._id}>{w.name} ({w.householdCount} hh){w.source === 'csv' ? ' · CSV' : ''}</option>
          ))}
        </select>
        <Button size="sm" onClick={() => walkListId && claim.mutate({ body: { walkListId } })} disabled={!walkListId || claim.isPending}>Claim list</Button>
        <span className="text-xs text-fg-subtle">or</span>
        <Button size="sm" variant="secondary" onClick={() => claim.mutate({ body: { all: true } })} disabled={claim.isPending}>Claim all Intake</Button>
      </div>
      {claim.data && (
        <p className="mt-2 text-xs text-success-fg">
          Claimed {claim.data.claimed} door(s){claim.data.reassigned ? ` (${claim.data.reassigned} moved from other efforts)` : ''}.{' '}
          <Link to={`/passes?effortId=${effort._id}`} onClick={() => setStoredCampaignId(campaignId)} className="font-semibold underline">
            Create a round →
          </Link>
        </p>
      )}
      {owned && (
        <div className="mt-2 text-xs text-warning-fg">
          {owned.conflicts} door(s) belong to another effort.{' '}
          <button onClick={() => claim.mutate({ body: { walkListId: walkListId || undefined, all: walkListId ? undefined : true, force: true } })} className="font-semibold underline">Move them here (re-carve)</button>
        </div>
      )}
      {claim.error && !owned && <p className="mt-2 text-xs text-danger">{claim.error.message}</p>}
    </div>
  );
}

function EffortRow({ campaignId, effort, walkLists, surveys, isSurveyType, crewNames, tz, onUpdate, onArchive, onDelete }) {
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
          <Badge variant={STATUS_VARIANT[effort.status] || 'neutral'} dot className="capitalize">{effort.status}</Badge>
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
              <ClaimPanel campaignId={campaignId} effort={effort} walkLists={walkLists} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                defaultValue={effort.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== effort.name && onUpdate(effort, { name: e.target.value.trim() })}
                className={COMPACT}
              />
              {isSurveyType && (
                <select
                  defaultValue={effort.surveyTemplateId || ''}
                  onChange={(e) => onUpdate(effort, { surveyTemplateId: e.target.value || null })}
                  className={COMPACT}
                >
                  <option value="">Survey: campaign default</option>
                  {surveys.map((s) => <option key={s._id} value={s._id}>{s.name} (v{s.version || 1})</option>)}
                </select>
              )}
              <a href={`/passes?effortId=${effort._id}`} className="text-xs font-medium text-brand-accent hover:underline">Manage passes →</a>
              {effort.activeRound && (
                <a href={`/turfs?passId=${effort.activeRound._id}`} className="text-xs font-medium text-brand-accent hover:underline">Cut / assign books →</a>
              )}
              <a href={`/map?effortId=${effort._id}`} className="text-xs font-medium text-brand-accent hover:underline">Audit on map →</a>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function EffortsPage() {
  const qc = useQueryClient();
  const { campaignId, setCampaignId, campaigns, selected, isLoading } = useCampaignSelection();
  const isSurveyType = selected?.type === 'survey';
  const [name, setName] = useState('');
  const [surveyTemplateId, setSurveyTemplateId] = useState('');
  const [seedWalkListId, setSeedWalkListId] = useState('');

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
  const surveysQ = useQuery({ queryKey: ['admin', 'surveys'], queryFn: () => api('/admin/surveys'), enabled: isSurveyType });

  const orgQ = useQuery({ queryKey: ['memberships'], queryFn: () => api('/admin/memberships') });
  const orgTz = useOrgTimeZone();
  const tz = selected?.timeZone || orgTz;

  const efforts = effortsQ.data?.efforts || [];
  const intakeCount = effortsQ.data?.intakeCount || 0;
  const walkLists = walkListsQ.data?.walkLists || [];
  const surveys = surveysQ.data?.surveys || [];

  // userId → "First Last", to render an effort's crewUserIds as a hover list.
  const nameByUserId = useMemo(
    () => new Map((orgQ.data?.members || []).map((m) => [m.user.id, `${m.user.firstName} ${m.user.lastName}`])),
    [orgQ.data]
  );
  const totalDoors = useMemo(() => efforts.reduce((sum, e) => sum + (e.doorCount || 0), 0), [efforts]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] });
  const create = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/efforts`, { method: 'POST', body: { name, surveyTemplateId: surveyTemplateId || undefined, seedWalkListId: seedWalkListId || undefined } }),
    onSuccess: () => { setName(''); setSurveyTemplateId(''); setSeedWalkListId(''); invalidate(); },
  });
  const update = useMutation({ mutationFn: ({ id, body }) => api(`/admin/campaigns/${campaignId}/efforts/${id}`, { method: 'PATCH', body }), onSuccess: invalidate });
  const archive = useMutation({ mutationFn: (id) => api(`/admin/campaigns/${campaignId}/efforts/${id}/archive`, { method: 'POST' }), onSuccess: invalidate });
  const del = useMutation({ mutationFn: (id) => api(`/admin/campaigns/${campaignId}/efforts/${id}`, { method: 'DELETE' }), onSuccess: invalidate });

  const fieldLabel = 'mb-1 block text-xs font-medium text-fg';

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Efforts</h1>
        <CampaignSelector campaignId={campaignId} onChange={setCampaignId} campaigns={campaigns} isLoading={isLoading} />
      </div>

      <p className="mb-4 max-w-3xl text-sm text-fg-muted">
        An effort is a parallel canvassing operation within a campaign — e.g. an area or a team. Each
        effort owns a disjoint set of doors, an optional survey, and a roster, and has its own Passes
        (cut on the Turf Cutting page). Doors no one has claimed sit in <strong>Intake</strong>.
      </p>

      {campaignId && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Efforts" value={efforts.length.toLocaleString()} />
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
          <strong>{intakeCount.toLocaleString()}</strong> door{intakeCount === 1 ? '' : 's'} in Intake (new addresses awaiting assignment). Open an effort below → <em>Claim all Intake</em> to assign them.
        </NextStepBanner>
      )}

      <Card as="section" className="mb-6 p-5">
        <h2 className="mb-3 text-base font-semibold text-fg">New effort</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className={fieldLabel}>Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Dallas" className="w-56" />
          </label>
          <label className="text-sm">
            <span className={fieldLabel}>Seed door-set (walk list)</span>
            <Select value={seedWalkListId} onChange={(e) => setSeedWalkListId(e.target.value)}>
              <option value="">None (claim doors later)</option>
              {walkLists.map((w) => <option key={w._id} value={w._id}>{w.name} ({w.householdCount} hh){w.source === 'csv' ? ' · CSV' : ''}</option>)}
            </Select>
          </label>
          {isSurveyType && (
            <label className="text-sm">
              <span className={fieldLabel}>Survey override</span>
              <Select value={surveyTemplateId} onChange={(e) => setSurveyTemplateId(e.target.value)}>
                <option value="">Campaign default</option>
                {surveys.map((s) => <option key={s._id} value={s._id}>{s.name} (v{s.version || 1})</option>)}
              </Select>
            </label>
          )}
          <Button onClick={() => name && create.mutate()} disabled={!name} loading={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create effort'}
          </Button>
        </div>
        {create.error && <div className="mt-2 text-xs text-danger">{create.error.message}</div>}
        <p className="mt-2 text-xs text-fg-muted">Walk lists can be built from filters or an uploaded Voter-ID CSV (Walk Lists page). Seeding from either claims only that list's <em>unowned</em> doors; to move doors already in another effort, open the effort → Claim → Re-carve.</p>
      </Card>

      <Card className="overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-sunken/90 text-[11px] font-semibold uppercase tracking-wider text-fg-muted backdrop-blur">
            <tr>
              <th className="px-4 py-2 text-left">Effort</th>
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
                crewNames={(e.crewUserIds || []).map((id) => nameByUserId.get(id)).filter(Boolean)}
                tz={tz}
                onUpdate={(eff, body) => update.mutate({ id: eff._id, body })}
                onArchive={(eff) => archive.mutate(eff._id)}
                onDelete={(eff) => { if (window.confirm(`Delete effort "${eff.name}"? Its doors return to Intake.`)) del.mutate(eff._id); }}
              />
            ))}
            {!efforts.length && <tr><td colSpan="8" className="px-4 py-6 text-center text-fg-muted">No efforts yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      {del.error && <div className="mt-2 text-sm text-danger">{del.error.message}</div>}
    </div>
  );
}
