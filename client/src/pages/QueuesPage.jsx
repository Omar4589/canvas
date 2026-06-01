import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

// Bull Board is mounted by the server at /admin/queues (super-admin only). We
// fetch a short-lived cookie ticket, then iframe the board. Works same-origin
// in production; in local dev the board is on the API origin.
export default function QueuesPage() {
  const ticketQ = useQuery({
    queryKey: ['queues-ticket'],
    queryFn: () => api('/admin/queues/ticket'),
    retry: false,
  });

  if (ticketQ.isLoading) {
    return <div className="p-6 text-sm text-gray-500">Loading job console…</div>;
  }
  if (ticketQ.error) {
    const msg = ticketQ.error.status === 403 ? 'The job console is super-admin only.' : ticketQ.error.message;
    return (
      <div className="p-6">
        <h1 className="mb-3 text-2xl font-semibold">Jobs</h1>
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</div>
      </div>
    );
  }
  return <iframe title="Job queue" src={ticketQ.data.url} className="h-full w-full border-0" />;
}
