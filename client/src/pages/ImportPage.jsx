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

  const { data, isLoading } = useQuery({
    queryKey: ['imports'],
    queryFn: () => api('/admin/imports'),
    refetchInterval: (q) => {
      const jobs = q.state.data?.jobs || [];
      return jobs[0]?.status === 'parsing' ? 2000 : false;
    },
  });

  const upload = useMutation({
    mutationFn: async (f) => {
      const fd = new FormData();
      fd.append('file', f);
      return api('/admin/imports/csv', { method: 'POST', formData: fd });
    },
    onSuccess: () => {
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ['imports'] });
    },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">CSV Import</h1>

      <section className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-base font-medium">Upload voter CSV</h2>
        <p className="mb-4 text-sm text-gray-600">
          Upserts by State Voter ID — re-uploading is safe and won't lose canvass activity.
        </p>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block text-sm"
        />
        <button
          onClick={() => file && upload.mutate(file)}
          disabled={!file || upload.isPending}
          className="mt-4 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
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
                  <td colSpan="7" className="px-4 py-6 text-center text-gray-500">
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
