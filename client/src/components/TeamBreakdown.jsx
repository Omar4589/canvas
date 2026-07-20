import { ratePct, rateLevel } from '../lib/rates.js';

const RATE_TEXT = { good: 'text-success-fg', caution: 'text-warning-fg', low: 'text-danger-fg' };
const rateClass = (pct) => RATE_TEXT[rateLevel(pct)] || 'text-fg';

// Every team's numbers side by side, with the reconciliation shown.
//
// The question this exists for: a client who runs one crew asks "how many doors has MY team
// knocked?", and the candidate asks for each crew's numbers plus his own. A one-team-at-a-time
// filter means checking three times and adding up by hand — which is exactly where a wrong number
// reaches a client. So show them all, and prove the arithmetic closes on the page.
//
// DOORS is distinct (house, round) — deduped WITHIN each team, so two of Asa's own people knocking
// one house counts once for Asa. Teams therefore add up to the campaign total, and the only thing
// that can break that is a house worked by two DIFFERENT teams, which is surfaced rather than
// quietly absorbed.
export default function TeamBreakdown({ data, onPick }) {
  const teams = data.teams || [];
  const campaign = data.campaign || {};
  const cross = data.crossTeamDoors || 0;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
            <th className="px-3 py-2 font-medium">Team</th>
            <th className="px-3 py-2 text-right font-medium">People</th>
            <th className="px-3 py-2 text-right font-medium">Doors</th>
            <th className="px-3 py-2 text-right font-medium">Survey doors</th>
            <th className="px-3 py-2 text-right font-medium">Surveys taken</th>
            <th className="px-3 py-2 text-right font-medium">Conn %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {teams.map((t) => (
            <tr
              key={t.coordinatorId || 'none'}
              onClick={() => onPick?.(t.coordinatorId || 'none')}
              className="cursor-pointer hover:bg-sunken/60"
            >
              <td className="px-3 py-2 font-medium text-fg">
                {/* Not a dumping ground: a candidate knocking their own district legitimately has
                    no team, and admins exclude this row on purpose. */}
                {t.coordinatorName || <span className="text-fg-muted">No team</span>}
              </td>
              <td className="px-3 py-2 text-right text-fg-muted">{t.people.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-medium text-fg">{t.doors.toLocaleString()}</td>
              <td className="px-3 py-2 text-right text-fg">{t.surveyDoors.toLocaleString()}</td>
              <td className="px-3 py-2 text-right text-fg-muted">{(t.surveysTaken || 0).toLocaleString()}</td>
              <td className={`px-3 py-2 text-right font-medium ${rateClass(t.connectionRate)}`}>
                {ratePct(t.connectionRate)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-sunken/40">
            <td className="px-3 py-2 font-semibold text-fg">Campaign</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right font-semibold text-fg">
              {(campaign.doors || 0).toLocaleString()}
            </td>
            <td className="px-3 py-2 text-right font-semibold text-fg">
              {(campaign.surveyDoors || 0).toLocaleString()}
            </td>
            <td className="px-3 py-2" />
            <td className={`px-3 py-2 text-right font-semibold ${rateClass(campaign.connectionRate)}`}>
              {ratePct(campaign.connectionRate)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Same shape and vocabulary as the canvasser reconciliation line above the grid
          ("N knocks across M canvassers · K overlap door-passes (counted once → B)") — one idea,
          one phrasing. The colliding doors themselves are already listed by "Review overlap doors";
          a cross-team collision is just a subset of those, so there is no second review UI. */}
      <p className="border-t border-border px-3 py-2 text-xs text-fg-muted">
        {cross > 0 ? (
          <>
            Teams add up to{' '}
            <strong className="text-fg">{(data.teamSum || 0).toLocaleString()}</strong>
            {' · '}
            <strong className="text-warning-fg">
              {cross.toLocaleString()} {cross === 1 ? 'house' : 'houses'} knocked by two different
              teams
            </strong>{' '}
            (counted once → <strong className="text-fg">{(campaign.doors || 0).toLocaleString()}</strong>).
            Each crew is credited for the door they knocked; the campaign counts the house once. Two
            teams on the same doors usually means the walk lists overlapped — see “Review overlap
            doors” below for which houses.
          </>
        ) : (
          <>
            Teams add up to exactly the campaign total —{' '}
            <strong className="text-fg">{(campaign.doors || 0).toLocaleString()}</strong> doors, no
            house worked by two teams. A door is one house per round, so a house two people on the{' '}
            <em>same</em> team both knocked already counts once.
          </>
        )}
      </p>
    </div>
  );
}
