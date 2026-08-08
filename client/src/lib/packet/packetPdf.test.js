import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPacketPdf, renderManifestPdf, packetFilename } from './packetPdf.js';
import { buildSurveyPrintModel } from './surveyPrintModel.js';
import { splitBooks } from './splitBooks.js';
import { DEFAULT_SETTINGS } from './packetSettings.js';
import { PAGE } from './packetTheme.js';
import { asciiSafe, countUnprintable, scanUnprintableNames } from '../pdfText.js';

// jsPDF's browser build runs under node, so the pagination invariant — the one that
// silently ruins a print run — can be asserted against a real document rather than a mock.

const SURVEY = {
  id: 's1',
  name: 'Fall canvass',
  intro: 'Hi, I’m a volunteer with the campaign.',
  closing: 'Thanks for your time.',
  questions: [
    {
      key: 'issue', label: 'Which issue matters most to you this year?', type: 'single_choice',
      otherOption: true, options: [
        { id: 'a', text: 'Housing costs' }, { id: 'b', text: 'Public safety' },
        { id: 'c', text: 'Schools' }, { id: 'd', text: 'Roads & transit' },
      ],
    },
    {
      key: 'plan', label: 'Do you plan to vote in the March 3 election?', type: 'single_choice',
      refusalOption: true, options: [
        { id: 'def', text: 'Definitely', script: 'Great — can we count on you?' },
        { id: 'pro', text: 'Probably' }, { id: 'und', text: 'Undecided' }, { id: 'no', text: 'Not voting' },
      ],
    },
    {
      key: 'how', label: 'How do you plan to vote?', type: 'multiple_choice',
      visibleIf: { logic: 'all', rules: [{ questionKey: 'plan', op: 'any_of', optionIds: ['def', 'pro'] }] },
      options: [{ id: 'm', text: 'Vote by mail' }, { id: 'e', text: 'Early in person' }, { id: 'x', text: 'Election Day' }],
    },
    {
      key: 'where', label: 'Do you know where your polling place is?', type: 'single_choice',
      visibleIf: { logic: 'all', rules: [{ questionKey: 'plan', op: 'any_of', optionIds: ['def', 'pro'] }] },
      options: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }],
    },
    { key: 'free', label: 'Anything you want the campaign to know?', type: 'text', options: [] },
  ],
};

// Pinned page count for makePayload(60, 2) at DEFAULT_SETTINGS — cover + script page + body.
// Update this DELIBERATELY when the layout changes; an accidental jump means something grew.
// 42 -> 47 when note rules went to a writable 20pt pitch, tick boxes to 10.5pt, and street
// bands arrived. Unchanged at 47 when the header band grew to 68pt — the door blocks repack
// into the same sheets. 47 -> 61 when doors became atomic: at three note lines a survey door
// clears half a page, so one lands per sheet instead of one-and-a-bit. Dropping this fixture to
// one note line puts it back under half a page and two fit again — that is the trade, and the
// studio shows it live as the knob turns.
const PAGE_PIN_60_DOORS = 61;

const voter = (i, name) => ({
  id: `v${i}`, name, party: 'DEM', age: 30 + i, gender: 'F', phone: null, voted: i === 0,
});

const makePayload = (doorCount, votersPerDoor, { survey = SURVEY } = {}) => ({
  campaign: { id: 'c1', name: 'Riverside City Council 2026', type: 'survey' },
  organization: { name: 'Harbor Progress Alliance' },
  generatedAt: '2026-08-06T14:14:00.000Z',
  books: [
    {
      id: 'b1', name: 'Ward 5 — Book C', colorIndex: 0,
      passId: 'p1', passName: 'Round 2', roundNumber: 2,
      doorCount, voterCount: doorCount * votersPerDoor,
      streets: [{ name: 'N ORCHARD AVE', count: doorCount }],
      omitted: { total: 3, reasons: { doNotContact: 1, alreadyVoted: 2 } },
      orderProvenance: 'book',
      survey,
      doors: Array.from({ length: doorCount }, (_, d) => ({
        id: `h${d}`, seq: d + 1,
        addressLine1: `${1400 + d * 4} N ORCHARD AVE`,
        addressLine2: d % 3 === 0 ? 'Apt 2B' : null,
        city: 'Riverside', state: 'CA', zipCode: '92501',
        status: d % 4 === 0 ? 'not_home' : 'unknocked',
        lastActionAt: d % 4 === 0 ? '2026-07-28T18:00:00.000Z' : null,
        voters: Array.from({ length: votersPerDoor }, (_, i) => voter(i, `Voter ${d}-${i} Delgado`)),
      })),
    },
  ],
  totals: { books: 1, doors: doorCount, voters: doorCount * votersPerDoor, omitted: 3 },
  warnings: [],
});

// Read back what actually landed on each page. jsPDF keeps per-page content streams, so a
// block that ran off the bottom is detectable rather than merely suspected.
const pageTexts = (doc) => {
  const out = [];
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    out.push(doc.internal.pages[p].join('\n'));
  }
  return out;
};

// Every `y` coordinate in a page's text-positioning operators. PDF space is bottom-up, so
// a small y is LOW on the sheet; anything below the bottom margin has escaped the page.
const textYs = (stream) => {
  const ys = [];
  const re = /BT\s*\/F\d+\s+[\d.]+\s+Tf.*?[\d.-]+\s+([\d.-]+)\s+Td/gs;
  let m;
  while ((m = re.exec(stream))) ys.push(parseFloat(m[1]));
  return ys;
};

test('no ink escapes the page, at every household size', async () => {
  for (const perDoor of [1, 2, 3, 5, 8]) {
    const doc = await renderPacketPdf(makePayload(6, perDoor), DEFAULT_SETTINGS);
    for (const [i, stream] of pageTexts(doc).entries()) {
      for (const y of textYs(stream)) {
        // PDF y is measured from the bottom; the printable floor is the footer baseline.
        assert.ok(
          y >= PAGE.MARGIN - 12,
          `${perDoor} voters/door: text at y=${y} on page ${i + 1} is below the bottom margin`
        );
        assert.ok(
          y <= PAGE.H - PAGE.MARGIN + 12,
          `${perDoor} voters/door: text at y=${y} on page ${i + 1} is above the top margin`
        );
      }
    }
  }
});

// A multi-book run, the only shape where one packet can collide with the next.
const makeRun = (sizes) => {
  const base = makePayload(1, 1, { survey: null });
  return {
    ...base,
    books: sizes.map((n, i) => ({
      ...makePayload(n, 1, { survey: null }).books[0],
      id: `b${i}`, name: `Book ${String.fromCharCode(65 + i)}`, colorIndex: i,
    })),
    totals: { books: sizes.length, doors: sizes.reduce((a, b) => a + b, 0), voters: 0, omitted: 0 },
  };
};

// A book's own page 1 is its cover; the footer names it. PDF pages are 1-indexed, so a cover
// on an ODD page is the FRONT of a sheet.
const coverPages = (doc) =>
  pageTexts(doc).flatMap((t, i) => (t.includes('Page 1 of') ? [i + 1] : []));

test('every packet starts on the front of a sheet when printing double-sided', async () => {
  // Otherwise a book ending on an odd page hands its last sheet's BACK to the next book's
  // cover: two packets fused onto one piece of paper, unseparable without a guillotine.
  const run = makeRun([3, 8, 2, 14]);
  const settings = { ...DEFAULT_SETTINGS, layout: 'field', duplex: true };
  const doc = await renderPacketPdf(run, settings);
  const covers = coverPages(doc);
  assert.equal(covers.length, 4);
  const backs = covers.filter((p) => p % 2 === 0);
  assert.deepEqual(backs, [], `covers landed on the back of a sheet: pages ${backs.join(', ')}`);
});

test('the padding is what does it — without it, a cover lands on a back side', async () => {
  const run = makeRun([3, 8, 2, 14]);
  const off = await renderPacketPdf(run, { ...DEFAULT_SETTINGS, layout: 'field', duplex: false });
  const on = await renderPacketPdf(run, { ...DEFAULT_SETTINGS, layout: 'field', duplex: true });
  assert.ok(
    coverPages(off).some((p) => p % 2 === 0),
    'fixture no longer reproduces the collision — pick book sizes that do'
  );
  assert.ok(on.getNumberOfPages() > off.getNumberOfPages(), 'padding should cost pages');
});

test('a spare page belongs to its own packet, not the next one', async () => {
  // It carries the book's band and counts in "Page N of M" — a page numbered into the NEXT
  // book would tell a volunteer their packet started with someone else's notes.
  const doc = await renderPacketPdf(makeRun([8, 3]), {
    ...DEFAULT_SETTINGS, layout: 'field', duplex: true,
  });
  const pages = pageTexts(doc);
  const spare = pages.findIndex((t) => t.includes('Spare room to write'));
  assert.ok(spare >= 0, 'expected a spare notes page');
  assert.match(pages[spare], /Book A/, 'the spare page must stay with Book A');
});

test('a single-book run is never padded', async () => {
  // Nothing follows it, so there is no collision to prevent and no sheet to spend.
  const one = makePayload(9, 1, { survey: null });
  const on = await renderPacketPdf(one, { ...DEFAULT_SETTINGS, layout: 'field', duplex: true });
  const off = await renderPacketPdf(one, { ...DEFAULT_SETTINGS, layout: 'field', duplex: false });
  assert.equal(on.getNumberOfPages(), off.getNumberOfPages());
});

test('the standalone hand-out sheet renders every packet row', async () => {
  // The ZIP download ships the manifest as its own file; each row's Pages column reads the
  // packet's range in its OWN file (1..N), which is what someone flipping that file sees.
  const run = makeRun([3, 8, 2]);
  const counts = new Map([['b0', 2], ['b1', 3], ['b2', 2]]);
  const doc = await renderManifestPdf(run, DEFAULT_SETTINGS, counts);
  const t = pageTexts(doc).join('\n');
  for (const b of run.books) assert.match(t, new RegExp(b.name));
  assert.match(t, /1-3/, 'the 3-page packet must show its own file range');
  assert.match(t, /HAND OUT AGAINST THIS SHEET/);
});

test('a door that fits on a page is never split across two', async () => {
  // Splitting puts the residents and "who answered" on one sheet and the questions on the next.
  // Tear a packet at a page boundary — exactly where two volunteers divide it — and neither half
  // is a workable door. It used to happen to two thirds of the doors in a real survey book.
  const doc = await renderPacketPdf(makePayload(40, 2), { ...DEFAULT_SETTINGS, noteLines: 1 });
  const split = pageTexts(doc).filter((t) => t.includes('cont.')).length;
  assert.equal(split, 0, `${split} pages carried a continued door that should have fitted whole`);
});

test('a door taller than one page continues, reprinting its address with (cont.)', async () => {
  // The per-door grid means a door barely grows with resident count — that is the point of
  // it — so a split needs a genuinely large building. A 30-unit address does it, and that
  // is a real thing to knock, not a contrived one.
  const doc = await renderPacketPdf(makePayload(2, 30), DEFAULT_SETTINGS);
  // PDF escapes literal parentheses inside text strings, so the stream carries `\(cont.\)`.
  const all = pageTexts(doc).join('\n');
  assert.ok(all.includes('cont.'), 'a split door must reprint its address marked (cont.)');
});

test('a long survey also splits cleanly, mid-question-run', async () => {
  const long = {
    ...SURVEY,
    questions: Array.from({ length: 22 }, (_, i) => ({
      key: `q${i}`, label: `Question number ${i + 1} about the campaign`, type: 'single_choice',
      options: [{ id: 'a', text: 'Yes' }, { id: 'b', text: 'No' }, { id: 'c', text: 'Not sure' }],
    })),
  };
  const doc = await renderPacketPdf(makePayload(3, 2, { survey: long }), DEFAULT_SETTINGS);
  assert.ok(pageTexts(doc).join('\n').includes('cont.'));
  // And still nothing off the bottom.
  for (const stream of pageTexts(doc)) {
    for (const y of textYs(stream)) assert.ok(y >= PAGE.MARGIN - 12, `text at y=${y} escaped`);
  }
});

test('page count is stable across two identical renders', async () => {
  const a = await renderPacketPdf(makePayload(30, 2), DEFAULT_SETTINGS);
  const b = await renderPacketPdf(makePayload(30, 2), DEFAULT_SETTINGS);
  assert.equal(a.getNumberOfPages(), b.getNumberOfPages());
});

test('the field layout drops every question and is markedly shorter', async () => {
  const payload = makePayload(40, 2);
  const survey = await renderPacketPdf(payload, { ...DEFAULT_SETTINGS, layout: 'survey' });
  const field = await renderPacketPdf(payload, { ...DEFAULT_SETTINGS, layout: 'field' });
  assert.ok(
    field.getNumberOfPages() < survey.getNumberOfPages(),
    `field (${field.getNumberOfPages()}p) must be shorter than survey (${survey.getNumberOfPages()}p)`
  );
  // The field list is paper for writing on, not a questionnaire.
  assert.ok(!pageTexts(field).join('\n').includes('Circle one'));
});

test('a campaign with no survey falls back to the field layout instead of printing nothing', async () => {
  const payload = makePayload(5, 2, { survey: null });
  const doc = await renderPacketPdf(payload, { ...DEFAULT_SETTINGS, layout: 'survey' });
  const all = pageTexts(doc).join('\n');
  assert.ok(!all.includes('Circle one'));
  assert.ok(doc.getNumberOfPages() > 0);
});

test('more note lines only ever grows the packet, never reorders it', async () => {
  const payload = makePayload(24, 2);
  const two = await renderPacketPdf(payload, { ...DEFAULT_SETTINGS, noteLines: 2 });
  const six = await renderPacketPdf(payload, { ...DEFAULT_SETTINGS, noteLines: 6 });
  assert.ok(six.getNumberOfPages() >= two.getNumberOfPages());
});

test('the print-only contract appears on every body page', async () => {
  const doc = await renderPacketPdf(makePayload(10, 2), DEFAULT_SETTINGS);
  const pages = pageTexts(doc);
  const withContract = pages.filter((p) => p.includes('print only')).length;
  assert.ok(withContract >= pages.length - 2, 'all but the cover pages carry the print-only line');
});

test('survey print model: gate labels, forward skip, retired-safe numbering', () => {
  const m = buildSurveyPrintModel(SURVEY);
  assert.equal(m.questions.length, 5);
  assert.equal(m.questions[2].gate, 'Only if Q2 = "Definitely" or "Probably"');
  // Two consecutive questions share one condition, so the parent gets a skip instruction
  // pointing PAST the run — a single gated question would not earn one.
  assert.equal(m.questions[1].skipHint, 'If not "Definitely" or "Probably", skip to Q5');
  assert.equal(m.questions[0].skipHint, null);
  // otherOption / refusalOption are flags on the question, not rows in `options` — they
  // have to be materialised or the paper offers fewer choices than the app.
  assert.ok(m.questions[0].options.some((o) => o.id === '__other__' && o.writeIn));
  assert.ok(m.questions[1].options.some((o) => o.id === '__refused__' && o.muted));
  assert.equal(m.questions[4].verb, 'Write in');
  assert.equal(m.scripts.length, 1);
});

test('unprintable text is folded, and what cannot be folded is counted', () => {
  assert.equal(asciiSafe('O’Brien'), "O'Brien");
  assert.equal(asciiSafe('a — b'), 'a - b');
  assert.equal(asciiSafe('café'), 'café'); // inside cp1252, prints as-is
  assert.equal(countUnprintable('O’Brien'), 0); // folded, not lost
  assert.ok(countUnprintable('Дмитрий') > 0); // Cyrillic cannot print
  const scan = scanUnprintableNames({
    books: [{ doors: [{ voters: [{ name: 'Дмитрий' }, { name: "O'Brien" }] }] }],
  });
  assert.equal(scan.count, 1);
});

test('every page carries a write-in name line, never a pre-printed assignee', async () => {
  const doc = await renderPacketPdf(makePayload(12, 2), DEFAULT_SETTINGS);
  const pages = pageTexts(doc);
  // A book routinely gets torn in half between two volunteers, so the name line has to be on
  // EVERY sheet — a cover-only line leaves half the packet unattributable.
  const withName = pages.filter((p) => p.includes('WALKED BY')).length;
  assert.ok(withName >= pages.length - 1, `only ${withName}/${pages.length} pages offer a name line`);
  assert.ok(pages.join('\n').includes('DATE'));
  // Nothing anywhere may claim who the app thinks holds this book.
  assert.ok(!/Assigned:/.test(pages.join('\n')), 'the in-app assignee must never be printed');
});

test('page count for a fixed payload is pinned', async () => {
  // A straight regression pin. Layout changes are fine — they just have to be deliberate,
  // and an accidental jump here means something started consuming vertical space.
  const doc = await renderPacketPdf(makePayload(60, 2), DEFAULT_SETTINGS);
  assert.equal(doc.getNumberOfPages(), PAGE_PIN_60_DOORS);
});

test('a street change is announced on the page', async () => {
  // The packet groups doors street by street; without a band the page gave no sign of it and
  // the whole reordering was invisible to the person holding the paper.
  const payload = makePayload(12, 1);
  payload.books[0].doors.forEach((d, i) => {
    d.street = i < 6 ? 'N ORCHARD AVE' : 'S CEDAR ST';
    d.addressLine1 = `${100 + i} ${d.street}`;
  });
  const doc = await renderPacketPdf(payload, DEFAULT_SETTINGS);
  const all = pageTexts(doc).join('\n');
  assert.ok(all.includes('N ORCHARD AVE'), 'the first street must be banded');
  assert.ok(all.includes('S CEDAR ST'), 'the second street must be banded');
  assert.ok(/doors 1-6/.test(all), 'a band should say how much of the street is in this run');
  assert.ok(/doors 7-12/.test(all));
});

test('pen instructions and field labels clear the AA contrast floor', async () => {
  // SUBTLE (#9CA3AF) is 2.54:1 on white. It is fine for the skim-only footer and nothing
  // else — every string a volunteer has to be TOLD must be GRAY (4.83:1) or darker.
  const { GRAY, SUBTLE } = await import('./packetTheme.js');
  const lum = (c) => { const v = c.map((n) => n / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (c) => 1.05 / (lum(c) + 0.05);
  assert.ok(ratio(GRAY) >= 4.5, `GRAY is ${ratio(GRAY).toFixed(2)}:1`);
  assert.ok(ratio(SUBTLE) < 4.5, 'SUBTLE is the known-low one — kept only for the footer');
});

test('the cover never overflows — long race names and huge street lists', async () => {
  // The cover does NOT paginate, so everything on it has to be bounded. A dense downtown
  // book can touch 80+ street names, and an uncapped two-column list ran off the sheet.
  const longName = 'Committee to Elect Randall Marchetti to the Florida House of Representatives District 54';
  for (const [name, streetCount] of [
    ['Randy for HD54', 0], ['Randy for HD54', 6], [longName, 30], [longName, 120], [longName, 400],
  ]) {
    const payload = makePayload(4, 2);
    payload.campaign.name = name;
    payload.books[0].streets = Array.from({ length: streetCount }, (_, i) => ({
      name: `STREET ${i} AVENUE`, count: i + 1,
    }));
    const doc = await renderPacketPdf(payload, DEFAULT_SETTINGS);
    doc.setPage(1);
    for (const y of textYs(doc.internal.pages[1].join('\n'))) {
      assert.ok(y >= PAGE.MARGIN - 2, `cover ink at y=${y} with ${streetCount} streets is off the page`);
    }
  }
});

test('the field list packs notes BESIDE the door, not under it', async () => {
  // The whole point of the field layout is density. Stacked, the notes block is the tallest
  // thing on the door and the right half of the sheet sits empty while it runs; measured, that
  // costs 25% more pages. This pins the packing so nobody quietly stacks them again.
  const payload = makePayload(60, 2);
  const doc = await renderPacketPdf(payload, { ...DEFAULT_SETTINGS, layout: 'field', noteLines: 3 });
  const bodyPages = doc.getNumberOfPages() - 1; // minus the cover
  assert.ok(bodyPages <= 16, `60 doors should fit in ~15 body pages, took ${bodyPages}`);

  // And the extra room is free: a 4th note line must not cost a page.
  const four = await renderPacketPdf(payload, { ...DEFAULT_SETTINGS, layout: 'field', noteLines: 4 });
  assert.equal(four.getNumberOfPages(), doc.getNumberOfPages());
});

test('the cover says which order the doors are in', async () => {
  // Both orders look "wrong" to anyone expecting A-Z — a route revisits streets and the
  // postal city can flip mid-route — so the cover has to say what the order actually is.
  const routeBook = makePayload(4, 1);
  routeBook.books[0].printOrder = 'route';
  const routeCover = (await renderPacketPdf(routeBook, DEFAULT_SETTINGS)).internal.pages[1].join('\n');
  assert.ok(routeCover.includes('walking route'), 'route order must be named');
  assert.ok(routeCover.includes('postal'), 'the postal-city flip must be explained');

  const streetBook = makePayload(4, 1);
  streetBook.books[0].printOrder = 'street';
  const streetCover = (await renderPacketPdf(streetBook, DEFAULT_SETTINGS)).internal.pages[1].join('\n');
  assert.ok(streetCover.includes('street by street'), 'street order must be named');
});

// A real 1x1 JPEG, so addImage parses a genuine header rather than a placeholder string.
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const withFakeBrowser = async (fn) => {
  const saved = { d: globalThis.document, f: globalThis.fetch, c: globalThis.createImageBitmap };
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => TINY_JPEG,
    }),
  };
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  globalThis.fetch = async () => ({ ok: true, blob: async () => ({}) });
  try { return await fn(); } finally {
    globalThis.document = saved.d; globalThis.fetch = saved.f; globalThis.createImageBitmap = saved.c;
  }
};

const geoPayload = (n) => {
  const p = makePayload(n, 1);
  p.books[0].id = `geo-${n}-${Math.round(n * 7919)}`;
  p.books[0].doors.forEach((d, i) => {
    d.lng = -82.32 + (i % 5) * 0.004;
    d.lat = 28.31 + Math.floor(i / 5) * 0.004;
  });
  return p;
};

test('the cover map draws the walk over a fetched basemap', async () => {
  await withFakeBrowser(async () => {
    const doc = await renderPacketPdf(geoPayload(12), { ...DEFAULT_SETTINGS, mapboxToken: 'pk.test' });
    doc.setPage(1);
    const cover = doc.internal.pages[1].join('\n');
    assert.ok(/\/I\d|\/XObject/.test(cover), 'the basemap image must be placed on the cover');
    const all = pageTexts(doc).join('\n');
    assert.ok(all.includes('ORDER of the walk'), 'the caption must say it is order, not directions');
  });
});

test('no token means no map, and the packet is otherwise identical', async () => {
  // Failing open is the whole contract: a dead token, an offline laptop, or a blocked host
  // must cost the packet the map and nothing else.
  const withMap = await renderPacketPdf(geoPayload(12), { ...DEFAULT_SETTINGS, mapboxToken: null });
  const without = await renderPacketPdf(geoPayload(12), { ...DEFAULT_SETTINGS, showCoverMap: false });
  assert.equal(withMap.getNumberOfPages(), without.getNumberOfPages());
});

test('map geometry: fits the doors, north up, east right', async () => {
  const { fitView, makeProjector } = await import('./packetMapImage.js');
  const doors = [
    { lng: -82.32, lat: 28.31 }, { lng: -82.28, lat: 28.36 },
    { lng: -82.35, lat: 28.33 }, { lng: -82.30, lat: 28.30 },
  ];
  const W = 700, H = 320;
  const view = fitView(doors, W, H);
  const proj = makeProjector(view, W, H, 516, 236);
  for (const d of doors) {
    const q = proj(d.lng, d.lat);
    assert.ok(q.x >= 0 && q.x <= 516 && q.y >= 0 && q.y <= 236, `door ${d.lng},${d.lat} fell outside the map`);
  }
  assert.ok(proj(-82.3, 28.36).y < proj(-82.3, 28.30).y, 'north must be up');
  assert.ok(proj(-82.28, 28.33).x > proj(-82.35, 28.33).x, 'east must be right');
  // Zoom 0 puts the origin at the centre of a 512px world — pins the Mercator constant.
  assert.equal(Math.round(makeProjector({ lng: 0, lat: 0, zoom: 0 }, 512, 512, 512, 512)(0, 0).x), 256);
});

test('the race is the masthead', async () => {
  const payload = makePayload(4, 2);
  payload.campaign.name = 'Riverside City Council 2026';
  const doc = await renderPacketPdf(payload, DEFAULT_SETTINGS);
  doc.setPage(1);
  const cover = doc.internal.pages[1].join('\n');
  assert.ok(cover.includes('Riverside City Council 2026'), 'the race must appear on the cover');
  assert.ok(cover.includes('Ward 5'), 'the book name identifies the packet');
  // The R2-B07 style plate was removed — the book name does that job now.
  assert.ok(!/R\d+-B\d+/.test(pageTexts(doc).join('\n')), 'no packet code anywhere');
  // No clock on the paper — a packet goes stale by days, not minutes.
  assert.ok(!/\d:\d\d\s*(AM|PM)/.test(pageTexts(doc).join('\n')), 'no time of day anywhere');
});

test('the filename is book, campaign, kind, date', () => {
  // The book leads: a folder of per-packet files sorts and scans by the one thing that
  // differs between them, instead of burying it behind an identical campaign prefix.
  const p = makePayload(1, 1);
  p.campaign.name = 'Florida - HD54 Randy Maggard';
  p.books[0].name = 'Book 33';
  assert.equal(
    packetFilename(p, { layout: 'survey' }),
    'book-33-florida-hd54-randy-maggard-survey-packet-2026-08-06.pdf'
  );
  assert.equal(
    packetFilename(p, { layout: 'field' }),
    'book-33-florida-hd54-randy-maggard-field-list-2026-08-06.pdf'
  );

  // Asking for a survey packet on a campaign with no survey prints the field list, so the
  // filename has to say field list too.
  const noSurvey = makePayload(1, 1);
  noSurvey.books[0].survey = null;
  assert.match(packetFilename(noSurvey, { layout: 'survey' }), /field-list-2026-08-06\.pdf$/);

  // A run of several books has no one book name to use, so it says how many.
  p.books.push({ ...p.books[0], id: 'b2', name: 'Book 34' });
  assert.match(packetFilename(p, { layout: 'survey' }), /^2-books-.*-survey-packet-2026-08-06\.pdf$/);

  // Punctuation collapses; nothing trails a hyphen into ".pdf".
  const odd = makePayload(1, 1);
  odd.campaign.name = "Mayor's Race — 2026!!";
  odd.books[0].name = 'Ward 5 / Book C';
  assert.equal(
    packetFilename(odd, { layout: 'field' }),
    'ward-5-book-c-mayor-s-race-2026-field-list-2026-08-06.pdf'
  );
});

// ── splitting big books into small packets ───────────────────────────────────
// splitBooks slices a payload BEFORE the renderer sees it; these tests pin what the renderer
// does with the parts — separate physical packets, each self-contained. The chunking rules
// themselves are pinned in splitBooks.test.js.

test('a split book renders as separate packets: manifest, own covers, restarting page numbers', async () => {
  // 80 doors at target 35 → two parts of 40 (one street, so the cuts land on the ideals).
  const payload = splitBooks(makePayload(80, 1), 35);
  assert.equal(payload.books.length, 2);
  const doc = await renderPacketPdf(payload, DEFAULT_SETTINGS);
  const pages = pageTexts(doc);
  const all = pages.join('\n');

  // One book split into parts is now MULTIPLE physical packets to sign out, so the very
  // split that created them brings the hand-out sheet with it.
  assert.ok(pages[0].includes('Packet run'), 'the hand-out sheet must lead a split run');
  assert.ok(pages[0].includes('2 packets'), 'totals.books must count parts, not books');
  assert.ok(pages[0].includes('1 of 2'), 'each part gets its own manifest row');
  assert.ok(pages[0].includes('2 of 2'));

  // Two covers — each part is its own stapled unit with its own tally box.
  assert.equal(pages.filter((p) => p.includes('TALLY AS YOU GO')).length, 2);

  // Per-packet page numbering restarts: exactly one "Page 1 of" per part.
  assert.equal((all.match(/Page 1 of \d+/g) || []).length, 2, 'each part must restart at Page 1');
  assert.ok(all.includes('1 of 2'), 'the part name reaches the page furniture');

  // The manifest's reprint ranges must differ — same-id parts used to overwrite each other.
  const ranges = [...pages[0].matchAll(/\b(\d+)-(\d+)\b/g)].map((m) => m[0]);
  assert.ok(new Set(ranges).size >= 2, `manifest ranges must be distinct, got ${ranges.join(', ')}`);
});

test('street bands inside a part agree with its restarted door numbers', async () => {
  // Part 2 of a 12-door book split 6/6: its band must say "doors 1-6" — the part's own
  // numbering — never "doors 7-12" carried over from the parent book.
  const payload = makePayload(12, 1);
  payload.books[0].doors.forEach((d, i) => {
    d.street = i < 6 ? 'N ORCHARD AVE' : 'S CEDAR ST';
    d.addressLine1 = `${100 + i} ${d.street}`;
  });
  const out = splitBooks(payload, 10); // hardMax 13 < ... no: 12 <= 13 stays whole — force it
  assert.equal(out.books.length, 1, 'sanity: 12 doors at target 10 stays whole (under hardMax)');

  const big = makePayload(24, 1);
  big.books[0].doors.forEach((d, i) => {
    d.street = i < 12 ? 'N ORCHARD AVE' : 'S CEDAR ST';
    d.addressLine1 = `${100 + i} ${d.street}`;
  });
  const split = splitBooks(big, 12); // two parts, cut exactly at the street change
  assert.equal(split.books.length, 2);
  assert.deepEqual(split.books.map((b) => b.doorCount), [12, 12]);
  const doc = await renderPacketPdf(split, DEFAULT_SETTINGS);
  const all = pageTexts(doc).join('\n');
  assert.ok(/S CEDAR ST/.test(all));
  assert.ok(/doors 1-12/.test(all), 'each part bands its own doors 1..n');
  assert.ok(!/doors 13-24/.test(all), 'no band may carry the parent book’s numbering');
});

test('split parts each draw their own cover map', async () => {
  await withFakeBrowser(async () => {
    const payload = splitBooks(geoPayload(80), 35);
    assert.equal(payload.books.length, 2);
    // Distinct part ids are what keep the cover-map cache from serving part 1's basemap to
    // every part — the same trap geoPayload's per-fixture ids dodge.
    assert.notEqual(payload.books[0].id, payload.books[1].id);
    const doc = await renderPacketPdf(payload, { ...DEFAULT_SETTINGS, mapboxToken: 'pk.test' });
    const covers = pageTexts(doc).filter((p) => p.includes('TALLY AS YOU GO'));
    assert.equal(covers.length, 2);
    for (const cover of covers) {
      assert.ok(/\/I\d|\/XObject/.test(cover), 'every part cover must place its own basemap');
    }
  });
});

test('the filename counts packets when a split happened', () => {
  // One source book split in two: keep the book's identity, say how many packets.
  const one = splitBooks(makePayload(80, 1), 35);
  assert.equal(
    packetFilename(one, { layout: 'survey' }),
    'ward-5-book-c-2-packets-riverside-city-council-2026-survey-packet-2026-08-06.pdf'
  );

  // Several source books with at least one split: no single name, count the packets.
  const two = makePayload(80, 1);
  two.books.push({ ...two.books[0], id: 'b2', name: 'Book D' });
  const out = splitBooks(two, 35);
  assert.equal(out.books.length, 4);
  assert.match(packetFilename(out, { layout: 'survey' }), /^4-packets-.*-survey-packet-2026-08-06\.pdf$/);

  // Knob off → identity payload → the unsplit filename, byte-identical.
  const off = splitBooks(makePayload(1, 1), 0);
  assert.match(packetFilename(off, { layout: 'survey' }), /^ward-5-book-c-.*-survey-packet-2026-08-06\.pdf$/);
});

test('a long hand-out sheet continues on reserved pages up front, never after the books', async () => {
  // drawManifest runs LAST (it needs the page ranges), so a raw addPage() there appends to
  // the END of the document — the custody sheet's tail printed after every book, unbranded
  // and unnumbered. Splitting made long manifests mainline (120 packets at a 10-door knob),
  // so the pages are now reserved up front; this pins that the overflow rows land there.
  const p = makePayload(2, 1);
  const base = { ...p.books[0], survey: null };
  p.books = Array.from({ length: 40 }, (_, i) => ({ ...base, id: `mb${i}`, name: `Bk-${i + 1}-x` }));
  p.totals = { books: 40, doors: 80, voters: 80, omitted: 0 };
  const doc = await renderPacketPdf(p, { ...DEFAULT_SETTINGS, layout: 'field' });
  const pages = pageTexts(doc);

  const firstCover = pages.findIndex((t) => t.includes('TALLY AS YOU GO'));
  assert.ok(pages[0].includes('Packet run'), 'the hand-out sheet leads the document');
  assert.ok(firstCover >= 2, `40 rows must overflow one manifest page (first cover on page ${firstCover + 1})`);
  const manifest = pages.slice(0, firstCover).join('\n');
  for (let i = 1; i <= 40; i++) {
    assert.ok(manifest.includes(`Bk-${i}-x`), `packet ${i}'s row must be on the up-front manifest pages`);
  }
  // The last page is a book body page with the print-only footer — not an orphan manifest tail.
  assert.ok(pages[pages.length - 1].includes('print only'), 'no unbranded manifest page at the end');
});

// Pinned like PAGE_PIN_60_DOORS: the split fixture's page count moves only on deliberate
// layout changes. 80 doors → 2 parts of 40; each part carries a cover and (survey layout)
// a script page, which is the paper cost of splitting — visible here, and live in the studio.
// 83 = manifest + 2 × (cover + 40 atomic survey doors at one per page) — the script page
// shares the first door page, exactly as in the unsplit pin's accounting. 83 -> 85 when
// packets began starting on a fresh sheet: the manifest and the first part are both odd, so
// each takes one spare page rather than handing its last sheet's back to the next cover.
const PAGE_PIN_80_DOORS_SPLIT_35 = 85;

test('page count for a split fixture is pinned', async () => {
  const doc = await renderPacketPdf(splitBooks(makePayload(80, 2), 35), DEFAULT_SETTINGS);
  assert.equal(doc.getNumberOfPages(), PAGE_PIN_80_DOORS_SPLIT_35);
});
