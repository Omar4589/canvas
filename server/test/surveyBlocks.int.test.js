import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Survey blocks and Script flow at the API, over the REAL Express app + a throwaway mongod:
//   npm run test:int -- test/surveyBlocks.int.test.js
// Pins docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md where an author, an API client or an older phone meets
// it: a statement is stored answer-less whatever a client sends, with its own caps and the
// {{canvasser}} rules (§E1, §E2); one style per template (§F) — List flow refuses routes, Script
// flow compiles them into the visibleIf every phone already evaluates, and entering Script flow is
// guarded; the final Burton survey, built through the API, compiles to the §F listing; and no
// consumer (§I) stores or shows a statement — the phone's submit, the admin edit, /survey-results,
// the voter profile, every desk-entry conversion payload, and a client report's breakdowns and
// public map answers. A hand-built payload can't share a block key or outgrow the size bounds, and
// a retired block or answer is never held to the placeholder rules.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-survey-blocks';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { switchToList } = await import('../src/services/surveys/routing.js');
const { computeSurveyBreakdowns, computeWindowStats, publicPointAnswer } = await import(
  '../src/services/reports/computeReport.js'
);
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { SurveyConversionRun } = await import('../src/models/SurveyConversionRun.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {}; // seeded ids + tokens, and the templates later tests build on

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [
    Organization, User, Membership, Subscription, Campaign, CampaignAssignment, Effort, Pass, Turf,
    TurfAssignment, Household, Voter, CanvassActivity, SurveyTemplate, SurveyResponse, SurveyConversionRun,
  ]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Blocks Org', slug: 'blocks-org-test', isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'blocks-admin@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cara', lastName: 'Canvasser', email: 'blocks-canv@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });

  // One round, two doors and one canvasser for the consumer tests. The campaign's survey is the
  // Burton template, attached once the API has built it.
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Burton for State House', type: 'survey', state: 'FL', isActive: true,
  });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'North' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1,
    name: 'Round 1', status: 'active', activatedAt: new Date(),
  });
  const homes = await Household.insertMany(
    [1, 2].map((n) => ({
      organizationId: org._id, campaignId: camp._id, effortId: effort._id,
      addressLine1: `${n} Block St`, city: 'Town', state: 'FL', zipCode: '33540',
      normalizedAddress: `${n} block st town fl 33540`,
      location: { type: 'Point', coordinates: [-82.1 + n * 0.001, 28.2] },
      isActive: true, status: 'unknocked',
    }))
  );
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book 1',
    mode: 'manual', status: 'published', householdIds: homes.map((h) => h._id), doorCount: homes.length,
  });
  await TurfAssignment.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canv._id,
  });
  const voters = await Voter.insertMany(
    [1, 2].map((n) => ({
      organizationId: org._id, campaignId: camp._id, householdId: homes[n - 1]._id,
      stateVoterId: `BLK-${n}`, firstName: 'V', lastName: `${n}`, fullName: `Voter ${n}`,
    }))
  );
  // Door 2 was knocked with nobody home: the row the desk-entry conversion test selects.
  const notHome = await CanvassActivity.create({
    organizationId: org._id, campaignId: camp._id, householdId: homes[1]._id, userId: canv._id,
    actionType: 'not_home', effortId: effort._id, passId: pass._id,
    location: { lat: 28.2, lng: -82.098, accuracy: 8 }, distanceFromHouseMeters: 9,
    timestamp: new Date(Date.now() - 2 * 3600_000),
  });
  await Household.updateOne({ _id: homes[1]._id }, { $set: { status: 'not_home' } });

  Object.assign(ctx, {
    org, camp, voters, notHome,
    adminTok: signUserToken(admin),
    canvTok: signUserToken(canv),
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const call = async (method, path, { token, orgId, body } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = String(orgId);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
};

const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });
const createSurvey = (body) => call('POST', '/api/admin/surveys', { ...asAdmin(), body: { name: 'Blocks', ...body } });
const patchSurvey = (id, body) => call('PATCH', `/api/admin/surveys/${id}`, { ...asAdmin(), body });
const stored = (id) => SurveyTemplate.findById(id).lean();
const byKey = (doc) => new Map(doc.questions.map((q) => [q.key, q]));
const visibleIfOf = (doc) =>
  Object.fromEntries(doc.questions.filter((q) => !q.retired).map((q) => [q.key, q.visibleIf]));
const keysOf = (rows) => rows.map((r) => r.questionKey ?? r.key);

// The compiler's only output shape: an `any` of positive any_of atoms, in source-question order.
const anyOf = (...atoms) => ({
  logic: 'any',
  rules: atoms.map(([questionKey, optionIds]) => ({ questionKey, op: 'any_of', optionIds })),
});

// The guards only ask whether a response exists, so a bare row is enough (distinct voter/pass ids
// keep the per-round unique index happy).
const addResponse = (surveyTemplateId) =>
  SurveyResponse.collection.insertOne({
    organizationId: ctx.org._id, campaignId: new mongoose.Types.ObjectId(), surveyTemplateId: new mongoose.Types.ObjectId(surveyTemplateId),
    voterId: new mongoose.Types.ObjectId(), passId: new mongoose.Types.ObjectId(),
    answers: [], submittedAt: new Date(),
  });

// Block builders, in the shapes the builder sends.
const opt = (id, text, extra = {}) => ({ id, text, ...extra });
const choice = (key, label, options, extra = {}) => ({ key, label, type: 'single_choice', options, ...extra });
const yesNo = (key, label, extra = {}) => choice(key, label, [opt('yes', 'Yes'), opt('no', 'No')], extra);
const text = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });
const statement = (key, label, extra = {}) => ({ key, label, type: 'statement', ...extra });

// The final Burton survey, as Part 1's table authors it (rulings 1-17).
const VOTE_PLAN = ['election_day', 'voting_early', 'by_mail', 'unsure', 'declined_to_answer'];
const BURTON = {
  name: 'Burton door script',
  flow: 'script',
  presentation: 'steps',
  intro: 'Hi there! My name is {{canvasser}}, and I am volunteering for Paul Burton for State House.',
  closing: 'Thank you for your time today. Not a problem. Have a good day!',
  tags: ['Supporter'],
  questions: [
    choice('q1', 'Can he count on your support…?', [
      opt('yes', 'Yes', { tag: 'Supporter', goTo: 'q4' }),
      opt('no', 'No', { goTo: 'q2' }),
      opt('undecided', 'Undecided', { goTo: 's1_pitch' }),
      opt('already_voted', 'Already voted', { goTo: 'q3', script: 'Oh great! Well thank you for participating.' }),
    ], { required: true }),
    text('q2', 'Thank you for sharing. Is there a particular reason?'),
    statement('s_q2_opponent', 'Are you aware of how much legal and financial trouble his opponent is in?', {
      note: 'Could share this with them if the situation feels appropriate.',
      links: [{ label: 'The opponent ledger article', url: 'https://example.org/opponent-ledger' }],
      goTo: '__end__',
    }),
    choice('q3', 'If you don\'t mind sharing, did you vote for Paul Burton?', [
      opt('yes', 'Yes', { tag: 'Supporter', goTo: 'close_3' }),
      opt('no', 'No', { goTo: '__end__' }),
      opt('declined_to_say', 'Declined to say', { goTo: '__end__' }),
    ], { required: true }),
    statement('s1_pitch', 'That\'s completely understandable… Common sense, right?', { title: 'Statement 1' }),
    choice('s1_question', 'Having heard that, can Paul count on your support?', [
      opt('yes', 'Yes', { tag: 'Supporter', goTo: 'q4' }),
      opt('still_undecided', 'Still undecided', { goTo: 'close_4' }),
      opt('no', 'No', { goTo: '__end__' }),
    ], { required: true }),
    choice('q4', 'The election is Tuesday, November 3rd. Do you plan to vote on election day, vote early, or vote by mail?', [
      opt('election_day', 'Election Day', { goTo: 'close_2' }),
      opt('voting_early', 'Voting early', { goTo: 'close_2' }),
      opt('by_mail', 'Vote by mail', { goTo: 'close_2' }),
      opt('unsure', 'Unsure', { goTo: 'close_2' }),
      opt('declined_to_answer', 'Declined to answer', { goTo: 'close_2' }),
      opt('not_voting', 'Not voting', { goTo: '__end__' }),
    ], { required: true }),
    statement('close_2', 'Every vote matters… make a plan to vote.', {
      role: 'closing', title: 'Close 2', note: 'Dates are also on the push card.', goTo: 'close_4',
    }),
    statement('close_3', 'Great! … Do you know anyone else that would want to vote for Paul?', {
      role: 'closing', title: 'Close 3', goTo: 'close_4',
    }),
    statement('close_4', 'For more information… Have a great day!', {
      role: 'closing',
      title: 'Close 4',
      note: 'Both links are also on the push card.',
      links: [
        { label: 'Campaign website', url: 'https://example.org/burton' },
        { label: 'Find your polling place', url: 'https://example.org/polling-place' },
      ],
      goTo: '__end__',
    }),
  ],
};

// §F's listing of the compiled Burton template, verbatim.
const BURTON_COMPILED = {
  q1: null,
  q2: anyOf(['q1', ['no']]),
  s_q2_opponent: anyOf(['q1', ['no']]),
  q3: anyOf(['q1', ['already_voted']]),
  s1_pitch: anyOf(['q1', ['undecided']]),
  s1_question: anyOf(['q1', ['undecided']]),
  q4: anyOf(['q1', ['yes']], ['s1_question', ['yes']]),
  close_2: anyOf(['q4', VOTE_PLAN]),
  close_3: anyOf(['q3', ['yes']]),
  close_4: anyOf(['q3', ['yes']], ['s1_question', ['still_undecided']], ['q4', VOTE_PLAN]),
};
const BURTON_ANSWERABLE = ['q1', 'q2', 'q3', 's1_question', 'q4'];
const BURTON_STATEMENTS = ['s_q2_opponent', 's1_pitch', 'close_2', 'close_3', 'close_4'];

test('a statement is stored answer-less, never required, with a role — whatever a client sends', { skip }, async () => {
  const res = await createSurvey({
    questions: [
      text('anything_else', 'Anything else on your mind?'),
      // A hand-built client sending everything a statement can't have.
      statement('pass_it_on', 'Thanks — {{canvasser}} will pass that on to Paul.', {
        required: true,
        options: [{ text: 'Yes' }, { text: 'No' }],
        otherOption: true,
        refusalOption: true,
        otherGoTo: 'bye',
      }),
      statement('bye', 'Have a great day!', { role: 'closing', title: '  Goodbye  ', note: '' }),
    ],
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  const qs = byKey(await stored(res.json.survey._id));

  const s = qs.get('pass_it_on');
  assert.strictEqual(s.type, 'statement');
  assert.strictEqual(s.role, 'statement', 'role defaults to statement');
  assert.strictEqual(s.required, false);
  assert.deepStrictEqual(s.options, []);
  assert.strictEqual(s.otherOption, false);
  assert.strictEqual(s.refusalOption, false);
  assert.strictEqual(s.otherGoTo, null);
  assert.strictEqual(s.label, 'Thanks — {{canvasser}} will pass that on to Paul.', 'the known placeholder is stored as typed');

  const bye = qs.get('bye');
  assert.strictEqual(bye.role, 'closing');
  assert.strictEqual(bye.title, 'Goodbye', 'trimmed');
  assert.strictEqual(bye.note, null, 'an empty note is no note');

  // A question carries no role at all: the model gives role no default, so nothing stamps one.
  const q = qs.get('anything_else');
  assert.ok(!('role' in q), 'no role on a stored question');
  assert.strictEqual(q.title, null);
  assert.ok(!('role' in res.json.survey.questions[0]), 'nor on the hydrated document the POST returns');
});

test('a question keeps its 1000-character cap; a statement reads up to 5000', { skip }, async () => {
  const long = await createSurvey({ questions: [text('q1', 'x'.repeat(1001))] });
  assert.strictEqual(long.status, 400);
  assert.strictEqual(long.json.error, 'A question\'s wording can be at most 1000 characters.');

  const body = 'Read this part aloud. '.repeat(200).trim();
  assert.ok(body.length > 4000);
  const ok = await createSurvey({ questions: [text('q1', 'Anything else?'), statement('s1', body)] });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.json));
  assert.strictEqual(byKey(await stored(ok.json.survey._id)).get('s1').label, body, 'stored whole');

  const tooLong = await createSurvey({ questions: [text('q1', 'Anything else?'), statement('s1', 'x'.repeat(5001))] });
  assert.strictEqual(tooLong.status, 400);
  assert.strictEqual(tooLong.json.error, 'Read-aloud text can be at most 5000 characters.');
});

test('titles, notes and links are capped, and a link must be http(s)', { skip }, async () => {
  const link = (url, label) => (label === undefined ? { url } : { label, url });
  const LINK_SCHEME = 'A link must start with http:// or https://.';
  const cases = [
    [{ title: 't'.repeat(81) }, 'A title can be at most 80 characters.'],
    [{ note: 'n'.repeat(2001) }, 'A note to the canvasser can be at most 2000 characters.'],
    [{ links: Array.from({ length: 6 }, (_, i) => link(`https://example.org/${i}`)) }, 'A block can have at most 5 links.'],
    [{ links: [link('javascript:alert(1)')] }, LINK_SCHEME],
    [{ links: [link('ftp://example.org/file')] }, LINK_SCHEME],
    [{ links: [link('https://example.org/x', 'l'.repeat(121))] }, 'A link label can be at most 120 characters.'],
  ];
  for (const [extra, message] of cases) {
    const res = await createSurvey({ questions: [text('q1', 'Anything else?'), statement('s1', 'Thanks!', extra)] });
    assert.strictEqual(res.status, 400, JSON.stringify(extra).slice(0, 80));
    assert.strictEqual(res.json.error, message);
  }

  // Notes and links ride on questions too, the scheme check ignores case, and a label is optional.
  const ok = await createSurvey({
    questions: [
      text('q1', 'Anything else?', { note: 'Only if they seem chatty.', links: [link('HTTPS://Example.org/Burton')] }),
      statement('s1', 'Thanks!', {
        title: 't'.repeat(80),
        note: 'n'.repeat(2000),
        links: Array.from({ length: 5 }, (_, i) => link(`http://example.org/${i}`, `Page ${i}`)),
      }),
    ],
  });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.json));
  const qs = byKey(await stored(ok.json.survey._id));
  assert.deepStrictEqual(qs.get('q1').links, [{ label: '', url: 'HTTPS://Example.org/Burton' }]);
  assert.strictEqual(qs.get('q1').note, 'Only if they seem chatty.');
  assert.strictEqual(qs.get('s1').links.length, 5);
});

test('{{canvasser}} is the one placeholder, and only in script text — never in wording or answers', { skip }, async () => {
  const unknown = (name) => `Unknown placeholder {{${name}}} — the only placeholder is {{canvasser}}.`;
  const NOT_HERE =
    'Placeholders like {{canvasser}} can\'t go in a question\'s wording or an answer — they\'re stored with every answer.';
  const UNFINISHED = 'Unfinished placeholder: every {{ needs a matching }} — the only placeholder is {{canvasser}}.';
  const plain = () => text('q1', 'Anything else?');
  const cases = [
    [{ questions: [text('q1', 'Did {{canvasser}} explain it?')] }, NOT_HERE],
    [{ questions: [choice('q1', 'Support?', [opt('yes', 'Yes, {{canvasser}}')])] }, NOT_HERE],
    [{ intro: 'Hi, it is {{date}} today.', questions: [plain()] }, unknown('date')],
    [{ closing: 'Thanks from {{canvasser', questions: [plain()] }, UNFINISHED],
    [{ questions: [choice('q1', 'Support?', [opt('yes', 'Yes', { script: 'Great, {{Canvasser}} says thanks!' })])] }, unknown('Canvasser')],
    [{ questions: [text('q1', 'Anything else?', { note: 'Mention {{ volunteer }}.' })] }, unknown('volunteer')],
    [{ questions: [plain(), statement('s1', 'My name is {{name}}.')] }, unknown('name')],
  ];
  for (const [body, message] of cases) {
    const res = await createSurvey(body);
    assert.strictEqual(res.status, 400, JSON.stringify(body).slice(0, 100));
    assert.strictEqual(res.json.error, message);
  }

  // The known token is fine wherever text is read aloud.
  const ok = await createSurvey({
    intro: 'Hi, my name is {{canvasser}}.',
    closing: 'Thanks — {{ canvasser }} appreciates it.',
    questions: [
      choice('q1', 'Support?', [opt('yes', 'Yes', { script: 'Great! {{canvasser}} will note that.' })], {
        note: 'Say {{canvasser}} clearly.',
      }),
      statement('s1', 'As {{canvasser}} said, every vote matters.'),
    ],
  });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.json));

  // A field-level rule, so the PATCH parser's .partial() keeps it.
  const patched = await patchSurvey(ok.json.survey._id, { intro: 'Hello, I am {{canvaser}}.' });
  assert.strictEqual(patched.status, 400);
  assert.strictEqual(patched.json.error, unknown('canvaser'));
});

test('a statement\'s title and a link\'s label hold no "{{" at all: the phone shows them as typed', { skip }, async () => {
  const plain = (what) =>
    `${what} can't contain "{{" — placeholders like {{canvasser}} work only in text that is read aloud.`;
  const link = (label) => ({ label, url: 'https://example.org/burton' });
  const cases = [
    [statement('s1', 'Thanks!', { title: 'Close {{date}}' }), plain('A title')],
    // Not even the known placeholder: a title is never filled.
    [statement('s1', 'Thanks!', { role: 'closing', title: 'Bye from {{canvasser}}' }), plain('A title')],
    [statement('s1', 'Thanks!', { links: [link('Site {{x}}')] }), plain('A link label')],
    [text('s1', 'Anything else?', { links: [link('Ask {{canvasser}}')] }), plain('A link label')],
  ];
  for (const [block, message] of cases) {
    const res = await createSurvey({ questions: [text('q1', 'Why?'), block] });
    assert.strictEqual(res.status, 400, JSON.stringify(block));
    assert.strictEqual(res.json.error, message);
  }
});

test('a retired block or answer is never held to the placeholder rules, so an older survey still saves', { skip }, async () => {
  const unknown = (name) => `Unknown placeholder {{${name}}} — the only placeholder is {{canvasser}}.`;
  const NOT_HERE =
    'Placeholders like {{canvasser}} can\'t go in a question\'s wording or an answer — they\'re stored with every answer.';
  const created = await createSurvey({
    questions: [
      choice('q1', 'Support?', [opt('yes', 'Yes'), opt('old', 'Old answer', { retired: true })]),
      text('gone', 'An old question', { retired: true }),
      choice('old_q', 'An old choice', [opt('maybe', 'Maybe')], { retired: true }),
      statement('old_close', 'Bye!', { role: 'closing', retired: true }),
    ],
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const id = created.json.survey._id;
  // Braces saved before the rules existed, in every place a rule now covers.
  await SurveyTemplate.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    {
      $set: {
        'questions.0.options.1.script': 'Say hi to {{voter_first}}',
        'questions.1.label': 'Is {{voter_first}} home?',
        'questions.2.options.0.text': 'Maybe, {{voter_first}}',
        'questions.3.label': 'Bye, {{voter_first}}!',
        'questions.3.title': 'Close {{n}}',
        'questions.3.note': 'Wave at {{voter_first}}',
        'questions.3.links': [{ label: 'Site {{x}}', url: 'https://example.org/burton' }],
      },
    }
  );

  // The builder sends every retired entry back with any edit, here a rename.
  const list = await call('GET', '/api/admin/surveys', asAdmin());
  const fetched = list.json.surveys.find((s) => String(s._id) === String(id));
  const renamed = await patchSurvey(id, { ...fetched, name: 'Renamed' });
  assert.strictEqual(renamed.status, 200, JSON.stringify(renamed.json));
  const qs = byKey(await stored(id));
  assert.strictEqual(qs.get('gone').label, 'Is {{voter_first}} home?', 'kept as it was');
  assert.strictEqual(qs.get('q1').options.find((o) => o.id === 'old').script, 'Say hi to {{voter_first}}');

  // Restored, an entry is held to the rules again.
  const restore = (key, optionId) =>
    fetched.questions.map((q) => {
      if (q.key !== key) return q;
      if (!optionId) return { ...q, retired: false };
      return { ...q, options: q.options.map((o) => (o.id === optionId ? { ...o, retired: false } : o)) };
    });
  const cases = [
    [restore('q1', 'old'), unknown('voter_first')],
    [restore('gone'), NOT_HERE],
    [restore('old_q'), NOT_HERE], // a retired question's answers were exempt with it
    [restore('old_close'), unknown('voter_first')],
  ];
  for (const [questions, message] of cases) {
    const res = await patchSurvey(id, { questions });
    assert.strictEqual(res.status, 400, message);
    assert.strictEqual(res.json.error, message);
  }

  // The reserved "__" prefix holds on a retired entry too.
  const key = await patchSurvey(id, { questions: [...fetched.questions, text('__old', 'Older', { retired: true })] });
  assert.strictEqual(key.status, 400);
  assert.strictEqual(key.json.error, 'A block key can\'t start with "__" — that prefix is reserved.');
  const withOldAnswer = fetched.questions.map((q) =>
    q.key === 'q1' ? { ...q, options: [...q.options, opt('__gone', 'Gone', { retired: true })] } : q
  );
  const answerId = await patchSurvey(id, { questions: withOldAnswer });
  assert.strictEqual(answerId.status, 400);
  assert.strictEqual(answerId.json.error, 'An answer id can\'t start with "__" — that prefix is reserved.');
});

test('a key or an answer id may not start with "__": the sentinels own that prefix', { skip }, async () => {
  const key = await createSurvey({ questions: [text('__end__', 'Anything else?')] });
  assert.strictEqual(key.status, 400);
  assert.strictEqual(key.json.error, 'A block key can\'t start with "__" — that prefix is reserved.');

  const id = await createSurvey({ questions: [choice('q1', 'Support?', [opt('yes', 'Yes'), opt('__other__', 'Other')])] });
  assert.strictEqual(id.status, 400);
  assert.strictEqual(id.json.error, 'An answer id can\'t start with "__" — that prefix is reserved.');
});

test('two blocks may not share a key, retired ones included', { skip }, async () => {
  const shared = (key) => `Two blocks share the key "${key}".`;
  const bodies = [
    // A statement sharing a question's key would hide that question's answers from both writers.
    [{ questions: [yesNo('q1', 'Support?'), statement('q1', 'Thanks for your time.')] }, 'q1'],
    // Two screens with one key would hold the stepper on the first.
    [{ presentation: 'steps', questions: [text('a', 'First?'), text('a', 'Again?'), text('b', 'Then?')] }, 'a'],
    [{ questions: [yesNo('q1', 'Support?'), text('q1', 'An old question', { retired: true })] }, 'q1'],
  ];
  for (const [body, key] of bodies) {
    const res = await createSurvey(body);
    assert.strictEqual(res.status, 400, JSON.stringify(body).slice(0, 100));
    assert.strictEqual(res.json.error, shared(key));
  }

  const created = await createSurvey({ questions: [yesNo('q1', 'Support?')] });
  assert.strictEqual(created.status, 201);
  const id = created.json.survey._id;
  const res = await patchSurvey(id, { questions: [yesNo('q1', 'Support?'), text('q1', 'Why?')] });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.json.error, shared('q1'));
  assert.strictEqual((await stored(id)).questions.length, 1, 'nothing stored');
});

test('a survey needs one question that records an answer; an empty survey stays allowed', { skip }, async () => {
  const NONE = 'Add at least one question that records an answer.';
  const only = await createSurvey({ questions: [statement('s1', 'Hello!'), statement('bye', 'Bye!', { role: 'closing' })] });
  assert.strictEqual(only.status, 400);
  assert.strictEqual(only.json.error, NONE);

  assert.strictEqual((await createSurvey({})).status, 201, 'a blank template is still created, as before');

  // Dropping the last question retires it, which leaves only a statement live: the same refusal.
  const created = await createSurvey({ questions: [statement('s1', 'Hello!'), text('q1', 'Anything else?')] });
  assert.strictEqual(created.status, 201);
  const dropped = await patchSurvey(created.json.survey._id, { questions: [statement('s1', 'Hello!')] });
  assert.strictEqual(dropped.status, 400);
  assert.strictEqual(dropped.json.error, NONE);
});

test('a condition may not reference a statement, and a statement is named by its title or first words', { skip }, async () => {
  const PITCH = 'Paul has spent twenty years fixing roads and schools in this district, and he wants to keep doing it.';
  const onStatement = await createSurvey({
    questions: [
      statement('pitch', PITCH),
      yesNo('q2', 'Can Paul count on you?', { visibleIf: { logic: 'all', rules: [{ questionKey: 'pitch', op: 'answered' }] } }),
    ],
  });
  assert.strictEqual(onStatement.status, 400);
  assert.strictEqual(
    onStatement.json.error,
    'Question "Can Paul count on you?" has a condition on statement "Paul has spent twenty years fixing roads and schools in this…", which is read aloud and has no answer — condition on the answers that led there instead.'
  );

  // A statement that owns a broken condition is named by its title, never by its read-aloud text.
  const owner = await createSurvey({
    questions: [
      yesNo('q1', 'Support?'),
      statement('close_2', PITCH, {
        role: 'closing',
        title: 'Close 2',
        visibleIf: { logic: 'any', rules: [{ questionKey: 'nope', op: 'answered' }] },
      }),
    ],
  });
  assert.strictEqual(owner.status, 400);
  assert.strictEqual(owner.json.error, 'Closing "Close 2" has a condition referencing an unknown or retired question "nope".');

  // A question's messages are byte-identical to before.
  const forward = await createSurvey({
    questions: [
      yesNo('q1', 'Support?', { visibleIf: { logic: 'all', rules: [{ questionKey: 'q2', op: 'answered' }] } }),
      text('q2', 'Why?'),
    ],
  });
  assert.strictEqual(forward.status, 400);
  assert.strictEqual(
    forward.json.error,
    'Question "Support?" has a condition referencing question "q2", which must come earlier in the survey.'
  );

  // A statement gated on an earlier question's answer is fine in List flow.
  const gated = await createSurvey({
    questions: [
      yesNo('q1', 'Support?'),
      statement('thanks', 'Thank you!', { visibleIf: { logic: 'all', rules: [{ questionKey: 'q1', op: 'is', optionIds: ['yes'] }] } }),
    ],
  });
  assert.strictEqual(gated.status, 201, JSON.stringify(gated.json));
});

test('List flow refuses a route on a live block or answer, and drops one on a retired entry', { skip }, async () => {
  const ROUTE = 'Go to is only available in Script flow.';
  const firsts = [
    choice('q1', 'Support?', [opt('yes', 'Yes', { goTo: 'q2' }), opt('no', 'No')]),
    text('q1', 'Anything else?', { goTo: '__end__' }),
    choice('q1', 'Support?', [opt('yes', 'Yes')], { otherOption: true, otherGoTo: '__end__' }),
    yesNo('q1', 'Support?', { goTo: 'q2' }), // a route on a choice question itself
  ];
  for (const first of firsts) {
    const res = await createSurvey({ questions: [first, text('q2', 'Why?')] });
    assert.strictEqual(res.status, 400, JSON.stringify(first));
    assert.strictEqual(res.json.error, ROUTE);
  }

  // An Other route while Other is off is no route at all: dropped, not refused.
  const off = await createSurvey({
    questions: [choice('q1', 'Support?', [opt('yes', 'Yes')], { otherGoTo: 'q2' }), text('q2', 'Why?')],
  });
  assert.strictEqual(off.status, 201, JSON.stringify(off.json));
  const id = off.json.survey._id;
  assert.strictEqual(byKey(await stored(id)).get('q1').otherGoTo, null);

  // Nobody can see or edit a retired entry, so a route on one is cleared silently.
  const patched = await patchSurvey(id, {
    questions: [
      choice('q1', 'Support?', [opt('yes', 'Yes'), opt('old', 'Old answer', { retired: true, goTo: 'q2' })]),
      text('q2', 'Why?'),
      text('gone', 'An old question', { retired: true, goTo: '__end__' }),
    ],
  });
  assert.strictEqual(patched.status, 200, JSON.stringify(patched.json));
  const doc = await stored(id);
  assert.strictEqual(doc.flow, 'list');
  assert.strictEqual(byKey(doc).get('q1').options.find((o) => o.id === 'old').goTo, null);
  assert.strictEqual(byKey(doc).get('gone').goTo, null);
});

test('an Other route is kept only on a choice question with Other on', { skip }, async () => {
  // A text question has no Other pick, so an Other route on one is no route: never a List-flow
  // refusal, and never stored.
  for (const flow of ['list', 'script']) {
    const res = await createSurvey({
      flow,
      questions: [text('q1', 'Anything else?', { otherOption: true, otherGoTo: '__end__' }), text('q2', 'Why?')],
    });
    assert.strictEqual(res.status, 201, `${flow}: ${JSON.stringify(res.json)}`);
    assert.strictEqual(byKey(await stored(res.json.survey._id)).get('q1').otherGoTo, null, flow);
  }

  // On a choice question with Other on it is a real route, stored and compiled.
  const res = await createSurvey({
    flow: 'script',
    questions: [
      choice('q1', 'Support?', [opt('yes', 'Yes'), opt('no', 'No')], { otherOption: true, otherGoTo: 'q3' }),
      text('q2', 'Why?'),
      text('q3', 'Anything else?'),
    ],
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  const doc = await stored(res.json.survey._id);
  assert.strictEqual(byKey(doc).get('q1').otherGoTo, 'q3');
  assert.deepStrictEqual(visibleIfOf(doc), {
    q1: null,
    q2: anyOf(['q1', ['yes', 'no']]),
    q3: anyOf(['q1', ['yes', 'no', '__other__']]),
  });
});

test('Script flow refuses an unreachable block, a backward route and a Go to on a choice question', { skip }, async () => {
  const script = (questions) => createSurvey({ flow: 'script', questions });

  const unreachable = await script([
    choice('q1', 'Support?', [opt('yes', 'Yes', { goTo: 'q3' }), opt('no', 'No', { goTo: 'q3' })]),
    text('q2', 'Why not?'),
    text('q3', 'Anything else?'),
  ]);
  const NOTHING = 'Nothing leads to "Why not?". Route an answer to it, or move it where the flow reaches it.';
  assert.strictEqual(unreachable.status, 400);
  assert.strictEqual(unreachable.json.error, NOTHING);
  assert.deepStrictEqual(unreachable.json.routeErrors, [{ key: 'q2', message: NOTHING }]);

  const backward = await script([
    yesNo('q1', 'Support?'),
    choice('q2', 'Plan to vote?', [opt('early', 'Early', { goTo: 'q1' }), opt('day', 'On the day')]),
  ]);
  assert.strictEqual(backward.status, 400);
  assert.strictEqual(
    backward.json.error,
    'The answer "Early" on "Plan to vote?" can only go to a later block, and "Support?" comes before it — move "Support?" down or pick another target.'
  );
  assert.strictEqual(backward.json.routeErrors[0].optionId, 'early');

  const onQuestion = await script([yesNo('q1', 'Support?', { goTo: '__end__' }), text('q2', 'Why?')]);
  assert.strictEqual(onQuestion.status, 400);
  assert.strictEqual(
    onQuestion.json.error,
    '"Support?" is a choice question, so its Go to belongs on each answer — remove the one on the question itself.'
  );
});

test('a survey holds at most 500 blocks and a question 200 answers, retired ones included', { skip }, async () => {
  const BLOCKS = 'A survey can have at most 500 blocks, retired ones included.';
  const ANSWERS = 'A question can have at most 200 answers, retired ones included.';
  const blocks = (n) => Array.from({ length: n }, (_, i) => text(`t${i}`, `Question ${i}`));
  const answers = (n) => Array.from({ length: n }, (_, i) => opt(`a${i}`, `Answer ${i}`));
  const oldBlock = () => text('old', 'An old question', { retired: true });
  const oldAnswer = () => opt('old', 'An old answer', { retired: true });

  const full = await createSurvey({ questions: [...blocks(499), oldBlock()] });
  assert.strictEqual(full.status, 201, JSON.stringify(full.json).slice(0, 200));
  const over = await createSurvey({ questions: [...blocks(500), oldBlock()] });
  assert.strictEqual(over.status, 400);
  assert.strictEqual(over.json.error, BLOCKS);

  const most = await createSurvey({ questions: [choice('q1', 'Precinct?', [...answers(199), oldAnswer()])] });
  assert.strictEqual(most.status, 201, JSON.stringify(most.json).slice(0, 200));
  const tooMany = await createSurvey({ questions: [choice('q1', 'Precinct?', [...answers(200), oldAnswer()])] });
  assert.strictEqual(tooMany.status, 400);
  assert.strictEqual(tooMany.json.error, ANSWERS);

  // At the caps a survey still saves as the builder sends it back.
  const fullId = full.json.survey._id;
  const again = await patchSurvey(fullId, { questions: (await stored(fullId)).questions });
  assert.strictEqual(again.status, 200, JSON.stringify(again.json).slice(0, 200));

  // A PATCH also stores, as retired, whatever it leaves out, and the next save sends that back, so
  // what it would store is held to the caps.
  const dropped = await patchSurvey(fullId, { questions: [text('new', 'A new question')] });
  assert.strictEqual(dropped.status, 400);
  assert.strictEqual(dropped.json.error, BLOCKS);
  assert.strictEqual((await stored(fullId)).questions.length, 500, 'nothing stored');
  const swapped = await patchSurvey(most.json.survey._id, {
    questions: [choice('q1', 'Precinct?', [opt('new', 'A new answer')])],
  });
  assert.strictEqual(swapped.status, 400);
  assert.strictEqual(swapped.json.error, ANSWERS);
});

test('Script flow walks at most 200 live blocks and refuses a script that compiles too large', { skip }, async () => {
  const SCRIPT_BLOCKS = 'A survey in Script flow can have at most 200 blocks.';
  const blocks = (n) => Array.from({ length: n }, (_, i) => text(`t${i}`, `Question ${i}`));

  const ok = await createSurvey({ flow: 'script', questions: [...blocks(200), text('old', 'Old', { retired: true })] });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.json).slice(0, 200));
  const over = await createSurvey({ flow: 'script', questions: blocks(201) });
  assert.strictEqual(over.status, 400);
  assert.strictEqual(over.json.error, SCRIPT_BLOCKS);
  assert.strictEqual((await createSurvey({ questions: blocks(201) })).status, 201, 'List flow compiles nothing');
  // A questions-only PATCH on a Script-flow template is held to it too.
  const grown = await patchSurvey(ok.json.survey._id, { questions: blocks(201) });
  assert.strictEqual(grown.status, 400);
  assert.strictEqual(grown.json.error, SCRIPT_BLOCKS);

  // Under every cap a continue still carries its source's whole condition forward: 60 questions
  // whose answers all lead to one block, with 139 blocks after it, compile to over 300,000 answer ids.
  const branching = Array.from({ length: 60 }, (_, i) =>
    choice(
      `b${i}`,
      `Branch ${i}`,
      Array.from({ length: 40 }, (_, j) => opt(`a${j}`, `Answer ${j}`, { goTo: j === 0 ? null : 'hub' }))
    )
  );
  const tangled = await createSurvey({
    flow: 'script',
    questions: [...branching, text('hub', 'Where they all meet'), ...blocks(139)],
  });
  assert.strictEqual(tangled.status, 400);
  assert.strictEqual(tangled.json.error, 'This script branches too much to save. Split it into two surveys.');
});

test('entering Script flow with a hand-written condition still on a block is refused, never overwritten', { skip }, async () => {
  const HAND = 'Remove the Show-only-if conditions before switching to Go to.';
  const handRule = { logic: 'all', rules: [{ questionKey: 'q1', op: 'is', optionIds: ['no'] }] };
  const questions = [yesNo('q1', 'Support?'), text('q2', 'Why not?', { visibleIf: handRule }), text('q3', 'Anything else?')];

  const born = await createSurvey({ flow: 'script', questions });
  assert.strictEqual(born.status, 400, 'a new survey in Script flow is entering it');
  assert.strictEqual(born.json.error, HAND);

  const list = await createSurvey({ questions });
  assert.strictEqual(list.status, 201, JSON.stringify(list.json));
  const id = list.json.survey._id;
  const refused = await patchSurvey(id, { flow: 'script', questions });
  assert.strictEqual(refused.status, 400);
  assert.strictEqual(refused.json.error, HAND);
  assert.deepStrictEqual(byKey(await stored(id)).get('q2').visibleIf, handRule, 'the hand rule is untouched');

  // Re-expressed as routes, the same branching goes through and compiles.
  const routed = await patchSurvey(id, {
    flow: 'script',
    questions: [
      choice('q1', 'Support?', [opt('yes', 'Yes', { goTo: 'q3' }), opt('no', 'No')]),
      text('q2', 'Why not?'),
      text('q3', 'Anything else?'),
    ],
  });
  assert.strictEqual(routed.status, 200, JSON.stringify(routed.json));
  const doc = await stored(id);
  assert.strictEqual(doc.flow, 'script');
  // "No" falls through Q2 into Q3, so Q3's two ways in merge into one atom.
  assert.deepStrictEqual(visibleIfOf(doc), {
    q1: null,
    q2: anyOf(['q1', ['no']]),
    q3: anyOf(['q1', ['yes', 'no']]),
  });
});

test('a flow change needs the questions; presentation flips on its own', { skip }, async () => {
  const created = await createSurvey({ questions: [yesNo('q1', 'Support?')] });
  assert.strictEqual(created.status, 201);
  const id = created.json.survey._id;

  for (const flow of ['script', 'list']) {
    const res = await patchSurvey(id, { flow });
    assert.strictEqual(res.status, 400, `flow: ${flow} alone`);
    assert.strictEqual(res.json.error, 'Send the questions with a flow change.');
  }

  const pres = await patchSurvey(id, { presentation: 'steps' });
  assert.strictEqual(pres.status, 200, JSON.stringify(pres.json));
  const doc = await stored(id);
  assert.strictEqual(doc.presentation, 'steps');
  assert.strictEqual(doc.flow, 'list');
  assert.strictEqual(doc.version, 1, 'no questions, no version bump');
});

test('a questions-only PATCH on a Script-flow template compiles', { skip }, async () => {
  const created = await createSurvey({
    flow: 'script',
    questions: [
      choice('q1', 'Support?', [opt('yes', 'Yes', { goTo: 'q3' }), opt('no', 'No')]),
      text('q2', 'Why not?'),
      text('q3', 'Anything else?'),
    ],
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const id = created.json.survey._id;

  // A new answer with no arrow continues to the next block. Nothing sent carries a condition and
  // no flow is sent: the stored Script flow still compiles every block.
  const res = await patchSurvey(id, {
    questions: [
      choice('q1', 'Support?', [opt('yes', 'Yes', { goTo: 'q3' }), opt('no', 'No'), { text: 'Maybe' }]),
      text('q2', 'Why not?'),
      text('q3', 'Anything else?'),
    ],
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const doc = await stored(id);
  assert.strictEqual(doc.flow, 'script');
  assert.deepStrictEqual(visibleIfOf(doc), {
    q1: null,
    q2: anyOf(['q1', ['no', 'maybe']]),
    q3: anyOf(['q1', ['yes', 'no', 'maybe']]),
  });
  ctx.scriptId = id;
});

test('with responses, leaving Script flow keeps the exact conditions and entering it is a 409', { skip }, async () => {
  const id = ctx.scriptId;
  await addResponse(id);
  const before = await stored(id);

  // "Switch back to Show only if", sent the way the builder sends it.
  const { questions, errors } = switchToList(before.questions);
  assert.deepStrictEqual(errors, []);
  const back = await patchSurvey(id, { flow: 'list', questions });
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  const after = await stored(id);
  assert.strictEqual(after.flow, 'list');
  assert.deepStrictEqual(visibleIfOf(after), visibleIfOf(before), 'the phone evaluates the very same conditions');
  for (const q of after.questions) {
    assert.strictEqual(q.goTo, null);
    for (const o of q.options) assert.strictEqual(o.goTo, null, `${q.key}.${o.id}`);
  }

  // Into Script flow again is refused now, whatever the questions say.
  const again = await patchSurvey(id, {
    flow: 'script',
    questions: after.questions.map((q) => ({ ...q, visibleIf: null })),
  });
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.json.code, 'survey-has-responses');
  assert.strictEqual(
    again.json.error,
    'This survey has responses, so it can\'t switch to Go to routing. Duplicate it to build the scripted version.'
  );
  assert.strictEqual((await stored(id)).flow, 'list');
});

test('with responses, retyping a question into a statement is the answer-type 409', { skip }, async () => {
  const id = ctx.scriptId; // List flow now, with a response
  const doc = await stored(id);
  const res = await patchSurvey(id, {
    questions: doc.questions.map((q) => (q.key === 'q2' ? { ...q, type: 'statement' } : q)),
  });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.code, 'survey-has-responses');
  assert.deepStrictEqual(res.json.reasons, ['Question "Why not?" changed type (text → statement).']);
});

test('a question retyped into a statement keeps none of its answers, not even as retired', { skip }, async () => {
  const plan = [opt('early', 'Early', { tag: 'Voter' }), opt('day', 'On the day')];
  const created = await createSurvey({ questions: [yesNo('q1', 'Support?'), choice('q2', 'Plan?', plan)] });
  assert.strictEqual(created.status, 201);
  const id = created.json.survey._id;

  // A client that leaves the old answers on the retyped block.
  const res = await patchSurvey(id, {
    questions: [yesNo('q1', 'Support?'), statement('q2', 'Every vote matters.', { options: plan })],
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const q2 = byKey(await stored(id)).get('q2');
  assert.strictEqual(q2.type, 'statement');
  assert.deepStrictEqual(q2.options, [], 'reconcile did not re-append them as retired');
});

test('the final Burton survey, built through the API, compiles to the §F listing', { skip }, async () => {
  const res = await createSurvey(BURTON);
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  const id = res.json.survey._id;
  const doc = await stored(id);
  assert.strictEqual(doc.flow, 'script');
  assert.strictEqual(doc.presentation, 'steps');
  assert.deepStrictEqual(doc.tags, ['Supporter']);
  assert.deepStrictEqual(visibleIfOf(doc), BURTON_COMPILED);

  assert.deepStrictEqual(
    doc.questions.map((q) => [q.key, q.type === 'statement' ? q.role : 'question']),
    [
      ['q1', 'question'], ['q2', 'question'], ['s_q2_opponent', 'statement'], ['q3', 'question'],
      ['s1_pitch', 'statement'], ['s1_question', 'question'], ['q4', 'question'],
      ['close_2', 'closing'], ['close_3', 'closing'], ['close_4', 'closing'],
    ]
  );
  const qs = byKey(doc);
  // The routes are stored as authored; every closing carries its explicit exit (the fall-through trap).
  assert.deepStrictEqual(qs.get('q1').options.map((o) => o.goTo), ['q4', 'q2', 's1_pitch', 'q3']);
  assert.strictEqual(qs.get('s_q2_opponent').goTo, '__end__');
  assert.strictEqual(qs.get('close_2').goTo, 'close_4');
  assert.strictEqual(qs.get('close_3').goTo, 'close_4');
  assert.strictEqual(qs.get('close_4').goTo, '__end__');
  assert.strictEqual(qs.get('s1_pitch').title, 'Statement 1');
  assert.strictEqual(qs.get('close_2').note, 'Dates are also on the push card.');
  assert.strictEqual(qs.get('close_4').links.length, 2);
  for (const key of ['q1', 's1_question', 'q3']) {
    assert.strictEqual(qs.get(key).options.find((o) => o.id === 'yes').tag, 'Supporter', key);
  }
  ctx.burtonId = id;
});

test('a GET → PATCH round-trip of a compiled template is accepted and its visibleIf recompiled', { skip }, async () => {
  const list = await call('GET', '/api/admin/surveys', asAdmin());
  assert.strictEqual(list.status, 200);
  const fetched = list.json.surveys.find((s) => String(s._id) === String(ctx.burtonId));
  assert.strictEqual(fetched.flow, 'script');
  assert.strictEqual(fetched.presentation, 'steps');

  // A stale or hand-edited condition rides along: overwritten by the compile, not rejected.
  fetched.questions.find((q) => q.key === 'q2').visibleIf = {
    logic: 'all',
    rules: [{ questionKey: 'q1', op: 'is', optionIds: ['yes'] }],
  };
  const res = await patchSurvey(ctx.burtonId, fetched);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const doc = await stored(ctx.burtonId);
  assert.deepStrictEqual(visibleIfOf(doc), BURTON_COMPILED);
  assert.strictEqual(doc.flow, 'script');
  assert.strictEqual(doc.version, 2);
});

test('duplicate copies flow, presentation, tags and every block field verbatim', { skip }, async () => {
  const res = await call('POST', `/api/admin/surveys/${ctx.burtonId}/duplicate`, asAdmin());
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  const [orig, copy] = await Promise.all([stored(ctx.burtonId), stored(res.json.survey._id)]);
  assert.strictEqual(copy.flow, 'script');
  assert.strictEqual(copy.presentation, 'steps');
  assert.deepStrictEqual(copy.tags, ['Supporter'], 'tags used to be dropped');
  assert.deepStrictEqual(copy.questions, orig.questions, 'roles, titles, notes, links, routes and compiled conditions');
  assert.strictEqual(copy.intro, orig.intro);
  assert.strictEqual(copy.closing, orig.closing);
});

test('the phone\'s submit stores no statement rows, even from an older bundle', { skip }, async () => {
  await Campaign.updateOne({ _id: ctx.camp._id }, { $set: { surveyTemplateId: ctx.burtonId } });
  const voter = ctx.voters[0];
  // An older bundle renders a statement like a text card and posts a row for every block it showed.
  const res = await call('POST', `/api/mobile/voters/${voter._id}/survey`, {
    token: ctx.canvTok,
    orgId: ctx.org._id,
    body: {
      surveyTemplateId: String(ctx.burtonId),
      answers: [
        { questionKey: 'q1', questionLabel: 'Can he count on your support…?', optionIds: ['undecided'], answer: 'Undecided' },
        { questionKey: 's1_pitch', questionLabel: 'That\'s completely understandable… Common sense, right?', answer: '' },
        {
          questionKey: 's1_question',
          questionLabel: 'Having heard that, can Paul count on your support?',
          optionIds: ['still_undecided'],
          answer: 'Still undecided',
        },
        { questionKey: 'close_4', questionLabel: 'For more information… Have a great day!', answer: 'typed into a closing card' },
      ],
      location: { lat: 28.2, lng: -82.099, accuracy: 8 },
      timestamp: new Date(Date.now() - 60_000).toISOString(),
    },
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  const row = await SurveyResponse.findOne({ voterId: voter._id, surveyTemplateId: ctx.burtonId }).lean();
  assert.deepStrictEqual(keysOf(row.answers), ['q1', 's1_question']);
  ctx.responseId = row._id;
});

test('the admin edit path never stores a statement row either', { skip }, async () => {
  const res = await call('PATCH', `/api/admin/voters/${ctx.voters[0]._id}/surveys/${ctx.responseId}`, {
    ...asAdmin(),
    body: {
      answers: [
        { questionKey: 'q1', questionLabel: 'Can he count on your support…?', optionIds: ['undecided'], answer: 'Undecided' },
        { questionKey: 's1_pitch', questionLabel: 'That\'s completely understandable…', answer: 'an admin typed here' },
        { questionKey: 's1_question', questionLabel: 'Having heard that…', optionIds: ['yes'], answer: 'Yes' },
      ],
    },
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const row = await SurveyResponse.findById(ctx.responseId).lean();
  assert.deepStrictEqual(keysOf(row.answers), ['q1', 's1_question']);
});

test('the voter profile\'s question snapshot holds the answerable questions only', { skip }, async () => {
  const res = await call('GET', `/api/admin/voters/${ctx.voters[0]._id}`, asAdmin());
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const survey = res.json.surveys.find((s) => s.surveyTemplateId === String(ctx.burtonId));
  assert.ok(survey, 'the Burton response is on the profile');
  assert.deepStrictEqual(keysOf(survey.questions), BURTON_ANSWERABLE);
  assert.ok(survey.answers.every((a) => !BURTON_STATEMENTS.includes(a.questionKey)));
});

test('/survey-results reports the answerable questions only', { skip }, async () => {
  const res = await call(
    'GET',
    `/api/admin/reports/survey-results?campaignId=${ctx.camp._id}&surveyTemplateId=${ctx.burtonId}`,
    asAdmin()
  );
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.totalResponses, 1);
  assert.deepStrictEqual(keysOf(res.json.questions), BURTON_ANSWERABLE);
});

test('every desk-entry conversion payload carries the answerable questions only', { skip }, async () => {
  const url = (suffix = '') => `/api/admin/campaigns/${ctx.camp._id}/survey-conversions${suffix}`;
  const actionIds = [String(ctx.notHome._id)];

  const composer = await call('POST', url('/template'), { ...asAdmin(), body: { actionIds } });
  assert.strictEqual(composer.status, 200, JSON.stringify(composer.json));
  assert.deepStrictEqual(keysOf(composer.json.template.questions), BURTON_ANSWERABLE, 'the composer template');

  const toSurvey = { direction: 'to_survey', to: 'survey_submitted', actionIds };
  const preview = await call('POST', url(), { ...asAdmin(), body: { ...toSurvey, dryRun: true } });
  assert.strictEqual(preview.status, 200, JSON.stringify(preview.json));
  assert.deepStrictEqual(keysOf(preview.json.template.questions), BURTON_ANSWERABLE, 'the dry-run preview');

  const opened = await call('POST', url(), { ...asAdmin(), body: { ...toSurvey, mode: 'queue' } });
  assert.strictEqual(opened.status, 201, JSON.stringify(opened.json));
  assert.deepStrictEqual(keysOf(opened.json.run.template.questions), BURTON_ANSWERABLE, 'the queue session it opens');

  const resumed = await call('GET', url(`/${opened.json.run.id}`), asAdmin());
  assert.strictEqual(resumed.status, 200, JSON.stringify(resumed.json));
  assert.deepStrictEqual(keysOf(resumed.json.run.template.questions), BURTON_ANSWERABLE, 'the session, resumed');

  assert.strictEqual((await call('POST', url(`/${opened.json.run.id}/close`), asAdmin())).status, 200);
});

test('a client report and its public map carry no statement, even from a stray stored row', { skip }, async () => {
  // A row under a statement key that got past the submit's filter (an older server, a hand edit).
  // PRIVACY_VERIFICATION item 26 relies on no statement text reaching a client: pinned here.
  const strayStatement = {
    questionKey: 's1_pitch', questionLabel: 'That\'s completely understandable…', optionIds: ['yes'], answer: 'Yes',
  };
  await SurveyResponse.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, surveyTemplateId: new mongoose.Types.ObjectId(ctx.burtonId),
    voterId: new mongoose.Types.ObjectId(), passId: new mongoose.Types.ObjectId(),
    answers: [
      { questionKey: 'q1', questionLabel: 'Can he count on your support…?', optionIds: ['yes'], answer: 'Yes' },
      strayStatement,
      { questionKey: 'close_4', questionLabel: 'For more information…', optionIds: [], answer: 'typed into a closing card' },
    ],
    submittedAt: new Date(),
  });
  const template = await stored(ctx.burtonId);
  const BURTON_CHOICES = ['q1', 'q3', 's1_question', 'q4'];

  const breakdowns = await computeSurveyBreakdowns({
    surveyScopeMatch: { organizationId: ctx.org._id, campaignId: ctx.camp._id },
    template,
  });
  assert.deepStrictEqual(keysOf(breakdowns), BURTON_CHOICES, 'the choice questions only');
  const yes = breakdowns[0].options.find((o) => o.id === 'yes');
  assert.strictEqual(yes.count, 1, 'the stray row is in scope: its q1 answer counts');
  const published = JSON.stringify(breakdowns);
  for (const s of template.questions.filter((q) => q.type === 'statement')) {
    assert.ok(!published.includes(s.label), `no text of ${s.key}`);
  }
  // The same through the report builder's window, the one caller.
  const stats = await computeWindowStats({
    orgId: ctx.org._id,
    campaignId: ctx.camp._id,
    range: { $lt: new Date(Date.now() + 60_000) },
    campaignType: ctx.camp.type,
    template,
  });
  assert.deepStrictEqual(keysOf(stats.surveyBreakdowns), BURTON_CHOICES);

  // A door's answer on the public map: null for a statement, by option ids or by snapshot.
  const qs = byKey(template);
  for (const key of BURTON_STATEMENTS) {
    assert.strictEqual(publicPointAnswer(qs.get(key), strayStatement), null, `${key}, option ids`);
    assert.strictEqual(publicPointAnswer(qs.get(key), { answer: 'Yes' }), null, `${key}, a snapshot`);
  }
  assert.strictEqual(publicPointAnswer(qs.get('q1'), { optionIds: ['yes'], answer: 'Yes' }), 'Yes', 'a choice still maps');
});
