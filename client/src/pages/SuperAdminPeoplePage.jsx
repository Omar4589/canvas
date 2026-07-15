import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';

const LIMIT = 25;

function KeyChips({ uidKeys, svidKeys }) {
  const chips = [
    ...(uidKeys || []).map((k) => `${k.uidSource}:${k.uid}`),
    ...(svidKeys || []).map((k) => `${k.registeredState} ${k.stateVoterId}`),
  ];
  if (!chips.length) return <span className="text-fg-subtle">— no keys —</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.slice(0, 3).map((c) => (
        <span key={c} className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">{c}</span>
      ))}
      {chips.length > 3 && <span className="text-[11px] text-fg-subtle">+{chips.length - 3}</span>}
    </div>
  );
}

export default function SuperAdminPeoplePage() {
  const navigate = useNavigate();
  const { activeOrgId } = useAuth();
  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const [skip, setSkip] = useState(0);

  // The identity directory is scoped to one organization now — you browse the people of the customer
  // you have entered, under a support grant, not a platform-wide name search. Pass the active org; if
  // none is selected, prompt to pick one. Reading a person still trips the grant modal (api/client.js)
  // the first time, exactly like the /admin surfaces.
  const params = new URLSearchParams({ limit: String(LIMIT), skip: String(skip) });
  if (activeOrgId) params.set('organizationId', activeOrgId);
  if (q) params.set('q', q);
  if (needsReview) params.set('needsReview', 'true');

  const peopleQ = useQuery({
    queryKey: ['super-admin', 'persons', activeOrgId, q, needsReview, skip],
    queryFn: () => api(`/super-admin/persons?${params.toString()}`),
    placeholderData: keepPreviousData,
    enabled: !!activeOrgId,
  });

  const data = peopleQ.data;
  const persons = data?.persons || [];
  const total = data?.total || 0;

  function submitSearch(e) {
    e.preventDefault();
    setSkip(0);
    setQ(searchText.trim());
  }

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-fg">People</h1>
      <p className="mt-1 text-sm text-fg-muted">
        A customer's canonical identity directory — one row per real person. Scoped to the organization
        you have entered; opening a record requires a support grant and is logged.
      </p>

      {!activeOrgId && (
        <div className="mt-4 rounded border border-border bg-card px-4 py-3 text-sm text-fg-muted">
          Select an organization from the switcher to browse its people. There is no platform-wide name
          search — you view one customer's records at a time, under a reasoned, time-boxed, audited grant.
        </div>
      )}

      <form onSubmit={submitSearch} className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search name, vendor uid, or state voter ID…"
          className="flex-1 min-w-[260px] rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          Search
        </button>
        <label className="flex items-center gap-2 rounded-md border border-border-strong bg-card px-3 py-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={needsReview}
            onChange={(e) => { setSkip(0); setNeedsReview(e.target.checked); }}
          />
          Needs review only
        </label>
      </form>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Keys</th>
              <th className="px-4 py-3 text-left">Orgs</th>
              <th className="px-4 py-3 text-left">Managed by</th>
              <th className="px-4 py-3 text-left">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {peopleQ.isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-fg-muted">Loading…</td></tr>
            ) : peopleQ.error ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-danger">Error: {peopleQ.error.message}</td></tr>
            ) : persons.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-fg-muted">No people match.</td></tr>
            ) : (
              persons.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/super-admin/people/${p.id}`)}
                  className="cursor-pointer hover:bg-sunken"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-fg">{p.fullName || '—'}</div>
                    {p.party && <div className="text-xs text-fg-subtle">{p.party}</div>}
                  </td>
                  <td className="px-4 py-3"><KeyChips uidKeys={p.uidKeys} svidKeys={p.svidKeys} /></td>
                  <td className="px-4 py-3 text-fg-muted">
                    {p.orgCount} org{p.orgCount === 1 ? '' : 's'}
                    <span className="text-fg-subtle"> · {p.voterCount} voter{p.voterCount === 1 ? '' : 's'}</span>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {p.ownerOrgName ? (
                      <span>{p.ownerOrgName}{p.ownerProvisional ? <span className="text-fg-subtle"> (provisional)</span> : ''}</span>
                    ) : (
                      <span className="text-fg-subtle">super-admin only</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {p.hasOpenCandidate && <span className="rounded-full bg-warning-tint px-2 py-0.5 text-xs font-medium text-warning-fg">merge?</span>}
                      {p.hasPendingProposal && <span className="rounded-full bg-brand-tint px-2 py-0.5 text-xs font-medium text-brand-accent">proposal</span>}
                      {(p.lockedFields || []).length > 0 && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-fg-muted">🔒 {p.lockedFields.length}</span>}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-fg-muted">
        <span>
          {total === 0 ? '0' : `${skip + 1}–${Math.min(skip + LIMIT, total)}`} of {total}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setSkip(Math.max(0, skip - LIMIT))}
            disabled={skip === 0}
            className="rounded-md border border-border-strong px-3 py-1.5 disabled:opacity-50"
          >
            ‹ Prev
          </button>
          <button
            onClick={() => setSkip(skip + LIMIT)}
            disabled={skip + LIMIT >= total}
            className="rounded-md border border-border-strong px-3 py-1.5 disabled:opacity-50"
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}
