import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import Pager from '../components/Pager.jsx';

const PAGE_SIZE = 25;

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function StatusPill({ status }) {
  const surveyed = status === 'surveyed';
  return (
    <span
      className={
        'rounded-full px-2 py-0.5 text-xs font-medium ' +
        (surveyed ? 'bg-success-tint text-success' : 'bg-sunken text-fg-muted')
      }
    >
      {surveyed ? 'Surveyed' : 'Not surveyed'}
    </span>
  );
}

export default function VotersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [party, setParty] = useState('');
  const [surveyStatus, setSurveyStatus] = useState('');
  const [voted, setVoted] = useState('');
  const [dnc, setDnc] = useState('');
  const [skip, setSkip] = useState(0);

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const campaigns = campaignsQ.data?.campaigns || [];

  // Any filter change resets to the first page. Search is excluded here: it's
  // debounced, so resetting the page on the raw keystroke would desync skip
  // from the lagging search term (a wasted fetch, or paging the old results).
  function onFilter(setter) {
    return (v) => {
      setter(v);
      setSkip(0);
    };
  }

  const debouncedSearch = useDebouncedValue(search);
  // Reset to page 1 when the debounced search actually commits, in the same
  // render the query key picks up the new term — so skip and search move together.
  const [prevSearch, setPrevSearch] = useState(debouncedSearch);
  if (prevSearch !== debouncedSearch) {
    setPrevSearch(debouncedSearch);
    setSkip(0);
  }
  const query = buildQuery({
    search: debouncedSearch,
    campaignId,
    party,
    surveyStatus,
    voted,
    dnc,
    limit: PAGE_SIZE,
    skip,
  });
  const votersQ = useQuery({
    queryKey: ['admin', 'voters', { search: debouncedSearch, campaignId, party, surveyStatus, voted, dnc, skip }],
    queryFn: ({ signal }) => api(`/admin/voters${query}`, { signal }),
    placeholderData: keepPreviousData,
  });

  const data = votersQ.data || { voters: [], total: 0 };
  const total = data.total || 0;
  const rows = data.voters || [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Voters</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Everyone in your organization's voter database. Click a voter to see their full profile.
            (For canvassers — the people you assign books to — see <strong>Users</strong>.)
          </p>
        </div>
        <Link to="/voters/dnc" className="shrink-0 text-sm font-medium text-brand-accent hover:underline">
          Do-not-contact list →
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, Voter ID, or address"
          className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:col-span-2"
        />
        <select
          value={campaignId}
          onChange={(e) => onFilter(setCampaignId)(e.target.value)}
          className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
        <select
          value={surveyStatus}
          onChange={(e) => onFilter(setSurveyStatus)(e.target.value)}
          className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
        >
          <option value="">Any survey status</option>
          <option value="surveyed">Surveyed</option>
          <option value="not_surveyed">Not surveyed</option>
        </select>
        <select
          value={voted}
          onChange={(e) => onFilter(setVoted)(e.target.value)}
          className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
        >
          <option value="">Any voted status</option>
          <option value="true">Voted</option>
          <option value="false">Not voted</option>
        </select>
        <select
          value={dnc}
          onChange={(e) => onFilter(setDnc)(e.target.value)}
          className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none"
        >
          <option value="">Any contact status</option>
          <option value="true">Do not contact</option>
          <option value="false">Contactable</option>
        </select>
        <input
          value={party}
          onChange={(e) => onFilter(setParty)(e.target.value)}
          placeholder="Party"
          className="rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none"
        />
      </div>

      {votersQ.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          Error loading voters: {votersQ.error.message}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Voter ID</th>
                <th className="px-4 py-2 font-medium">Party</th>
                <th className="px-4 py-2 font-medium">Address</th>
                <th className="px-4 py-2 font-medium">Campaign</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-center font-medium">Voted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-fg-muted">
                    {votersQ.isLoading ? 'Loading…' : 'No voters match these filters.'}
                  </td>
                </tr>
              ) : (
                rows.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => navigate(`/voters/${v.id}`)}
                    className="cursor-pointer transition-colors hover:bg-sunken"
                  >
                    <td className="px-4 py-2 font-medium text-fg">{v.fullName}</td>
                    <td className="px-4 py-2 font-mono text-xs text-fg-muted">{v.stateVoterId}</td>
                    <td className="px-4 py-2 text-fg-muted">{v.party || '—'}</td>
                    <td className="px-4 py-2 text-fg-muted">
                      {v.household ? `${v.household.addressLine1}, ${v.household.city} ${v.household.state}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-fg-muted">{v.household?.campaignName || '—'}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusPill status={v.surveyStatus} />
                        {v.dnc && (
                          <span className="rounded-full bg-danger-tint px-2 py-0.5 text-xs font-medium text-danger">DNC</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {v.voted ? <span className="text-teal-600" title="Voted">✓</span> : ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3">
        <Pager skip={skip} limit={PAGE_SIZE} total={total} onChange={setSkip} />
      </div>
    </div>
  );
}
