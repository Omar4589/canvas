// Shape a ClientReport for public viewing. Used by BOTH the public share endpoints
// (/share/:token/reports) and the admin preview (/admin/client-reports/:id/preview) so the
// operator sees byte-for-byte what recipients will. Applies the visibility whitelist and drops
// admin-only internals.
//
// What reaches the wire is ENFORCED here, not on screen (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md
// §F1): visible questions are visibleKeysFor (empty = none), map questions are servedMapKeys (a
// follow-up only with its parents, and only what both the report's settings and its live snapshot
// allow), `supportQuestionKey` only when that question is visible, no `coverage`, no
// `visibility.mapAnswerKeys`, and NO INSTANTS: dates are civil dates in the report's own zone
// (§F0). The map's version is the snapshot's opaque key, never an ObjectId.

import { normalizeTag } from '../surveys/tags.js';
import { zonedDayStr } from '../../utils/timezone.js';
import { visibleKeysFor, servedMapKeys, mapServed, numbersCutOff, scopeOf, seriesKeyOf } from './reportVisibility.js';
import { mapVersionOf } from './clientReportMap.js';

function shapeWindow(w = {}, { visibleKeys = [], visibleTags = [] } = {}) {
  // Empty means NONE (it used to mean all, so unticking every question showed all of them — B3).
  const keys = new Set(visibleKeys);
  const surveyBreakdowns = (w.surveyBreakdowns || [])
    .filter((b) => keys.has(b.questionKey))
    .map((b) => ({
      questionKey: b.questionKey,
      questionLabel: b.questionLabel,
      type: b.type,
      options: (b.options || []).map((o) => ({ option: o.option, count: o.count, percent: o.percent })),
    }));
  // OPT-IN, like visible questions: empty = show NONE. Tag names are operator-authored strings on
  // an unauthenticated page, so each is an affirmative tick. Case-insensitive match (normalizeTag)
  // so a palette re-casing between compute and tick can never silently hide a chosen tag.
  const tagSet = new Set(visibleTags.map(normalizeTag));
  const tagBreakdowns = tagSet.size
    ? (w.tagBreakdowns || [])
        .filter((b) => tagSet.has(normalizeTag(b.tag)))
        .map((b) => ({ tag: b.tag, identifiedVoters: b.identifiedVoters, currentVoters: b.currentVoters }))
    : [];
  return {
    totals: w.totals || {},
    contactBreakdown: w.contactBreakdown || {},
    surveyBreakdowns,
    tagBreakdowns,
  };
}

const plain = (report) => (typeof report?.toObject === 'function' ? report.toObject() : report);
const dayOf = (instant, tz) => {
  if (!instant) return null;
  try {
    return zonedDayStr(instant, tz || 'America/New_York');
  } catch {
    return new Date(instant).toISOString().slice(0, 10);
  }
};

/**
 * The report's dates as the client reads them: published, edited, numbers refreshed — and
 * numbersThrough only when the numbers were taken before the period ended. Civil dates only.
 */
export const reportDates = (r) => {
  const cut = numbersCutOff(r);
  return {
    publishedOn: dayOf(r.publishedAt, r.timeZone),
    editedOn: dayOf(r.contentEditedAt, r.timeZone),
    refreshedOn: dayOf(r.numbersRefreshedAt, r.timeZone),
    numbersThrough: cut && r.rangeEndUtc && new Date(cut) < new Date(r.rangeEndUtc) ? dayOf(cut, r.timeZone) : null,
  };
};

const scopeFor = (r, seriesLabel = null) => {
  const s = scopeOf(r);
  return { kind: s.kind, label: s.label, seriesKey: seriesKeyOf(r), seriesLabel: seriesLabel || s.label };
};

// Compact row for the report hub list (newest-first): headline KPIs + the period, no breakdowns.
// No campaignId and no instants (§O9).
export function shapeReportListRow(report, { inputs, seriesLabel = null } = {}) {
  const r = plain(report);
  const served = inputs ? mapServed(r, inputs) : r.visibility?.showMap !== false;
  return {
    id: String(r._id),
    // Frozen with the numbers, as on the report itself: the hub's second figure is lit dropped or
    // surveys by it, never guessed from the totals. null on a report from before the field.
    campaignType: r.campaignType || null,
    title: r.title || '',
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    // Latest progress (PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §N): an all-time report, read with no "+N".
    allTime: !!r.allTime,
    // Scope label only (never an id): two same-week reports — one scoped, one campaign-wide —
    // must be distinguishable on the share link's list, not just after opening each.
    effortName: r.effortName || null,
    scope: scopeFor(r, seriesLabel),
    ...reportDates(r),
    mapMode: served ? inputs?.mapMode || 'pins' : null,
    mapPointCount: served ? r.mapPointCount || 0 : 0,
    showMap: served,
    headline: {
      cumulative: r.stats?.cumulative?.totals || {},
      period: r.stats?.period?.totals || {},
    },
  };
}

/**
 * The client's report. `inputs` is the live snapshot's (liveInputs); `earlierTotals` the line
 * computed at read time (earlierTotalsLine); `nav` the older/newer report in the same series. On a
 * link to one report (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D) the share route passes nav null and
 * the line's one-report form ({ changes, since: null, before }), so nothing names another report.
 * `mapSource` is the report the map endpoints read when it isn't `report` itself — the admin
 * preview shapes the on-screen overlay, but its map (and so its map version) is the saved report's.
 */
export function shapeReportForClient(report, { inputs, earlierTotals = null, nav = null, seriesLabel = null, mapSource = null } = {}) {
  const r = plain(report);
  const visibleKeys = visibleKeysFor(r);
  const served = inputs ? mapServed(r, inputs) : false;
  const support = r.supportQuestionKey && visibleKeys.includes(r.supportQuestionKey) ? r.supportQuestionKey : null;
  const vis = { visibleKeys, visibleTags: r.visibility?.visibleTags || [] };
  return {
    id: String(r._id),
    campaignType: r.campaignType || null,
    title: r.title || '',
    effortName: r.effortName || null, // walk-list scope label (frozen at creation); null = whole campaign
    scope: scopeFor(r, seriesLabel),
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    allTime: !!r.allTime,
    timeZone: r.timeZone,
    status: r.status,
    ...reportDates(r),
    observations: (r.observations || []).map((s) => ({ heading: s.heading, body: s.body })),
    // The headline question only when it is itself visible — a hidden question's key is a slug of
    // its wording and must never reach a link holder (B8).
    supportQuestionKey: support,
    stats: {
      cumulative: shapeWindow(r.stats?.cumulative, vis),
      period: shapeWindow(r.stats?.period, vis),
    },
    // Frozen goal progress, and ONLY when the operator ticked it. Same least-exposure rule as
    // visibleTags: an unticked goal never reaches the wire at all, so nothing downstream can
    // render it by accident. Progress only — the model deliberately freezes no verdict.
    goal:
      r.visibility?.showGoal && r.goalSnapshot?.target
        ? {
            target: r.goalSnapshot.target,
            deadline: r.goalSnapshot.deadline || null,
            done: r.goalSnapshot.done || 0,
            remaining: r.goalSnapshot.remaining || 0,
            percent: r.goalSnapshot.percent || 0,
          }
        : null,
    // The map's switches only — never the map-answer keys (B8). What the map carries is the map
    // endpoint's business, read from the live snapshot.
    visibility: {
      showMap: served,
      mapMode: served ? inputs?.mapMode || 'pins' : null,
      areaSize: served && inputs?.mapMode === 'area' ? inputs.areaSize || 'small' : null,
      // Opaque (contract C7): changes whenever what the map endpoints serve does.
      mapVersion: served ? mapVersionOf(plain(mapSource) || r, inputs) : null,
    },
    mapPointCount: served ? r.mapPointCount || 0 : 0,
    areaCellCount: served ? r.areaCellCount || 0 : 0,
    earlierTotals,
    nav,
  };
}

// The pins endpoints' door shape for the ADMIN builder's legacy list view — never the public wire
// (that is the compact payload in clientReportMap.js). Answers stripped to `keys`.
export function shapeMapPoints(points, keys = null) {
  const allowed = keys ? new Set(keys) : null;
  return points.map((p) => ({
    id: String(p.seq ?? p._id ?? ''),
    addressLine1: p.addressLine1 || '',
    city: p.city || '',
    state: p.state || '',
    location: { lng: p.lng, lat: p.lat },
    status: p.status,
    answers: (p.answers || [])
      .filter((a) => !allowed || allowed.has(a.questionKey))
      .map((a) => ({ questionKey: a.questionKey, answer: a.answer })),
  }));
}

/**
 * The MapFilters `survey` prop (questions with options + counts) from the report's cumulative
 * breakdowns — the SERVED map questions only (servedMapKeys), never the operator's raw list.
 */
export function mapFilterSurvey(report, inputs) {
  const r = plain(report);
  const keys = inputs ? servedMapKeys(r, inputs) : [];
  const wanted = new Set(keys);
  const questions = (r.stats?.cumulative?.surveyBreakdowns || [])
    .filter((b) => wanted.has(b.questionKey))
    .map((b) => ({
      key: b.questionKey,
      label: b.questionLabel,
      type: b.type,
      options: (b.options || []).map((o) => ({ option: o.option, count: o.count })),
    }));
  return { questions };
}
