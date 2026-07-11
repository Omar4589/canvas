import { Link } from 'react-router-dom';
import RowMenu from '../RowMenu.jsx';
import { DataTable } from '../ui/index.js';
import { daysUntil, formatDateLabel } from '../../lib/electionDates.js';
import { TypePill, StatusBadge, CountdownChip } from './CampaignCard.jsx';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

// Table rendering of the same campaign list as CampaignCard — used by both the
// active and archived sections. `menuItems(c)` comes from the page (same items as the card).
export default function CampaignsTable({ campaigns, menuItems }) {
  return (
    <DataTable
      head={
        <>
          <th className="px-4 py-3">Name</th>
          <th className="px-4 py-3">Type</th>
          <th className="px-4 py-3">State</th>
          <th className="px-4 py-3">Election Day</th>
          <th className="px-4 py-3 text-right">Households</th>
          <th className="px-4 py-3 text-right">Knocked</th>
          <th className="px-4 py-3 text-right">Surveys / Lit</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3 text-right">
            <span className="sr-only">Actions</span>
          </th>
        </>
      }
    >
      {campaigns.map((c) => {
        const households = c.counts?.households || 0;
        const pct = households ? Math.round((100 * (c.counts?.knocked || 0)) / households) : 0;
        return (
          <tr key={c._id} className="hover:bg-sunken">
            <td className="px-4 py-3 font-medium text-fg">
              <Link
                to={`/campaigns/${c._id}`}
                className="text-fg hover:text-brand-accent hover:underline"
              >
                {c.name}
              </Link>
              {c.stepsTotal != null && !c.setupComplete && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-[10px] font-medium text-brand-tint-fg">
                  <span className="h-1 w-1 rounded-full bg-brand-accent" />
                  Setup {c.stepsDone}/{c.stepsTotal}
                </span>
              )}
            </td>
            <td className="px-4 py-3">
              <TypePill type={c.type} />
            </td>
            <td className="px-4 py-3">{c.state}</td>
            <td className="px-4 py-3">
              {c.electionDay ? (
                <span className="flex items-center gap-1.5">
                  {formatDateLabel(c.electionDay)}
                  <CountdownChip days={daysUntil(c.electionDay, c.timeZone)} />
                </span>
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </td>
            <td className="px-4 py-3 text-right tabular-nums">{fmt(c.counts?.households)}</td>
            <td className="px-4 py-3">
              <div className="flex items-center justify-end gap-2">
                <span className="tabular-nums">{fmt(c.counts?.knocked)}</span>
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full bg-brand-600"
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </span>
              </div>
            </td>
            <td className="px-4 py-3 text-right tabular-nums">
              {c.type === 'survey' ? fmt(c.counts?.surveysSubmitted) : fmt(c.counts?.litDropped)}
            </td>
            <td className="px-4 py-3">
              <StatusBadge isActive={c.isActive} />
            </td>
            <td className="px-4 py-3 text-right">
              <RowMenu items={menuItems(c)} />
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}
