import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  andList,
  orgConfirmKind,
  onCampaignIds,
  historyByCampaign,
  prePickFor,
  pickCount,
  picksBody,
  submitLabel,
  coordinatorNames,
  campaignLines,
  orgDoneView,
  profileDoneView,
  removeQuestion,
} from './addToCampaigns.js';

const DANA = { id: 'd1', firstName: 'Dana', lastName: 'Cruz', role: 'lead' };
const SAM = { id: 's1', firstName: 'Sam', lastName: 'Lee', role: 'admin' };
const names = coordinatorNames([DANA, SAM]);

test('the step follows what the address turned out to be', () => {
  assert.equal(orgConfirmKind({ outcome: 'outside' }), 'new');
  assert.equal(orgConfirmKind({ outcome: 'in-org' }), 'colleague');
  assert.equal(orgConfirmKind({ outcome: 'in-org-inactive' }), 'switched-off');
  assert.equal(orgConfirmKind({ outcome: 'on-campaign' }), 'unknown');
  assert.equal(orgConfirmKind(null), 'unknown');
});

test('campaigns they are on are locked; history is keyed by campaign', () => {
  const rows = [
    { campaignId: 'a', onCampaign: true, history: { doors: 0, sources: [] } },
    { campaignId: 'b', onCampaign: false, history: { doors: 4, sources: [] } },
  ];
  assert.deepEqual([...onCampaignIds(rows)], ['a']);
  assert.equal(historyByCampaign(rows).get('b').doors, 4);
  assert.equal(historyByCampaign(rows).get('c'), undefined);
});

test('a checked campaign starts on the newest team whose coordinator can still lead and is offered', () => {
  const history = {
    doors: 9,
    sources: [
      { coordinatorId: 'gone', canLead: false, doors: 2 },
      { coordinatorId: 'd1', canLead: true, doors: 5 },
      { coordinatorId: null, canLead: false, doors: 2 },
    ],
  };
  assert.equal(prePickFor(history, ['d1', 's1']), 'd1');
  assert.equal(prePickFor(history, ['s1']), '', 'not offered → No crew');
  assert.equal(prePickFor(null, ['d1']), '');
});

test('the picks go out in list order, with No crew as null', () => {
  const picks = { c: 'd1', a: '' };
  assert.equal(pickCount(picks), 2);
  assert.deepEqual(picksBody(picks, ['a', 'b', 'c']), [
    { campaignId: 'a', coordinatorId: null },
    { campaignId: 'c', coordinatorId: 'd1' },
  ]);
  assert.deepEqual(picksBody({}, ['a']), []);
});

test('the main button says what it will do', () => {
  assert.equal(submitLabel('new', { n: 2, role: 'canvasser' }), 'Create & add to 2 campaigns');
  assert.equal(submitLabel('new', { n: 0, role: 'canvasser' }), 'Create');
  assert.equal(submitLabel('new', { n: 3, role: 'admin' }), 'Create', 'an admin gets no campaign list');
  assert.equal(submitLabel('colleague', { n: 1 }), 'Add to 1 campaign');
  assert.equal(submitLabel('colleague', { n: 0 }), 'Add to campaigns');
  assert.equal(submitLabel('switched-off', { n: 0 }), 'Switch on');
  assert.equal(submitLabel('switched-off', { n: 2 }), 'Switch on & add to 2 campaigns');
  assert.equal(submitLabel('profile', { n: 4 }), 'Add to 4 campaigns');
  assert.equal(submitLabel('unknown'), null);
});

test('lists read as English', () => {
  assert.equal(andList([]), '');
  assert.equal(andList(['A']), 'A');
  assert.equal(andList(['A', 'B']), 'A and B');
  assert.equal(andList(['A', 'B', 'C']), 'A, B and C');
});

const created = {
  user: { firstName: 'Jane', lastName: 'Doe', email: 'jane@t.co' },
  outcome: 'created',
  attached: false,
  role: 'canvasser',
  campaigns: [
    { campaignId: 'a', campaignName: 'Fall Canvass', coordinatorId: 'd1', result: 'joined', restamp: { doors: 0 } },
    { campaignId: 'b', campaignName: 'Riverside Turnout', coordinatorId: null, result: 'joined', restamp: { doors: 0 } },
  ],
};

test('a new person on two campaigns', () => {
  const v = orgDoneView(created, { crewNameById: names });
  assert.equal(v.title, 'Added');
  assert.deepEqual(v.lines, [
    'Jane Doe is in your organization, on Fall Canvass and Riverside Turnout.',
    'They’ve been emailed a link to set their own password.',
  ]);
  assert.equal(v.first, 'Jane');
});

test('a new canvasser on no campaign is told the app will look empty, an admin is not', () => {
  const canvasser = orgDoneView({ ...created, campaigns: [] });
  assert.ok(canvasser.lines.includes('Jane isn’t on any campaign yet, so the app won’t show them one. You can add them to one later from Users.'));
  const admin = orgDoneView({ ...created, role: 'admin', campaigns: [] });
  assert.ok(!admin.lines.some((l) => l.includes('isn’t on any campaign')));
});

test('an attached account says what was typed was not used', () => {
  const v = orgDoneView({ ...created, outcome: 'attached', attached: true });
  assert.ok(v.lines[1].startsWith('That email already had a Doorline account, so we added Jane Doe rather than a new person.'));
  assert.ok(!v.lines.some((l) => l.includes('emailed a link')));
});

test('a colleague: what joined, what moved, what was already there, what failed', () => {
  const v = orgDoneView(
    {
      user: { firstName: 'Pat', lastName: 'Rivera' },
      outcome: 'in-org',
      campaigns: [
        { campaignId: 'a', campaignName: 'Fall Canvass', coordinatorId: 'd1', result: 'already-on', restamp: {} },
        {
          campaignId: 'b',
          campaignName: 'Riverside Turnout',
          coordinatorId: 'd1',
          result: 'joined',
          restamp: { doors: 120, sources: [{ coordinatorId: null, name: null, doors: 100 }, { coordinatorId: 's1', name: 'Sam Lee', doors: 20 }] },
        },
        { campaignId: 'c', campaignName: 'Lit Drop North', coordinatorId: null, result: 'joined', restamp: { error: 'ledger' } },
        { campaignId: 'd', campaignName: 'Late Push', coordinatorId: null, result: 'error', restamp: {} },
      ],
    },
    { crewNameById: names }
  );
  assert.deepEqual(v.lines, [
    'Pat Rivera is now on Riverside Turnout and Lit Drop North.',
    'On Riverside Turnout, Pat’s 120 earlier doors moved from No team and Sam Lee’s team to Dana Cruz’s team.',
    'On Lit Drop North, Pat’s earlier doors didn’t finish moving. Open Pat on that campaign and choose Finish it.',
    'Pat was already on Fall Canvass, so nothing changed there.',
    'Pat couldn’t be added to Late Push. Try again.',
  ]);
});

test('nothing joined for a colleague reads Nothing changed, not Added', () => {
  const v = orgDoneView({ user: { firstName: 'Pat', lastName: 'Rivera' }, outcome: 'in-org', campaigns: [{ campaignName: 'Fall Canvass', result: 'already-on', restamp: {} }] });
  assert.equal(v.title, 'Nothing changed');
  assert.deepEqual(v.lines, ['Nothing changed for Pat Rivera.', 'Pat was already on Fall Canvass, so nothing changed there.']);
});

test('switched back on, with and without campaigns', () => {
  const base = { user: { firstName: 'Off', lastName: 'Person' }, outcome: 'in-org-inactive' };
  assert.equal(orgDoneView({ ...base, campaigns: [] }).title, 'Switched on');
  assert.equal(orgDoneView({ ...base, campaigns: [] }).lines[0], 'Off Person’s account is switched back on.');
  assert.equal(
    orgDoneView({ ...base, campaigns: [{ campaignName: 'Fall Canvass', result: 'joined', restamp: {} }] }).lines[0],
    'Off Person’s account is switched back on, and they’re on Fall Canvass.'
  );
});

test('a crew missing from the list is not called No team', () => {
  const lines = campaignLines([{ campaignName: 'X', coordinatorId: 'zz', result: 'joined', restamp: { surveys: 3 } }], { first: 'Pat', crewNameById: names });
  assert.deepEqual(lines, ['On X, Pat’s 3 earlier surveys moved to the crew you picked.']);
});

test('the profile’s result', () => {
  const v = profileDoneView(
    [
      { campaignName: 'Fall Canvass', result: 'joined', restamp: {} },
      { campaignName: 'Riverside Turnout', result: 'already-on', restamp: {} },
    ],
    { firstName: 'Ana', crewNameById: names }
  );
  assert.equal(v.title, 'Added');
  assert.deepEqual(v.lines, ['Ana is now on Fall Canvass.', 'Ana was already on Riverside Turnout, so nothing changed there.']);
  assert.equal(profileDoneView([{ campaignName: 'A', result: 'already-on' }], { firstName: 'Ana' }).title, 'Nothing changed');
});

test('the Remove question matches the member sheet’s, with the crew line only when they run one', () => {
  const plain = removeQuestion({ name: 'Pat Rivera', campaignName: 'Fall Canvass' });
  assert.equal(plain.title, 'Remove Pat Rivera from Fall Canvass?');
  assert.equal(
    plain.message,
    'Any books they hold here go back to the pool, so you can hand them to someone else. Books shared with other canvassers stay assigned to them. This doesn’t affect their other campaigns. Their work is kept — every door they knocked still counts toward this campaign.'
  );
  const lead = removeQuestion({ name: 'Dana Cruz', campaignName: 'Fall Canvass', crewSize: 1 });
  assert.ok(lead.message.endsWith('\n\nDana Cruz runs a crew here: 1 person will have no coordinator. Their past doors stay on Dana Cruz’s team.'));
});
