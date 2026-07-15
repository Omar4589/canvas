import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Household } from '../../models/Household.js';
import { User } from '../../models/User.js';
import { FlagReview } from '../../models/FlagReview.js';
import { haversineMeters } from '../../utils/normalizeAddress.js';
import { FLAG_THRESHOLDS, maxSeverity } from './flagThresholds.js';

// GPS canvassing-quality detector. Computes flags LIVE from the CanvassActivity ledger —
// nothing about which actions are flagged is stored; only the reviewer's DECISION is
// persisted (FlagReview), joined here as `review` (absent = 'open').
//
// `match` is a fully-built CanvassActivity filter (org/campaign/effort + timestamp window,
// optional userId) — same contract as computeOverlaps(match, ...). Reads CanvassActivity
// ONLY: a survey submit already writes a `survey_submitted` activity row, and multi-voter-
// at-one-door collapses to a single door-action (the correct unit for a GPS audit, and it
// avoids a false "rapid" flag from several quick voter-surveys at one door).
//
// Four flag types: far (distance − accuracy), weak_gps, rapid (impossibly short door-to-door
// gap), one_spot (stationary: many distinct doors from one GPS spot whose pins are spread).
// Memory backstop: detection loads every matched row into Node and sorts in-process, so a huge
// window (e.g. 62-day, whole-campaign) could OOM the web dyno. Above this many rows we bail with
// `truncated` rather than load them — a PARTIAL audit would silently hide flags, worse than asking
// the user to narrow the range. Normal daily/weekly audits are far under this.
const AUDIT_ROW_CAP = 250000;

export async function detectFlags(match, { organizationId, thresholds = FLAG_THRESHOLDS, rowCap = AUDIT_ROW_CAP } = {}) {
  // Admin BULK-authored rows (via:'bulk', e.g. book-level bulk-restrict) are invisible to detection
  // by design: a batch shares one timestamp across many doors and would flood 'rapid' HIGH flags
  // that audit nothing a canvasser did.
  const scanFilter = { ...match, via: { $ne: 'bulk' } };

  const scanCount = await CanvassActivity.countDocuments(scanFilter);
  if (scanCount > rowCap) {
    return { entries: [], summary: emptySummary(), windowActionCount: scanCount, truncated: true };
  }

  const rows = await CanvassActivity.find(
    scanFilter,
    '_id userId householdId campaignId effortId passId actionType timestamp location distanceFromHouseMeters replaced wasOfflineSubmission'
  )
    .sort({ userId: 1, timestamp: 1 })
    .lean();

  if (!rows.length) {
    return { entries: [], summary: emptySummary(), windowActionCount: 0, truncated: false };
  }

  // House pins + address (one query) — for the one-spot house-spread guard and to attach
  // address/geometry to every entry without a second fetch.
  const householdIds = [...new Set(rows.map((r) => String(r.householdId)))];
  const households = await Household.find(
    { _id: { $in: householdIds }, organizationId },
    'addressLine1 addressLine2 city state zipCode location'
  ).lean();
  const hInfoMap = new Map(households.map((h) => [String(h._id), h]));
  const pinMap = new Map(households.map((h) => [String(h._id), pinLngLat(h)]));

  const { acc, byUser } = computeReasons(rows, pinMap, thresholds);

  // Join persisted review decisions (absent = open).
  const flaggedIds = [...acc.keys()];
  const reviews = flaggedIds.length
    ? await FlagReview.find({ organizationId, actionId: { $in: flaggedIds } }).lean()
    : [];
  const reviewMap = new Map(reviews.map((rv) => [String(rv.actionId), rv]));

  // Resolve canvasser + reviewer names in one query.
  const userIds = new Set();
  for (const { row } of acc.values()) userIds.add(String(row.userId));
  for (const rv of reviews) if (rv.reviewedBy) userIds.add(String(rv.reviewedBy));
  const users = userIds.size
    ? await User.find({ _id: { $in: [...userIds] } }, 'firstName lastName email').lean()
    : [];
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const nameOf = (id) => {
    const u = uMap.get(String(id));
    return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '';
  };

  const entries = [];
  for (const { row, reasons } of acc.values()) {
    const reasonList = [...reasons.values()];
    const sev = reasonList.reduce((m, r) => maxSeverity(m, r.severity), null);
    const h = hInfoMap.get(String(row.householdId));
    const rv = reviewMap.get(String(row._id));
    entries.push({
      actionModel: 'CanvassActivity',
      actionId: String(row._id),
      userId: String(row.userId),
      canvasser: { id: String(row.userId), name: nameOf(row.userId) },
      householdId: String(row.householdId),
      campaignId: String(row.campaignId),
      effortId: row.effortId ? String(row.effortId) : null,
      actionType: row.actionType,
      timestamp: row.timestamp,
      location: row.location || null,
      distanceFromHouseMeters: row.distanceFromHouseMeters ?? null,
      wasOfflineSubmission: !!row.wasOfflineSubmission,
      household: h
        ? {
            id: String(h._id),
            addressLine1: h.addressLine1 || '',
            addressLine2: h.addressLine2 || null,
            city: h.city || '',
            state: h.state || '',
            zipCode: h.zipCode || '',
            location: pinMap.get(String(h._id)) || null,
          }
        : null,
      reasons: reasonList,
      maxSeverity: sev,
      review: rv
        ? {
            status: rv.status,
            note: rv.note || null,
            reviewedBy: rv.reviewedBy ? String(rv.reviewedBy) : null,
            reviewedByName: nameOf(rv.reviewedBy),
            reviewedAt: rv.reviewedAt || null,
          }
        : { status: 'open', note: null, reviewedBy: null, reviewedByName: '', reviewedAt: null },
    });
  }
  entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return { entries, summary: summarize(entries, byUser, nameOf), windowActionCount: rows.length, truncated: false };
}

// PURE detection core (no DB) — exported for unit testing. `rows` are lean CanvassActivity
// docs (time-sorted per user is fine but not required — grouped + sorted here); `pinMap` maps
// householdId string → {lng,lat}|null. Returns { acc, byUser } where acc is
// Map<actionIdStr, { row, reasons: Map<type, reason> }>.
export function computeReasons(rows, pinMap, thresholds = FLAG_THRESHOLDS) {
  const T = thresholds;
  const acc = new Map();
  const addReason = (row, reason) => {
    const id = String(row._id);
    let e = acc.get(id);
    if (!e) {
      e = { row, reasons: new Map() };
      acc.set(id, e);
    }
    const prev = e.reasons.get(reason.type);
    if (!prev || maxSeverity(prev.severity, reason.severity) === reason.severity) {
      e.reasons.set(reason.type, reason);
    }
  };

  const byUser = new Map();
  for (const r of rows) {
    const uid = String(r.userId);
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(r);
  }
  for (const timeline of byUser.values()) {
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Per-row: far + weak_gps.
    for (const r of timeline) {
      const acc_m = r.location?.accuracy;
      const missing = !r.location || r.location.lat == null || r.location.lng == null;

      // weak_gps — a null accuracy alone is NOT flagged (unknown ≠ bad; would flood legacy
      // data); missing location, a poor/oversized fix, or an offline sync are the signals.
      let weakSev = null;
      if (missing) weakSev = 'high';
      else if (acc_m != null && acc_m > T.GPS_ACCURACY_BAD_M) weakSev = 'high';
      else if (acc_m != null && acc_m > T.GPS_ACCURACY_WARN_M) weakSev = 'med';
      else if (r.wasOfflineSubmission) weakSev = 'low';

      // Stale fix — the OS computed this fix long before the tap that used it (location.
      // fixTimestamp vs r.timestamp). The client caps reused fixes at 2 min, so a big gap
      // means a bypassed/old client or a forged payload. Escalates weak_gps — same admin
      // question, "this stamp can't be trusted". Absent fixTimestamp (legacy rows, old
      // clients) and negative gaps (clock skew) never flag.
      let fixAgeSec = null;
      if (!missing && r.location?.fixTimestamp) {
        fixAgeSec = (new Date(r.timestamp) - new Date(r.location.fixTimestamp)) / 1000;
        let staleSev = null;
        if (fixAgeSec > T.STALE_FIX_HIGH_SEC) staleSev = 'high';
        else if (fixAgeSec > T.STALE_FIX_MED_SEC) staleSev = 'med';
        if (staleSev) weakSev = maxSeverity(weakSev, staleSev);
      }
      const stale = fixAgeSec != null && fixAgeSec > T.STALE_FIX_MED_SEC;
      if (weakSev) {
        addReason(r, {
          type: 'weak_gps',
          severity: weakSev,
          detail: {
            accuracy: acc_m ?? null,
            missing,
            offline: !!r.wasOfflineSubmission,
            ...(stale ? { stale: true, fixAgeSec: Math.round(fixAgeSec) } : {}),
          },
        });
      }

      // mock_gps — Android marked the fix as coming from a mock-location provider (a
      // fake-GPS app). Captured silently — the canvasser app never blocks or hints, so
      // the evidence accumulates instead of tipping the cheater off. false/null/absent
      // (iOS, legacy rows, old clients) never flag.
      if (r.location?.mocked === true) {
        addReason(r, { type: 'mock_gps', severity: 'high', detail: {} });
      }

      // far — distance MINUS accuracy (a big distance from a poor fix reads as weak_gps, not
      // far). Null distance = unknown → never "far".
      const d = r.distanceFromHouseMeters;
      if (d != null) {
        const effective = Math.max(0, d - (acc_m ?? 0));
        let farSev = null;
        if (effective > T.FAR_CONFIRM_M) farSev = 'high';
        else if (effective > T.FAR_WARN_M) farSev = 'med';
        if (farSev) {
          const detail = { meters: d, effectiveMeters: Math.round(effective), accuracy: acc_m ?? null };
          if (r.replaced) {
            // Correction context for the UI, on EVERY far correction (downgraded or not):
            // the entry this one replaced ("latest wins" deleted its row — the snapshot is
            // the only surviving record of where the canvasser stood the first time).
            detail.priorActionType = r.replaced.actionType || null;
            detail.priorMeters = r.replaced.distanceFromHouseMeters ?? null;
            detail.priorAccuracy = r.replaced.location?.accuracy ?? null;
            detail.minutesSincePrior = r.replaced.timestamp
              ? Math.round((new Date(r.timestamp) - new Date(r.replaced.timestamp)) / 60000)
              : null;
            // Downgrade, don't suppress: the chain's best evidence (`nearest`) proves they
            // were AT this door recently → an honest correction, not a phantom knock. The
            // >= 0 guard denies the downgrade on reversed clocks (offline flush skew).
            const near = r.replaced.nearest;
            if (near && near.distanceFromHouseMeters != null && near.timestamp) {
              const nearEff = Math.max(0, near.distanceFromHouseMeters - (near.accuracy ?? 0));
              const sinceNearMin = (new Date(r.timestamp) - new Date(near.timestamp)) / 60000;
              if (nearEff <= T.FAR_WARN_M && sinceNearMin >= 0 && sinceNearMin <= T.FAR_CORRECTION_WINDOW_MIN) {
                farSev = 'low';
                detail.downgraded = true;
                detail.nearestMeters = near.distanceFromHouseMeters;
                detail.minutesSinceNearest = Math.round(sinceNearMin);
              }
            }
          }
          addReason(r, { type: 'far', severity: farSev, detail });
        }
      }
    }

    // rapid — consecutive DISTINCT-door gaps on the travel timeline (notes excluded).
    const travel = timeline.filter((r) => r.actionType !== 'note_added');
    for (let i = 1; i < travel.length; i++) {
      const prev = travel[i - 1];
      const cur = travel[i];
      if (String(prev.householdId) === String(cur.householdId)) continue;
      const gapSec = (new Date(cur.timestamp) - new Date(prev.timestamp)) / 1000;
      if (!(gapSec >= 0 && gapSec < T.RAPID_GAP_SEC)) continue;
      // Offline-batch artifact: both offline with an identical stamp = sync time, not behavior.
      if (prev.wasOfflineSubmission && cur.wasOfflineSubmission && gapSec === 0) continue;
      addReason(cur, {
        type: 'rapid',
        severity: gapSec < T.RAPID_GAP_HIGH_SEC ? 'high' : 'med',
        detail: {
          gapSec: Math.round(gapSec),
          prevHouseholdId: String(prev.householdId),
          prevActionType: prev.actionType,
        },
      });
    }

    // one_spot — stationary clusters of DISTINCT doors with spread-out pins.
    detectOneSpot(timeline, pinMap, T, addReason);
  }

  return { acc, byUser };
}

// Greedy time-ordered sweep: anchor at the earliest unassigned located row, gather all rows
// within radius + time window of the anchor, then fire if the cluster covers enough DISTINCT
// doors whose OWN pins are spread out (the apartment guard).
function detectOneSpot(timeline, pinMap, T, addReason) {
  const located = timeline.filter((r) => r.location && r.location.lat != null && r.location.lng != null);
  const assigned = new Set();
  for (let i = 0; i < located.length; i++) {
    if (assigned.has(i)) continue;
    const anchor = located[i];
    const cluster = [anchor];
    assigned.add(i);
    for (let j = i + 1; j < located.length; j++) {
      if (assigned.has(j)) continue;
      const cand = located[j];
      const spanMin = (new Date(cand.timestamp) - new Date(anchor.timestamp)) / 60000;
      if (spanMin > T.ONE_SPOT_WINDOW_MIN) break; // time-sorted → nothing later qualifies
      const dist = haversineMeters(anchor.location.lat, anchor.location.lng, cand.location.lat, cand.location.lng);
      if (dist <= T.ONE_SPOT_RADIUS_M) {
        cluster.push(cand);
        assigned.add(j);
      }
    }
    const distinctHH = [...new Set(cluster.map((r) => String(r.householdId)))];
    if (distinctHH.length < T.ONE_SPOT_MIN_DISTINCT_HH) continue;
    if (housePinSpread(distinctHH, pinMap) < T.ONE_SPOT_HOUSE_SPREAD_M) continue; // apartment guard
    const spanMin = Math.round(
      (new Date(cluster[cluster.length - 1].timestamp) - new Date(cluster[0].timestamp)) / 60000
    );
    const severity = distinctHH.length >= 8 ? 'high' : 'med';
    for (const r of cluster) {
      addReason(r, {
        type: 'one_spot',
        severity,
        detail: { distinctHouseholds: distinctHH.length, radiusM: T.ONE_SPOT_RADIUS_M, spanMin },
      });
    }
  }
}

// Max pairwise distance between the distinct households' pins (households without a pin are
// ignored; <2 pins → 0, so the cluster can't fire — conservative).
function housePinSpread(householdIds, pinMap) {
  const pins = [];
  for (const id of householdIds) {
    const p = pinMap.get(String(id));
    if (p) pins.push(p);
  }
  let max = 0;
  for (let a = 0; a < pins.length; a++) {
    for (let b = a + 1; b < pins.length; b++) {
      const d = haversineMeters(pins[a].lat, pins[a].lng, pins[b].lat, pins[b].lng);
      if (d > max) max = d;
    }
  }
  return max;
}

function pinLngLat(h) {
  const c = h?.location?.coordinates;
  if (!c || c.length < 2) return null;
  return { lng: c[0], lat: c[1] };
}

function emptySummary() {
  return {
    totals: { flaggedActions: 0, far: 0, rapid: 0, oneSpot: 0, weakGps: 0, mockGps: 0, open: 0, reviewed: 0, dismissed: 0, confirmed: 0 },
    byCanvasser: [],
  };
}

const REASON_KEY = { far: 'far', rapid: 'rapid', one_spot: 'oneSpot', weak_gps: 'weakGps', mock_gps: 'mockGps' };

export function summarize(entries, byUser, nameOf) {
  const totals = { flaggedActions: 0, far: 0, rapid: 0, oneSpot: 0, weakGps: 0, mockGps: 0, open: 0, reviewed: 0, dismissed: 0, confirmed: 0 };
  const perUser = new Map();
  for (const [uid, timeline] of byUser.entries()) {
    perUser.set(uid, {
      userId: uid,
      name: nameOf(uid),
      totalActions: timeline.filter((r) => r.actionType !== 'note_added').length,
      flaggedActions: 0,
      far: 0,
      rapid: 0,
      oneSpot: 0,
      weakGps: 0,
      mockGps: 0,
      openCount: 0,
      worstSeverity: null,
    });
  }

  for (const e of entries) {
    totals.flaggedActions += 1; // total flags in range, status-independent (secondary reference)
    const status = e.review?.status || 'open';
    const isOpen = status === 'open';
    // Each status counted exactly once (open/reviewed/dismissed/confirmed). `open` is the
    // actionable "flagged" number the UI headlines; the others form the resolved breakdown.
    if (totals[status] != null) totals[status] += 1;
    const u = perUser.get(e.userId);
    if (u) {
      u.flaggedActions += 1;
      if (isOpen) u.openCount += 1;
      u.worstSeverity = maxSeverity(u.worstSeverity, e.maxSeverity);
    }
    // Per-reason counts reflect OPEN flags only, so the reason chips/cards stay consistent
    // with the open-first headline and the map's default open view.
    if (isOpen) {
      const seen = new Set();
      for (const r of e.reasons) {
        const key = REASON_KEY[r.type];
        if (!key || seen.has(key)) continue;
        seen.add(key);
        totals[key] += 1;
        if (u) u[key] += 1;
      }
    }
  }

  const byCanvasser = [...perUser.values()]
    .filter((u) => u.flaggedActions > 0)
    .sort((a, b) => b.flaggedActions - a.flaggedActions);

  return { totals, byCanvasser };
}
