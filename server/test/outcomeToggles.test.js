import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The toggleable/always-on outcome split is a hand-maintained mirror across the two clients:
//   client/src/lib/outcomeToggles.js   (web Door Outcomes page)
//   mobile/lib/outcomeToggles.js       (mobile admin Door Outcomes screen)
// This is the gate that keeps them honest, the same way actionLabels.test.js keeps the label
// maps honest. All three files are plain ESM with no React/RN imports, so they load in node.
// Runs under plain `npm test` (no DB, no app boot).
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../../client/src/lib/outcomeToggles.js');
const MOBILE = path.resolve(here, '../../mobile/lib/outcomeToggles.js');

const web = await import(WEB);
const mobile = await import(MOBILE);
const server = await import('../src/services/canvass/outcomeToggles.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Campaign } = await import('../src/models/Campaign.js');

// Read straight off the schema rather than hand-listed — a hand-listed copy would just be
// another mirror to drift.
const ACTION_TYPES = CanvassActivity.schema.path('actionType').enumValues;

const CLASSES = {
  toggleable: server.TOGGLEABLE_OUTCOMES,
  optIn: server.OPT_IN_OUTCOMES,
  alwaysOn: server.ALWAYS_ON_OUTCOMES,
};

test('every toggleable, opt-in and always-on outcome is a real actionType', () => {
  for (const k of Object.values(CLASSES).flat()) {
    assert.ok(ACTION_TYPES.includes(k), `'${k}' is not in the CanvassActivity actionType enum`);
  }
});

test('every door actionType is in exactly ONE class — an unclassified outcome cannot slip through', () => {
  // Before the opt-in class existed this only asserted the lists were disjoint, so an outcome in
  // NEITHER list passed every test — and an unclassified outcome is one no gate knows about.
  for (const k of ACTION_TYPES.filter((a) => a !== 'note_added')) {
    const homes = Object.entries(CLASSES).filter(([, list]) => list.includes(k)).map(([name]) => name);
    assert.strictEqual(homes.length, 1, `'${k}' is in ${homes.length} classes (${homes.join(', ') || 'none'})`);
  }
});

test('Campaign.disabledOutcomes element enum IS the toggleable list', () => {
  // Read off the schema path, never hand-listed: if the model and the constant ever disagree,
  // zod and mongoose would accept different sets and the write path would 500 on the gap.
  // Also the guard that an opt-in outcome can never be stored in the DENY-list, where every
  // campaign's [] would read it as ON.
  const elementEnum = Campaign.schema.path('disabledOutcomes').caster.enumValues;
  assert.deepStrictEqual([...elementEnum].sort(), [...server.TOGGLEABLE_OUTCOMES].sort());
});

test('Campaign.enabledOutcomes and everEnabledOutcomes element enums ARE the opt-in list', () => {
  for (const field of ['enabledOutcomes', 'everEnabledOutcomes']) {
    const elementEnum = Campaign.schema.path(field).caster.enumValues;
    assert.deepStrictEqual([...elementEnum].sort(), [...server.OPT_IN_OUTCOMES].sort(), field);
  }
});

test('web and mobile mirrors match the server exactly', () => {
  for (const m of [web, mobile]) {
    assert.deepStrictEqual([...m.TOGGLEABLE_OUTCOMES], [...server.TOGGLEABLE_OUTCOMES]);
    assert.deepStrictEqual([...m.OPT_IN_OUTCOMES], [...server.OPT_IN_OUTCOMES]);
    assert.deepStrictEqual([...m.ALWAYS_ON_OUTCOMES], [...server.ALWAYS_ON_OUTCOMES]);
  }
});

test('both clients hint every toggleable outcome, identically', () => {
  assert.deepStrictEqual(
    web.OUTCOME_HINTS,
    mobile.OUTCOME_HINTS,
    'client/src/lib/outcomeToggles.js and mobile/lib/outcomeToggles.js have drifted — the same toggle would explain itself differently depending on the device'
  );
  assert.deepStrictEqual(
    Object.keys(web.OUTCOME_HINTS).sort(),
    [...server.TOGGLEABLE_OUTCOMES, ...server.OPT_IN_OUTCOMES].sort()
  );
});

// --- The opt-in rule, on all three copies -------------------------------------------------------

const survey = (over = {}) => ({ type: 'survey', disabledOutcomes: [], enabledOutcomes: [], everEnabledOutcomes: [], ...over });
const RELEASED = ['not_target'];

test('an opt-in outcome is on only when released, on a survey campaign, and turned on', () => {
  const on = survey({ enabledOutcomes: ['not_target'], everEnabledOutcomes: ['not_target'] });
  assert.strictEqual(server.isOutcomeEnabled(on, 'not_target', RELEASED), true);
  assert.strictEqual(server.isOutcomeEnabled(on, 'not_target', []), false, 'unreleased (or withdrawn) reads off');
  assert.strictEqual(server.isOutcomeEnabled({ ...on, type: 'lit_drop' }, 'not_target', RELEASED), false, 'survey campaigns only');
  assert.strictEqual(server.isOutcomeEnabled(survey(), 'not_target', RELEASED), false, 'default off');
  assert.strictEqual(server.isOutcomeEnabled({ type: 'survey' }, 'not_target', RELEASED), false, 'a legacy doc with no field reads off');
  // The deny-list keeps its meaning for the toggleable class, and always-on stays on.
  assert.strictEqual(server.isOutcomeEnabled(survey(), 'refused', []), true);
  assert.strictEqual(server.isOutcomeEnabled(survey({ disabledOutcomes: ['refused'] }), 'refused', []), false);
  assert.strictEqual(server.isOutcomeEnabled(survey({ disabledOutcomes: ['refused'] }), 'not_home', []), true);
});

test('the release gate reads the OPT_IN_OUTCOMES config var at call time and ignores unknown keys', () => {
  const saved = process.env.OPT_IN_OUTCOMES;
  try {
    delete process.env.OPT_IN_OUTCOMES;
    assert.deepStrictEqual(server.availableOptInOutcomes(), []);
    process.env.OPT_IN_OUTCOMES = ' not_target , refused, bogus ';
    assert.deepStrictEqual(server.availableOptInOutcomes(), ['not_target'], 'only opt-in keys can be released');
  } finally {
    if (saved === undefined) delete process.env.OPT_IN_OUTCOMES;
    else process.env.OPT_IN_OUTCOMES = saved;
  }
});

test('ever-enabled and in-use: once on, always in use — never because of the release', () => {
  assert.strictEqual(server.outcomeEverEnabled(survey(), 'not_target'), false);
  assert.strictEqual(server.outcomeEverEnabled(survey({ everEnabledOutcomes: ['not_target'] }), 'not_target'), true);
  assert.strictEqual(server.outcomeEverEnabled(survey({ enabledOutcomes: ['not_target'] }), 'not_target'), true, 'on right now counts');
  assert.strictEqual(server.outcomeEverEnabled(survey(), 'refused'), true, 'a toggleable outcome was always showable');
  for (const m of [server, web, mobile]) {
    assert.strictEqual(m.outcomeInUse(survey(), 'not_target'), false);
    assert.strictEqual(m.outcomeInUse(survey({ everEnabledOutcomes: ['not_target'] }), 'not_target'), true);
  }
});

test('the web mirror answers exactly what the server answers', () => {
  const cases = [
    survey(),
    survey({ enabledOutcomes: ['not_target'] }),
    { ...survey({ enabledOutcomes: ['not_target'] }), type: 'lit_drop' },
    survey({ disabledOutcomes: ['refused', 'restricted'] }),
    { type: 'survey' },
  ];
  for (const c of cases) {
    for (const available of [[], RELEASED]) {
      for (const key of ACTION_TYPES.filter((a) => a !== 'note_added')) {
        assert.strictEqual(web.isOutcomeEnabled(c, key, available), server.isOutcomeEnabled(c, key, available), `${key} ${JSON.stringify(c)} ${available}`);
      }
    }
  }
});

test('the phone gate fails CLOSED: a bootstrap without the field never shows an opt-in button', () => {
  // The bootstrap ships enabledOutcomes already narrowed (released, survey, on), so the phone reads
  // the list as-is — but anything missing must read OFF, never the deny-list's "unlisted means on".
  assert.strictEqual(mobile.isOutcomeOn({ type: 'survey' }, 'not_target'), false, 'older server: no field');
  assert.strictEqual(mobile.isOutcomeOn({ type: 'survey', enabledOutcomes: [] }, 'not_target'), false);
  assert.strictEqual(mobile.isOutcomeOn({ type: 'survey', enabledOutcomes: ['not_target'] }, 'not_target'), true);
  assert.strictEqual(mobile.isOutcomeOn({ type: 'lit_drop', enabledOutcomes: ['not_target'] }, 'not_target'), false);
  assert.strictEqual(mobile.isOutcomeOn(undefined, 'not_target'), false, 'no bootstrap at all');
  assert.strictEqual(mobile.isOutcomeOn({ type: 'survey' }, 'refused'), true, 'toggleable: unlisted means on');
  assert.strictEqual(mobile.isOutcomeOn({ type: 'survey', disabledOutcomes: ['refused'] }, 'refused'), false);
});

test('the door-config stamp is stable, order-blind, and moves on every setting a door screen reads', () => {
  const base = survey({ disabledOutcomes: ['restricted', 'refused'], enabledOutcomes: ['not_target'], doorAddPolicy: 'leads' });
  const stamp = server.doorConfigStamp(base, RELEASED);
  assert.strictEqual(stamp, server.doorConfigStamp({ ...base, disabledOutcomes: ['refused', 'restricted'] }, RELEASED), 'order-blind');
  assert.notStrictEqual(stamp, server.doorConfigStamp(base, []), 'a withdrawal changes it');
  assert.notStrictEqual(stamp, server.doorConfigStamp({ ...base, enabledOutcomes: [] }, RELEASED));
  assert.notStrictEqual(stamp, server.doorConfigStamp({ ...base, disabledOutcomes: [] }, RELEASED));
  assert.notStrictEqual(stamp, server.doorConfigStamp({ ...base, doorAddPolicy: 'all' }, RELEASED));
  assert.strictEqual(server.doorConfigStamp({ type: 'survey' }, RELEASED), '||all', 'a legacy doc has a stamp too');
  // It contains '|' — the client MUST encode it (a raw '|' breaks every poll on iOS 15/16).
  assert.strictEqual(decodeURIComponent(encodeURIComponent(stamp)), stamp);
});
