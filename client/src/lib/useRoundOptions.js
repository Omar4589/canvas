import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { isArchivedWalkList, passOptionLabel, walkListLabel } from './walkListOptions.js';

// The round picker's option list, shared by every web round picker (Dashboard, Survey Explorer,
// Door Outcomes, Saved Searches, and the Export Center through roundOptionRows) so they cannot
// drift. Labelled "walk list · Pass N" because `roundNumber` restarts per effort (models/Pass.js)
// — a bare "Pass 2" names a different round in every walk list. Same effort-then-round ordering
// the knocks-by-pass report uses, so the two read alike, except that an archived walk list's
// rounds come after the open ones', marked "North (archived) · Pass 2" — a report filter keeps
// its history, listed last (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §D.4).
//
// Sourced from GET /admin/campaigns/:id/passes, deliberately NOT from knocks-by-pass rows:
// options must never depend on the filters they will set (a narrowed report would delete the
// options that narrowed it), and the endpoint's `legacyResponseCount` keys the legacy bucket
// on null-pass RESPONSES — the unit a survey round picker actually scopes.
//
// `poll` is a spreadable react-query options object (e.g. the Dashboard's HOME_POLL) for
// pages under the Live-pill contract; omit it on single-fetch pages like the Explorer.
// `effortId` narrows `roundOptions` to one walk list's rounds; `allRoundOptions` stays whole, for
// naming or checking a pass the narrowing left out.
export function useRoundOptions(campaignId, { poll, effortId } = {}) {
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

  const allRoundOptions = useMemo(
    () =>
      roundOptionRows({
        passes: passesQ.data?.passes,
        efforts: effortsQ.data?.efforts,
        legacyResponseCount: passesQ.data?.legacyResponseCount,
      }),
    [passesQ.data, effortsQ.data]
  );
  const roundOptions = useMemo(() => narrowRoundOptions(allRoundOptions, effortId), [allRoundOptions, effortId]);

  return { roundOptions, allRoundOptions, passesQ, effortsQ };
}

// The rows themselves, pure (useRoundOptions.test.js). The Export Center builds from its own passes
// query, which the server has already narrowed to the picked walk list, and passes no legacy count:
// that page offers its own "Legacy / no pass".
export const roundOptionRows = ({ passes, efforts, legacyResponseCount = 0 } = {}) => {
  const effortById = new Map((efforts || []).map((ef) => [String(ef._id), ef]));
  const rows = (passes || [])
    .map((p) => {
      const effort = effortById.get(String(p.effortId));
      return {
        id: String(p._id),
        effortId: String(p.effortId || ''),
        effortName: effort?.name || '',
        archived: isArchivedWalkList(effort),
        roundNumber: p.roundNumber,
        // "North · Pass 3 · GOTV": the pass's own name only when it says more than its number.
        label: passOptionLabel(p, effort ? walkListLabel(effort) : ''),
      };
    })
    .sort(
      (a, b) =>
        Number(a.archived) - Number(b.archived) ||
        (a.effortName || '￿').localeCompare(b.effortName || '￿') ||
        (a.roundNumber ?? Infinity) - (b.roundNumber ?? Infinity)
    );
  // Pre-turf responses carry passId:null and belong to no Pass document. Without this option
  // they'd sit in "All passes" and in no selectable pass, so the passes would not add up to the
  // headline. Sorted last, mirroring the "Legacy / no pass" row on the knocks-by-pass report.
  // This label is synthesized HERE, not supplied by the server, so it has to be kept in step with
  // routes/admin/reports.js by hand. The 'legacy' id is the server sentinel and never changes.
  if ((legacyResponseCount || 0) > 0) {
    rows.push({ id: 'legacy', effortId: '', effortName: '￿', archived: false, roundNumber: Infinity, label: 'Legacy / no pass' });
  }
  return rows;
};

// One walk list's rounds ('' = every round). The legacy bucket belongs to no walk list, so a
// narrowed list never offers it.
export const narrowRoundOptions = (rows, effortId) =>
  effortId ? rows.filter((r) => r.effortId === String(effortId)) : rows;
