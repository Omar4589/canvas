import {
  PAGE, TYPE, BRAND, DARK, GRAY, SUBTLE, RULE, HAIRLINE, WHITE,
  BOOK_COLORS, STATUS_INK, STATUS_LABEL, drawDoorlinePin,
} from './packetTheme.js';
import { buildSurveyPrintModel } from './surveyPrintModel.js';
import { asciiSafe } from '../pdfText.js';
import { resolveLayout } from './packetSettings.js';
import { fetchCoverMap } from './packetMapImage.js';

// The packet renderer. jsPDF is loaded lazily so it never lands in the console's initial bundle.
//
// TWO RULES HOLD THIS FILE TOGETHER.
//
// 1. MEASURE AND PAINT ARE ONE CODE PATH. Every draw helper takes a `paint` flag and returns
//    the height it consumed; called with paint=false it measures without emitting ink. Two
//    separate implementations would drift the moment anyone edited one of them, and the
//    symptom — text sliding under the footer — only shows up on page 40 of a print run.
//
// 2. NOTHING IS TALLER THAN A PAGE. The door is decomposed into question-sized segments, so
//    the packer never meets a block it cannot place. reportPdf.js's ensure() is deliberately
//    NOT reused: it adds a page and then draws the block anyway, which silently runs long
//    blocks off the bottom of the sheet.

const OUTCOMES = ['Not home', 'Refused', 'Wrong address', 'Surveyed', 'Restricted'];
const OUTCOMES_FIELD = ['Not home', 'Refused', 'Wrong address', 'Spoke with', 'Restricted'];

const setFont = (doc, size, style = 'normal', color = DARK) => {
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
};

const text = (doc, s, x, y, opts) => doc.text(asciiSafe(s), x, y, opts);

// A row of outlined pills (circle one) or squares (tick any), wrapped to the content width.
// Returns the height consumed whether or not it painted.
const chipRow = (doc, x, y, w, items, shape, paint, opts = {}) => {
  const size = opts.size || TYPE.option;
  setFont(doc, size, 'normal', DARK);
  let cx = x;
  let cy = y;
  let rows = 1;
  for (const item of items) {
    const label = asciiSafe(item.text ?? item);
    const tw = doc.getTextWidth(label);
    const boxW = shape === 'pill' ? tw + 12 : tw + 15;
    const advance = boxW + 6;
    if (cx + boxW > x + w && cx > x) { cx = x; cy += 17; rows += 1; }
    if (paint) {
      const ink = item.muted ? SUBTLE : GRAY;
      doc.setDrawColor(ink[0], ink[1], ink[2]);
      doc.setLineWidth(0.6);
      if (shape === 'pill') {
        doc.roundedRect(cx, cy, tw + 12, 14, 7, 7, 'S');
        setFont(doc, size, 'normal', item.muted ? GRAY : DARK);
        text(doc, label, cx + 6, cy + 9.8);
      } else {
        doc.rect(cx, cy + 2, 10.5, 10.5, 'S');
        setFont(doc, size, 'normal', DARK);
        text(doc, label, cx + 15, cy + 9.8);
      }
      // A write-in option ("Other:") needs somewhere to write.
      if (item.writeIn) {
        const lineX = cx + tw + 16;
        const lineW = Math.min(120, x + w - lineX);
        if (lineW > 20) {
          doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
          doc.setLineWidth(0.5);
          doc.line(lineX, cy + 11, lineX + lineW, cy + 11);
        }
      }
    }
    cx += advance;
    if (item.writeIn) cx += 130;
    if (cx > x + w) { cx = x; cy += 17; rows += 1; }
  }
  return rows * 17 + 2;
};

// 20pt ≈ 7.1mm, i.e. college-ruled. The previous 12pt pitch was 4.23mm — tighter than any
// ruled paper on sale — so a one-handed note written outdoors crossed three of them.
const NOTE_PITCH = 20;
const ruledLines = (doc, x, y, w, n, firstIndent, paint) => {
  if (paint) {
    doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    doc.setLineWidth(0.5);
    for (let i = 0; i < n; i++) {
      const lx = x + (i === 0 ? firstIndent : 0);
      doc.line(lx, y + 12 + i * NOTE_PITCH, x + w, y + 12 + i * NOTE_PITCH);
    }
  }
  return 6 + n * NOTE_PITCH;
};

const microLabel = (doc, s, x, y, paint) => {
  if (paint) {
    setFont(doc, TYPE.micro, 'bold', GRAY);
    text(doc, s.toUpperCase(), x, y + 9);
  }
  return 0;
};

// ── segments ─────────────────────────────────────────────────────────────────
// A door becomes a flat list of atoms. `voter` marks which resident an atom belongs to so a
// page break in the middle of a person can reprint their name with "(cont.)".

const voterMetaLine = (v) =>
  [v.party, v.age != null ? String(v.age) : null, v.gender].filter(Boolean).join(' · ');

const questionSegment = (q, ctx) => ({
  kind: 'question',
  measure: (doc, x, y, paint) => {
    let h = 0;
    const indent = q.gate ? 10 : 0;
    if (q.gate) {
      if (paint) {
        setFont(doc, TYPE.gate, 'italic', GRAY);
        text(doc, q.gate, x + indent, y + 8);
        doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
        doc.setLineWidth(1.5);
        doc.line(x + 3, y + 1, x + 3, y + 11);
      }
      h += 12;
    }
    if (paint) {
      setFont(doc, TYPE.questionLabel, 'bold', DARK);
      text(doc, `${q.number}. ${q.label}`, x + indent, y + h + 8);
      setFont(doc, TYPE.penVerb, 'italic', GRAY);
      text(doc, q.verb, x + ctx.contentW, y + h + 8, { align: 'right' });
    }
    h += 13;
    if (q.type === 'text') {
      if (paint) {
        doc.setLineDashPattern([2, 2], 0);
        doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
        doc.setLineWidth(0.5);
        doc.line(x + indent + 4, y + h + 10, x + ctx.contentW, y + h + 10);
        // ALWAYS reset: a dash pattern left set leaks into every later stroke on the page,
        // including the notes rules and the door separator.
        doc.setLineDashPattern([], 0);
      }
      h += 18;
    } else {
      h += chipRow(
        doc, x + indent + 4, y + h, ctx.contentW - indent - 4,
        q.options, q.type === 'single_choice' ? 'pill' : 'square', paint
      );
    }
    if (q.skipHint) {
      if (paint) {
        setFont(doc, TYPE.gate, 'italic', GRAY);
        text(doc, `-> ${q.skipHint}`, x + indent + 4, y + h + 7);
      }
      h += 11;
    }
    return h + 4;
  },
});

const buildDoorSegments = (door, ctx) => {
  const segs = [];
  const survey = ctx.layout === 'survey' ? ctx.survey : null;

  // Resident roster. In the survey layout these are just names above one shared grid; in
  // the field layout they are the whole content.
  for (const v of door.voters) {
    segs.push({
      kind: 'voter',
      voterId: v.id,
      voterName: v.name,
      measure: (doc, x, y, paint) => {
        if (paint) {
          const size = ctx.layout === 'field' ? TYPE.voterNameCompact : TYPE.voterName;
          setFont(doc, size, 'bold', DARK);
          text(doc, v.name, x + 6, y + 9);
          const nameW = doc.getTextWidth(asciiSafe(v.name));
          setFont(doc, TYPE.voterMeta, 'normal', GRAY);
          const meta = voterMetaLine(v);
          if (meta) text(doc, meta, x + 6 + nameW + 10, y + 9);
          if (v.phone) {
            setFont(doc, TYPE.voterMeta, 'normal', GRAY);
            text(doc, v.phone, x + ctx.contentW, y + 9, { align: 'right' });
          } else if (v.voted) {
            setFont(doc, TYPE.voterMeta, 'bold', [21, 128, 61]);
            text(doc, 'voted', x + ctx.contentW, y + 9, { align: 'right' });
          }
        }
        return ctx.layout === 'field' ? 13 : 14;
      },
    });
  }

  if (survey) {
    // Who answered — only meaningful when more than one person lives here. One grid per
    // door (not per voter) is what keeps a two-resident door on one page.
    if (door.voters.length > 1) {
      segs.push({
        kind: 'who',
        measure: (doc, x, y, paint) => {
          microLabel(doc, 'Who answered?', x + 6, y, paint);
          const chips = [
            ...door.voters.map((v) => ({ text: v.name.split(' ')[0] })),
            { text: 'Someone else' },
          ];
          return chipRow(doc, x + 100, y, ctx.contentW - 100, chips, 'pill', paint);
        },
      });
    }
    segs.push({
      kind: 'rule',
      measure: (doc, x, y, paint) => {
        if (paint) {
          doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
          doc.setLineWidth(0.5);
          doc.line(x + 6, y + 4, x + ctx.contentW, y + 4);
        }
        return 9;
      },
    });
    for (const q of survey.questions) segs.push(questionSegment(q, ctx));
  }

  // Tail: what happened at the door, then room to write. Kept as one atom so an outcome
  // row never lands on a different sheet from its own notes.
  segs.push({
    kind: 'tail',
    measure: (doc, x, y, paint) => {
      let h = 0;
      if (ctx.showOutcome) {
        h += 4;
        microLabel(doc, 'Door outcome', x + 6, y + h, paint);
        const labels = ctx.layout === 'field' ? OUTCOMES_FIELD : OUTCOMES;
        h += chipRow(doc, x + 92, y + h, ctx.contentW - 92, labels.map((t) => ({ text: t })), 'square', paint);
      }
      if (ctx.noteLines > 0) {
        microLabel(doc, 'Notes', x + 6, y + h, paint);
        h += ruledLines(doc, x + 6, y + h, ctx.contentW - 6, ctx.noteLines, 44, paint);
      }
      if (paint) {
        doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
        doc.setLineWidth(0.5);
        doc.line(x, y + h + 7, x + ctx.contentW, y + h + 7);
      }
      return h + 14;
    },
  });

  return segs;
};

// The address header, redrawn at the top of every chunk a door occupies. A SOLID badge is a
// new door; a HOLLOW one means "you are looking at the back half of the house you're standing
// at" — readable while flipping a page, without reading a word.
const drawAddressHeader = (doc, x, y, door, ctx, continued, paint) => {
  if (paint) {
    if (continued) {
      doc.setDrawColor(BRAND[0], BRAND[1], BRAND[2]);
      doc.setLineWidth(1);
      doc.circle(x + 11, y + 11, 11, 'S');
      setFont(doc, TYPE.seqNumber, 'bold', BRAND);
    } else {
      doc.setFillColor(BRAND[0], BRAND[1], BRAND[2]);
      doc.circle(x + 11, y + 11, 11, 'F');
      setFont(doc, TYPE.seqNumber, 'bold', WHITE);
    }
    text(doc, String(door.seq), x + 11, y + 15.5, { align: 'center' });

    setFont(doc, TYPE.addressLine1, 'bold', DARK);
    text(doc, continued ? `${door.addressLine1} (cont.)` : door.addressLine1, x + 30, y + 12);
    setFont(doc, TYPE.addressMeta, 'normal', GRAY);
    const meta = [
      [door.city, door.state].filter(Boolean).join(', '),
      door.zipCode,
      door.addressLine2,
    ].filter(Boolean).join(' · ');
    if (meta) text(doc, meta, x + 30, y + 24);

    if (ctx.showPriorStatus && !continued && door.status && door.status !== 'unknocked') {
      const ink = STATUS_INK[door.status] || GRAY;
      const label = STATUS_LABEL[door.status] || String(door.status).toUpperCase();
      const when = door.lastActionAt
        ? ` · ${new Date(door.lastActionAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}`
        : '';
      const full = `${label}${when}`;
      setFont(doc, TYPE.micro, 'bold', ink);
      const w = doc.getTextWidth(asciiSafe(full)) + 16;
      doc.setDrawColor(ink[0], ink[1], ink[2]);
      doc.setLineWidth(0.6);
      doc.roundedRect(x + ctx.contentW - w, y + 2, w, 15, 7.5, 7.5, 'S');
      text(doc, full, x + ctx.contentW - w / 2, y + 12, { align: 'center' });
    }
  }
  return 30;
};

// A street band. The packet groups doors street by street, but until this existed the page
// gave no sign of it — a volunteer flipping from door 16 to door 17 saw an identical red badge
// and had to read the street words inside the address to notice they had crossed onto a new
// road. The whole reordering was invisible on the one surface that matters.
const STREET_BAND_H = 26;
const drawStreetBand = (doc, x, y, street, range, ctx, paint) => {
  if (paint) {
    doc.setFillColor(249, 250, 251);
    doc.rect(x, y, ctx.contentW, 20, 'F');
    doc.setDrawColor(BRAND[0], BRAND[1], BRAND[2]);
    doc.setLineWidth(2.5);
    doc.line(x, y, x, y + 20);
    setFont(doc, 12.5, 'bold', DARK);
    text(doc, street, x + 9, y + 14);
    if (range) {
      setFont(doc, TYPE.micro, 'normal', GRAY);
      text(doc, range, x + ctx.contentW - 6, y + 14, { align: 'right' });
    }
  }
  return STREET_BAND_H;
};

// ── page furniture ───────────────────────────────────────────────────────────
const drawBand = (doc, payload, book, ctx) => {
  const x = PAGE.MARGIN;
  const y = PAGE.MARGIN;
  drawDoorlinePin(doc, x, y, 15);

  setFont(doc, TYPE.headerCampaign, 'bold', DARK);
  text(doc, payload.campaign.name, x + 24, y + 8);
  setFont(doc, TYPE.headerOrg, 'normal', GRAY);
  text(doc, payload.organization.name, x + 24, y + 18);

  const right = x + ctx.contentW;
  setFont(doc, TYPE.headerBook, 'bold', DARK);
  text(doc, book.name, right, y + 8, { align: 'right' });
  setFont(doc, TYPE.headerMeta, 'normal', GRAY);
  // Deliberately NOT the in-app assignee. A packet goes to whoever picks it up off the
  // folding table, which is rarely who the app thinks holds the book — printing a name here
  // would be wrong more often than right, and wrong in a way nobody can correct with a pen.
  // The cover carries a write-in line instead.
  const bits = [
    book.roundNumber ? `Round ${book.roundNumber}` : null,
    `${book.doorCount} doors`,
  ].filter(Boolean);
  text(doc, bits.join(' · '), right, y + 19, { align: 'right' });

  const stripe = BOOK_COLORS[book.colorIndex % BOOK_COLORS.length];
  doc.setFillColor(stripe[0], stripe[1], stripe[2]);
  doc.rect(x, y + 30, ctx.contentW, 4, 'F');

  // Who walked THIS sheet — on every page, not just the cover, because one book routinely
  // gets torn in half and handed to two volunteers.
  const dateW = 100;
  const nameEnd = x + ctx.contentW - dateW - 34;
  setFont(doc, TYPE.micro, 'bold', GRAY);
  text(doc, 'WALKED BY', x, y + 50);
  text(doc, 'DATE', x + ctx.contentW - dateW - 30, y + 50);
  doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
  doc.setLineWidth(0.5);
  doc.line(x + 52, y + 52, nameEnd, y + 52);
  doc.line(x + ctx.contentW - dateW, y + 52, x + ctx.contentW, y + 52);

  // No closing rule. It used to sit 4pt under the write-in underline, which read as one
  // smudged double line — and the colour stripe above already says where the header ends.
  // What the first address needed was space, not another rule: BODY_TOP is now 24pt below
  // the write-in line instead of 2pt.
};

const drawFooterRule = (doc, payload, ctx) => {
  const x = PAGE.MARGIN;
  const y = PAGE.BODY_BOTTOM + 8;
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.setLineWidth(0.5);
  doc.line(x, y, x + ctx.contentW, y);
  setFont(doc, TYPE.footer, 'normal', SUBTLE);
  // The print-only contract, on every single sheet. Someone who picks up one loose page
  // must not be able to assume this syncs.
  text(doc, `${ctx.printedAt} · print only — nothing written here syncs to Doorline`, x, y + 10);
};

// ── covers and reference pages ───────────────────────────────────────────────
const drawManifest = (doc, payload, ctx) => {
  const x = PAGE.MARGIN;
  let y = PAGE.MARGIN + 10;
  setFont(doc, TYPE.coverTitle, 'bold', DARK);
  text(doc, 'Packet run', x, y);
  y += 22;
  setFont(doc, TYPE.coverBody, 'normal', GRAY);
  text(doc, `${payload.campaign.name} · ${payload.organization.name}`, x, y);
  y += 14;
  text(doc, `${ctx.printedAt} · ${payload.totals.books} packets · ${payload.totals.doors} doors`, x, y);
  y += 26;

  setFont(doc, TYPE.micro, 'bold', SUBTLE);
  text(doc, 'HAND OUT AGAINST THIS SHEET — ONE LINE PER PACKET', x, y);
  y += 16;

  // The last three are ruled cells, not data — custody gets written in ink, at the table
  // where the packets actually are. Widths sum to CONTENT_W (516).
  const cols = [
    { label: 'Book', w: 186 },
    { label: 'Doors', w: 42 },
    { label: 'Pages', w: 46 },
    { label: 'Walked by', w: 124, write: true },
    { label: 'Out', w: 59, write: true },
    { label: 'In', w: 59, write: true },
  ];
  setFont(doc, TYPE.micro, 'bold', SUBTLE);
  let cx = x;
  for (const c of cols) { text(doc, c.label.toUpperCase(), cx, y); cx += c.w; }
  y += 6;
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.setLineWidth(0.5);
  doc.line(x, y, x + ctx.contentW, y);
  y += 4;

  for (const book of payload.books) {
    const range = ctx.pageRanges.get(book.id);
    cx = x;
    setFont(doc, TYPE.option, 'bold', DARK);
    text(doc, book.name, cx, y + 11); cx += cols[0].w;
    setFont(doc, TYPE.option, 'normal', DARK);
    text(doc, String(book.doorCount), cx, y + 11); cx += cols[1].w;
    setFont(doc, TYPE.option, 'normal', GRAY);
    text(doc, range ? `${range.from}-${range.to}` : '—', cx, y + 11); cx += cols[2].w;
    doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    doc.setLineWidth(0.5);
    for (const c of cols.filter((k) => k.write)) {
      doc.line(cx, y + 13, cx + c.w - 10, y + 13);
      cx += c.w;
    }
    y += 20;
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.line(x, y - 3, x + ctx.contentW, y - 3);
    if (y > PAGE.BODY_BOTTOM - 20) { doc.addPage(); y = PAGE.MARGIN + 10; }
  }

  y += 14;
  setFont(doc, TYPE.gate, 'italic', GRAY);
  doc.splitTextToSize(
    'Nothing written in these packets reaches Doorline. Books walked on paper will keep reading as unknocked in coverage, on the map, and in reports.',
    ctx.contentW
  ).forEach((ln) => { text(doc, ln, x, y); y += 12; });
};

// The walk, drawn over a basemap. The image is a plain rectangle fetched from Mapbox; every
// line and dot here is projected locally, so no household coordinate is ever in that request.
const COVER_MAP_H = 236;
const drawCoverMap = (doc, book, ctx, x, y, map) => {
  const W = ctx.contentW;
  const pts = book.doors
    .filter((d) => Number.isFinite(d.lng) && Number.isFinite(d.lat))
    .map((d) => map.project(d.lng, d.lat));
  if (pts.length < 2) return 0;

  doc.addImage(map.dataUrl, 'JPEG', x, y, W, COVER_MAP_H);
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.setLineWidth(0.5);
  doc.rect(x, y, W, COVER_MAP_H, 'S');

  // Order of the walk. Deliberately straight door-to-door — we hold the doors, not a routing
  // engine, and a line pretending to follow streets would be a turn-by-turn claim we can't back.
  doc.setLineJoin('round');
  doc.setLineCap('round');
  doc.setDrawColor(BRAND[0], BRAND[1], BRAND[2]);
  doc.setLineWidth(1.1);
  for (let i = 1; i < pts.length; i++) {
    doc.line(x + pts[i - 1].x, y + pts[i - 1].y, x + pts[i].x, y + pts[i].y);
  }

  doc.setFillColor(DARK[0], DARK[1], DARK[2]);
  for (const p of pts) doc.circle(x + p.x, y + p.y, 1.1, 'F');

  // Where you start and where you end — the two things worth finding at a glance.
  const cap = (p, label) => {
    doc.setFillColor(WHITE[0], WHITE[1], WHITE[2]);
    doc.circle(x + p.x, y + p.y, 7.5, 'F');
    doc.setDrawColor(BRAND[0], BRAND[1], BRAND[2]);
    doc.setLineWidth(1.6);
    doc.circle(x + p.x, y + p.y, 7.5, 'S');
    setFont(doc, TYPE.micro, 'bold', BRAND);
    text(doc, label, x + p.x, y + p.y + 2.8, { align: 'center' });
  };
  cap(pts[0], 'A');
  cap(pts[pts.length - 1], 'B');
  return COVER_MAP_H;
};

const drawCover = (doc, payload, book, ctx, coverMap) => {
  const x = PAGE.MARGIN;
  let y = PAGE.MARGIN + 34;

  // ── masthead: the RACE, biggest thing on the page ──
  drawDoorlinePin(doc, x, y - 24, 26);
  const mastheadX = x + 34;
  setFont(doc, TYPE.coverCampaign, 'bold', DARK);
  const nameLines = doc.splitTextToSize(asciiSafe(payload.campaign.name), ctx.contentW - 34);
  for (const line of nameLines) {
    text(doc, line, mastheadX, y);
    y += 27;
  }
  setFont(doc, TYPE.coverOrg, 'normal', GRAY);
  text(doc, payload.organization.name, mastheadX, y - 5);
  y += 16;

  y += 14;

  // ── the identifier: which book this is ──
  setFont(doc, TYPE.coverBook, 'bold', DARK);
  text(doc, book.name, x, y - 10);
  setFont(doc, TYPE.coverBody, 'normal', GRAY);
  const bits = [
    book.roundNumber ? `Round ${book.roundNumber}` : null,
    `${book.doorCount} doors`,
    `${book.voterCount} residents`,
  ].filter(Boolean);
  text(doc, bits.join(' · '), x, y + 5);
  y += 26;

  // The book's colour, so the cover matches the stripe on every page behind it and the
  // swatch on the Turf Cutting map.
  const stripe = BOOK_COLORS[book.colorIndex % BOOK_COLORS.length];
  doc.setFillColor(stripe[0], stripe[1], stripe[2]);
  doc.rect(x, y, ctx.contentW, 4, 'F');
  y += 22;

  // Say which order the doors are in. Both orders are geographic, and both look "wrong" to
  // anyone expecting alphabetical — a route revisits streets, and out here the postal city
  // flips mid-route because the San Antonio / Dade City ZIP line cuts through the
  // neighborhood. One sentence here stops the packet being reported as mis-sorted.
  setFont(doc, TYPE.coverBody, 'italic', GRAY);
  const orderNote = book.printOrder === 'street'
    ? 'Doors run street by street, in walking order — up one side and back down the other.'
    : 'Doors follow the walking route, not A-Z — a street can come up in more than one stretch, and the city name is postal, so it may alternate while the route stays local.';
  doc.splitTextToSize(orderNote, ctx.contentW).forEach((ln) => {
    text(doc, ln, x, y);
    y += 12;
  });
  y += 10;

  // Who is carrying this — filled in with a pen, by whoever actually takes it. The app's
  // assignment is not printed anywhere: on a paper day the packet goes to whoever is
  // standing there, and a pre-printed name that turns out to be wrong cannot be corrected.
  const nameW = ctx.contentW * 0.62;
  setFont(doc, TYPE.micro, 'bold', GRAY);
  text(doc, 'WALKED BY', x, y);
  text(doc, 'DATE', x + nameW + 16, y);
  doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
  doc.setLineWidth(0.75);
  doc.line(x, y + 22, x + nameW, y + 22);
  doc.line(x + nameW + 16, y + 22, x + ctx.contentW, y + 22);
  y += 44;

  if (coverMap) {
    const drawn = drawCoverMap(doc, book, ctx, x, y, coverMap);
    if (drawn) {
      y += drawn + 12;
      setFont(doc, TYPE.gate, 'italic', GRAY);
      text(doc, 'A is your first door, B your last. The line is the ORDER of the walk, drawn door to door — not directions along the streets.', x, y);
      y += 18;
    }
  }

  if (book.streets.length) {
    setFont(doc, TYPE.micro, 'bold', SUBTLE);
    text(doc, 'STREETS IN THIS PACKET', x, y);
    y += 14;
    setFont(doc, TYPE.coverBody, 'normal', DARK);

    // The cover does NOT paginate, so the list is capped to the rows that actually fit above
    // the tally box and the footer note. A book in a dense downtown grid can touch 80+ street
    // names, and an uncapped two-column list ran clean off the bottom of the sheet.
    const RESERVED = 150; // tally box + omission line + print-only note
    const rowsThatFit = Math.max(1, Math.floor((PAGE.H - PAGE.MARGIN - RESERVED - y) / 13));
    const shown = Math.min(book.streets.length, rowsThatFit * 2);
    const half = Math.ceil(shown / 2);
    const colW = ctx.contentW / 2;
    book.streets.slice(0, shown).forEach((s, i) => {
      const col = i < half ? 0 : 1;
      const row = i < half ? i : i - half;
      text(doc, `${s.name}  ${s.count}`, x + col * colW, y + row * 13);
    });
    y += Math.max(half, 1) * 13;
    if (shown < book.streets.length) {
      setFont(doc, TYPE.gate, 'italic', GRAY);
      text(doc, `+ ${book.streets.length - shown} more streets — every address is listed inside.`, x, y + 10);
      y += 14;
    }
    y += 18;
  }

  if (book.omitted.total > 0) {
    setFont(doc, TYPE.coverBody, 'normal', GRAY);
    // The total only. A per-reason breakdown on paper edges toward outing a household to
    // whoever holds it; the admin sees the split on screen instead.
    text(
      doc,
      `${book.doorCount} of ${book.doorCount + book.omitted.total} doors printed. ${book.omitted.total} removed by current suppression rules.`,
      x, y
    );
    y += 20;
  }

  setFont(doc, TYPE.micro, 'bold', SUBTLE);
  text(doc, 'TALLY AS YOU GO', x, y);
  y += 8;
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.setLineWidth(0.5);
  doc.roundedRect(x, y, ctx.contentW, 54, 4, 4, 'S');
  const labels = ctx.layout === 'field' ? OUTCOMES_FIELD : OUTCOMES;
  const cw = ctx.contentW / labels.length;
  labels.forEach((l, i) => {
    setFont(doc, TYPE.micro, 'normal', GRAY);
    text(doc, l, x + i * cw + cw / 2, y + 16, { align: 'center' });
    doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    doc.line(x + i * cw + 12, y + 40, x + (i + 1) * cw - 12, y + 40);
  });
  y += 74;

  setFont(doc, TYPE.gate, 'italic', GRAY);
  text(doc, `Printed ${ctx.printedAt}. Print only — nothing written in this packet syncs to Doorline.`, x, y);
};

const drawScriptPage = (doc, survey, ctx) => {
  const x = PAGE.MARGIN;
  let y = PAGE.BODY_TOP;
  setFont(doc, TYPE.coverTitle, 'bold', DARK);
  text(doc, 'What to say', x, y);
  y += 26;
  const para = (label, body) => {
    if (!body) return;
    setFont(doc, TYPE.micro, 'bold', SUBTLE);
    text(doc, label.toUpperCase(), x, y);
    y += 13;
    setFont(doc, TYPE.coverBody, 'normal', DARK);
    doc.splitTextToSize(asciiSafe(body), ctx.contentW).forEach((ln) => {
      if (y > PAGE.BODY_BOTTOM - 12) { doc.addPage(); y = PAGE.BODY_TOP; }
      text(doc, ln, x, y);
      y += 13;
    });
    y += 12;
  };
  para('Opening', survey.intro);
  for (const s of survey.scripts) {
    para(`${s.question} — if they say "${s.option}"`, s.script);
  }
  para('Closing', survey.closing);
};

// ── the run ──────────────────────────────────────────────────────────────────
export const renderPacketPdf = async (payload, settings) => {
  const { jsPDF } = await import('jspdf');
  // compress:true is a measured ~5x size win (2.3MB -> 453KB at 200 doors) for ~10% more time.
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });

  const layout = resolveLayout(settings, payload.books.some((b) => b.survey));
  const ctx = {
    contentW: PAGE.CONTENT_W,
    layout,
    noteLines: settings.noteLines,
    showOutcome: settings.showOutcome,
    showPriorStatus: settings.showPriorStatus,
    // Date only. A packet goes stale by DAYS — someone opting out on Thursday is still in a
    // Wednesday printout — so the hour told a volunteer nothing and just added clutter.
    printedAt: new Date(payload.generatedAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    }),
    pageRanges: new Map(),
    survey: null,
  };

  const pageOwner = []; // pdf page number -> book, for the second numbering pass
  let first = true;
  const newPage = (book) => {
    if (!first) doc.addPage();
    first = false;
    if (book) {
      drawBand(doc, payload, book, ctx);
      drawFooterRule(doc, payload, ctx);
    }
    pageOwner[doc.getNumberOfPages()] = book || null;
    return PAGE.BODY_TOP;
  };

  // Manifest first so it travels with the stacks and cannot be lost.
  if (settings.showManifest && payload.books.length > 1) {
    newPage(null);
    // Ranges are filled after paging; draw the manifest last onto this reserved page.
    ctx.manifestPage = doc.getNumberOfPages();
  }

  for (const book of payload.books) {
    ctx.survey = book.survey ? buildSurveyPrintModel(book.survey) : null;
    // jsPDF opens with one blank page, so the very first newPage() reuses it rather than
    // adding one — the cover lands on the page that already exists.
    const from = first ? doc.getNumberOfPages() : doc.getNumberOfPages() + 1;

    newPage(null);
    // Fetched per book and memoised, so turning a knob re-renders the PDF without re-hitting
    // Mapbox. Returns null on any failure — a packet must never fail to print over a map.
    const coverMap = settings.showCoverMap
      ? await fetchCoverMap({
          doors: book.doors,
          token: settings.mapboxToken,
          boxW: PAGE.CONTENT_W,
          boxH: COVER_MAP_H,
          cacheKey: book.id,
        })
      : null;
    drawCover(doc, payload, book, ctx, coverMap);
    pageOwner[doc.getNumberOfPages()] = book;

    if (layout === 'survey' && ctx.survey && settings.showScriptPage &&
        (ctx.survey.intro || ctx.survey.closing || ctx.survey.scripts.length)) {
      newPage(book);
      drawScriptPage(doc, ctx.survey, ctx);
    }

    // CONTIGUOUS runs, in walk order. A route that leaves a street and comes back later gets
    // a SECOND run, and each band describes the stretch in front of the volunteer.
    //
    // This used to be first-seen..last-seen for the whole book, which on a route-ordered book
    // printed "Corbin Ridge St · doors 12-28" over a run that actually ended at 16 — the label
    // claimed seventeen doors of one street where the walk had four separate chunks.
    const runs = [];
    const runIndexOf = new Array(book.doors.length);
    book.doors.forEach((d, i) => {
      const k = d.street || '';
      const last = runs[runs.length - 1];
      if (last && last.street === k) last.to = i + 1;
      else runs.push({ street: k, from: i + 1, to: i + 1 });
      runIndexOf[i] = runs.length - 1;
    });
    // A street the route returns to later says so, instead of looking like the whole street.
    const laterRun = new Set();
    runs.forEach((r, i) => {
      if (runs.some((o, j) => j > i && o.street === r.street)) laterRun.add(i);
    });

    let y = newPage(book);
    let lastStreet = null;
    for (const [doorIdx, door] of book.doors.entries()) {
      const segs = buildDoorSegments(door, ctx);
      let idx = 0;
      let continued = false;
      let currentVoter = null;

      const street = door.street || '';
      if (street && street !== lastStreet) {
        // The band plus the address header plus the first atom must fit together — a band
        // stranded at the foot of a page announces a street that starts overleaf.
        const firstH = segs[0].measure(doc, PAGE.MARGIN, y, false);
        if (y + STREET_BAND_H + 30 + firstH > PAGE.BODY_BOTTOM && y > PAGE.BODY_TOP) {
          y = newPage(book);
        }
        const ri = runIndexOf[doorIdx];
        const r = runs[ri];
        const span = r.to > r.from ? `doors ${r.from}-${r.to}` : `door ${r.from}`;
        const label = laterRun.has(ri) ? `${span} · back later` : span;
        drawStreetBand(doc, PAGE.MARGIN, y, street, label, ctx, true);
        y += STREET_BAND_H;
        lastStreet = street;
      }

      while (idx < segs.length) {
        const headerH = 30;
        // Does the header plus at least ONE atom fit in what's left? If not, turn the page
        // rather than stranding a lone address at the bottom of a sheet.
        const firstH = segs[idx].measure(doc, PAGE.MARGIN, y, false);
        if (y + headerH + firstH > PAGE.BODY_BOTTOM && y > PAGE.BODY_TOP) {
          y = newPage(book);
        }

        drawAddressHeader(doc, PAGE.MARGIN, y, door, ctx, continued, true);
        y += headerH;

        // A break inside one person's block reprints their name so the answers below are
        // never attributed to whoever happens to be at the top of the next page.
        if (continued && currentVoter) {
          setFont(doc, TYPE.voterName, 'bold', DARK);
          text(doc, `${currentVoter} (cont.)`, PAGE.MARGIN + 6, y + 9);
          y += 16;
        }

        while (idx < segs.length) {
          const seg = segs[idx];
          const h = seg.measure(doc, PAGE.MARGIN, y, false);
          if (y + h > PAGE.BODY_BOTTOM) break;
          seg.measure(doc, PAGE.MARGIN, y, true);
          if (seg.kind === 'voter') currentVoter = seg.voterName;
          y += h;
          idx += 1;
        }

        if (idx < segs.length) {
          y = newPage(book);
          continued = true;
        }
      }
    }

    ctx.pageRanges.set(book.id, { from, to: doc.getNumberOfPages() });
  }

  if (ctx.manifestPage) {
    doc.setPage(ctx.manifestPage);
    drawManifest(doc, payload, ctx);
  }

  // Second pass: per-book page numbers. A volunteer holds ONE book, so "Book C · Page 7 of
  // 12" is meaningful where "Page 84 of 312" is not. The manifest carries absolute ranges
  // so a director can still reprint by range.
  const total = doc.getNumberOfPages();
  const counts = new Map();
  for (let p = 1; p <= total; p++) {
    const b = pageOwner[p];
    if (b) counts.set(b.id, (counts.get(b.id) || 0) + 1);
  }
  const seen = new Map();
  for (let p = 1; p <= total; p++) {
    const b = pageOwner[p];
    if (!b) continue;
    const n = (seen.get(b.id) || 0) + 1;
    seen.set(b.id, n);
    doc.setPage(p);
    setFont(doc, TYPE.footer, 'normal', SUBTLE);
    text(
      doc,
      `${b.name} · Page ${n} of ${counts.get(b.id)}`,
      PAGE.MARGIN + PAGE.CONTENT_W,
      PAGE.BODY_BOTTOM + 18,
      { align: 'right' }
    );
  }

  return doc;
};

export const packetFilename = (payload, settings) => {
  const camp = String(payload.campaign.name || 'campaign').replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
  const kind = settings.layout === 'field' ? 'field-list' : 'walk-packet';
  const day = new Date(payload.generatedAt).toISOString().slice(0, 10);
  return `${camp}-${kind}-${day}.pdf`.replace(/-+/g, '-').toLowerCase();
};
