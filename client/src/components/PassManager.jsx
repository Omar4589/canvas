import { Fragment, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import StatCard from './StatCard.jsx';
import { useCampaignSelection } from './CampaignSelector.jsx';
import { Card, Badge, Button, Input, Modal } from './ui';
import {
  ArchivePassDialog,
  ArchiveWalkListDialog,
  BringBackPassDialog,
  UnarchiveWalkListDialog,
  invalidateLifecycle,
  isTemporaryError,
  noticeText,
  refreshAfterRefusal,
} from './walkListLifecycle';
import { formatInTz } from '../lib/datetime.js';
import { ratePct } from '../lib/rates.js';
import { archivedPassDetail, walkListActions } from '../lib/walkListState.js';
import { passShortLabel } from '../lib/walkListOptions.js';

// Effort-scoped pass management, shared by the full-page PassesPage wrapper
// (variant="full") and the Walk Lists drawer (variant="compact"). The effort is
// fixed by the caller — there is no walk-list picker here.
//
// An archived pass shows how it ended and, while it can, Bring back
// (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §D.2). An archived walk list — or campaign — makes every pass
// view-only: no New pass, Activate, Archive, Delete or Bring back.

const STATUS_VARIANT = { draft: 'neutral', active: 'success', archived: 'neutral' };

const SEG_COLORS = {
  surveyed: '#22c55e',
  lit_dropped: '#a855f7',
  not_home: '#3b82f6',
  wrong_address: '#ef4444',
  refused: '#f59e0b',
  restricted: '#475569',
  no_soliciting: '#db2777',
  not_target: '#a21caf',
  unknocked: '#9ca3af',
};

function ProgressBar({ counts = {}, total = 0 }) {
  if (!total) return <span className="text-xs text-fg-subtle">no doors</span>;
  return (
    <div className="flex h-2 w-40 overflow-hidden rounded bg-sunken">
      {['surveyed', 'refused', 'not_target', 'restricted', 'no_soliciting', 'lit_dropped', 'not_home', 'wrong_address', 'unknocked'].map((k) =>
        counts[k] ? (
          <div key={k} style={{ width: `${(counts[k] / total) * 100}%`, background: SEG_COLORS[k] }} />
        ) : null
      )}
    </div>
  );
}

function PassProgress({ campaignId, passId }) {
  const q = useQuery({
    queryKey: ['pass-progress', campaignId, passId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes/${passId}/progress`),
    enabled: !!campaignId && !!passId,
  });
  if (q.isLoading) return <span className="text-xs text-fg-subtle">…</span>;
  const { counts, total } = q.data || {};
  const done = total ? Math.round(((total - (counts?.unknocked || 0)) / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <ProgressBar counts={counts || {}} total={total || 0} />
      <span className="text-xs tabular-nums text-fg-muted">{done}%</span>
    </div>
  );
}

// Stacked initials avatars for a book's assigned canvassers (hover = full names).
function Avatars({ users = [] }) {
  if (!users.length) return <span className="text-xs text-fg-subtle">Unassigned</span>;
  const shown = users.slice(0, 3);
  return (
    <span
      className="flex items-center -space-x-1"
      title={users.map((u) => `${u.firstName} ${u.lastName}`).join(', ')}
    >
      {shown.map((u) => (
        <span
          key={u.id}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-tint text-[9px] font-semibold text-brand-tint-fg ring-1 ring-card"
        >
          {((u.firstName?.[0] || '') + (u.lastName?.[0] || '')).toUpperCase()}
        </span>
      ))}
      {users.length > 3 && <span className="pl-1.5 text-[10px] text-fg-subtle">+{users.length - 3}</span>}
    </span>
  );
}

// Activate a pass, but guard the silent dead-end: a pass with published books but
// ZERO canvasser assignments activates fine yet shows the field nothing. Warn
// (non-blocking) when that's the case; "Activate anyway" proceeds.
function ActivateButton({ campaignId, pass, onActivate, pending = false }) {
  const [confirm, setConfirm] = useState(false);
  const asgQ = useQuery({
    queryKey: ['turf-pass-assignments', campaignId, pass._id],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/assignments?passId=${pass._id}`),
    enabled: !!campaignId && !!pass._id,
  });
  const assignmentCount = (asgQ.data?.assignments || []).length;

  // A second click while the first is on its way would meet the walk list's lifecycle lock and read
  // "someone else is changing this walk list" while the pass goes live — so it's ignored.
  function click() {
    if (pending) return;
    if (asgQ.isSuccess && assignmentCount === 0) setConfirm(true);
    else onActivate();
  }

  return (
    <>
      <button onClick={click} disabled={pending} className="text-xs font-semibold text-success hover:underline disabled:opacity-60">
        Activate
      </button>
      {confirm && (
        <Modal
          size="md"
          onClose={() => setConfirm(false)}
          title="Activate with no canvassers assigned?"
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={() => { setConfirm(false); onActivate(); }}>Activate anyway</Button>
            </>
          }
        >
          <p className="text-sm text-fg-muted">
            No books in this pass are assigned to a canvasser. Canvassers only see books assigned to them,
            so nobody will have work until you assign them on the Turf Cutting page. You can activate now and
            assign later.
          </p>
        </Modal>
      )}
    </>
  );
}

// viewOnly: an archived pass, or any pass of an archived walk list or campaign — Turf Cutting shows
// its books as they were, so the links say View, never Cut.
function PassDetail({ campaignId, pass, tz, viewOnly = false }) {
  const turfsQ = useQuery({
    queryKey: ['turfs', campaignId, pass._id],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs?passId=${pass._id}`),
    enabled: !!campaignId,
  });
  const asgQ = useQuery({
    queryKey: ['turf-pass-assignments', campaignId, pass._id],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/assignments?passId=${pass._id}`),
    enabled: !!campaignId,
  });
  const turfs = turfsQ.data?.turfs || [];
  const byTurf = new Map();
  for (const a of asgQ.data?.assignments || []) {
    const key = String(a.turfId);
    const arr = byTurf.get(key) || [];
    arr.push(a.user);
    byTurf.set(key, arr);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
        {pass.activatedAt && (
          <span>Activated {formatInTz(pass.activatedAt, tz, { month: 'short', day: 'numeric', year: 'numeric' }, false)}</span>
        )}
        <a href={`/campaigns/${campaignId}/turfs?passId=${pass._id}`} className="font-medium text-brand-accent hover:underline">
          {viewOnly ? 'View books →' : 'Cut / assign books →'}
        </a>
        <a href={`/campaigns/${campaignId}/map?passId=${pass._id}`} className="font-medium text-brand-accent hover:underline">Audit →</a>
      </div>
      {turfsQ.isLoading ? (
        <div className="text-xs text-fg-muted">Loading books…</div>
      ) : !turfs.length ? (
        <div className="text-xs text-fg-muted">
          {viewOnly ? (
            'No books were cut for this pass.'
          ) : (
            <>
              No books cut yet.{' '}
              <a href={`/campaigns/${campaignId}/turfs?passId=${pass._id}`} className="font-medium text-brand-accent hover:underline">Cut books →</a>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
          {turfs.map((t) => (
            <li key={t._id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-fg">{t.name}</span>
                <span className="ml-2 text-xs text-fg-muted">{(t.eligibleDoorCount ?? t.doorCount ?? 0).toLocaleString()} doors</span>
              </div>
              <div className="flex items-center gap-3">
                <Avatars users={byTurf.get(String(t._id)) || []} />
                <a href={`/campaigns/${campaignId}/turfs?passId=${pass._id}`} className="shrink-0 text-xs font-medium text-brand-accent hover:underline">Open in Turf →</a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PassManager({ campaignId, effortId, tz, variant = 'full', campaignType }) {
  const qc = useQueryClient();
  const compact = variant === 'compact';
  const [name, setName] = useState('');
  const [openId, setOpenId] = useState(null);
  // The open box: { kind: 'archive' | 'bring-back', passId } for a pass, or { kind: 'unarchive' | 'end' }
  // for the walk list.
  const [dialog, setDialog] = useState(null);
  // The line left after archiving or bringing back a pass, with its Undo (lifecycleCopy.noticeText).
  const [notice, setNotice] = useState(null);

  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId, effortId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes?effortId=${effortId}`),
    enabled: !!campaignId && !!effortId,
    // A row whose Bring back is held for a moment ("Try again in a minute": a book operation holds the
    // pass) checks again on its own, so the button comes back without a reload.
    refetchInterval: (query) => ((query.state.data?.passes || []).some((p) => p.bringBack?.temporary) ? 30_000 : false),
  });
  const passes = passesQ.data?.passes || [];
  // The walk list and the campaign come from the caches both callers already hold.
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  const effort = (effortsQ.data?.efforts || []).find((e) => String(e._id) === String(effortId)) || null;
  const { selected } = useCampaignSelection(campaignId);
  const campaignArchived = selected?.isActive === false;
  const walkListArchived = effort?.status === 'archived';
  const readOnly = campaignArchived || walkListArchived;
  // An archived walk list whose pass is still live — archived before this change, until the one-time
  // check runs — offers "End Pass 3" beside Unarchive, as its Walk Lists row does.
  const endPassLabel = walkListActions(effort, { campaignArchived }).endPass;

  const totalBooks = useMemo(() => passes.reduce((s, p) => s + (p.turfCount || 0), 0), [passes]);
  const activePass = passes.find((p) => p.status === 'active');
  const nextNumber = useMemo(() => passes.reduce((m, p) => Math.max(m, p.roundNumber || 0), 0) + 1, [passes]);
  const formatDay = (iso) => formatInTz(iso, tz, { month: 'short', day: 'numeric' }, false);

  const invalidate = () => invalidateLifecycle(qc, campaignId);
  // A 409 means this page may be behind (someone archived the walk list, the pass or the campaign):
  // refetch, and show the server's sentence.
  const onRefusal = (err) => refreshAfterRefusal(qc, campaignId, err);

  const create = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/passes`, { method: 'POST', body: { name, effortId } }),
    onSuccess: () => { setName(''); invalidate(); },
    onError: onRefusal,
  });
  const action = useMutation({
    mutationFn: ({ id, op }) => api(`/admin/campaigns/${campaignId}/passes/${id}/${op}`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: onRefusal,
  });
  const del = useMutation({
    mutationFn: (id) => api(`/admin/campaigns/${campaignId}/passes/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: onRefusal,
  });
  // Undo for the line after: an archive is undone by Bring back, a bring back by archiving again (its
  // box was just confirmed, so the flag is sent as-is).
  const undo = useMutation({
    mutationFn: (n) =>
      n.kind === 'pass-archived'
        ? api(`/admin/campaigns/${campaignId}/passes/${n.pass._id}/bring-back`, { method: 'POST', body: {} })
        : api(`/admin/campaigns/${campaignId}/passes/${n.pass._id}/archive`, { method: 'POST', body: { confirmArchive: true } }),
    onSuccess: (res, n) => {
      invalidate();
      setNotice(
        n.kind === 'pass-archived'
          ? { kind: 'pass-back', pass: n.pass, to: res?.to || null, downgraded: res?.downgraded || null }
          : { kind: 'pass-archived', pass: n.pass }
      );
    },
    onError: onRefusal,
  });
  const noticeLine = notice ? noticeText(notice) : null;
  // A refused Undo says why on its own line, and a permanent refusal (say a newer pass went live since)
  // takes the link away — it could never work (code review round 2).
  const undoRefused = undo.error?.status === 409 && !isTemporaryError(undo.error);
  const passRef = (p) => ({ _id: p._id, roundNumber: p.roundNumber, name: p.name });
  // The box reads the row as it is NOW: a refetch after a refusal updates what it says.
  const dialogPass = dialog?.passId ? passes.find((p) => String(p._id) === String(dialog.passId)) || null : null;
  const openDialog = (next) => {
    undo.reset();
    setDialog(next);
  };

  // Lit-drop campaigns knock to drop literature, not to survey — same column, different unit.
  const isLitDrop = campaignType === 'lit_drop';
  const colSpan = 10;

  return (
    <div>
      {!compact && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Passes" value={passes.length.toLocaleString()} />
          <StatCard
            label="Active pass"
            value={activePass ? `Pass ${activePass.roundNumber}` : '—'}
            accent={activePass ? 'green' : undefined}
            hint={activePass ? activePass.name : undefined}
          />
          <StatCard label="Total books" value={totalBooks.toLocaleString()} />
        </div>
      )}

      {campaignArchived ? (
        // The Walk Lists page carries the campaign's own banner above its drawers.
        !compact && (
          <div className="mb-6 rounded-md border border-border bg-sunken px-3 py-2 text-sm text-fg-muted">
            This campaign is archived, so its passes are read-only. Reactivate it on the Campaigns page to make changes.
          </div>
        )
      ) : walkListArchived ? (
        compact ? (
          // The drawer above already offers Unarchive; one button per view.
          <p className="mb-3 text-xs text-fg-muted">Passes are view only while {effort.name} is archived.</p>
        ) : (
          <div
            className={`mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border px-4 py-2.5 text-sm ${
              endPassLabel ? 'border-warning/30 bg-warning-tint text-warning-fg' : 'border-border bg-sunken text-fg-muted'
            }`}
          >
            <span className="min-w-0">
              {endPassLabel
                ? `${effort.name} is archived, but ${passShortLabel(effort.activeRound)} is still live. Its other passes are view only.`
                : `${effort.name} is archived, so its passes are view only. Their history stays in every report.`}
            </span>
            <span className="flex shrink-0 flex-wrap gap-2">
              {endPassLabel && (
                <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: 'end' })}>
                  {endPassLabel}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => openDialog({ kind: 'unarchive' })}>
                Unarchive {effort.name}
              </Button>
            </span>
          </div>
        )
      ) : compact ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Pass ${nextNumber} — optional name`}
            className="w-52 py-1 text-xs"
          />
          <Button size="sm" onClick={() => create.mutate()} loading={create.isPending}>
            {create.isPending ? 'Adding…' : 'New pass'}
          </Button>
          {create.error && <span className="text-xs text-danger">{create.error.message}</span>}
        </div>
      ) : (
        <Card as="section" className="mb-6 p-5">
          <h2 className="mb-3 text-base font-semibold text-fg">New pass</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-fg">Name <span className="font-normal text-fg-subtle">(optional)</span></span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Pass ${nextNumber}`} className="w-56" />
            </label>
            <Button onClick={() => create.mutate()} loading={create.isPending}>
              {create.isPending ? 'Adding…' : 'New pass'}
            </Button>
          </div>
          {create.error && <div className="mt-2 text-xs text-danger">{create.error.message}</div>}
          <p className="mt-2 text-xs text-fg-muted">
            A new pass numbers itself (leave the name blank for “Pass {nextNumber}”). Create a pass → cut its books on the Turf Cutting page → Activate it here. Each walk list has one live pass at a time; activating the next pass ends the current one. An archived pass can be brought back until a newer pass on its walk list goes live.
          </p>
        </Card>
      )}

      {noticeLine && (
        <div role="status" className={`mb-2 flex items-start gap-3 text-xs ${noticeLine.tone === 'warning' ? 'text-warning-fg' : 'text-success-fg'}`}>
          <span className="flex-1">
            {noticeLine.text}
            {noticeLine.undo && !readOnly && !undoRefused && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => undo.mutate(notice)}
                  disabled={undo.isPending}
                  className="font-semibold underline disabled:opacity-60"
                >
                  {undo.isPending ? 'Undoing…' : 'Undo'}
                </button>
              </>
            )}
            {undo.error && <span className="ml-1 text-danger">{undo.error.message}</span>}
          </span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 font-semibold hover:opacity-70" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <Card className="overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-2 text-left">Pass</th>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">Books</th>
              <th className="px-4 py-2 text-right">Knocks</th>
              <th className="px-4 py-2 text-right">{isLitDrop ? 'Lit drops' : 'Survey doors'}</th>
              <th className="px-4 py-2 text-right">Conn %</th>
              <th className="px-4 py-2 text-left">Progress</th>
              <th className="px-4 py-2 text-left">Created</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {passes.map((p) => {
              const open = openId === p._id;
              const endedDetail = p.status === 'archived' ? archivedPassDetail(p, { formatDate: formatDay, effortName: effort?.name }) : '';
              return (
                <Fragment key={p._id}>
                  <tr
                    onClick={() => setOpenId(open ? null : p._id)}
                    className="cursor-pointer border-t border-border transition-colors hover:bg-sunken/60"
                  >
                    <td className="px-4 py-2 text-fg-muted">
                      <span className="mr-1.5 inline-block text-fg-subtle">{open ? '▾' : '▸'}</span>
                      {p.roundNumber}
                    </td>
                    <td className="px-4 py-2 text-fg">
                      {p.name}
                      {p.status === 'active' && (
                        <Badge variant="success" className="ml-2">ACTIVE</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {p.status === 'archived' ? (
                        // "Archived · Oct 27 by Ada · by hand", then why it can't come back when it can't. An
                        // archived walk list's banner already says why none of its passes can.
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="inline-flex flex-wrap items-center gap-x-1.5">
                            <Badge variant={STATUS_VARIANT.archived}>Archived</Badge>
                            {endedDetail && <span className="text-xs text-fg-muted">{endedDetail}</span>}
                          </span>
                          {!readOnly && p.bringBack && !p.bringBack.ok && p.bringBackMessage && (
                            <span className="text-[11px] text-fg-subtle">{p.bringBackMessage}</span>
                          )}
                        </div>
                      ) : (
                        <Badge variant={STATUS_VARIANT[p.status] || 'neutral'} className="capitalize">{p.status}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg">{p.turfCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg">{(p.knockCount || 0).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg">
                      {((isLitDrop ? p.litKnocks : p.surveyedKnocks) || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg-muted">{ratePct(p.connectionRate)}</td>
                    <td className="px-4 py-2"><PassProgress campaignId={campaignId} passId={p._id} /></td>
                    <td className="px-4 py-2 text-fg-muted">
                      {p.createdAt ? formatInTz(p.createdAt, tz, { month: 'short', day: 'numeric', year: 'numeric' }, false) : '—'}
                    </td>
                    <td className="space-x-2 px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {!readOnly && p.status === 'draft' && (
                        <ActivateButton
                          campaignId={campaignId}
                          pass={p}
                          onActivate={() => action.mutate({ id: p._id, op: 'activate' })}
                          pending={action.isPending}
                        />
                      )}
                      {/* A draft can hold knocks (a discard that kept them, a restored snapshot): the server
                          refuses to delete it — its history stays — so it offers Archive instead. */}
                      {!readOnly && (p.status === 'active' || (p.status === 'draft' && p.knockCount > 0)) && (
                        <button onClick={() => openDialog({ kind: 'archive', passId: p._id })} className="text-xs text-fg-muted hover:underline">
                          Archive
                        </button>
                      )}
                      {!readOnly && p.status === 'draft' && !(p.knockCount > 0) && (
                        <button onClick={() => del.mutate(p._id)} className="text-xs text-danger hover:underline">
                          Delete
                        </button>
                      )}
                      {!readOnly && p.status === 'archived' && p.bringBack?.ok && (
                        <button
                          onClick={() => openDialog({ kind: 'bring-back', passId: p._id })}
                          className="text-xs font-semibold text-brand-accent hover:underline"
                        >
                          Bring back
                        </button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-t border-border bg-sunken/50">
                      <td colSpan={colSpan} className="px-4 py-3">
                        <PassDetail campaignId={campaignId} pass={p} tz={tz} viewOnly={readOnly || p.status === 'archived'} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!passes.length && (
              <tr><td colSpan={colSpan} className="px-4 py-6 text-center text-fg-muted">
                {passesQ.isLoading ? 'Loading passes…' : 'No passes yet — add the first one above.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </Card>
      {/* Activate's refusals (pass-archived, another-pass-live, walk-list-archived…) are the server's sentence. */}
      {action.error && <div className="mt-2 text-sm text-danger">{action.error.message}</div>}
      {del.error && <div className="mt-2 text-sm text-danger">{del.error.message}</div>}

      {dialog?.kind === 'archive' && dialogPass && (
        <ArchivePassDialog
          campaignId={campaignId}
          pass={dialogPass}
          effortName={effort?.name}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setNotice({ kind: 'pass-archived', pass: passRef(dialogPass) });
          }}
        />
      )}
      {dialog?.kind === 'bring-back' && dialogPass && (
        <BringBackPassDialog
          campaignId={campaignId}
          pass={dialogPass}
          effortName={effort?.name}
          onClose={() => setDialog(null)}
          onDone={(res) => {
            setDialog(null);
            setNotice({ kind: 'pass-back', pass: passRef(dialogPass), to: res?.to || null, downgraded: res?.downgraded || null });
          }}
        />
      )}
      {dialog?.kind === 'unarchive' && effort && (
        <UnarchiveWalkListDialog
          campaignId={campaignId}
          effort={effort}
          onClose={() => setDialog(null)}
          onDone={(res) => {
            setDialog(null);
            setNotice({
              kind: 'walk-list-unarchived',
              name: effort.name,
              pass: res?.endedPass || null,
              to: res?.to || null,
              bringBackError: res?.bringBackError || null,
            });
          }}
        />
      )}
      {dialog?.kind === 'end' && effort && (
        <ArchiveWalkListDialog
          campaignId={campaignId}
          effort={effort}
          onClose={() => setDialog(null)}
          onDone={(res) => {
            setDialog(null);
            setNotice({ kind: 'pass-ended', name: effort.name, pass: res?.endedPass || null });
          }}
        />
      )}
    </div>
  );
}
