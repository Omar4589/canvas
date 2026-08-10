import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// One tag's voters split by team — "this team identified N supporters, M still are."
//
// FIRST-FINDER credit: each voter belongs to the team whose canvasser tagged them first, so
// the rows add up EXACTLY to the campaign line, both columns (/tag-teams guarantees the
// partition; the footer states it so nobody has to trust it blind). This is deliberately
// unlike TeamBreakdown's doors, where a cross-team double-knock lands in both rows and gets
// reconciled in prose — first-finder has no over-claim to explain away.
//
// Renders nothing while the org's team-attribution backfill hasn't run (ready:false), and an
// inline error rather than an authoritative-looking zero table on failure.
export default function TagTeamTable({ campaignId, tag, surveyTemplateId, effortId, passId, coordinatorId, dateRange }) {
  const { data, isLoading, error } = useQuery({
    queryKey: [
      'reports',
      'tag-teams',
      campaignId,
      tag,
      surveyTemplateId,
      effortId,
      passId,
      coordinatorId,
      dateRange?.from,
      dateRange?.to,
    ],
    queryFn: () =>
      api(
        `/admin/reports/tag-teams${buildQuery({
          campaignId,
          tag,
          surveyTemplateId,
          effortId,
          passId,
          coordinatorId,
          from: dateRange?.from,
          to: dateRange?.to,
        })}`
      ),
  });

  if (isLoading) return <div className="px-3 py-2 text-xs text-fg-muted">Loading teams…</div>;
  if (error) return <div className="px-3 py-2 text-xs text-danger">Teams unavailable: {error.message}</div>;
  if (!data?.ready) return null;

  const teams = data.teams || [];
  const noTeam = data.noTeam || { identifiedVoters: 0, currentVoters: 0 };
  const totals = data.totals || { identifiedVoters: 0, currentVoters: 0 };
  // A one-bucket table says nothing a headline doesn't; only render once teams exist.
  if (!teams.length) return null;
  const flipped = totals.identifiedVoters - totals.currentVoters;

  return (
    <div className="overflow-x-auto border-b border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
            <th className="px-3 py-2 font-medium">Team</th>
            <th className="px-3 py-2 text-right font-medium">Voters identified</th>
            <th className="px-3 py-2 text-right font-medium">Still current</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {teams.map((t) => (
            <tr key={t.coordinatorId}>
              <td className="px-3 py-2 font-medium text-fg">{t.coordinatorName}</td>
              <td className="px-3 py-2 text-right font-medium text-fg">
                {t.identifiedVoters.toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right text-fg-muted">{t.currentVoters.toLocaleString()}</td>
            </tr>
          ))}
          {/* Not a dumping ground: a candidate knocking their own district legitimately has no
              team. Rendered whenever it holds anyone; zeros are omitted for signal. */}
          {noTeam.identifiedVoters > 0 && (
            <tr>
              <td className="px-3 py-2 text-fg-muted">No team</td>
              <td className="px-3 py-2 text-right font-medium text-fg">
                {noTeam.identifiedVoters.toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right text-fg-muted">{noTeam.currentVoters.toLocaleString()}</td>
            </tr>
          )}
          <tr className="border-t-2 border-border bg-sunken/40">
            <td className="px-3 py-2 font-semibold text-fg">Campaign</td>
            <td className="px-3 py-2 text-right font-semibold text-fg">
              {totals.identifiedVoters.toLocaleString()}
            </td>
            <td className="px-3 py-2 text-right font-semibold text-fg">
              {totals.currentVoters.toLocaleString()}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2 text-xs text-fg-muted">
        {flipped > 0 ? (
          <>
            Teams add up to exactly the campaign total —{' '}
            <strong className="text-fg">{totals.identifiedVoters.toLocaleString()}</strong> voters
            identified. Each voter counts once, for the team whose canvasser tagged them first — a
            voter reached by two teams stays with the first.{' '}
            <strong className="text-fg">{flipped.toLocaleString()}</strong>{' '}
            {flipped === 1 ? 'has' : 'have'} since given an answer without this tag, which is why
            still-current reads{' '}
            <strong className="text-fg">{totals.currentVoters.toLocaleString()}</strong>.
          </>
        ) : (
          <>
            Teams add up to exactly the campaign total —{' '}
            <strong className="text-fg">{totals.identifiedVoters.toLocaleString()}</strong> voters
            identified, all still current. Each voter counts once, for the team whose canvasser
            tagged them first — a voter reached by two teams stays with the first.
          </>
        )}
      </p>
    </div>
  );
}
