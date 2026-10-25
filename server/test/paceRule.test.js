import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  PACE_DEFAULTS,
  paceConfig,
  historyFor,
  historyEntryOf,
  entriesOf,
  visitsOf,
  judgeVisits,
  findPause,
  replayPauses,
  countsAfter,
  summarize,
  HISTORY_CAP,
  previewRowCap,
  PREVIEW_ROW_CAP_DEFAULT,
} from '../src/services/audit/paceRule.js';
import { zonedDayStr } from '../src/utils/timezone.js';

// Pure tests of the automatic-pause rule (docs/PROPOSAL_PACE_PAUSE.md §B, §K). No DB. Rows are lean
// CanvassActivity-shaped docs. The two fixtures are real activity exports, anonymized (§K.2): A logged
// doors from a car on its second and third days; B is an honest canvasser.

const C = PACE_DEFAULTS;
const BASE = new Date('2026-07-01T16:00:00Z').getTime();
const at = (sec) => new Date(BASE + sec * 1000);

let counter = 0;
const row = (o) => ({
  _id: o._id || `r${++counter}`,
  householdId: o.householdId || 'h',
  campaignId: o.campaignId || 'c',
  actionType: o.actionType || 'not_home',
  timestamp: o.timestamp,
  createdAt: o.createdAt ?? o.timestamp,
  location: o.location || { lat: 30, lng: -95, accuracy: 5 },
  wasOfflineSubmission: o.wasOfflineSubmission ?? false,
  replaced: o.replaced ?? null,
  ...(o.via ? { via: o.via } : {}),
  ...(o.knockPin ? { knockPin: o.knockPin } : {}),
  ...(o.reclassified ? { reclassified: o.reclassified } : {}),
});

// A point `meters` east of (30, -95).
const east = (meters, accuracy = 5) => ({ lat: 30, lng: -95 + meters / (111320 * Math.cos((30 * Math.PI) / 180)), accuracy });

const judgeRows = (rows, { households, config = C } = {}) => {
  const entries = entriesOf(rows);
  return judgeVisits(visitsOf(entries, config), entries, { households, config });
};

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────
// The export carries the replaced entry's time and result but not its GPS reading, so a fixture's history
// entry borrows the standing row's reading (fixture only; the server stores replaced.location).
const loadFixture = (name) => {
  const data = JSON.parse(readFileSync(new URL(`./fixtures/pace/${name}`, import.meta.url), 'utf8'));
  const rows = data.rows.map((r, i) => {
    const location = { lat: r.lat, lng: r.lng, accuracy: r.acc };
    return row({
      _id: `f${i}`,
      householdId: `door-${r.door}`,
      actionType: r.action,
      timestamp: new Date(r.t),
      createdAt: new Date(r.t),
      location,
      wasOfflineSubmission: r.offline,
      replaced: r.replacedAt
        ? { timestamp: new Date(r.replacedAt), actionType: r.replacedAction, location }
        : null,
    });
  });
  const households = new Map(data.rows.map((r) => [`door-${r.door}`, { addressLine1: `${r.door} Fixture Rd`, addressLine2: r.unit ? 'Unit 1' : null }]));
  return { rows, households, timeZone: data.timeZone };
};

// The preview's shape (§I.1): judge every row once, bucket visits by their first entry's day, replay each day.
const replayByDay = ({ rows, households, timeZone }, config = C) => {
  const verdicts = judgeRows(rows, { households, config });
  const days = new Map();
  for (const v of verdicts) {
    const d = zonedDayStr(new Date(v.visit.first.at), timeZone);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(v);
  }
  const standingByDay = new Map();
  for (const r of [...rows].sort((a, b) => a.timestamp - b.timestamp)) {
    const d = zonedDayStr(r.timestamp, timeZone);
    if (!standingByDay.has(d)) standingByDay.set(d, []);
    standingByDay.get(d).push(String(r._id));
  }
  const out = {};
  for (const [d, vs] of days) {
    const { pauses, worst } = replayPauses(vs, config);
    const first = pauses[0];
    out[d] = {
      pauses: pauses.length,
      worst,
      firstAt: first ? new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(first.trigger.visit.first.at)) : null,
      firstEntry: first ? standingByDay.get(d).indexOf(first.trigger.visit.standingRowId) + 1 : null,
      firstWindow: first?.window ?? null,
    };
  }
  return out;
};

test('fixture A (car canvasser): pauses on both car days at the moments the owner saw, never on the honest day', () => {
  const days = replayByDay(loadFixture('pace-fixture-a.json'));
  // Day 1 (the honest day): never comes close.
  assert.equal(days['2026-08-22'].pauses, 0);
  assert.equal(days['2026-08-22'].worst, 1);
  // Day 2 (car): paused within its first 20 entries — at 13:10:03 local, on entry 17.
  assert.equal(days['2026-08-27'].firstAt, '13:10:03');
  assert.equal(days['2026-08-27'].firstEntry, 17);
  assert.ok(days['2026-08-27'].firstEntry <= 20);
  // Day 3 (car, rural): later, at 17:07:58 on entry 42.
  assert.equal(days['2026-08-28'].firstAt, '17:07:58');
  assert.equal(days['2026-08-28'].firstEntry, 42);
  // The pattern behind the first pause: mostly vehicle speed.
  const s = summarize(days['2026-08-27'].firstWindow);
  assert.equal(s.fails, 8);
  assert.equal(s.vehicle, 6);
  assert.equal(s.still, 1);
  assert.equal(s.walking, 1);
});

test('fixture B (honest canvasser): never pauses on any of its four days', () => {
  const days = replayByDay(loadFixture('pace-fixture-b.json'));
  assert.deepEqual(Object.keys(days).sort(), ['2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26']);
  for (const [d, r] of Object.entries(days)) {
    assert.equal(r.pauses, 0, d);
    assert.ok(r.worst <= 1, `${d} worst ${r.worst}`);
  }
});

// ── Visits ───────────────────────────────────────────────────────────────────────────────────────────
// A walking canvasser's previous door, 60 m away, 60 s earlier: never a fail on its own.
const prior = () => row({ householdId: 'p', timestamp: at(0), location: east(0) });

test('two voters surveyed at one door are one visit, judged once', () => {
  const v1 = { timestamp: at(120), location: east(60), actionType: 'survey_submitted' };
  const r = row({ householdId: 'd', timestamp: at(150), location: east(60), actionType: 'survey_submitted', replaced: { history: [historyEntryOf(row({ householdId: 'd', ...v1 }))] } });
  const verdicts = judgeRows([prior(), r]).filter((v) => v.judged && v.prev);
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].at, at(120).getTime()); // judged at the first voter's save
  assert.equal(verdicts[0].fail, false);
});

test('saving a door twice from a car is judged at the first save (the round-1 dodge)', () => {
  // Previous door 120 m away, 10 s earlier: impossible. The second save 3 s later replaces the first.
  const first = row({ householdId: 'd', timestamp: at(10), location: east(120) });
  const second = row({ householdId: 'd', timestamp: at(13), location: east(120), replaced: { history: historyFor(first) } });
  const v = judgeRows([prior(), second]).find((x) => x.judged && x.prev);
  assert.equal(v.at, at(10).getTime());
  assert.equal(v.fail, true);
});

test('a callback after 10 minutes is a new visit, and a correction to the callback cannot erase the first visit (the round-2 dodge)', () => {
  // V1 from the car (fails), V3 eleven minutes later starts a new visit, V4 corrects V3 three seconds later.
  const v1 = row({ householdId: 'd', timestamp: at(10), location: east(120) });
  const v3 = row({ householdId: 'd', timestamp: at(10 + 660), location: east(120), replaced: { history: historyFor(v1) } });
  const v4 = row({ householdId: 'd', timestamp: at(10 + 663), location: east(120), replaced: { history: historyFor(v3) } });
  assert.equal(v4.replaced.history.length, 2); // both earlier saves survive on the standing row
  const verdicts = judgeRows([prior(), v4]).filter((x) => x.judged && x.prev);
  assert.equal(verdicts.length, 2); // the car visit and the callback visit
  assert.equal(verdicts[0].at, at(10).getTime());
  assert.equal(verdicts[0].fail, true);
});

test('two rows at one door with no snapshot link (racing writes) are still one visit', () => {
  const a = row({ householdId: 'd', timestamp: at(100), location: east(60) });
  const b = row({ householdId: 'd', timestamp: at(102), location: east(60), actionType: 'refused' });
  const verdicts = judgeRows([prior(), a, b]).filter((x) => x.judged && x.prev);
  assert.equal(verdicts.length, 1);
});

test('Wrong address corrected to Not home is judged at the Wrong address tap', () => {
  const wa = row({ householdId: 'd', timestamp: at(8), location: east(120), actionType: 'wrong_address' });
  const nh = row({ householdId: 'd', timestamp: at(14), location: east(120), replaced: { history: historyFor(wa) } });
  const v = judgeRows([prior(), nh]).find((x) => x.judged && x.prev);
  assert.equal(v.at, at(8).getTime());
  assert.equal(v.fail, true);
});

// ── Check 2: a survey later in a visit ───────────────────────────────────────────────────────────────
test('Not home tapped after the knock, then a survey saved minutes later when someone answers, passes', () => {
  // Walked 40 m in 31 s, knocked, waited, tapped Not home; surveyed 2 minutes later.
  const nh = row({ householdId: 'd', timestamp: at(45), location: east(40) });
  const sv = row({ householdId: 'd', timestamp: at(165), location: east(40), actionType: 'survey_submitted', replaced: { history: historyFor(nh) } });
  const v = judgeRows([prior(), sv]).find((x) => x.judged && x.prev);
  assert.equal(v.fail, false);
  assert.equal(v.surveyCheck.fail, false);
});

test('Not home from a car, then a survey saved seconds later, fails on the survey check', () => {
  // 100 m in 25 s: possible as a Not home (100/11.2 + 15 = 23.9 s), impossible for a survey (53.9 s).
  const nh = row({ householdId: 'd', timestamp: at(25), location: east(100) });
  const sv = row({ householdId: 'd', timestamp: at(33), location: east(100), actionType: 'survey_submitted', replaced: { history: historyFor(nh) } });
  const v = judgeRows([prior(), sv]).find((x) => x.judged && x.prev);
  assert.equal(v.surveyCheck.fail, true);
  assert.equal(v.fail, true);
});

test('a visit whose first save is a survey needs 45 seconds', () => {
  const ok = judgeRows([prior(), row({ householdId: 'd', timestamp: at(60), location: east(60), actionType: 'survey_submitted' })]).find((x) => x.prev);
  const bad = judgeRows([prior(), row({ householdId: 'd', timestamp: at(40), location: east(60), actionType: 'survey_submitted' })]).find((x) => x.prev);
  assert.equal(ok.fail, false);
  assert.equal(bad.fail, true);
});

// ── What is and isn't judged ─────────────────────────────────────────────────────────────────────────
test('units and condo-complex homes are never judged', () => {
  const households = new Map([['apt', { addressLine1: '10 Main St', addressLine2: 'Apt 3' }], ['line1', { addressLine1: '12 Main St Unit 4' }]]);
  const rows = [prior(), row({ householdId: 'apt', timestamp: at(2), location: east(5) }), row({ householdId: 'line1', timestamp: at(4), location: east(9) }), row({ householdId: 'cx', timestamp: at(6), location: east(12), knockPin: 'complex' })];
  const verdicts = judgeRows(rows, { households });
  for (const id of ['apt', 'line1', 'cx']) {
    const v = verdicts.find((x) => x.visit.householdId === id);
    assert.equal(v.judged, false, id);
    assert.equal(v.why, 'unit', id);
  }
});

test('skipped results are not judged but are the next door\'s predecessor', () => {
  // A Wrong address at door b, then a Not home at c 5 s later and 50 m away: c fails against b.
  const rows = [prior(), row({ householdId: 'b', timestamp: at(60), location: east(50), actionType: 'wrong_address' }), row({ householdId: 'c', timestamp: at(65), location: east(100) })];
  const verdicts = judgeRows(rows);
  assert.equal(verdicts.find((x) => x.visit.householdId === 'b').judged, false);
  const c = verdicts.find((x) => x.visit.householdId === 'c');
  assert.equal(c.prev.householdId, 'b');
  assert.equal(c.fail, true);
});

test('notes and desk marks are not entries at all', () => {
  const rows = [prior(), row({ householdId: 'n', timestamp: at(55), location: east(400), actionType: 'note_added' }), row({ householdId: 'k', timestamp: at(57), location: east(400), actionType: 'restricted', via: 'bulk' }), row({ householdId: 'c', timestamp: at(60), location: east(60) })];
  const c = judgeRows(rows).find((x) => x.visit.householdId === 'c');
  assert.equal(c.prev.householdId, 'p');
  assert.equal(c.fail, false);
});

test('Not a target voter is judged like Refused; the original result is read through reclassified.from', () => {
  const nt = judgeRows([prior(), row({ householdId: 'd', timestamp: at(5), location: east(80), actionType: 'not_target' })]).find((x) => x.prev);
  assert.equal(nt.judged, true);
  assert.equal(nt.fail, true);
  // An admin later converted a car Not home to Restricted on Door Outcomes: still judged as Not home.
  const conv = judgeRows([prior(), row({ householdId: 'd', timestamp: at(5), location: east(80), actionType: 'restricted', reclassified: { from: 'not_home' } })]).find((x) => x.prev);
  assert.equal(conv.judged, true);
});

// ── Restarts and windows ─────────────────────────────────────────────────────────────────────────────
// A day of doors after an anchor door (the day's first door has nothing to be compared with): `fast` ones
// 120 m in 8 s (fail), the rest 30 m in 50 s (pass).
const day = (pattern, { start = 0, createdShift = 0, offline = false } = {}) => {
  const anchor = at(start);
  const rows = [row({ householdId: `a${start}`, timestamp: anchor, createdAt: new Date(anchor.getTime() + createdShift * 1000), location: east(0), wasOfflineSubmission: offline })];
  let t = start;
  let x = 0;
  pattern.forEach((fast, i) => {
    t += fast ? 8 : 50;
    x += fast ? 120 : 30;
    const ts = at(t);
    rows.push(row({ householdId: `d${start}-${i}`, timestamp: ts, createdAt: new Date(ts.getTime() + createdShift * 1000), location: east(x), wasOfflineSubmission: offline }));
  });
  return rows;
};

test('8 fails in a run of 20 pause; 7 do not', () => {
  const eight = judgeRows(day([...Array(12).fill(false), ...Array(8).fill(true)]));
  const seven = judgeRows(day([...Array(13).fill(false), ...Array(7).fill(true)]));
  assert.ok(findPause(eight));
  assert.equal(findPause(seven), null);
});

test('any run of 20 is checked, not only the latest (a late batch from a stuck queue)', () => {
  const verdicts = judgeRows(day([...Array(8).fill(true), ...Array(40).fill(false)]));
  const p = findPause(verdicts);
  assert.ok(p);
  assert.equal(p.fails, 8);
});

test('the count restarts after an unpause: old fails never re-pause, by server time for live entries', () => {
  const rows = day([...Array(8).fill(true), ...Array(30).fill(false)]);
  const verdicts = judgeRows(rows);
  const restartAt = rows[9].createdAt.getTime(); // unpaused after the car run
  assert.equal(findPause(verdicts, { restartAt }), null);
});

test('a phone clock set a day ahead or back cannot move live entries across the restart', () => {
  // Tap times a day ahead, server receive times true: after the restart, the fails still count.
  const ahead = day(Array(8).fill(true), { start: 86400, createdShift: -86400 + 10000 });
  const restartAt = at(5000).getTime();
  assert.ok(findPause(judgeRows(ahead), { restartAt }));
  // Tap times a day back, received after the restart: still counted (by createdAt).
  const back = day(Array(8).fill(true), { start: -86400, createdShift: 86400 + 10000 });
  assert.ok(findPause(judgeRows(back), { restartAt }));
});

test('replays are compared by tap time, so doors from before an unpause uploaded later never count', () => {
  // Tapped before the unpause (offline), received after it.
  const late = day(Array(8).fill(true), { createdShift: 7200, offline: true });
  const restartAt = at(3600).getTime();
  assert.equal(findPause(judgeRows(late), { restartAt }), null);
  assert.equal(countsAfter({ visit: { first: { at: 100, createdAt: 9e12, offline: true } } }, 1000), false);
  assert.equal(countsAfter({ visit: { first: { at: 100, createdAt: 9e12, offline: false } } }, 1000), true);
});

test('the preview lifts each would-be pause at once and keeps counting', () => {
  const verdicts = judgeRows(day([...Array(8).fill(true), ...Array(5).fill(false), ...Array(8).fill(true)]));
  const { pauses, worst } = replayPauses(verdicts);
  assert.equal(pauses.length, 2);
  assert.equal(worst, 8);
});

test('two saves at the same instant at different doors keep row order (the tie-break)', () => {
  const t = at(30);
  const verdicts = judgeRows([prior(), row({ householdId: 'a', timestamp: t, location: east(20) }), row({ householdId: 'b', timestamp: t, location: east(40) })]);
  const b = verdicts.find((x) => x.visit.householdId === 'b');
  assert.equal(b.prev.householdId, 'a');
  assert.equal(b.gapSec, 0);
  assert.equal(b.fail, true);
});

// ── History and config ───────────────────────────────────────────────────────────────────────────────
test('history carries every earlier save, capped, and turns a legacy one-level snapshot into one entry', () => {
  let r = row({ householdId: 'd', timestamp: at(0) });
  for (let i = 1; i <= 25; i++) r = row({ householdId: 'd', timestamp: at(i), replaced: { history: historyFor(r) } });
  assert.equal(r.replaced.history.length, HISTORY_CAP);
  assert.equal(new Date(r.replaced.history[HISTORY_CAP - 1].at).getTime(), at(24).getTime());
  const legacy = row({ householdId: 'd', timestamp: at(9), replaced: { timestamp: at(3), actionType: 'refused', location: east(1) } });
  const h = historyFor(legacy);
  assert.equal(h.length, 2);
  assert.equal(h[0].actionType, 'refused');
  assert.equal(h[0].createdAt, null);
  assert.equal(historyEntryOf(row({ timestamp: at(1), actionType: 'restricted', reclassified: { from: 'not_home' } })).actionType, 'not_home');
});

test('config falls back to the defaults on unusable values and honors good ones', () => {
  const cfg = paceConfig({ PACE_DOOR_SEC: 'abc', PACE_WINDOW: '20.5', PACE_SURVEY_SEC: '50', PACE_FAILS_TO_PAUSE: '-1' });
  assert.equal(cfg.doorSec, 15);
  assert.equal(cfg.window, 20);
  assert.equal(cfg.surveySec, 50);
  assert.equal(cfg.failsToPause, 8);
  assert.equal(paceConfig({}, { doorSec: 30 }).doorSec, 30);
});

// ── Simulated days (§K.3) ────────────────────────────────────────────────────────────────────────────
// A seeded random walk, so the run is identical every time.
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const stepFrom = (rand, p, meters) => {
  const a = rand() * 2 * Math.PI;
  return { lat: p.lat + (meters * Math.cos(a)) / 111320, lng: p.lng + (meters * Math.sin(a)) / (111320 * Math.cos((p.lat * Math.PI) / 180)) };
};

const honestDay = (rand, waitSec, answerRate) => {
  let t = 0;
  let pos = { lat: 30, lng: -90 };
  const rows = [];
  for (let d = 1; d <= 120; d++) {
    const hopM = 15 + rand() * 30;
    pos = stepFrom(rand, pos, hopM);
    t += hopM / 1.3 + waitSec;
    const nh = row({ householdId: `h${d}`, timestamp: at(t), location: { ...stepFrom(rand, pos, rand() * 4), accuracy: 5 + rand() * 5 } });
    if (rand() < answerRate) {
      t += 60 + rand() * 120;
      rows.push(row({ householdId: `h${d}`, timestamp: at(t), actionType: 'survey_submitted', location: { ...stepFrom(rand, pos, rand() * 4), accuracy: 5 + rand() * 5 }, replaced: { history: historyFor(nh) } }));
    } else rows.push(nh);
  }
  return rows;
};

const carDay = (rand, { fakeSurveys = false, eraseLater = false } = {}) => {
  let t = 0;
  let pos = { lat: 30, lng: -90 };
  const rows = [];
  const firsts = [];
  for (let d = 1; d <= 60; d++) {
    const hopM = 40 + rand() * 80;
    pos = stepFrom(rand, pos, hopM);
    t += hopM / (3.6 + rand() * 3);
    const nh = row({ householdId: `h${d}`, timestamp: at(t), location: { ...pos, accuracy: 5 } });
    if (fakeSurveys && d % 3 === 0) {
      t += 5 + rand() * 10;
      rows.push(row({ householdId: `h${d}`, timestamp: at(t), actionType: 'survey_submitted', location: { ...pos, accuracy: 5 }, replaced: { history: historyFor(nh) } }));
    } else if (eraseLater) firsts.push(nh);
    else rows.push(nh);
    if (eraseLater && d % 7 === 0) {
      // Eleven minutes later, re-save each of the last 7 doors twice, 3 s apart, from a parked spot.
      t += 660;
      for (const f of firsts.splice(0)) {
        const a = row({ householdId: f.householdId, timestamp: at((t += 2)), location: { ...pos, accuracy: 5 }, replaced: { history: historyFor(f) } });
        rows.push(row({ householdId: f.householdId, timestamp: at((t += 3)), location: { ...pos, accuracy: 5 }, replaced: { history: historyFor(a) } }));
      }
    }
  }
  return rows;
};

test('simulated honest days with Not home first and surveys minutes later are never paused', () => {
  const rand = rng(7);
  for (const [wait, answer] of [[10, 0.25], [10, 0.4], [20, 0.4]]) {
    for (let i = 0; i < 60; i++) {
      assert.equal(replayPauses(judgeRows(honestDay(rand, wait, answer))).pauses.length, 0, `wait ${wait} answer ${answer} day ${i}`);
    }
  }
});

test('simulated car cheats are always paused, with fake surveys and with re-saves to erase doors', () => {
  const rand = rng(11);
  for (const opts of [{}, { fakeSurveys: true }, { eraseLater: true }]) {
    for (let i = 0; i < 60; i++) {
      assert.ok(replayPauses(judgeRows(carDay(rand, opts))).pauses.length > 0, `${JSON.stringify(opts)} day ${i}`);
    }
  }
});

test('the preview size limit: a whole number of at least 1, else the default — a typo never lifts it', () => {
  assert.equal(PREVIEW_ROW_CAP_DEFAULT, 150000);
  assert.equal(previewRowCap({}), 150000, 'unset');
  assert.equal(previewRowCap({ PACE_PREVIEW_ROW_CAP: '' }), 150000, 'empty');
  assert.equal(previewRowCap({ PACE_PREVIEW_ROW_CAP: '1' }), 1, 'the off switch: every range refuses');
  assert.equal(previewRowCap({ PACE_PREVIEW_ROW_CAP: '200000' }), 200000);
  for (const bad of ['0', '-5', '2.5', 'abc', 'Infinity', '1e9x']) {
    assert.equal(previewRowCap({ PACE_PREVIEW_ROW_CAP: bad }), 150000, bad);
  }
});
