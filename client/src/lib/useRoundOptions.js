import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

// The round picker's option list, shared by the Survey Explorer and the Dashboard so the two
// pickers cannot drift. Labelled "walk list · Pass N" because `roundNumber` restarts per
// effort (models/Pass.js) — a bare "Pass 2" names a different round in every walk list. Same
// effort-then-round ordering the knocks-by-pass report uses, so the two read alike.
//
// Sourced from GET /admin/campaigns/:id/passes, deliberately NOT from knocks-by-pass rows:
// options must never depend on the filters they will set (a narrowed report would delete the
// options that narrowed it), and the endpoint's `legacyResponseCount` keys the legacy bucket
// on null-pass RESPONSES — the unit a survey round picker actually scopes.
//
// `poll` is a spreadable react-query options object (e.g. the Dashboard's HOME_POLL) for
// pages under the Live-pill contract; omit it on single-fetch pages like the Explorer.
export function useRoundOptions(campaignId, { poll } = {}) {
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
    ...(poll || {}),
  });
  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes`),
    enabled: !!campaignId,
    ...(poll || {}),
  });

  const efforts = effortsQ.data?.efforts || [];
  const roundOptions = useMemo(() => {
    const effortName = new Map(efforts.map((ef) => [String(ef._id), ef.name]));
    const rows = (passesQ.data?.passes || [])
      .map((p) => ({
        id: String(p._id),
        effortId: String(p.effortId || ''),
        effortName: effortName.get(String(p.effortId)) || '',
        roundNumber: p.roundNumber,
        label: `${effortName.get(String(p.effortId)) || 'Walk list'} · Pass ${p.roundNumber}`,
      }))
      .sort(
        (a, b) =>
          (a.effortName || '￿').localeCompare(b.effortName || '￿') ||
          (a.roundNumber ?? Infinity) - (b.roundNumber ?? Infinity)
      );
    // Pre-turf responses carry passId:null and belong to no Pass document. Without this option
    // they'd sit in "All passes" and in no selectable pass, so the passes would not add up to the
    // headline. Sorted last, mirroring the "Legacy / no pass" row on the knocks-by-pass report.
    // This label is synthesized HERE, not supplied by the server, so it has to be kept in step with
    // routes/admin/reports.js by hand. The 'legacy' id is the server sentinel and never changes.
    if ((passesQ.data?.legacyResponseCount || 0) > 0) {
      rows.push({ id: 'legacy', effortId: '', effortName: '￿', roundNumber: Infinity, label: 'Legacy / no pass' });
    }
    return rows;
  }, [passesQ.data, efforts]);

  return { roundOptions, passesQ, effortsQ };
}
