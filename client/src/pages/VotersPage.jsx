import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';

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
        (surveyed ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500')
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
  const [offset, setOffset] = useState(0);

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const campaigns = campaignsQ.data?.campaigns || [];

  // Any filter change resets to the first page.
  function onFilter(setter) {
    return (v) => {
      setter(v);
      setOffset(0);
    };
  }

  const query = buildQuery({ search, campaignId, party, surveyStatus, voted, limit: PAGE_SIZE, offset });
  const votersQ = useQuery({
    queryKey: ['admin', 'voters', { search, campaignId, party, surveyStatus, voted, offset }],
    queryFn: () => api(`/admin/voters${query}`),
    placeholderData: keepPreviousData,
  });

  const data = votersQ.data || { voters: [], total: 0 };
  const total = data.total || 0;
  const rows = data.voters || [];
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Voters</h1>
        <p className="mt-1 text-sm text-gray-600">
          Everyone in your organization's voter database. Click a voter to see their full profile.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <input
          value={search}
          onChange={(e) => onFilter(setSearch)(e.target.value)}
          placeholder="Search name, Voter ID, or address"
          className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 sm:col-span-2"
        />
        <select
          value={campaignId}
          onChange={(e) => onFilter(setCampaignId)(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
        <select
          value={surveyStatus}
          onChange={(e) => onFilter(setSurveyStatus)(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        >
          <option value="">Any survey status</option>
          <option value="surveyed">Surveyed</option>
          <option value="not_surveyed">Not surveyed</option>
        </select>
        <select
          value={voted}
          onChange={(e) => onFilter(setVoted)(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        >
          <option value="">Any voted status</option>
          <option value="true">Voted</option>
          <option value="false">Not voted</option>
        </select>
        <input
          value={party}
          onChange={(e) => onFilter(setParty)(e.target.value)}
          placeholder="Party"
          className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
        />
      </div>

      {votersQ.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error loading voters: {votersQ.error.message}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
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
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-gray-500">
                    {votersQ.isLoading ? 'Loading…' : 'No voters match these filters.'}
                  </td>
                </tr>
              ) : (
                rows.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => navigate(`/voters/${v.id}`)}
                    className="cursor-pointer transition-colors hover:bg-gray-50"
                  >
                    <td className="px-4 py-2 font-medium text-gray-900">{v.fullName}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{v.stateVoterId}</td>
                    <td className="px-4 py-2 text-gray-700">{v.party || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {v.household ? `${v.household.addressLine1}, ${v.household.city} ${v.household.state}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{v.household?.campaignName || '—'}</td>
                    <td className="px-4 py-2"><StatusPill status={v.surveyStatus} /></td>
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

      <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
        <span>
          {from}–{to} of {total.toLocaleString()}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50 hover:bg-gray-50"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={to >= total}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
