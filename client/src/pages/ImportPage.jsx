import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function StatusBadge({ status }) {
  const cls = {
    pending: 'bg-gray-100 text-gray-700',
    parsing: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  }[status] || 'bg-gray-100 text-gray-700';
  return <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{status}</span>;
}

export default function ImportPage() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [campaignId, setCampaignId] = useState('');

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['imports'],
    queryFn: () => api('/admin/imports'),
    refetchInterval: (q) => {
      const jobs = q.state.data?.jobs || [];
      return jobs[0]?.status === 'parsing' ? 2000 : false;
    },
  });

  const upload = useMutation({
    mutationFn: async ({ file, campaignId }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('campaignId', campaignId);
      return api('/admin/imports/csv', { method: 'POST', formData: fd });
    },
    onSuccess: () => {
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ['imports'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
    },
  });

  const campaigns = (campaignsQ.data?.campaigns || []).filter((c) => c.isActive);
  const canSubmit = file && campaignId && !upload.isPending;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">CSV Import</h1>

      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-base font-medium">Upload voter CSV</h2>
        <p className="mb-4 text-sm text-gray-600">
          Each upload is scoped to a single campaign. Upserts by State Voter ID — re-uploading
          the same CSV under the same campaign is safe and won't lose canvass activity.
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Campaign
          </label>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="w-full max-w-md rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          >
            <option value="">— Choose a campaign —</option>
            {campaigns.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name} ({c.state} · {c.type === 'survey' ? 'Survey' : 'Lit drop'})
              </option>
            ))}
          </select>
          {!campaignsQ.isLoading && !campaigns.length && (
            <p className="mt-1 text-xs text-amber-700">
              No active campaigns. Create one on the Campaigns page first.
            </p>
          )}
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-700">
            CSV file
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block text-sm"
          />
        </div>

        <button
          onClick={() => canSubmit && upload.mutate({ file, campaignId })}
          disabled={!canSubmit}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {upload.isPending ? 'Importing…' : 'Import'}
        </button>
        {upload.error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {upload.error.message}
          </div>
        )}
        {upload.data?.job && (
          <div className="mt-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            Imported: {fmt(upload.data.job.uniqueVoters)} voters into{' '}
            {fmt(upload.data.job.uniqueHouseholds)} households (
            {fmt(upload.data.job.newVoters)} new,{' '}
            {fmt(upload.data.job.duplicateStateVoterIds.length)} duplicate IDs).
          </div>
        )}
      </section>

      <h2 className="mb-3 text-base font-medium">Recent imports</h2>
      {isLoading ? (
        <div>Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Campaign</th>
                <th className="px-4 py-2 text-left">File</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Voters</th>
                <th className="px-4 py-2 text-right">Households</th>
                <th className="px-4 py-2 text-right">New</th>
                <th className="px-4 py-2 text-right">Errors</th>
              </tr>
            </thead>
            <tbody>
              {(data?.jobs || []).map((j) => (
                <tr key={j._id} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-gray-600">
                    {new Date(j.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    {j.campaignId?.name || '—'}
                  </td>
                  <td className="px-4 py-2">{j.filename || '—'}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="px-4 py-2 text-right">{fmt(j.uniqueVoters)}</td>
                  <td className="px-4 py-2 text-right">{fmt(j.uniqueHouseholds)}</td>
                  <td className="px-4 py-2 text-right">
                    {fmt(j.newVoters)} v / {fmt(j.newHouseholds)} h
                  </td>
                  <td className="px-4 py-2 text-right">{fmt(j.errorCount)}</td>
                </tr>
              ))}
              {!data?.jobs?.length && (
                <tr>
                  <td colSpan="8" className="px-4 py-6 text-center text-gray-500">
                    No imports yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
