import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';

// The client report PDF (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §H5), built for real with jsPDF:
// the org's logo top left — and a logo jsPDF can't read never breaks the PDF (§F8); the scope, the
// period and the dates in the header; the notes; "Powered by Doorline"; a name that carries the
// campaign, the scope and both dates; text folded to what jsPDF's built-in faces can print (an en
// dash used to drop out of every header line); and the web's red brand, not indigo (WALK-11).

// The same module instance reportPdf.js's `import('jspdf')` resolves to in node.
const { jsPDF } = await import(new URL('../../node_modules/jspdf/dist/jspdf.node.min.js', import.meta.url).href);
const { generateReportPdf } = await import('./reportPdf.js');

let saved = null;
jsPDF.API.save = function save(name) {
  saved = { name, out: this.output() };
};

// A 2×1 RGBA PNG, built by hand.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(2, 0);
ihdr.writeUInt32BE(1, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(Buffer.from([0, 220, 38, 38, 255, 255, 255, 255, 255]))),
  chunk('IEND', Buffer.alloc(0)),
]);
const LOGO = `data:image/png;base64,${png.toString('base64')}`;

const report = {
  campaignType: 'survey',
  title: '',
  weekStart: '2026-10-13',
  weekEnd: '2026-10-19',
  scope: { kind: 'team', label: 'Volunteer team' },
  publishedOn: '2026-10-20',
  editedOn: '2026-10-21',
  numbersThrough: '2026-10-18',
  earlierTotals: { changes: [{ card: 'doorsKnocked', delta: -120 }], since: { weekStart: '2026-10-06', weekEnd: '2026-10-12' } },
  stats: {
    cumulative: { totals: { doorsKnocked: 3412, surveysTaken: 1980 }, contactBreakdown: { surveyed: 2000, not_home: 1412 }, surveyBreakdowns: [] },
    period: { totals: { doorsKnocked: 412 } },
  },
  observations: [{ heading: 'Voter intent', body: 'They’re “leaning” our way – mostly.' }],
};

const textRuns = (out) => [...out.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]);

test('the PDF: logo, header, notes, footer and name — and every line printable', async () => {
  await generateReportPdf(report, { campaignName: 'Fall 2026', orgName: 'Fox Bryant', logoDataUrl: LOGO });
  assert.equal(saved.name, 'fall-2026-team-volunteer-team-weekly-report-2026-10-13-to-2026-10-19.pdf');
  assert.match(saved.out, /\/Subtype \/Image/, 'the logo is drawn');
  const runs = textRuns(saved.out);
  const has = (s) => runs.some((r) => r.includes(s));
  assert.ok(has('Fall 2026') && has('Fox Bryant'));
  assert.ok(has('Weekly report  ·  Oct 13 - Oct 19, 2026  ·  Team: Volunteer team'), runs.join(' | '));
  assert.ok(has('Published Oct 20  ·  Edited Oct 21'));
  assert.ok(has('Numbers as of Oct 18 - the period was still running.'));
  assert.ok(has('Earlier totals were updated by -120 doors since the Oct 6 - Oct 12 report.'));
  assert.ok(has("A home both teams visited counts in each team's report."));
  assert.ok(has('+412 this week'));
  assert.ok(has('They\'re "leaning" our way - mostly.'), 'smart quotes and dashes folded, not dropped');
  assert.ok(has('Powered by Doorline'));
  assert.ok(!runs.some((r) => r.includes('\u0000')), 'no line fell back to two-byte text (which prints as gaps)');
});

test('a logo jsPDF cannot read never breaks the PDF', async () => {
  saved = null;
  await generateReportPdf(report, { campaignName: 'Fall 2026', orgName: 'Fox Bryant', logoDataUrl: 'data:image/png;base64,AAAA' });
  assert.ok(saved, 'still saved');
  assert.doesNotMatch(saved.out, /\/Subtype \/Image/);
  assert.ok(textRuns(saved.out).some((r) => r.includes('Powered by Doorline')));
});

// A W×H RGBA PNG of a red bar on transparency, built by hand like the one above.
const bigPng = (W, H) => {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(W, 0);
  head.writeUInt32BE(H, 4);
  head[8] = 8;
  head[9] = 6;
  const rows = [];
  for (let yy = 0; yy < H; yy += 1) {
    const row = Buffer.alloc(1 + W * 4);
    for (let xx = 0; xx < W; xx += 1) {
      if (xx > W * 0.05 && xx < W * 0.95 && yy > H * 0.2 && yy < H * 0.8) row.set([200, 30, 40, 255], 1 + xx * 4);
    }
    rows.push(row);
  }
  const file = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${file.toString('base64')}`;
};
const imageXObjects = (out) => [...out.matchAll(/\/Subtype \/Image([\s\S]*?)stream/g)].map((m) => m[1]);

test('a big logo is compressed: a 1000×1000 logo makes a PDF of tens of KB, not megabytes (PUBUX-2)', async () => {
  await generateReportPdf(report, { campaignName: 'Fall 2026', orgName: 'Fox Bryant', logoDataUrl: bigPng(1000, 1000) });
  const images = imageXObjects(saved.out);
  assert.ok(images.length >= 1, 'the logo is drawn');
  assert.ok(images.every((d) => /\/FlateDecode/.test(d)), `every image stream deflated: ${images.join(' | ')}`);
  // Uncompressed, its pixels alone were 4 MB (1000 × 1000 × RGB + alpha).
  assert.ok(saved.out.length < 100 * 1024, `PDF is ${Math.round(saved.out.length / 1024)} KB`);
});

test('in a browser the logo is redrawn at about 3 pixels a printed point before it is embedded (PUBUX-2)', async () => {
  const canvases = [];
  globalThis.Image = class {
    set src(value) {
      this.given = value;
      setTimeout(() => {
        this.naturalWidth = 2000;
        this.naturalHeight = 2000;
        this.onload();
      });
    }
  };
  globalThis.document = {
    createElement: (tag) => {
      const canvas = { tag, width: 0, height: 0, draws: [] };
      canvas.getContext = () => ({ drawImage: (img, x, y, w, h) => canvas.draws.push({ img, x, y, w, h }) });
      canvas.toDataURL = (type) => (type === 'image/png' ? LOGO : null); // the 2×1 PNG stands in for the redraw
      canvases.push(canvas);
      return canvas;
    },
  };
  try {
    await generateReportPdf(report, { campaignName: 'Fall 2026', logoDataUrl: 'data:image/png;base64,big-original' });
  } finally {
    delete globalThis.Image;
    delete globalThis.document;
  }
  assert.equal(canvases.length, 1);
  const [c] = canvases;
  // Printed at 42×42 pt (the 42 pt height cap), drawn at 3× that.
  assert.deepEqual([c.tag, c.width, c.height], ['canvas', 126, 126]);
  assert.equal(c.draws.length, 1);
  assert.equal(c.draws[0].img.given, 'data:image/png;base64,big-original');
  assert.deepEqual([c.draws[0].w, c.draws[0].h], [126, 126]);
  const [img] = imageXObjects(saved.out);
  assert.match(img, /\/Width 2\b[\s\S]*\/Height 1\b/, 'the redrawn image is what went in, not the original');
});

// Every text run of a PDF: page, x, size, weight and text — and its width in jsPDF's own Helvetica
// metrics, to check nothing runs past the right margin (the reviewer's pdfprobe, condensed).
const measure = new jsPDF({ unit: 'pt', format: 'letter' });
const runsOf = (out) => {
  const fontOf = {};
  for (const m of out.matchAll(/(\d+) 0 obj\s*<<\s*\/Type \/Font\s*\/BaseFont \/([\w-]+)/g)) fontOf[m[1]] = m[2];
  const res = {};
  for (const m of out.matchAll(/\/F(\d+) (\d+) 0 R/g)) res[`F${m[1]}`] = fontOf[m[2]];
  const runs = [];
  let page = 0;
  for (const s of out.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    if (!/BT/.test(s[1])) continue;
    page += 1;
    for (const bt of s[1].matchAll(/BT([\s\S]*?)ET/g)) {
      const tf = bt[1].match(/\/(F\d+) ([\d.]+) Tf/);
      const td = bt[1].match(/([\d.-]+) ([\d.-]+) Td/);
      const text = [...bt[1].matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1')).join('');
      if (!tf || !td) continue;
      measure.setFont('helvetica', /Bold/.test(res[tf[1]] || '') ? 'bold' : 'normal');
      measure.setFontSize(Number(tf[2]));
      runs.push({ page, x: Number(td[1]), y: Number(td[2]), size: Number(tf[2]), text, right: Number(td[1]) + measure.getTextWidth(text) });
    }
  }
  return runs;
};
const RIGHT_EDGE = 612 - 48;

test('every heading and label wraps inside the margins (PUBUX-3)', async () => {
  const longQ = 'If the election for County Commission District 7 were held today, would you vote for Hernández, for Smith, or are you still undecided?';
  const longOpt = 'Definitely Hernández, and planning to vote early in person at the main library downtown on the first Saturday of early voting';
  const long = {
    ...report,
    title: 'Final push before early voting: North Tampa precincts and the Seminole Heights neighborhood walk',
    scope: { kind: 'team', label: 'Volunteer team · Seminole Heights and Old Seminole Heights combined Saturday crew' },
    supportQuestionKey: 'support',
    stats: {
      ...report.stats,
      cumulative: {
        ...report.stats.cumulative,
        surveyBreakdowns: [
          { questionKey: 'support', questionLabel: longQ, type: 'single_choice', options: [{ option: longOpt, count: 1234 }, { option: 'Undecided', count: 456 }] },
          { questionKey: 'q2', questionLabel: `How important is ${'property taxes and the county budget '.repeat(3).trim()} to you?`, type: 'single_choice', options: [{ option: 'Very', count: 9 }] },
        ],
        tagBreakdowns: [{ tag: 'Strong supporters who also asked for a yard sign and volunteered for election day phone banking', identifiedVoters: 1234567, currentVoters: 1200000 }],
      },
    },
    observations: [{ heading: 'What we heard at the doors in the northern precincts about the transit referendum and property taxes', body: 'Mostly receptive.' }],
  };
  await generateReportPdf(long, { campaignName: 'Re-elect Commissioner María José Hernández-Villanueva, District 7 — Hillsborough County', orgName: 'Fox Bryant Field Strategies' });
  const runs = runsOf(saved.out);
  const past = runs.filter((r) => r.right > RIGHT_EDGE + 0.5);
  assert.deepEqual(past.map((r) => `${Math.round(r.right)} ${r.text}`), [], 'nothing past the right margin');
  const text = runs.map((r) => r.text).join(' ');
  for (const s of ['Re-elect Commissioner', 'District 7 - Hillsborough County', 'Support - If the election', 'still undecided?', 'neighborhood walk', 'Saturday crew', 'transit referendum and property taxes', 'phone banking']) {
    assert.ok(text.includes(s), `"${s}" is printed (wrapped, not cut)`);
  }
  // The header line wraps between its parts, never on a separator.
  const header = runs.filter((r) => r.page === 1 && r.size === 10.5 && !/^[A-Z ]+$/.test(r.text));
  assert.ok(header.length >= 2, header.map((r) => r.text).join(' | '));
  assert.ok(header.every((r) => !/^\s*·|·\s*$/.test(r.text)), header.map((r) => r.text).join(' | '));
  // A wrapped option label stays on the left of its count, on the count's line first.
  const count = runs.find((r) => r.text === '1,234  (73%)');
  const label = runs.find((r) => r.text.startsWith('Definitely Hern'));
  assert.ok(count && label && label.y === count.y && label.right < count.x, `${label?.right} < ${count?.x}`);
});

test('a question taller than a page starts where it is, keeping its heading with its first rows', async () => {
  const many = {
    ...report,
    observations: [],
    stats: {
      ...report.stats,
      cumulative: {
        ...report.stats.cumulative,
        surveyBreakdowns: [
          { questionKey: 'many', questionLabel: 'Which of these thirty issues matter most?', type: 'multiple_choice', options: Array.from({ length: 30 }, (_, i) => ({ option: `Issue ${i + 1}`, count: 300 - i })) },
        ],
      },
    },
  };
  await generateReportPdf(many, { campaignName: 'Fall 2026' });
  const runs = runsOf(saved.out);
  const title = runs.find((r) => r.text === 'Which of these thirty issues matter most?');
  const first = runs.find((r) => r.text === 'Issue 1');
  assert.equal(title.page, 1, 'not pushed to a fresh page it could not fit on either');
  assert.equal(first.page, title.page, 'with its first row');
  assert.ok(runs.some((r) => r.text === 'Issue 30' && r.page > 1), 'and the rest runs on');
});

test('a 14-day report never says "week"; a one-day report names its day', async () => {
  await generateReportPdf({ ...report, weekEnd: '2026-10-26', scope: { kind: 'campaign' }, stats: { ...report.stats, period: { totals: {} } } }, { campaignName: 'Fall 2026' });
  assert.equal(saved.name, 'fall-2026-whole-campaign-report-2026-10-13-to-2026-10-26.pdf');
  const runs = textRuns(saved.out);
  assert.ok(runs.some((r) => r.includes('Quiet stretch - no new doors knocked in these 14 days.')));
  assert.ok(!runs.some((r) => /week/i.test(r)), runs.filter((r) => /week/i.test(r)).join(' | '));
  await generateReportPdf({ ...report, weekStart: '2026-10-24', weekEnd: '2026-10-24' }, {});
  assert.equal(saved.name, 'team-volunteer-team-daily-report-2026-10-24.pdf');
  assert.ok(textRuns(saved.out).some((r) => r.includes('+412 that day')));
});

test('the PDF wears the red brand the web wears — its --brand token — never the old indigo (WALK-11)', async () => {
  const { PDF_BRAND } = await import('./reportPdf.js');
  // The web's light-theme token (the first --brand in index.css; html.dark lifts it for contrast, and a PDF is always light).
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  const [, rgb] = css.match(/--brand:\s*(\d+ \d+ \d+);/);
  const hex = `#${rgb.split(' ').map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  assert.equal(PDF_BRAND, hex);
  await generateReportPdf(report, { campaignName: 'Fall 2026' });
  const fills = new Set([...saved.out.matchAll(/(\d*\.?\d+ \d*\.?\d+ \d*\.?\d+) rg/g)].map((m) => m[1]));
  const brand = rgb.split(' ').map((v) => Number((Number(v) / 255).toFixed(3)).toString()).join(' ');
  assert.ok(fills.has(brand), `the Doors knocked figure is drawn in ${PDF_BRAND} (${brand} rg): ${[...fills].join(' | ')}`);
  for (const indigo of ['0.31 0.275 0.898', '0.388 0.4 0.945']) assert.ok(!fills.has(indigo), `no indigo (${indigo})`);
});
