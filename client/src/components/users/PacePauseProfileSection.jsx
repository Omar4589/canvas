import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { formatInTz } from '../../lib/datetime.js';
import { statusLine } from '../../lib/pacePause.js';
import { invalidatePaceCaches } from '../audit/PacePausePanel.jsx';

// A member's automatic pauses, in their profile (docs/PROPOSAL_PACE_PAUSE.md §G.4): the open one with Review
// and Unpause, then the past ones. Renders nothing for someone never paused, which is nearly everyone.
const PacePauseProfileSection = ({ userId, tz }) => {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'pace-pauses', 'list', 'user', userId],
    queryFn: () => api(`/admin/pace-pauses?userId=${userId}&status=all`),
    enabled: !!userId,
    retry: false,
  });
  const unpauseM = useMutation({
    mutationFn: (id) => api(`/admin/pace-pauses/${id}/unpause`, { method: 'POST' }),
    onSuccess: () => invalidatePaceCaches(qc),
  });
  const pauses = q.data?.pauses || [];
  if (!pauses.length) return null;
  const open = pauses.find((p) => p.status === 'paused' && p.memberActive);
  const past = pauses.filter((p) => p !== open);
  return (
    <div className="border-b border-border px-6 py-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">Automatic pause</h3>
      {open && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-tint px-3 py-2">
          <p className="text-sm text-danger-fg">
            Paused for review on {open.campaignName || 'a campaign'} since {formatInTz(open.firedAt, tz)}
            {!open.blocking && ' — not blocking while automatic pause is switched off'}
          </p>
          <div className="flex items-center gap-3">
            <Link to={`/campaigns/${open.campaignId}/audit/pauses/${open.id}`} className="text-sm font-semibold text-brand-accent hover:underline">
              Review
            </Link>
            <button
              type="button"
              disabled={unpauseM.isPending}
              onClick={() => unpauseM.mutate(open.id)}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              Unpause
            </button>
          </div>
        </div>
      )}
      {unpauseM.error && <p className="mb-2 text-sm text-danger">{unpauseM.error.message}</p>}
      {past.length > 0 && (
        <ul className="space-y-1 text-sm">
          {past.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-fg">
                {formatInTz(p.firedAt, tz)} · {p.campaignName || 'a campaign'}
                <span className="ml-2 text-xs text-fg-muted">{statusLine(p, tz)}</span>
              </span>
              <Link to={`/campaigns/${p.campaignId}/audit/pauses/${p.id}`} className="text-xs font-semibold text-brand-accent hover:underline">
                Review
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default PacePauseProfileSection;
