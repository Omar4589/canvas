import { Fragment, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import StatCard from './StatCard.jsx';
import { Card, Badge, Button, Input, Modal } from './ui';
import { formatInTz } from '../lib/datetime.js';
import { ratePct } from '../lib/rates.js';

// Effort-scoped pass management, shared by the full-page PassesPage wrapper
// (variant="full") and the Walk Lists drawer (variant="compact"). The effort is
// fixed by the caller — there is no walk-list picker here.

const STATUS_VARIANT = { draft: 'neutral', active: 'success', archived: 'neutral' };

const SEG_COLORS = {
  surveyed: '#22c55e',
  lit_dropped: '#a855f7',
  not_home: '#3b82f6',
  wrong_address: '#ef4444',
  refused: '#f59e0b',
  restricted: '#475569',
  unknocked: '#9ca3af',
};

function ProgressBar({ counts = {}, total = 0 }) {
  if (!total) return <span className="text-xs text-fg-subtle">no doors</span>;
  return (
    <div className="flex h-2 w-40 overflow-hidden rounded bg-sunken">
      {['surveyed', 'refused', 'restricted', 'lit_dropped', 'not_home', 'wrong_address', 'unknocked'].map((k) =>
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
function ActivateButton({ campaignId, pass, onActivate }) {
  const [confirm, setConfirm] = useState(false);
  const asgQ = useQuery({
    queryKey: ['turf-pass-assignments', campaignId, pass._id],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/assignments?passId=${pass._id}`),
    enabled: !!campaignId && !!pass._id,
  });
  const assignmentCount = (asgQ.data?.assignments || []).length;

  function click() {
    if (asgQ.isSuccess && assignmentCount === 0) setConfirm(true);
    else onActivate();
  }

  return (
    <>
      <button onClick={click} className="text-xs font-semibold text-success hover:underline">
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

function PassDetail({ campaignId, pass, tz }) {
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
        <a href={`/campaigns/${campaignId}/turfs?passId=${pass._id}`} className="font-medium text-brand-accent hover:underline">Cut / assign books →</a>
        <a href={`/campaigns/${campaignId}/map?passId=${pass._id}`} className="font-medium text-brand-accent hover:underline">Audit →</a>
      </div>
      {turfsQ.isLoading ? (
        <div className="text-xs text-fg-muted">Loading books…</div>
      ) : !turfs.length ? (
        <div className="text-xs text-fg-muted">
          No books cut yet.{' '}
          <a href={`/campaigns/${campaignId}/turfs?passId=${pass._id}`} className="font-medium text-brand-accent hover:underline">Cut books →</a>
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
  const [archiveTarget, setArchiveTarget] = useState(null); // pass pending archive-confirm
  const [archiveText, setArchiveText] = useState('');

  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId, effortId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes?effortId=${effortId}`),
    enabled: !!campaignId && !!effortId,
  });
  const passes = passesQ.data?.passes || [];

  const totalBooks = useMemo(() => passes.reduce((s, p) => s + (p.turfCount || 0), 0), [passes]);
  const activePass = passes.find((p) => p.status === 'active');
  const nextNumber = useMemo(() => passes.reduce((m, p) => Math.max(m, p.roundNumber || 0), 0) + 1, [passes]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'passes', campaignId] });
    qc.invalidateQueries({ queryKey: ['admin', 'efforts', campaignId] });
    qc.invalidateQueries({ queryKey: ['admin', 'setup-status', campaignId] });
    qc.invalidateQueries({ queryKey: ['campaign-rollup'] });
  };

  const create = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/passes`, { method: 'POST', body: { name, effortId } }),
    onSuccess: () => { setName(''); invalidate(); },
  });
  const action = useMutation({
    mutationFn: ({ id, op }) => api(`/admin/campaigns/${campaignId}/passes/${id}/${op}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: (id) => api(`/admin/campaigns/${campaignId}/passes/${id}/archive`, { method: 'POST', body: { confirmArchive: true } }),
    onSuccess: () => { setArchiveTarget(null); setArchiveText(''); invalidate(); },
  });
  const del = useMutation({
    mutationFn: (id) => api(`/admin/campaigns/${campaignId}/passes/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

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

      {compact ? (
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
            A new pass numbers itself (leave the name blank for “Pass {nextNumber}”). Create a pass → cut its books on the Turf Cutting page → Activate it here. Passes are one-way (draft → active → archived); each walk list can have one active pass.
          </p>
        </Card>
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
                      <Badge variant={STATUS_VARIANT[p.status] || 'neutral'} className="capitalize">{p.status}</Badge>
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
                      {p.status === 'draft' && (
                        <ActivateButton
                          campaignId={campaignId}
                          pass={p}
                          onActivate={() => action.mutate({ id: p._id, op: 'activate' })}
                        />
                      )}
                      {p.status === 'active' && (
                        <button onClick={() => { setArchiveText(''); setArchiveTarget(p); }} className="text-xs text-fg-muted hover:underline">
                          Archive
                        </button>
                      )}
                      {p.status === 'draft' && (
                        <button onClick={() => del.mutate(p._id)} className="text-xs text-danger hover:underline">
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-t border-border bg-sunken/50">
                      <td colSpan={colSpan} className="px-4 py-3">
                        <PassDetail campaignId={campaignId} pass={p} tz={tz} />
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
      {action.error && <div className="mt-2 text-sm text-danger">{action.error.message}</div>}

      {archiveTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-overlay/40 p-4" onClick={() => setArchiveTarget(null)}>
          <div className="w-full max-w-md rounded-lg bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-fg">
              Archive Pass {archiveTarget.roundNumber} — {archiveTarget.name}?
            </h3>
            <p className="mt-2 text-sm text-fg-muted">
              Archiving is <strong>one-way</strong> — a pass can't be reopened, and canvassers lose it in the field.
              <strong> Knock history is kept</strong> (add a new pass to keep going).
            </p>
            {archiveTarget.knockCount > 0 && (
              <div className="mt-2 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
                ⚠️ {archiveTarget.knockCount.toLocaleString()} knock{archiveTarget.knockCount === 1 ? '' : 's'} already recorded in this pass.
              </div>
            )}
            {archiveTarget.knockCount > 0 && (
              <label className="mt-3 block text-sm">
                <span className="mb-1 block text-xs font-medium text-fg-muted">Type <strong>archive</strong> to confirm</span>
                <input
                  value={archiveText}
                  onChange={(e) => setArchiveText(e.target.value)}
                  autoFocus
                  placeholder="archive"
                  className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-danger focus:outline-none"
                />
              </label>
            )}
            {archive.error && <div className="mt-2 text-xs text-danger">{archive.error.message}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setArchiveTarget(null)} disabled={archive.isPending} className="rounded px-3 py-1.5 text-sm text-fg-muted hover:bg-sunken">
                Cancel
              </button>
              <button
                onClick={() => archive.mutate(archiveTarget._id)}
                disabled={archive.isPending || (archiveTarget.knockCount > 0 && archiveText.trim().toLowerCase() !== 'archive')}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {archive.isPending ? 'Archiving…' : 'Archive pass'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
