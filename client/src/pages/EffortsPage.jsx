import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import CampaignSelector, { useCampaignSelection } from '../components/CampaignSelector.jsx';

const STATUS_BADGE = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-400',
};

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
  const canvassers = (orgQ.data?.members || []).filter((m) => m.role === 'canvasser' && m.user.isActive && m.isActive);
  const addable = canvassers.filter((m) => !crewIds.has(String(m.user.id)));

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Crew</div>
      <p className="mb-2 text-[11px] text-gray-500">
        Fills in automatically from book assignments. Add people here to pre-stage them before assigning.
      </p>
      {crew.length === 0 ? (
        <p className="text-xs text-gray-500">No one yet — assign books on the Turf page, or pre-add someone below.</p>
      ) : (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {crew.map((c) => {
            const manualOnly = c.viaRoster && !c.viaAssignment;
            return (
              <li key={c.user.id} className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs ring-1 ring-gray-200">
                {c.user.firstName} {c.user.lastName}
                <span className={c.viaAssignment ? 'text-[10px] font-medium text-green-600' : 'text-[10px] text-gray-400'}>
                  {c.viaAssignment ? 'assigned' : 'added'}
                </span>
                {manualOnly && (
                  <button onClick={() => remove.mutate(c.user.id)} className="text-gray-400 hover:text-red-600" title="Remove (pre-staged only — assigned people leave when unassigned on the Turf page)">×</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="">Pre-add canvasser…</option>
          {addable.map((m) => (
            <option key={m.user.id} value={m.user.id}>{m.user.firstName} {m.user.lastName}</option>
          ))}
        </select>
        <button onClick={() => userId && add.mutate(userId)} disabled={!userId || add.isPending} className="rounded bg-brand-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">Add</button>
      </div>
    </div>
  );
}

function ClaimPanel({ campaignId, effort, walkLists }) {
  const qc = useQueryClient();
  const [walkListId, setWalkListId] = useState('');
  const claim = useMutation({
    mutationFn: ({ body }) => api(`/admin/campaigns/${campaignId}/efforts/${effort._id}/claim`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] }),
  });
  const owned = claim.error?.data?.code === 'doors-owned' ? claim.error.data : null;

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Claim doors</div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={walkListId} onChange={(e) => setWalkListId(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="">From a walk list…</option>
          {walkLists.map((w) => (
            <option key={w._id} value={w._id}>{w.name} ({w.householdCount} hh){w.source === 'csv' ? ' · CSV' : ''}</option>
          ))}
        </select>
        <button onClick={() => walkListId && claim.mutate({ body: { walkListId } })} disabled={!walkListId || claim.isPending} className="rounded bg-brand-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">Claim list</button>
        <span className="text-xs text-gray-400">or</span>
        <button onClick={() => claim.mutate({ body: { all: true } })} disabled={claim.isPending} className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-white">Claim all Intake</button>
      </div>
      {claim.data && (
        <p className="mt-2 text-xs text-green-700">Claimed {claim.data.claimed} door(s){claim.data.reassigned ? ` (${claim.data.reassigned} moved from other efforts)` : ''}.</p>
      )}
      {owned && (
        <div className="mt-2 text-xs text-amber-700">
          {owned.conflicts} door(s) belong to another effort.{' '}
          <button onClick={() => claim.mutate({ body: { walkListId: walkListId || undefined, all: walkListId ? undefined : true, force: true } })} className="font-semibold underline">Move them here (re-carve)</button>
        </div>
      )}
      {claim.error && !owned && <p className="mt-2 text-xs text-red-700">{claim.error.message}</p>}
    </div>
  );
}

function EffortRow({ campaignId, effort, walkLists, surveys, isSurveyType, onUpdate, onArchive, onDelete }) {
  const [open, setOpen] = useState(false);
  const survey = surveys.find((s) => String(s._id) === String(effort.surveyTemplateId));
  return (
    <>
      <tr className="border-t border-gray-100">
        <td className="px-4 py-2">
          <span className="font-medium text-gray-900">{effort.name}</span>
        </td>
        <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE[effort.status] || ''}`}>{effort.status}</span></td>
        <td className="px-4 py-2 text-right">{(effort.doorCount || 0).toLocaleString()}</td>
        <td className="px-4 py-2 text-right">{effort.crewCount || 0}</td>
        <td className="px-4 py-2">{effort.activeRound ? `Round ${effort.activeRound.roundNumber} · ${effort.activeRound.name}` : <span className="text-gray-400">—</span>}</td>
        <td className="px-4 py-2 text-gray-600">{isSurveyType ? (survey ? survey.name : <span className="text-gray-400">campaign default</span>) : <span className="text-gray-400">n/a</span>}</td>
        <td className="space-x-2 px-4 py-2 text-right">
          <button onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-brand-700 hover:underline">{open ? 'Close' : 'Manage'}</button>
          {effort.status !== 'archived' && <button onClick={() => onArchive(effort)} className="text-xs text-gray-500 hover:underline">Archive</button>}
          <button onClick={() => onDelete(effort)} className="text-xs text-red-600 hover:underline">Delete</button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-gray-50 bg-gray-50/50">
          <td colSpan="7" className="px-4 py-3">
            <div className="grid gap-3 md:grid-cols-2">
              <RosterPanel campaignId={campaignId} effort={effort} />
              <ClaimPanel campaignId={campaignId} effort={effort} walkLists={walkLists} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                defaultValue={effort.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== effort.name && onUpdate(effort, { name: e.target.value.trim() })}
                className="rounded border border-gray-300 px-2 py-1 text-xs"
              />
              {isSurveyType && (
                <select
                  defaultValue={effort.surveyTemplateId || ''}
                  onChange={(e) => onUpdate(effort, { surveyTemplateId: e.target.value || null })}
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                >
                  <option value="">Survey: campaign default</option>
                  {surveys.map((s) => <option key={s._id} value={s._id}>{s.name} (v{s.version || 1})</option>)}
                </select>
              )}
              <a href={`/passes?effortId=${effort._id}`} className="text-xs font-medium text-brand-700 hover:underline">Manage rounds →</a>
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

  const efforts = effortsQ.data?.efforts || [];
  const intakeCount = effortsQ.data?.intakeCount || 0;
  const walkLists = walkListsQ.data?.walkLists || [];
  const surveys = surveysQ.data?.surveys || [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] });
  const create = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/efforts`, { method: 'POST', body: { name, surveyTemplateId: surveyTemplateId || undefined, seedWalkListId: seedWalkListId || undefined } }),
    onSuccess: () => { setName(''); setSurveyTemplateId(''); setSeedWalkListId(''); invalidate(); },
  });
  const update = useMutation({ mutationFn: ({ id, body }) => api(`/admin/campaigns/${campaignId}/efforts/${id}`, { method: 'PATCH', body }), onSuccess: invalidate });
  const archive = useMutation({ mutationFn: (id) => api(`/admin/campaigns/${campaignId}/efforts/${id}/archive`, { method: 'POST' }), onSuccess: invalidate });
  const del = useMutation({ mutationFn: (id) => api(`/admin/campaigns/${campaignId}/efforts/${id}`, { method: 'DELETE' }), onSuccess: invalidate });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Efforts</h1>
        <CampaignSelector campaignId={campaignId} onChange={setCampaignId} campaigns={campaigns} isLoading={isLoading} />
      </div>

      <p className="mb-4 max-w-3xl text-sm text-gray-500">
        An effort is a parallel canvassing operation within a campaign — e.g. an area or a team. Each
        effort owns a disjoint set of doors, an optional survey, and a roster, and has its own Rounds
        (cut on the Turf Cutting page). Doors no one has claimed sit in <strong>Intake</strong>.
      </p>

      {intakeCount > 0 && (
        <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
          <strong>{intakeCount.toLocaleString()}</strong> door{intakeCount === 1 ? '' : 's'} in Intake (new addresses awaiting assignment). Open an effort below → <em>Claim all Intake</em> to assign them.
        </div>
      )}

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-base font-medium">New effort</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-700">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Dallas" className="rounded border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-700">Seed door-set (walk list)</span>
            <select value={seedWalkListId} onChange={(e) => setSeedWalkListId(e.target.value)} className="rounded border border-gray-300 px-3 py-2 text-sm">
              <option value="">None (claim doors later)</option>
              {walkLists.map((w) => <option key={w._id} value={w._id}>{w.name} ({w.householdCount} hh){w.source === 'csv' ? ' · CSV' : ''}</option>)}
            </select>
          </label>
          {isSurveyType && (
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-700">Survey override</span>
              <select value={surveyTemplateId} onChange={(e) => setSurveyTemplateId(e.target.value)} className="rounded border border-gray-300 px-3 py-2 text-sm">
                <option value="">Campaign default</option>
                {surveys.map((s) => <option key={s._id} value={s._id}>{s.name} (v{s.version || 1})</option>)}
              </select>
            </label>
          )}
          <button onClick={() => name && create.mutate()} disabled={!name || create.isPending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
            {create.isPending ? 'Creating…' : 'Create effort'}
          </button>
        </div>
        {create.error && <div className="mt-2 text-xs text-red-700">{create.error.message}</div>}
        <p className="mt-2 text-xs text-gray-500">Walk lists can be built from filters or an uploaded Voter-ID CSV (Walk Lists page). Seeding from either claims only that list's <em>unowned</em> doors; to move doors already in another effort, open the effort → Claim → Re-carve.</p>
      </section>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Effort</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">Doors</th>
              <th className="px-4 py-2 text-right">Crew</th>
              <th className="px-4 py-2 text-left">Active round</th>
              <th className="px-4 py-2 text-left">Survey</th>
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
                onUpdate={(eff, body) => update.mutate({ id: eff._id, body })}
                onArchive={(eff) => archive.mutate(eff._id)}
                onDelete={(eff) => { if (window.confirm(`Delete effort "${eff.name}"? Its doors return to Intake.`)) del.mutate(eff._id); }}
              />
            ))}
            {!efforts.length && <tr><td colSpan="7" className="px-4 py-6 text-center text-gray-500">No efforts yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {del.error && <div className="mt-2 text-sm text-red-700">{del.error.message}</div>}
    </div>
  );
}
