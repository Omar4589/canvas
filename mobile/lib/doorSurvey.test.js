import { test } from 'node:test';
import assert from 'node:assert';
import { surveyForBook, surveyForDoor, practiceSurveys } from './doorSurvey.js';

// doorSurvey.js is the ONE answer to "which survey does this door use", read by the door screen
// and by Practice the survey. If the two ever disagreed, a canvasser would rehearse one survey and
// meet another at the door, so the door's rule is pinned here exactly as the screen computed it
// inline before (survey.jsx at 0b5c7da), and practice is pinned to the same rule.
//
// Run from the REPO ROOT: `npm run test:mobile` (the root glob picks this up; never add a test
// script to mobile/package.json — it is OTA-fingerprint-hashed).

const campaignSurvey = { _id: 'S-campaign', name: 'Campaign default' };
const earlySurvey = { _id: 'S-early', name: 'Early vote script' };

const bundle = (over = {}) => ({
  campaign: { id: 'C1', type: 'survey' },
  activeSurvey: campaignSurvey,
  surveys: { 'S-campaign': campaignSurvey, 'S-early': earlySurvey },
  books: [],
  efforts: [],
  ...over,
});

// The door screen's inline rule before this module existed, kept as the oracle.
const oldDoorRule = (bootstrap, household) => {
  const books = bootstrap?.books || [];
  const surveys = bootstrap?.surveys || {};
  const book = household?.turfId
    ? books.find((b) => String(b.id) === String(household.turfId))
    : null;
  const sid = book?.surveyTemplateId;
  return (sid && surveys[String(sid)]) || bootstrap?.activeSurvey || null;
};

test('door: a book with its own survey uses it', () => {
  const b = bundle({ books: [{ id: 'B1', effortId: 'E1', surveyTemplateId: 'S-early' }] });
  assert.strictEqual(surveyForDoor(b, { turfId: 'B1' }), earlySurvey);
});

test('door: a survey the phone does not hold falls back to the campaign default', () => {
  const b = bundle({ books: [{ id: 'B1', surveyTemplateId: 'S-gone' }] });
  assert.strictEqual(surveyForDoor(b, { turfId: 'B1' }), campaignSurvey);
});

test("door: no book, or a book that isn't the user's, falls back to the campaign default", () => {
  const b = bundle({ books: [{ id: 'B1', surveyTemplateId: 'S-early' }] });
  assert.strictEqual(surveyForDoor(b, { turfId: null }), campaignSurvey);
  assert.strictEqual(surveyForDoor(b, { turfId: 'B9' }), campaignSurvey);
  assert.strictEqual(surveyForDoor(b, undefined), campaignSurvey);
});

test('door: nothing resolves to null', () => {
  assert.strictEqual(surveyForDoor(bundle({ activeSurvey: null, surveys: {} }), { turfId: 'B1' }), null);
  assert.strictEqual(surveyForDoor(undefined, undefined), null);
  assert.strictEqual(surveyForBook(null, null), null);
});

test('door: matches the old inline rule on every combination', () => {
  const surveysCases = [{}, { 'S-campaign': campaignSurvey, 'S-early': earlySurvey }, undefined];
  const activeCases = [campaignSurvey, null, undefined];
  const booksCases = [
    [],
    [{ id: 'B1', surveyTemplateId: 'S-early' }],
    [{ id: 'B1', surveyTemplateId: null }],
    [{ id: 'B1', surveyTemplateId: 'S-gone' }],
    [{ id: 1, surveyTemplateId: 'S-early' }],
    undefined,
  ];
  const households = [undefined, null, {}, { turfId: 'B1' }, { turfId: 1 }, { turfId: '1' }, { turfId: 'B9' }];
  for (const surveys of surveysCases) {
    for (const activeSurvey of activeCases) {
      for (const books of booksCases) {
        const b = { surveys, activeSurvey, books };
        for (const h of households) {
          assert.strictEqual(surveyForDoor(b, h), oldDoorRule(b, h), JSON.stringify({ b, h }));
        }
      }
    }
  }
});

test('practice: nothing on a lit-drop campaign, or with no bundle', () => {
  assert.deepStrictEqual(practiceSurveys(bundle({ campaign: { id: 'C1', type: 'lit_drop' } })), []);
  assert.deepStrictEqual(practiceSurveys(bundle({ campaign: undefined })), []);
  assert.deepStrictEqual(practiceSurveys(undefined), []);
  assert.deepStrictEqual(practiceSurveys(null), []);
});

test('practice: no books yet offers the campaign survey', () => {
  const list = practiceSurveys(bundle());
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'S-campaign');
  assert.strictEqual(list[0].survey, campaignSurvey);
  assert.deepStrictEqual(list[0].walkLists, []);
  assert.strictEqual(list[0].label, 'Campaign survey');
});

test('practice: nothing when no survey resolves', () => {
  assert.deepStrictEqual(practiceSurveys(bundle({ activeSurvey: null, surveys: {} })), []);
  const books = [{ id: 'B1', effortId: 'E1', surveyTemplateId: null }];
  assert.deepStrictEqual(practiceSurveys(bundle({ activeSurvey: null, surveys: {}, books })), []);
});

test('practice: books sharing a survey give one entry naming every walk list', () => {
  const list = practiceSurveys(
    bundle({
      books: [
        { id: 'B1', effortId: 'E2', surveyTemplateId: 'S-early' },
        { id: 'B2', effortId: 'E1', surveyTemplateId: 'S-early' },
        { id: 'B3', effortId: 'E2', surveyTemplateId: 'S-early' },
      ],
      efforts: [
        { id: 'E1', name: 'Early vote' },
        { id: 'E2', name: 'Chase' },
      ],
    })
  );
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].survey, earlySurvey);
  assert.deepStrictEqual(list[0].walkLists, ['Chase', 'Early vote']);
  assert.strictEqual(list[0].label, 'Chase, Early vote');
});

test('practice: a walk list override plus the campaign default give two entries, sorted by name', () => {
  const list = practiceSurveys(
    bundle({
      books: [
        { id: 'B1', effortId: 'E1', surveyTemplateId: 'S-early' },
        { id: 'B2', effortId: 'E2', surveyTemplateId: 'S-campaign' },
        { id: 'B3', effortId: null, surveyTemplateId: 'S-campaign' },
      ],
      efforts: [
        { id: 'E1', name: 'Early vote' },
        { id: 'E2', name: 'Base' },
      ],
    })
  );
  assert.deepStrictEqual(
    list.map((e) => [e.id, e.label]),
    [
      ['S-campaign', 'Base'],
      ['S-early', 'Early vote'],
    ]
  );
});

test('practice: a survey the phone does not hold folds into the campaign default, as at the door', () => {
  const list = practiceSurveys(
    bundle({
      books: [
        { id: 'B1', effortId: 'E1', surveyTemplateId: 'S-gone' },
        { id: 'B2', effortId: null, surveyTemplateId: 'S-campaign' },
      ],
      efforts: [{ id: 'E1', name: 'Early vote' }],
    })
  );
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].survey, campaignSurvey);
  assert.deepStrictEqual(list[0].walkLists, ['Early vote']);
});

test('practice: books outside any walk list read as the campaign survey', () => {
  const list = practiceSurveys(bundle({ books: [{ id: 'B1', effortId: null, surveyTemplateId: 'S-campaign' }] }));
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].label, 'Campaign survey');
});

test('practice: every entry is the survey the door would use for one of the books', () => {
  const b = bundle({
    books: [
      { id: 'B1', effortId: 'E1', surveyTemplateId: 'S-early' },
      { id: 'B2', effortId: 'E2', surveyTemplateId: 'S-gone' },
      { id: 'B3', effortId: null, surveyTemplateId: null },
    ],
    efforts: [
      { id: 'E1', name: 'Early vote' },
      { id: 'E2', name: 'Base' },
    ],
  });
  const atDoors = new Set(b.books.map((book) => surveyForDoor(b, { turfId: book.id })));
  const practiced = new Set(practiceSurveys(b).map((e) => e.survey));
  assert.deepStrictEqual(practiced, atDoors);
});
