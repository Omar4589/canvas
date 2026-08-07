import {
  PAGE, TYPE, BRAND, DARK, GRAY, SUBTLE, RULE, HAIRLINE, WHITE,
  BOOK_COLORS, STATUS_INK, STATUS_LABEL, drawDoorlinePin,
} from './packetTheme.js';
import { buildSurveyPrintModel } from './surveyPrintModel.js';
import { asciiSafe } from '../pdfText.js';
import { resolveLayout } from './packetSettings.js';

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
    const boxW = shape === 'pill' ? tw + 12 : tw + 11;
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
        doc.rect(cx, cy + 3.5, 7, 7, 'S');
        setFont(doc, size, 'normal', DARK);
        text(doc, label, cx + 11, cy + 9.8);
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

const ruledLines = (doc, x, y, w, n, firstIndent, paint) => {
  if (paint) {
    doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    doc.setLineWidth(0.5);
    for (let i = 0; i < n; i++) {
      const lx = x + (i === 0 ? firstIndent : 0);
      doc.line(lx, y + 10 + i * 12, x + w, y + 10 + i * 12);
    }
  }
  return 4 + n * 12;
};

const microLabel = (doc, s, x, y, paint) => {
  if (paint) {
    setFont(doc, TYPE.micro, 'bold', SUBTLE);
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
      setFont(doc, TYPE.penVerb, 'italic', SUBTLE);
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

// ── page furniture ───────────────────────────────────────────────────────────
const drawBand = (doc, payload, book, ctx) => {
  const x = PAGE.MARGIN;
  const y = PAGE.MARGIN;
  drawDoorlinePin(doc, x, y, 15);

  setFont(doc, TYPE.headerCampaign, 'bold', DARK);
  text(doc, payload.campaign.name, x + 24, y + 8);
  setFont(doc, TYPE.headerOrg, 'normal', GRAY);
  text(doc, payload.organization.name, x + 24, y + 18);

  const right = x + ctx.contentW - 106;
  setFont(doc, TYPE.headerBook, 'bold', DARK);
  text(doc, book.name, right, y + 8, { align: 'right' });
  setFont(doc, TYPE.headerMeta, 'normal', GRAY);
  const bits = [
    book.roundNumber ? `Round ${book.roundNumber}` : null,
    `${book.doorCount} doors`,
    book.assignedTo,
  ].filter(Boolean);
  text(doc, bits.join(' · '), right, y + 19, { align: 'right' });

  // Code plate — how a packet found on a desk three weeks later says what it is.
  const plateX = x + ctx.contentW - 96;
  doc.setDrawColor(BRAND[0], BRAND[1], BRAND[2]);
  doc.setLineWidth(1);
  doc.roundedRect(plateX, y, 96, 24, 4, 4, 'S');
  setFont(doc, TYPE.plate, 'bold', BRAND);
  text(doc, book.code, plateX + 48, y + 16, { align: 'center' });

  const stripe = BOOK_COLORS[book.colorIndex % BOOK_COLORS.length];
  doc.setFillColor(stripe[0], stripe[1], stripe[2]);
  doc.rect(x, y + 30, ctx.contentW, 4, 'F');
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.setLineWidth(0.5);
  doc.line(x, y + 39, x + ctx.contentW, y + 39);
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

  const cols = [
    { label: 'Code', w: 62 },
    { label: 'Book', w: 168 },
    { label: 'Doors', w: 44 },
    { label: 'Pages', w: 48 },
    { label: 'Out', w: 97 },
    { label: 'In', w: 97 },
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
    setFont(doc, TYPE.option, 'bold', BRAND);
    text(doc, book.code, cx, y + 11); cx += cols[0].w;
    setFont(doc, TYPE.option, 'normal', DARK);
    text(doc, book.name, cx, y + 11); cx += cols[1].w;
    text(doc, String(book.doorCount), cx, y + 11); cx += cols[2].w;
    setFont(doc, TYPE.option, 'normal', GRAY);
    text(doc, range ? `${range.from}-${range.to}` : '—', cx, y + 11); cx += cols[3].w;
    // Ruled cells — custody is recorded in ink, on the table where the packets are.
    doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    doc.line(cx, y + 13, cx + cols[4].w - 10, y + 13); cx += cols[4].w;
    doc.line(cx, y + 13, cx + cols[5].w - 10, y + 13);
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

const drawCover = (doc, payload, book, ctx) => {
  const x = PAGE.MARGIN;
  let y = PAGE.MARGIN + 60;

  doc.setDrawColor(BRAND[0], BRAND[1], BRAND[2]);
  doc.setLineWidth(2);
  doc.roundedRect(x, y - 34, 200, 46, 6, 6, 'S');
  setFont(doc, TYPE.coverPlate, 'bold', BRAND);
  text(doc, book.code, x + 100, y, { align: 'center' });
  y += 44;

  setFont(doc, TYPE.coverTitle, 'bold', DARK);
  text(doc, book.name, x, y);
  y += 22;
  setFont(doc, TYPE.coverBody, 'normal', GRAY);
  text(doc, `${payload.campaign.name} · ${payload.organization.name}`, x, y);
  y += 15;
  const bits = [
    book.roundNumber ? `Round ${book.roundNumber}` : null,
    `${book.doorCount} doors`,
    `${book.voterCount} residents`,
    book.assignedTo ? `Assigned: ${book.assignedTo}` : null,
  ].filter(Boolean);
  text(doc, bits.join(' · '), x, y);
  y += 30;

  if (book.streets.length) {
    setFont(doc, TYPE.micro, 'bold', SUBTLE);
    text(doc, 'STREETS IN THIS PACKET', x, y);
    y += 14;
    setFont(doc, TYPE.coverBody, 'normal', DARK);
    const half = Math.ceil(book.streets.length / 2);
    const colW = ctx.contentW / 2;
    book.streets.forEach((s, i) => {
      const col = i < half ? 0 : 1;
      const row = i < half ? i : i - half;
      text(doc, `${s.name}  ${s.count}`, x + col * colW, y + row * 13);
    });
    y += Math.max(half, 1) * 13 + 18;
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
    printedAt: new Date(payload.generatedAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
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
    drawCover(doc, payload, book, ctx);
    pageOwner[doc.getNumberOfPages()] = book;

    if (layout === 'survey' && ctx.survey && settings.showScriptPage &&
        (ctx.survey.intro || ctx.survey.closing || ctx.survey.scripts.length)) {
      newPage(book);
      drawScriptPage(doc, ctx.survey, ctx);
    }

    let y = newPage(book);
    for (const door of book.doors) {
      const segs = buildDoorSegments(door, ctx);
      let idx = 0;
      let continued = false;
      let currentVoter = null;

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
