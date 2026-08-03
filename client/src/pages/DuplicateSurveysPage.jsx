import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api/client.js';
import CampaignSelector, { useCampaignSelection } from '../components/CampaignSelector.jsx';
import DateRangeSelector, { defaultRange } from '../components/DateRangeSelector.jsx';
import Pager from '../components/Pager.jsx';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { Card, Badge, Segmented } from '../components/ui/index.js';

const LIMIT = 25;

const KIND_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'sameRoundOverwritten', label: 'Same round, overwritten' },
  { value: 'sameCanvasserSameDay', label: 'Same canvasser, same day' },
  { value: 'differentCanvassers', label: 'Different canvassers, later round' },
];

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
  const [kind, setKind] = useState('all');
  const [userId, setUserId] = useState('');
  const [skip, setSkip] = useState(0);
  const tz = selected?.timeZone || orgTz;

  // Switching campaigns changes the roster, so a carried-over canvasser id would silently filter
  // to nobody — clear it here (before commit, so no query fires with the stale pair). The kind
  // and date filters are campaign-agnostic and stay put, so an audit survives a campaign flip.
  const [prevCampaignId, setPrevCampaignId] = useState(campaignId);
  if (prevCampaignId !== campaignId) {
    setPrevCampaignId(campaignId);
    setUserId('');
    setSkip(0);
  }

  // Any filter change returns to the first page.
  useEffect(() => {
    setSkip(0);
  }, [dateRange.from, dateRange.to, kind, userId]);

  // Ledger-first (NOT the roster): a departed canvasser's duplicates still show on this page, so
  // they must stay filterable. Bare array response.
  const canvassersQ = useQuery({
    queryKey: ['reports', 'canvassers', campaignId],
    queryFn: () => api(`/admin/reports/canvassers${buildQuery({ campaignId })}`),
    enabled: !!campaignId,
  });
  const canvasserOptions = useMemo(() => {
    const rows = Array.isArray(canvassersQ.data) ? canvassersQ.data : [];
    return rows
      .map((c) => ({
        id: c.userId,
        name:
          (`${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown') +
          (c.status && c.status !== 'active' ? ` (${c.status})` : ''),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [canvassersQ.data]);

  const qs = buildQuery({
    campaignId,
    from: dateRange.from,
    to: dateRange.to,
    kind: kind === 'all' ? '' : kind,
    userId,
    skip,
    limit: LIMIT,
  });
  const q = useQuery({
    queryKey: ['admin', 'duplicate-surveys', campaignId, dateRange.from, dateRange.to, kind, userId, skip],
    queryFn: () => api(`/admin/reports/duplicate-surveys${qs}`),
    enabled: !!campaignId,
    placeholderData: keepPreviousData,
  });

  const duplicates = q.data?.duplicates || [];
  const total = q.data?.total || 0;
  const reportTz = q.data?.timeZone || tz;
  const filtered = kind !== 'all' || !!userId;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Duplicate surveys</h1>
          <p className="mt-1 max-w-xl text-sm text-fg-muted">
            Voters with more than one survey response — the reason “Surveys” can read higher than
            “Surveyed voters.” Same round · overwritten means a second canvasser's submit replaced
            the first one's answers — the originals are preserved on the voter profile and can be
            restored there. Same canvasser, same day is usually a double-submit; different
            canvassers in a later round is usually a legitimate revisit.
          </p>
        </div>
        <CampaignSelector
          campaignId={campaignId}
          onChange={setCampaignId}
          campaigns={campaigns}
          isLoading={campaignsLoading}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented size="sm" options={KIND_OPTIONS} value={kind} onChange={setKind} />
          {(canvasserOptions.length > 0 || userId) && (
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              title="Filter by canvasser"
              className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">All canvassers</option>
              {canvasserOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <DateRangeSelector value={dateRange} onChange={setDateRange} tz={tz} />
      </div>

      {q.isLoading ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">Loading…</div>
      ) : q.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          Error: {q.error.message}
        </div>
      ) : duplicates.length === 0 ? (
        <Card className="p-6 text-sm text-fg-muted">
          {filtered
            ? 'No duplicate surveys match these filters.'
            : 'No duplicate surveys in this range. Every surveyed voter has exactly one response. 🎉'}
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {duplicates.map((d) => (
              <Card key={d.voterId} className="p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-fg">{d.voter?.fullName || 'Unknown voter'}</span>
                  {d.voter?.party && <span className="text-xs text-fg-muted">({d.voter.party})</span>}
                  <Badge variant="neutral">surveyed {d.count}×</Badge>
                  {/* All flag badges render together — never one hidden behind another. Severity
                      ladder: danger = answers were destroyed (preserved), warning = duplicate rows
                      exist but nothing lost, info = benign cross-round history. */}
                  {d.sameRoundOverwritten && (
                    <Badge variant="danger" dot>
                      Same round · overwritten
                    </Badge>
                  )}
                  {d.sameCanvasserSameDay && (
                    <Badge variant="warning" dot>
                      Same canvasser · same day
                    </Badge>
                  )}
                  {d.differentCanvassers && (
                    <Badge variant="info" dot>
                      Different canvassers · later round
                    </Badge>
                  )}
                </div>

                <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-xs">
                  <span className="truncate text-fg-muted">
                    {d.household
                      ? `${d.household.addressLine1}${d.household.city ? `, ${d.household.city}` : ''} ${d.household.state || ''}`
                      : ''}
                  </span>
                  {d.voter && (
                    <Link
                      to={`/voters/${d.voter.id}`}
                      className="shrink-0 font-semibold text-brand-accent hover:underline"
                    >
                      Open voter →
                    </Link>
                  )}
                </div>

                <div className="mt-2 divide-y divide-border border-t border-border">
                  {d.responses.map((r) => (
                    <div
                      key={r.responseId}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-1 text-xs"
                    >
                      <span className={r.overwritten ? 'font-medium text-fg-muted' : 'font-medium text-fg'}>
                        {r.canvasser.firstName} {r.canvasser.lastName}
                      </span>
                      <span className="text-fg-muted">{fmt(r.submittedAt, reportTz)}</span>
                      <span className="text-fg-subtle">{r.roundLabel}</span>
                      {r.overwritten && (
                        <span className="flex items-center gap-1.5">
                          <Badge variant="danger">Overwritten</Badge>
                          <span className="text-fg-subtle">
                            replaced by {r.overwrittenBy?.firstName} {r.overwrittenBy?.lastName}
                          </span>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
          <Pager skip={skip} limit={LIMIT} total={total} onChange={setSkip} className="mt-1" />
        </>
      )}
    </div>
  );
}
