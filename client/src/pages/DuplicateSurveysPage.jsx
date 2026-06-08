import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import CampaignSelector, { useCampaignSelection } from '../components/CampaignSelector.jsx';
import DateRangeSelector, { defaultRange } from '../components/DateRangeSelector.jsx';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { Card, Badge } from '../components/ui/index.js';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function fmt(ts, tz) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export default function DuplicateSurveysPage() {
  const orgTz = useOrgTimeZone();
  const { campaignId, setCampaignId, campaigns, selected, isLoading: campaignsLoading } =
    useCampaignSelection();
  const [dateRange, setDateRange] = useState(() => defaultRange('all'));
  const tz = selected?.timeZone || orgTz;

  const qs = buildQuery({ campaignId, from: dateRange.from, to: dateRange.to });
  const q = useQuery({
    queryKey: ['admin', 'duplicate-surveys', campaignId, dateRange.from, dateRange.to],
    queryFn: () => api(`/admin/reports/duplicate-surveys${qs}`),
    enabled: !!campaignId,
  });

  const duplicates = q.data?.duplicates || [];
  const reportTz = q.data?.timeZone || tz;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Duplicate surveys</h1>
          <p className="mt-1 max-w-xl text-sm text-fg-muted">
            Voters with more than one survey response — the reason “Surveys” can read higher than
            “Surveyed voters.” Same canvasser, same day is usually a mistake; different canvassers or a
            different round is usually a legitimate revisit. Open the voter to delete an extra response.
          </p>
        </div>
        <CampaignSelector
          campaignId={campaignId}
          onChange={setCampaignId}
          campaigns={campaigns}
          isLoading={campaignsLoading}
        />
      </div>

      <div className="flex justify-end">
        <DateRangeSelector value={dateRange} onChange={setDateRange} tz={tz} />
      </div>

      {q.isLoading && <div className="text-sm text-fg-muted">Loading…</div>}
      {!q.isLoading && duplicates.length === 0 && (
        <Card className="p-6 text-sm text-fg-muted">
          No duplicate surveys in this range. Every surveyed voter has exactly one response. 🎉
        </Card>
      )}

      <div className="space-y-3">
        {duplicates.map((d) => (
          <Card key={d.voterId} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-fg">{d.voter?.fullName || 'Unknown voter'}</span>
                  {d.voter?.party && (
                    <span className="text-xs text-fg-muted">({d.voter.party})</span>
                  )}
                  <Badge variant="neutral">surveyed {d.count}×</Badge>
                </div>
                {d.household && (
                  <div className="mt-0.5 text-xs text-fg-muted">
                    {d.household.addressLine1}
                    {d.household.city ? `, ${d.household.city}` : ''} {d.household.state}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {d.sameCanvasserSameDay && (
                  <Badge variant="danger" dot>
                    Same canvasser · same day
                  </Badge>
                )}
                {d.differentCanvassers && !d.sameCanvasserSameDay && (
                  <Badge variant="info" dot>
                    Different canvassers
                  </Badge>
                )}
                {d.voter && (
                  <Link
                    to={`/voters/${d.voter.id}`}
                    className="text-xs font-semibold text-brand-accent hover:underline"
                  >
                    Open voter →
                  </Link>
                )}
              </div>
            </div>

            <div className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border">
              {d.responses.map((r) => (
                <div
                  key={r.responseId}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-card px-3 py-2 text-sm"
                >
                  <span className="font-medium text-fg">
                    {r.canvasser.firstName} {r.canvasser.lastName}
                  </span>
                  <span className="text-fg-muted">{fmt(r.submittedAt, reportTz)}</span>
                  <span className="text-xs text-fg-subtle">{r.roundLabel}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
