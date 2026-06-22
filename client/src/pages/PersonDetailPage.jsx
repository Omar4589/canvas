import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';

const IDENTITY = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['fullName', 'Full name'],
  ['phone', 'Phone'], ['phoneType', 'Phone type'], ['cellPhone', 'Cell phone'],
  ['party', 'Party'], ['gender', 'Gender'], ['dateOfBirth', 'Date of birth'],
  ['registrationStatus', 'Registration status'],
];

function fmtDate(d, withTime = false) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(+dt)) return '—';
  return withTime ? dt.toLocaleString() : dt.toLocaleDateString();
}
function dobInput(d) {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(+dt) ? '' : dt.toISOString().slice(0, 10);
}

function Section({ title, right, children }) {
  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

// ── Merge dialog: pick the surviving value for each differing identity field ──
function MergeDialog({ survivor, victimId, onClose, onMerge, busy, error }) {
  const victimQ = useQuery({
    queryKey: ['super-admin', 'person', victimId],
    queryFn: () => api(`/super-admin/persons/${victimId}`),
  });
  const victim = victimQ.data?.person;
  const [choice, setChoice] = useState(null); // field -> 'survivor' | 'victim'

  const fields = IDENTITY.map(([k]) => k).filter((k) => k !== 'fullName');
  const differ = victim ? fields.filter((k) => JSON.stringify(survivor[k] ?? null) !== JSON.stringify(victim[k] ?? null)) : [];
  const choiceFor = (k) => (choice?.[k]) || ((survivor[k] ?? null) != null ? 'survivor' : 'victim');

  function confirm() {
    const fieldDecisions = differ.map((k) => {
      const from = choiceFor(k);
      return {
        field: k,
        chosenValue: from === 'victim' ? (victim[k] ?? null) : (survivor[k] ?? null),
        fromPersonId: from === 'victim' ? victim.id : survivor.id,
      };
    });
    onMerge({ victimId, fieldDecisions });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border border-border bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-fg">Merge into this person</h3>
        <p className="mt-1 text-sm text-fg-muted">
          The other record is tombstoned; its voters &amp; identity keys move onto <span className="font-medium text-fg">{survivor.fullName || 'this person'}</span>.
          Reversible later via split.
        </p>
        {victimQ.isLoading ? (
          <p className="mt-4 text-sm text-fg-muted">Loading the other record…</p>
        ) : victimQ.error ? (
          <p className="mt-4 text-sm text-danger">Error: {victimQ.error.message}</p>
        ) : !victim ? (
          <p className="mt-4 text-sm text-danger">The other record could not be loaded.</p>
        ) : (
          <>
            {differ.length === 0 ? (
              <p className="mt-4 rounded bg-sunken p-3 text-sm text-fg-muted">Identity values are identical — nothing to choose. Confirm to merge.</p>
            ) : (
              <table className="mt-4 w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-fg-subtle">
                  <tr><th className="py-1 text-left">Field</th><th className="py-1 text-left">Keep this</th><th className="py-1 text-left">Take other</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {differ.map((k) => (
                    <tr key={k}>
                      <td className="py-2 pr-2 font-medium text-fg-muted">{IDENTITY.find(([f]) => f === k)?.[1] || k}</td>
                      {['survivor', 'victim'].map((side) => {
                        const val = side === 'survivor' ? survivor[k] : victim[k];
                        return (
                          <td key={side} className="py-2 pr-2">
                            <label className="flex items-center gap-2">
                              <input type="radio" name={`m-${k}`} checked={choiceFor(k) === side} onChange={() => setChoice((c) => ({ ...c, [k]: side }))} />
                              <span className={(val ?? null) == null ? 'text-fg-subtle' : 'text-fg'}>{k === 'dateOfBirth' ? fmtDate(val) : (val ?? '—')}</span>
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {error && <div className="mt-3 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{error}</div>}
            <div className="mt-5 flex gap-2">
              <button onClick={confirm} disabled={busy} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {busy ? 'Merging…' : 'Confirm merge'}
              </button>
              <button onClick={onClose} className="rounded-md border border-border-strong px-4 py-2 text-sm">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function PersonDetailPage() {
  const { personId } = useParams();
  const qc = useQueryClient();
  const key = ['super-admin', 'person', personId];
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [mergeVictim, setMergeVictim] = useState(null);
  const [manualVictim, setManualVictim] = useState('');

  const detailQ = useQuery({ queryKey: key, queryFn: () => api(`/super-admin/persons/${personId}`) });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const onErr = (e) => setErr(e.message);
  const clearErr = () => setErr('');

  const patchIdentity = useMutation({
    mutationFn: (body) => api(`/super-admin/persons/${personId}`, { method: 'PATCH', body }),
    onSuccess: () => { clearErr(); setEditing(false); invalidate(); }, onError: onErr,
  });
  const setOwner = useMutation({
    mutationFn: (orgId) => api(`/super-admin/persons/${personId}/owner`, { method: 'PATCH', body: { orgId } }),
    onSuccess: () => { clearErr(); invalidate(); }, onError: onErr,
  });
  const setLock = useMutation({
    mutationFn: (lockedFields) => api(`/super-admin/persons/${personId}/lock`, { method: 'PATCH', body: { lockedFields } }),
    onSuccess: () => { clearErr(); invalidate(); }, onError: onErr,
  });
  const merge = useMutation({
    mutationFn: (body) => api(`/super-admin/persons/${personId}/merge`, { method: 'POST', body }),
    onSuccess: () => { clearErr(); setMergeVictim(null); setManualVictim(''); invalidate(); }, onError: onErr,
  });
  const split = useMutation({
    mutationFn: (mergeLogId) => api(`/super-admin/persons/${personId}/split`, { method: 'POST', body: { mergeLogId } }),
    onSuccess: () => { clearErr(); invalidate(); }, onError: onErr,
  });
  const dismissCandidate = useMutation({
    mutationFn: (candidateId) => api(`/super-admin/persons/candidates/${candidateId}/dismiss`, { method: 'POST' }),
    onSuccess: () => { clearErr(); invalidate(); }, onError: onErr,
  });
  const resolveProposal = useMutation({
    mutationFn: ({ proposalId, action }) => api(`/super-admin/persons/edit-proposals/${proposalId}/${action}`, { method: 'POST' }),
    onSuccess: () => { clearErr(); invalidate(); }, onError: onErr,
  });

  if (detailQ.isLoading) return <div className="p-6 text-sm text-fg-muted">Loading…</div>;
  if (detailQ.error) return <div className="p-6 text-sm text-danger">Error: {detailQ.error.message}</div>;

  const d = detailQ.data;
  const p = d.person;
  const orgNameById = new Map(d.orgs.map((o) => [o.organizationId, o.organizationName]));
  const provLabel = (f) => {
    const pv = p.fieldProvenance?.[f];
    if (!pv) return null;
    const org = pv.orgId ? orgNameById.get(String(pv.orgId)) : null;
    return `via ${pv.source}${org ? ` · ${org}` : ''}${pv.at ? ` · ${fmtDate(pv.at)}` : ''}`;
  };

  function startEdit() {
    const f = {};
    for (const [k] of IDENTITY) f[k] = k === 'dateOfBirth' ? dobInput(p[k]) : (p[k] ?? '');
    setForm(f);
    setEditing(true);
  }
  function submitEdit(e) {
    e.preventDefault();
    const body = {};
    for (const [k] of IDENTITY) body[k] = form[k] === '' ? null : form[k];
    patchIdentity.mutate(body);
  }
  function toggleLock(field) {
    const cur = new Set(p.lockedFields || []);
    if (cur.has(field)) cur.delete(field); else cur.add(field);
    setLock.mutate([...cur]);
  }

  return (
    <div className="max-w-4xl">
      <Link to="/super-admin/people" className="text-sm font-medium text-brand-accent hover:underline">‹ People</Link>
      <div className="mb-6 mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-fg">{p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Unknown person'}</h1>
        <span className="font-mono text-xs text-fg-subtle">{p.id}</span>
        {d.isTombstone && <span className="rounded-full bg-warning-tint px-2 py-0.5 text-xs font-medium text-warning-fg">merged → shown survivor</span>}
        <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-fg-muted">{d.orgCount} org{d.orgCount === 1 ? '' : 's'}</span>
        {p.matchConfidence && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-fg-muted">{p.matchConfidence}</span>}
        <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-fg-subtle">v{p.identityVersion}</span>
      </div>

      {err && <div className="mb-4 rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">{err}</div>}

      {/* Canonical identity */}
      <Section
        title="Canonical identity"
        right={!editing && <button onClick={startEdit} className="text-sm font-medium text-brand-accent hover:underline">Edit</button>}
      >
        {!editing ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {IDENTITY.map(([k, label]) => {
              const locked = (p.lockedFields || []).includes(k);
              return (
                <div key={k}>
                  <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-fg-subtle">
                    {label}
                    {k !== 'fullName' && (
                      <button
                        onClick={() => toggleLock(k)}
                        title={locked ? 'Locked — propagation/imports will not overwrite. Click to unlock.' : 'Lock this field against propagation'}
                        className={'rounded px-1 text-[11px] ' + (locked ? 'text-amber-600' : 'text-fg-subtle hover:text-fg-muted')}
                      >
                        {locked ? '🔒' : '🔓'}
                      </button>
                    )}
                  </dt>
                  <dd className="text-fg">{k === 'dateOfBirth' ? fmtDate(p[k]) : (p[k] || '—')}</dd>
                  {provLabel(k) && <dd className="text-[11px] text-fg-subtle">{provLabel(k)}</dd>}
                </div>
              );
            })}
          </dl>
        ) : (
          <form onSubmit={submitEdit}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {IDENTITY.map(([k, label]) => (
                <label key={k} className="block text-xs font-medium text-fg-muted">
                  {label}
                  <input
                    type={k === 'dateOfBirth' ? 'date' : 'text'}
                    value={form[k] ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                    className="mt-1 w-full rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg focus:border-brand-accent focus:outline-none"
                  />
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-fg-subtle">Saving propagates these values to every org's cached copy of this person (except locally-edited or locked fields).</p>
            <div className="mt-4 flex gap-2">
              <button type="submit" disabled={patchIdentity.isPending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {patchIdentity.isPending ? 'Saving…' : 'Save & propagate'}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-border-strong px-4 py-2 text-sm">Cancel</button>
            </div>
          </form>
        )}
      </Section>

      {/* Ownership */}
      <Section title="Ownership">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-fg-muted">
            Identity managed by:{' '}
            <span className="font-medium text-fg">{p.ownerOrgName || 'super-admin only'}</span>
            {p.ownerProvisional && <span className="text-fg-subtle"> (provisional)</span>}
          </span>
          <select
            value={p.identityOwnerOrgId || ''}
            onChange={(e) => setOwner.mutate(e.target.value || null)}
            disabled={setOwner.isPending}
            className="rounded border border-border-strong bg-card px-2 py-1.5 text-sm text-fg"
          >
            <option value="">Super-admin only (no owner)</option>
            {d.orgs.map((o) => <option key={o.organizationId} value={o.organizationId}>{o.organizationName}</option>)}
          </select>
        </div>
        <p className="mt-2 text-xs text-fg-subtle">An org can only own a person it has a linked voter for. The owner's imports/edits propagate; non-owners file review proposals.</p>
      </Section>

      {/* Identity keys */}
      <Section title="Identity keys">
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-fg-subtle">Vendor UID keys</div>
            {(p.uidKeys || []).length ? (
              <ul className="mt-1 space-y-1">
                {p.uidKeys.map((k, i) => <li key={i} className="font-mono text-xs text-fg">{k.uidSource}:{k.uid} <span className="text-fg-subtle">· {k.source}</span></li>)}
              </ul>
            ) : <p className="text-fg-subtle">— none —</p>}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-fg-subtle">State voter-ID keys</div>
            {(p.svidKeys || []).length ? (
              <ul className="mt-1 space-y-1">
                {p.svidKeys.map((k, i) => <li key={i} className="font-mono text-xs text-fg">{k.registeredState} {k.stateVoterId} <span className="text-fg-subtle">· {k.source}</span></li>)}
              </ul>
            ) : <p className="text-fg-subtle">— none —</p>}
          </div>
        </div>
      </Section>

      {/* Per-org activity (privacy-safe summary) */}
      <Section title={`Per-organization activity (${d.orgs.length})`}>
        <p className="mb-3 text-xs text-fg-subtle">Counts &amp; dates only — survey answers and field notes stay private to each org and are never shown here.</p>
        {d.orgs.length === 0 ? (
          <p className="text-sm text-fg-muted">No org has a voter linked to this person.</p>
        ) : (
          <div className="overflow-hidden rounded border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Org</th>
                  <th className="px-3 py-2 text-left">Voters</th>
                  <th className="px-3 py-2 text-left">Surveys</th>
                  <th className="px-3 py-2 text-left">Voted</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                  <th className="px-3 py-2 text-left">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.orgs.map((o) => (
                  <tr key={o.organizationId}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-fg">{o.organizationName || o.organizationId}</div>
                      {o.addresses[0] && <div className="text-xs text-fg-subtle">{o.addresses[0].city}, {o.addresses[0].state}</div>}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{o.voterCount}</td>
                    <td className="px-3 py-2 text-fg-muted">{o.surveyCount}{o.surveyStatus?.surveyed ? <span className="text-fg-subtle"> ({o.surveyStatus.surveyed} surveyed)</span> : ''}</td>
                    <td className="px-3 py-2 text-fg-muted">{o.votedCount}</td>
                    <td className="px-3 py-2 text-fg-muted">{o.noteCount}</td>
                    <td className="px-3 py-2 text-fg-muted">{fmtDate(o.lastActivityAt, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Merge candidates */}
      {d.candidates.length > 0 && (
        <Section title={`Merge review (${d.candidates.filter((c) => c.status === 'open').length} open)`}>
          <ul className="space-y-2">
            {d.candidates.map((c) => {
              const otherId = c.personIdB && String(c.personIdB) !== String(p.id) ? String(c.personIdB)
                : (String(c.personIdA) !== String(p.id) ? String(c.personIdA) : null);
              return (
                <li key={c._id} className="rounded border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium text-fg">{c.reason}</span>
                      <span className="text-fg-subtle"> · {c.status}</span>
                      {(c.sampleUid || c.sampleSvid) && <span className="text-fg-subtle"> · {c.sampleUid || `${c.sampleState || ''} ${c.sampleSvid}`}</span>}
                    </div>
                    {c.status === 'open' && (
                      <div className="flex gap-2">
                        {otherId && <button onClick={() => setMergeVictim(otherId)} className="rounded border border-border-strong px-2 py-1 text-xs hover:bg-sunken">Merge into this</button>}
                        {otherId && <Link to={`/super-admin/people/${otherId}`} className="rounded border border-border-strong px-2 py-1 text-xs hover:bg-sunken">View other</Link>}
                        <button onClick={() => dismissCandidate.mutate(c._id)} className="rounded border border-border-strong px-2 py-1 text-xs text-fg-muted hover:bg-sunken">Dismiss</button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* Edit proposals */}
      {d.proposals.filter((pr) => pr.status === 'pending').length > 0 && (
        <Section title="Pending identity proposals">
          <ul className="space-y-2">
            {d.proposals.filter((pr) => pr.status === 'pending').map((pr) => (
              <li key={pr._id} className="rounded border border-border p-3 text-sm">
                <div className="mb-2 text-fg-muted">
                  Proposed by <span className="font-medium text-fg">{pr.orgName || orgNameById.get(String(pr.orgId)) || pr.orgId}</span> · {pr.source}
                </div>
                <ul className="mb-2 space-y-0.5">
                  {Object.entries(pr.fields || {}).map(([f, v]) => (
                    <li key={f} className="text-xs">
                      <span className="text-fg-subtle">{f}:</span>{' '}
                      <span className="text-fg-muted line-through">{String(pr.canonicalSnapshot?.[f] ?? '—')}</span>{' → '}
                      <span className="font-medium text-fg">{String(v ?? '—')}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button onClick={() => resolveProposal.mutate({ proposalId: pr._id, action: 'approve' })} disabled={resolveProposal.isPending} className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60">Approve &amp; propagate</button>
                  <button onClick={() => resolveProposal.mutate({ proposalId: pr._id, action: 'reject' })} disabled={resolveProposal.isPending} className="rounded-md border border-border-strong px-3 py-1.5 text-xs">Reject</button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Manual merge */}
      <Section title="Merge another record into this person">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            value={manualVictim}
            onChange={(e) => setManualVictim(e.target.value.trim())}
            placeholder="Paste the other person's ID…"
            className="min-w-[280px] flex-1 rounded border border-border-strong bg-card px-2 py-1.5 font-mono text-xs text-fg"
          />
          <button
            onClick={() => manualVictim && setMergeVictim(manualVictim)}
            disabled={!manualVictim}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Review merge…
          </button>
        </div>
      </Section>

      {/* Merge / split history */}
      {d.mergeLog.length > 0 && (
        <Section title="Merge history">
          <ul className="space-y-2 text-sm">
            {d.mergeLog.map((l) => (
              <li key={l._id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-3">
                <div className="text-fg-muted">
                  <span className="font-medium text-fg capitalize">{l.action}</span>
                  {' · '}{fmtDate(l.createdAt, true)}
                  <span className="text-fg-subtle"> · {(l.movedVoterIds || []).length} voter(s)</span>
                  {l.action === 'merge' && <span className="font-mono text-xs text-fg-subtle"> · victim {String(l.victimId).slice(-6)}</span>}
                </div>
                {l.action === 'merge' && String(l.survivorId) === String(p.id) && (
                  <button onClick={() => { if (window.confirm('Reverse this merge? The victim person and its voters are restored.')) split.mutate(l._id); }} disabled={split.isPending} className="rounded border border-border-strong px-2 py-1 text-xs hover:bg-sunken disabled:opacity-50">
                    Split (reverse)
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {mergeVictim && (
        <MergeDialog
          survivor={p}
          victimId={mergeVictim}
          busy={merge.isPending}
          error={merge.error?.message}
          onClose={() => setMergeVictim(null)}
          onMerge={(body) => merge.mutate(body)}
        />
      )}
    </div>
  );
}
