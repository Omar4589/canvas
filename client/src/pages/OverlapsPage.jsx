import { useEffect, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import DateRangeSelector, { RANGE_PRESETS } from '../components/DateRangeSelector.jsx';
import { defaultRange } from '../lib/datePresets.js';
import OverlapDoorCard from '../components/OverlapDoorCard.jsx';
import { Card } from '../components/ui/index.js';
import { useCurrentCampaign } from '../lib/useCurrentCampaign.js';
import { CampaignLoading, CampaignMissing } from '../components/campaigns/CampaignGate.jsx';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// The standalone Overlaps report — doors knocked by 2+ canvassers in the same pass.
//
// Reads the ANCHORED /overlap-doors, deliberately NOT the date-windowed /overlaps the Timeline's
// reconciliation uses. The difference is the whole point of this page: the windowed engine only sees
// a collision when BOTH knocks fall inside the range, so on a "today" view it silently misses a door
// knocked last week and again this morning. Anchoring detects across the whole pass and surfaces the
// collision because one knock lands in view — with the earlier knock named and dated.
//
// No LiveStatus pill on purpose: /overlap-doors is deliberately un-polled (a whole-pass aggregation
// whose answer barely moves), and the live-poll contract requires every count under a pill to poll.
export default function OverlapsPage() {
  const { campaignId } = useParams();
  const orgTz = useOrgTimeZone();
  const navigate = useNavigate();

  const { campaign: current, resolving, notFound } = useCurrentCampaign(campaignId);
  const tz = current?.timeZone || orgTz;
  const tzReady = !resolving;

  const [dateRange, setDateRange] = useState(() => defaultRange('today', orgTz));
  const rangeTouchedRef = useRef(false);

  // One mounted element serves every campaign, so stale filters would bleed across a switch.
  const [prevCampaignId, setPrevCampaignId] = useState(campaignId);
  if (prevCampaignId !== campaignId) {
    setPrevCampaignId(campaignId);
    setDateRange(defaultRange('today', tz));
    rangeTouchedRef.current = false;
  }

  // Anchor "today" to the CAMPAIGN's day once its tz resolves, unless the admin already picked.
  useEffect(() => {
    if (rangeTouchedRef.current || !tzReady) return;
    setDateRange(defaultRange('today', tz));
  }, [tzReady, tz]);

  const overlapsQ = useQuery({
    queryKey: ['admin', 'overlap-doors', 'page', campaignId, dateRange?.from, dateRange?.to],
    queryFn: () =>
      api(
        `/admin/reports/overlap-doors${buildQuery({
          campaignId,
          from: dateRange?.from,
          to: dateRange?.to,
        })}`
      ),
    enabled: !!campaignId,
    placeholderData: keepPreviousData,
  });

  function onRangeChange(next) {
    rangeTouchedRef.current = true;
    setDateRange(next);
  }

  // Reuse the map's existing ?household= deep link (the Notes hub uses it too): it opens on all-time
  // so an old door still loads, then flies to the pin.
  function viewOnMap(door) {
    navigate(`/campaigns/${campaignId}/map?household=${door.householdId}`);
  }

  if (resolving) return <CampaignLoading />;
  if (notFound) return <CampaignMissing />;

  const doors = overlapsQ.data?.doors || [];
  const outOfRange = overlapsQ.data?.outOfRangeTotal || 0;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg">{current?.name || 'Campaign'}</h1>
          <div className="mt-1 text-sm text-fg-muted">
            Overlaps — doors more than one canvasser knocked in the same round
          </div>
        </div>
        <DateRangeSelector value={dateRange} onChange={onRangeChange} tz={tz} presets={RANGE_PRESETS} />
      </div>

      {overlapsQ.isLoading ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-fg-muted">Loading…</div>
      ) : overlapsQ.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
          Error: {overlapsQ.error.message}
        </div>
      ) : (
        <>
          <Card className="mb-3 p-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span className="text-2xl font-semibold text-fg tabular-nums">{doors.length}</span>
              <span className="text-fg-muted">
                {doors.length === 1 ? 'door was' : 'doors were'} worked by more than one canvasser in the
                same round
              </span>
            </div>
            {/* Collisions whose knocks all fall outside the chosen dates. Real, just not anchored to a
                day in view — surfaced rather than dropped, with the fix stated. */}
            {outOfRange > 0 && (
              <div className="mt-2 text-xs text-fg-muted">
                <span className="font-medium">+{outOfRange}</span> more outside your dates — widen the
                range to see them.
              </div>
            )}
            <div className="mt-2 text-xs text-fg-muted">
              A door is a collision when two canvassers knocked it in the <em>same round</em>. Once a
              round has covered a door, nobody should return until the next one — so these are usually
              two walk lists that ran into each other. Nothing here is billed twice.
            </div>
          </Card>

          {doors.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center">
              <div className="text-sm font-medium text-fg">No overlaps in this range</div>
              <div className="mt-1 text-sm text-fg-muted">
                Every door in view was worked by at most one canvasser per round.
                {outOfRange > 0 ? ' Widen the date range to see the ones outside it.' : ''}
              </div>
            </div>
          ) : (
            <Card className="p-4">
              <div className="divide-y divide-border">
                {doors.map((d) => (
                  <OverlapDoorCard key={d.householdId} door={d} tz={tz} onViewMap={viewOnMap} />
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
