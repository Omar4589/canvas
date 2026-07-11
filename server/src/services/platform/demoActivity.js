import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { SurveyResponse } from '../../models/SurveyResponse.js';
import { resolveStatus } from '../../utils/statusPrecedence.js';
import { normalizeAndFilterAnswers } from '../surveys/normalizeAnswers.js';
import { haversineMeters } from '../../utils/normalizeAddress.js';
import { zonedDayRange } from '../../utils/timezone.js';

// Shared demo-activity generator + persister. Both the one-time seed
// (seedDemoOrg.stageCanvassHistory) and the super-admin "Refresh demo day" button
// (services/platform/refreshDemoDay) build and persist a day's fake canvassing
// through here, so the two paths can never drift in realism or write pattern.
//
// The realism model is PER-CANVASSER, not per-book: each canvasser walks roughly
// one book per day spread across today + the four prior evenings, on a single
// running clock (2-5 min between doors), capped to a believable daily total. That
// keeps `doorsPerHour = knocks / (last-first span)` in a realistic ~15-20 band
// instead of collapsing a canvasser's whole inventory into one window.
//
// Distributions are tuned to a real field operation: most doors are not-home, the
// connection rate (surveys / knocks) lands ~22%, and the survey answers mirror a
// real canvass (Support / Likely Support / Undecided / Opposed, multi-select
// issues, and an action-style yard-sign question shown only to supporters).

// Per-book completion fractions, cycled per canvasser in book order — books are
// walked partially (never 100%), some heavily, some barely.
export const BOOK_FRACTIONS = [0.9, 0.75, 0.6, 0.45, 0.3, 0.15];

// Outcome mix per knock. survey → connection ~22-23%; refused is a contact but not
// a completion; most doors are not-home (realistic).
export const OUTCOME_WEIGHTS = [
  ['not_home', 61],
  ['survey', 23],
  ['refused', 11],
  ['wrong_address', 5],
];

// Candidate-support mix among surveyed voters. Ids are stable (strong_support /
// lean_support); the demo template DISPLAYS them as "Support" / "Likely Support".
export const SUPPORT_WEIGHTS = [
  ['strong_support', 24],
  ['lean_support', 26],
  ['undecided', 35],
  ['opposed', 15],
];

// Top-issue option ids (match the demo survey template's `top_issue` options).
const ISSUE_IDS = [
  'healthcare',
  'public_schools',
  'cost_of_living',
  'public_safety',
  'water_environment',
  'property_taxes',
  'roads_infrastructure',
];

// One book per day, cycling: today first, then the four prior evenings.
const DAY_OFFSETS = [0, -1, -2, -3, -4];

// ---------------------------------------------------------------------------
// Timezone helpers — all staged history is relative to `now` so the demo stays
// fresh. Parameterized by tz (the seed and the button pass the campaign's tz).
// ---------------------------------------------------------------------------
function dayStr(offsetDays, tz, now) {
  const d = new Date(now + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function localTime(offsetDays, minutesAfterMidnight, tz, now) {
  const day = dayStr(offsetDays, tz, now);
  const midnightUtc = zonedDayRange(day, day, tz).$gte;
  return new Date(midnightUtc.getTime() + minutesAfterMidnight * 60000);
}

// Minutes after local midnight, right now, in `tz`.
function nowLocalMinutes(tz, now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(now));
  const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return h * 60 + m;
}

function jitterLocation(rng, hh) {
  const [lng, lat] = hh.location.coordinates;
  const meters = 4 + rng.next() * 12;
  const angle = rng.next() * Math.PI * 2;
  const dLat = (meters * Math.sin(angle)) / 111320;
  const dLng = (meters * Math.cos(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng, accuracy: rng.int(5, 20) };
}

function activityDoc({ rng, hh, userId, actionType, ts, passId, turfId, voterId = null, wasOffline = false }) {
  const loc = jitterLocation(rng, hh);
  const [hLng, hLat] = hh.location.coordinates;
  return {
    organizationId: hh.organizationId,
    campaignId: hh.campaignId,
    householdId: hh._id,
    voterId,
    userId,
    actionType,
    passId,
    turfId,
    effortId: hh.effortId,
    note: null,
    location: loc,
    distanceFromHouseMeters: Math.round(haversineMeters(hLat, hLng, loc.lat, loc.lng)),
    timestamp: ts,
    wasOfflineSubmission: wasOffline,
  };
}

/**
 * Build a day's worth of fake activity IN MEMORY (no DB writes). Pure aside from
 * `rng` and `now`, so the caller controls persistence and the seed can stay
 * deterministic (seeded rng) while the button varies (Math.random).
 *
 * @param stagedBooks       published turfs to walk (reviewer's book already removed)
 * @param assignmentsByTurf Map<turfIdStr, userId> — who owns each book
 * @param hhById            Map<hhIdStr, householdDoc>
 * @param votersByHousehold Map<hhIdStr, voterDoc[]>
 * @returns { activities, surveys, overlaps, todayKnocks }
 */
export function stageDemoActivity({
  rng, campaign, template, tz, stagedBooks, assignmentsByTurf, hhById, votersByHousehold, now = Date.now(),
}) {
  const activities = [];
  const surveys = [];
  const overlapCandidates = [];
  let todayKnocks = 0;
  const nowMin = nowLocalMinutes(tz, now);
  const cutoff = nowMin - 4; // never knock into the future

  function knockDoor({ hh, canvasserId, ts, passId, turfId, isToday }) {
    const wasOffline = rng.chance(0.1);
    const outcome = rng.weighted(OUTCOME_WEIGHTS);
    const voters = votersByHousehold.get(String(hh._id)) || [];
    if (outcome === 'survey' && template && voters.length) {
      const voter = voters[0];
      const support = rng.weighted(SUPPORT_WEIGHTS);
      const issues = [rng.pick(ISSUE_IDS)];
      if (rng.chance(0.4)) issues.push(rng.pick(ISSUE_IDS));
      // Action-style yard-sign question — supporters only (visibleIf drops it for
      // everyone else). Most supporters take no action; a few do. Recorded only
      // when an action was taken, so "answered" reflects real follow-through.
      const yardActions = [];
      if (rng.chance(0.18)) yardActions.push('yard_sign_delivered');
      if (rng.chance(0.08)) yardActions.push('candidate_follow_up');
      if (rng.chance(0.05)) yardActions.push('volunteer_request');
      const raw = [
        { questionKey: 'candidate_support', optionIds: [support] },
        { questionKey: 'top_issue', optionIds: [...new Set(issues)] },
      ];
      if (yardActions.length) raw.push({ questionKey: 'yard_sign', optionIds: yardActions });
      const answers = normalizeAndFilterAnswers(template, raw); // drops yard_sign when hidden
      const loc = jitterLocation(rng, hh);
      const [hLng, hLat] = hh.location.coordinates;
      surveys.push({
        filter: { voterId: voter._id, passId },
        fields: {
          organizationId: hh.organizationId,
          campaignId: campaign._id,
          voterId: voter._id,
          householdId: hh._id,
          userId: canvasserId,
          surveyTemplateId: template._id,
          surveyTemplateVersion: template.version || 1,
          answers,
          note: null,
          location: loc,
          distanceFromHouseMeters: Math.round(haversineMeters(hLat, hLng, loc.lat, loc.lng)),
          submittedAt: ts,
          passId,
          turfId,
          effortId: hh.effortId,
          wasOfflineSubmission: wasOffline,
          editedBy: null,
          editedAt: null,
        },
      });
      activities.push(activityDoc({ rng, hh, userId: canvasserId, actionType: 'survey_submitted', ts, passId, turfId, voterId: voter._id, wasOffline }));
    } else {
      const actionType = outcome === 'survey' ? 'not_home' : outcome;
      activities.push(activityDoc({ rng, hh, userId: canvasserId, actionType, ts, passId, turfId, wasOffline }));
      if (actionType === 'not_home' && overlapCandidates.length < 3) {
        overlapCandidates.push({ hh, ts, canvasserId, passId, turfId });
      }
    }
    if (isToday) todayKnocks += 1;
  }

  // Group each canvasser's books, then spread them one-per-day and walk each day
  // on a single running clock — the fix for the "200 doors/hour" collapse.
  const booksByCanvasser = new Map();
  for (const turf of stagedBooks) {
    const cid = String(assignmentsByTurf.get(String(turf._id)));
    if (!cid || cid === 'undefined') continue; // unassigned book — nobody to attribute to
    if (!booksByCanvasser.has(cid)) booksByCanvasser.set(cid, []);
    booksByCanvasser.get(cid).push(turf);
  }

  for (const books of booksByCanvasser.values()) {
    const canvasserId = assignmentsByTurf.get(String(books[0]._id));
    // Assign each of this canvasser's books to a day, taking a partial slice.
    const byDay = new Map();
    books.forEach((turf, i) => {
      const dayOffset = DAY_OFFSETS[i % DAY_OFFSETS.length];
      const allDoors = (turf.householdIds || []).map(String).filter((id) => hhById.has(id));
      const fraction = BOOK_FRACTIONS[i % BOOK_FRACTIONS.length];
      const selected = allDoors.slice(0, Math.round(allDoors.length * fraction));
      if (!byDay.has(dayOffset)) byDay.set(dayOffset, []);
      byDay.get(dayOffset).push({ turf, doorIds: selected });
    });

    for (const [dayOffset, dayBooks] of byDay) {
      const isToday = dayOffset === 0;
      // Evenings ~4:30-5:00pm; today ~9:30am. Early-morning refreshes shrink the
      // window rather than time-travel past "now".
      let minutes = isToday ? 9 * 60 + 30 + rng.int(-30, 30) : 16 * 60 + 30 + rng.int(0, 30);
      if (isToday && minutes >= cutoff) minutes = Math.max(7 * 60, cutoff - rng.int(60, 120));
      const dailyCap = isToday ? rng.int(10, 22) : rng.int(28, 44);
      let staged = 0;
      let done = false;
      for (const { turf, doorIds } of dayBooks) {
        if (done) break;
        for (const hhId of doorIds) {
          if (staged >= dailyCap || (isToday && minutes >= cutoff)) { done = true; break; }
          knockDoor({
            hh: hhById.get(hhId), canvasserId,
            ts: localTime(dayOffset, minutes, tz, now),
            passId: turf.passId, turfId: turf._id, isToday,
          });
          staged += 1;
          minutes += rng.int(2, 5);
        }
      }
    }
  }

  // A couple of same-round overlaps (different canvasser re-knocks a not-home door)
  // for the overlaps card + the timeline's billing reconciliation line. The pool is
  // built from the STAGED books' owners only, so it can never attribute a knock to
  // the reviewer (whose book is never staged) — keeping that account clean.
  const fieldCanvassers = [...new Set(stagedBooks.map((t) => String(assignmentsByTurf.get(String(t._id)))).filter(Boolean))];
  for (const o of overlapCandidates.slice(0, 3)) {
    const others = fieldCanvassers.filter((id) => id !== String(o.canvasserId));
    if (!others.length) break;
    activities.push(activityDoc({
      rng, hh: o.hh, userId: rng.pick(others), actionType: 'not_home',
      ts: new Date(Math.min(o.ts.getTime() + rng.int(30, 90) * 60000, now - 60000)),
      passId: o.passId, turfId: o.turfId,
    }));
  }

  return { activities, surveys, overlaps: Math.min(overlapCandidates.length, 3), todayKnocks };
}

/**
 * Persist a staged day with batched writes (the fix for the H12 timeout). Assumes
 * the caller already wiped the activity layer and reset touched doors to unknocked.
 * Door status is computed IN MEMORY from the generated activities (no per-household
 * DB round-trips), exactly the way resolveStatus maintains it.
 */
export async function persistDemoActivity({ campaign, activities, surveys }) {
  if (activities.length) await CanvassActivity.insertMany(activities, { ordered: false });

  if (surveys.length) {
    // Dedupe on the unique (voterId, passId) key so insertMany can't collide.
    const byKey = new Map();
    for (const s of surveys) byKey.set(`${s.filter.voterId}:${s.filter.passId}`, s.fields);
    await SurveyResponse.insertMany([...byKey.values()], { ordered: false });
  }

  // Group activities per door (drop note_added for parity with the live recompute),
  // resolve status + last action, and persist with ONE bulkWrite.
  const actsByDoor = new Map();
  for (const a of activities) {
    if (a.actionType === 'note_added') continue;
    const k = String(a.householdId);
    if (!actsByDoor.has(k)) actsByDoor.set(k, []);
    actsByDoor.get(k).push(a);
  }
  const ops = [];
  for (const [hhId, acts] of actsByDoor) {
    const status = resolveStatus(campaign.type, acts);
    let last = null;
    for (const a of acts) if (!last || a.timestamp > last.timestamp) last = a;
    ops.push({
      updateOne: {
        filter: { _id: hhId },
        update: { $set: { status, lastActionAt: last.timestamp, lastActionBy: last.userId } },
      },
    });
  }
  if (ops.length) await Household.bulkWrite(ops);

  if (surveys.length) {
    await Voter.updateMany(
      { _id: { $in: surveys.map((s) => s.filter.voterId) } },
      { $set: { surveyStatus: 'surveyed' } }
    );
  }
}
