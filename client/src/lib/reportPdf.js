import { percentsTo100 } from './percent.js';
import { deriveReportSections, formatCount, periodStrings, reportPdfFileName } from './reportDerive.js';
import { formatWeekRange } from './datePresets.js';
import { asciiSafe } from './pdfText.js';

// One-click client-side PDF of a client report. Composed from the report DATA (not a screenshot) via
// deriveReportSections — the SAME source the on-screen ClientReportView uses — so the document mirrors
// the screen's numbers, labels, colors, and section order. The coverage map is intentionally OMITTED
// (a WebGL canvas doesn't compose cleanly into a vector PDF, and the user asked to leave it out).
// jsPDF is loaded lazily (await import) so it never lands in the public report's initial bundle.

const MARGIN = 48; // points (1/72")
const GRAY = [107, 114, 128];
const SUBTLE = [156, 163, 175];
const DARK = [17, 24, 39];
const TRACK = [229, 231, 235];
const CARD = [249, 250, 251];
// The brand: the web's light-theme --brand token and Tailwind's brand-600 (index.css,
// tailwind.config.js) — the red the screen's Doors knocked card, door-goal bar and uncoloured bars wear.
// It was indigo here (WALK-11).
export const PDF_BRAND = '#dc2626';
const DEFAULT_BAR = PDF_BRAND;

// Approximate the on-screen accent tokens with print-friendly hexes (a PDF is always light).
const ACCENT_HEX = { brand: PDF_BRAND, green: '#16a34a', blue: '#2563eb', amber: '#d97706', red: '#dc2626' };

const BRAND_RGB = [220, 38, 38]; // PDF_BRAND, for a colour that can't be read
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6) return BRAND_RGB;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return BRAND_RGB;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const accentRgb = (a) => hexToRgb(ACCENT_HEX[a] || '#111827');

// jsPDF's built-in faces print WinAnsi only: one en dash, minus sign or curly quote dropped
// characters or turned a whole line into gaps (lib/pdfText.js). Folded first — keeping the middle
// dot, which WinAnsi prints.
const pdfSafe = (value) =>
  String(value ?? '')
    .split('·')
    .map(asciiSafe)
    .join('·');

const LOGO_MAX_W = 150;
const LOGO_MAX_H = 42;
// jsPDF embeds an image as every pixel it has, decoded — uncompressed by default, a 2000×2000 logo
// printed at 42 pt made a 16 MB PDF (PUBUX-2). So a logo bigger than about three pixels a printed
// point is redrawn on a canvas at that size first (still sharp in print and zoomed in), and the pixels
// go in deflated: 'MEDIUM' (deflate 6, PNG's Average filter) over 'FAST' (deflate 1, Sub) — as quick
// at these sizes, and a detailed 2000×2000 logo embedded without the canvas step (no DOM, as in the
// tests) came to 69 KB where 'FAST' left 913 KB.
const LOGO_PX_PER_PT = 3;
const LOGO_COMPRESSION = 'MEDIUM';

/** The logo as an <img> the browser has decoded, or null (no DOM here, or it can't be read). */
const loadImage = (dataUrl) =>
  new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return resolve(null);
    try {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch {
      resolve(null);
    }
    return undefined;
  });

/**
 * The logo ready to place: { data, w, h } — `w`×`h` its printed size in points (at most 150×42),
 * `data` a PNG data URL of at most about LOGO_PX_PER_PT pixels a point when a canvas could redraw it
 * — or null when it can't be read. Never throws.
 */
const fitLogo = async (doc, dataUrl) => {
  try {
    const img = await loadImage(dataUrl);
    const { width, height } = img ? { width: img.naturalWidth, height: img.naturalHeight } : doc.getImageProperties(dataUrl);
    const scale = Math.min(LOGO_MAX_W / width, LOGO_MAX_H / height, 1);
    if (!(scale > 0) || !Number.isFinite(scale)) return null;
    const w = width * scale;
    const h = height * scale;
    const pxW = Math.max(1, Math.round(w * LOGO_PX_PER_PT));
    const pxH = Math.max(1, Math.round(h * LOGO_PX_PER_PT));
    if (!img || (width <= pxW && height <= pxH)) return { data: dataUrl, w, h };
    const canvas = document.createElement('canvas');
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { data: dataUrl, w, h };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, pxW, pxH);
    const data = canvas.toDataURL('image/png');
    return { data: typeof data === 'string' && data.startsWith('data:image/png') ? data : dataUrl, w, h };
  } catch {
    return null;
  }
};

/** A Blob as a data URL — what jsPDF's addImage takes — or null. Never throws. */
export const blobToDataUrl = (blob) =>
  new Promise((resolve) => {
    if (!blob) return resolve(null);
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
    return undefined;
  });

/**
 * The client report as a PDF (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §H5): the org's logo top left
 * (`logoDataUrl`, a PNG data URL, or none); the scope, the period and its published, edited and
 * refreshed dates in the header; "Numbers as of …", the earlier-totals line and the team note when
 * they apply; "Powered by Doorline" in the footer; no map. The file is named for the campaign, the
 * scope and both dates.
 */
export async function generateReportPdf(report, { campaignName = '', orgName = '', logoDataUrl = null } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  // Every string this document prints goes through pdfSafe, including observations typed with
  // smart quotes.
  const rawText = doc.text.bind(doc);
  doc.text = (value, ...rest) => rawText(Array.isArray(value) ? value.map(pdfSafe) : pdfSafe(value), ...rest);
  const rawSplit = doc.splitTextToSize.bind(doc);
  doc.splitTextToSize = (value, ...rest) => rawSplit(pdfSafe(value), ...rest);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  let y = MARGIN;

  const sections = deriveReportSections(report);
  const periodTitle = periodStrings(sections.period).title;
  doc.setProperties({
    title: pdfSafe([campaignName, report.title || periodTitle, formatWeekRange(report.weekStart, report.weekEnd), sections.heading.scope].filter(Boolean).join(' · ')),
  });

  const ensure = (h) => {
    // A block taller than a whole page starts where it is when that's already the top of one — a
    // fresh page couldn't hold it either (it only left a blank page), and its lines check again.
    if (y + h > pageH - MARGIN && y > MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };
  const setFont = (size, style = 'normal', color = DARK) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const paragraph = (value, size, color, lineH) => {
    setFont(size, 'normal', color);
    doc.splitTextToSize(String(value), contentW).forEach((ln) => {
      ensure(lineH);
      doc.text(ln, MARGIN, y);
      y += lineH;
    });
  };
  // Every heading and label wraps to the width it has, in the current font (PUBUX-3): a long
  // campaign name, scope, survey question or observation heading ran off the page, out to
  // x = 1,000 pt. Blocks wrap first and count the lines in their height estimates.
  const wrap = (value, width = contentW) => doc.splitTextToSize(String(value ?? ''), width);
  // Parts joined by `sep` on as few lines as fit, so a wrapped line never starts or ends on a
  // separator; a part too long for a line of its own wraps by words.
  const pack = (parts, sep, width = contentW) => {
    const out = [];
    let line = '';
    for (const part of parts) {
      const joined = line ? `${line}${sep}${part}` : part;
      if (doc.getTextWidth(pdfSafe(joined)) <= width) {
        line = joined;
        continue;
      }
      if (line) out.push(line);
      const pieces = wrap(part, width);
      line = pieces.pop() || '';
      out.push(...pieces);
    }
    if (line) out.push(line);
    return out;
  };
  // A block moves to the next page whole when it fits on one; one taller than a page splits anyway,
  // so only its heading and first rows (`head`) are kept together — not a page left near empty.
  const keepTogether = (whole, head) => ensure(whole <= pageH - MARGIN * 2 ? whole : head);
  // Lines down the page, `lineH` apart, each checking for a page break; `after` is the gap below the
  // last — what the one-line version always had, so a heading that fits sits exactly as before.
  const printLines = (lines, lineH, after = lineH) => {
    lines.forEach((ln, i) => {
      ensure(lineH);
      doc.text(ln, MARGIN, y);
      y += i === lines.length - 1 ? after : lineH;
    });
  };

  // ── Header ──────────────────────────────────────────────────────────────────
  // The org's logo, top left, shrunk and compressed (fitLogo). A logo jsPDF can't read never breaks
  // the PDF (§F8).
  const logo = logoDataUrl ? await fitLogo(doc, logoDataUrl) : null;
  if (logo) {
    try {
      const top = MARGIN - 14;
      doc.addImage(logo.data, 'PNG', MARGIN, top, logo.w, logo.h, undefined, LOGO_COMPRESSION);
      y = top + logo.h + 24;
    } catch {
      /* no logo, then */
    }
  }
  setFont(20, 'bold', DARK);
  printLines(wrap(campaignName || report.title || periodTitle), 23, 18);
  if (orgName) {
    setFont(11, 'normal', GRAY);
    printLines(wrap(orgName), 14, 15);
  }
  setFont(10.5, 'normal', GRAY);
  // The scope says itself in the header — scoped numbers under an unlabeled header read as campaign
  // totals — and so does the period ("Weekly report", or the report's own title).
  const lead = campaignName ? report.title || periodTitle : !report.title ? null : periodTitle;
  printLines(pack([lead, formatWeekRange(report.weekStart, report.weekEnd), sections.heading.scope].filter(Boolean), '  ·  '), 13, 13);
  if (sections.heading.dates.length) {
    setFont(9, 'normal', SUBTLE);
    printLines(pack(sections.heading.dates, '  ·  '), 12, 12);
  }
  doc.setDrawColor(TRACK[0], TRACK[1], TRACK[2]);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  y += 20;

  // What qualifies the numbers: taken early, earlier totals that moved, the team rule.
  const notes = [sections.numbersAsOf, sections.earlierTotals, sections.teamNote].filter(Boolean);
  if (notes.length) {
    notes.forEach((n) => paragraph(n, 9.5, GRAY, 13));
    y += 10;
  }

  // ── Activity at a glance (KPI grid, 2 columns) ──────────────────────────────
  setFont(10.5, 'bold', GRAY);
  doc.text('ACTIVITY AT A GLANCE', MARGIN, y);
  y += 14;
  if (sections.isQuietWeek) {
    setFont(9, 'normal', SUBTLE);
    printLines(wrap(sections.pdfQuietText), 12, 14);
  }
  const cols = 2;
  const gap = 14;
  const cellW = (contentW - gap * (cols - 1)) / cols;
  const cellH = 58;
  for (let i = 0; i < sections.kpis.length; i += cols) {
    ensure(cellH + 6);
    sections.kpis.slice(i, i + cols).forEach((k, j) => {
      const x = MARGIN + j * (cellW + gap);
      doc.setFillColor(CARD[0], CARD[1], CARD[2]);
      doc.roundedRect(x, y, cellW, cellH, 6, 6, 'F');
      setFont(8.5, 'normal', GRAY);
      doc.text(String(k.label).toUpperCase(), x + 12, y + 17);
      const [r, g, b] = accentRgb(k.accent);
      setFont(22, 'bold', [r, g, b]);
      doc.text(String(k.value), x + 12, y + 40);
      const sub =
        k.delta === null
          ? k.hint || ''
          : k.delta > 0
            ? k.deltaText
            : k.deltaZeroText || '';
      if (sub) {
        setFont(8.5, 'normal', SUBTLE);
        doc.text(String(sub), x + 12, y + 52);
      }
    });
    y += cellH + 10;
  }
  y += 6;

  // ── Door goal: one progress track against a fixed target. Not barsBlock, which normalizes
  //    every bar against the biggest ITEM — here the denominator is the target, so a 34% goal
  //    would have rendered as a full-width bar. Progress only; the snapshot freezes no verdict.
  const goalBlock = (goal) => {
    ensure(74);
    setFont(13, 'bold', DARK);
    doc.text(String(goal.title), MARGIN, y);
    y += 13;
    setFont(9, 'normal', GRAY);
    doc.text(String(goal.subtitle), MARGIN, y);
    y += 18;
    setFont(9.5, 'normal', GRAY);
    doc.text(`${formatCount(goal.done)} of ${formatCount(goal.target)} doors`, MARGIN, y);
    setFont(9.5, 'bold', DARK);
    doc.text(`${goal.percent}%`, MARGIN + contentW, y, { align: 'right' });
    const trackY = y + 5;
    doc.setFillColor(TRACK[0], TRACK[1], TRACK[2]);
    doc.roundedRect(MARGIN, trackY, contentW, 6, 3, 3, 'F');
    if (goal.percent > 0) {
      const [r, g, b] = accentRgb('brand');
      doc.setFillColor(r, g, b);
      doc.roundedRect(MARGIN, trackY, Math.max(2, (goal.percent / 100) * contentW), 6, 3, 3, 'F');
    }
    y += 24;
    if (goal.remaining > 0) {
      setFont(9, 'normal', SUBTLE);
      doc.text(`${formatCount(goal.remaining)} doors to go.`, MARGIN, y);
      y += 14;
    }
    y += 10;
  };

  // A row's label wraps to the room left of its right-aligned figure (a long answer option ran under
  // the count); its extra lines push the row down by LABEL_LH each.
  const LABEL_LH = 12;
  const labelRows = (items, rightOf) =>
    items.map((it, idx) => {
      const right = rightOf(it, idx);
      setFont(9.5, 'bold', DARK);
      const room = contentW - doc.getTextWidth(pdfSafe(right)) - 12;
      setFont(9.5, 'normal', GRAY);
      const label = wrap(it.label, room);
      return { it, right, label, extra: (Math.max(1, label.length) - 1) * LABEL_LH };
    });

  // ── A labeled-bars block (contact / support / each survey question) ─────────
  const barsBlock = (title, subtitle, items, emphasis = false) => {
    const titleLH = emphasis ? 17 : 16;
    setFont(emphasis ? 14 : 13, 'bold', DARK);
    const titleLines = wrap(title);
    setFont(9, 'normal', GRAY);
    const subLines = subtitle ? wrap(subtitle) : [];
    const percents = percentsTo100(items.map((it) => it.count || 0));
    const rows = labelRows(items, (it, idx) => `${formatCount(it.count)}  (${percents[idx]}%)`);
    const rowsH = (list) => Math.max(1, list.length) * 24 + list.reduce((s, r) => s + r.extra, 0);
    const headH = (titleLines.length - 1) * titleLH + (subtitle ? 30 + (subLines.length - 1) * 11 : 18);
    keepTogether(headH + rowsH(rows) + 14, headH + rowsH(rows.slice(0, 3)));
    setFont(emphasis ? 14 : 13, 'bold', DARK);
    printLines(titleLines, titleLH, subtitle ? 13 : 16);
    if (subtitle) {
      setFont(9, 'normal', GRAY);
      printLines(subLines, 11, 15);
    }
    if (!items.length) {
      setFont(9.5, 'normal', SUBTLE);
      doc.text('No responses yet.', MARGIN, y);
      y += 18;
      return;
    }
    const max = Math.max(1, ...items.map((it) => it.count || 0));
    rows.forEach(({ it, right, label, extra }) => {
      ensure(24 + extra);
      setFont(9.5, 'normal', GRAY);
      label.forEach((ln, i) => doc.text(ln, MARGIN, y + i * LABEL_LH));
      setFont(9.5, 'bold', DARK);
      doc.text(right, MARGIN + contentW, y, { align: 'right' });
      const trackY = y + extra + 5;
      doc.setFillColor(TRACK[0], TRACK[1], TRACK[2]);
      doc.roundedRect(MARGIN, trackY, contentW, 6, 3, 3, 'F');
      const fillW = Math.max(2, ((it.count || 0) / max) * contentW);
      const [r, g, b] = hexToRgb(it.color || DEFAULT_BAR);
      doc.setFillColor(r, g, b);
      doc.roundedRect(MARGIN, trackY, fillW, 6, 3, 3, 'F');
      y += 24 + extra;
    });
    y += 10;
  };

  // ── Voter groups (tags): plain label/number rows — VOTER counts, no track/fill and no
  //    percent, because "identified · still current" are overlapping people, not shares. ──
  const tagsBlock = (section) => {
    setFont(13, 'bold', DARK);
    const titleLines = wrap(section.title);
    setFont(9, 'normal', GRAY);
    const subLines = wrap(section.subtitle || '');
    const rows = labelRows(section.items, (it) =>
      it.current != null
        ? `${formatCount(it.identified)} identified  ·  ${formatCount(it.current)} still current`
        : `${formatCount(it.identified)} identified`
    );
    const rowsH = (list) => Math.max(1, list.length) * 18 + list.reduce((s, r) => s + r.extra, 0);
    const headH = 30 + (titleLines.length - 1) * 16 + (Math.max(1, subLines.length) - 1) * 11;
    keepTogether(headH + rowsH(rows) + 10, headH + rowsH(rows.slice(0, 3)));
    setFont(13, 'bold', DARK);
    printLines(titleLines, 16, 13);
    setFont(9, 'normal', GRAY);
    printLines(subLines, 11, 15);
    rows.forEach(({ right, label, extra }) => {
      ensure(18 + extra);
      setFont(9.5, 'normal', GRAY);
      label.forEach((ln, i) => doc.text(ln, MARGIN, y + i * LABEL_LH));
      setFont(9.5, 'bold', DARK);
      doc.text(right, MARGIN + contentW, y, { align: 'right' });
      y += 18 + extra;
    });
    y += 10;
  };

  // Same order as the screen: goal frames the headline numbers, then the breakdowns slice them.
  if (sections.goal) goalBlock(sections.goal);
  barsBlock(sections.contact.title, sections.contact.subtitle, sections.contact.items);
  if (sections.support) {
    barsBlock(sections.support.title, sections.support.subtitle, sections.support.items, true);
  }
  if (sections.tags) tagsBlock(sections.tags);
  sections.others.forEach((b) => barsBlock(b.title, null, b.items));

  // ── Canvasser observations ──────────────────────────────────────────────────
  if (report.observations?.length) {
    ensure(30);
    setFont(10.5, 'bold', GRAY);
    doc.text('CANVASSER OBSERVATIONS', MARGIN, y);
    y += 16;
    report.observations.forEach((s) => {
      setFont(12, 'bold', DARK);
      const headLines = wrap(s.heading || '');
      // The heading stays with the first line of its text.
      ensure(30 + (Math.max(1, headLines.length) - 1) * 14);
      printLines(headLines, 14, 14);
      setFont(10, 'normal', GRAY);
      doc.splitTextToSize(String(s.body || ''), contentW).forEach((ln) => {
        ensure(14);
        doc.text(ln, MARGIN, y);
        y += 13;
      });
      y += 10;
    });
  }

  // ── What these numbers mean (the PDF can't show the on-screen "(i)" tooltips, so list the
  //    same definitions here — same `help` strings from reportDerive, single source of truth) ──
  const defs = [];
  for (const k of sections.kpis) if (k.help) defs.push([k.label, k.help]);
  if (sections.goal?.help) defs.push([sections.goal.title, sections.goal.help]);
  if (sections.contact?.help) defs.push([sections.contact.title, sections.contact.help]);
  for (const it of sections.contact?.items || []) if (it.help) defs.push([it.label, it.help]);
  if (sections.tags?.help) defs.push([sections.tags.title, sections.tags.help]);
  if (defs.length) {
    y += 4;
    ensure(34);
    setFont(10.5, 'bold', GRAY);
    doc.text('WHAT THESE NUMBERS MEAN', MARGIN, y);
    y += 16;
    defs.forEach(([term, desc]) => {
      // Each measured in the font it prints in (the description was measured in the previous
      // one's), and the term's lines counted.
      setFont(9.5, 'bold', DARK);
      const termLines = wrap(term);
      setFont(9, 'normal', GRAY);
      const lines = doc.splitTextToSize(String(desc), contentW);
      ensure(15 + (Math.max(1, termLines.length) - 1) * 12 + lines.length * 12);
      setFont(9.5, 'bold', DARK);
      printLines(termLines, 12, 13);
      setFont(9, 'normal', GRAY);
      lines.forEach((ln) => {
        ensure(12);
        doc.text(ln, MARGIN, y);
        y += 12;
      });
      y += 6;
    });
  }

  // ── Footer on every page ────────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    setFont(8, 'normal', SUBTLE);
    doc.text('Powered by Doorline', pageW - MARGIN, pageH - 24, { align: 'right' });
    if (pages > 1) doc.text(`Page ${p} of ${pages}`, MARGIN, pageH - 24);
  }

  doc.save(reportPdfFileName(report, { campaignName }));
}
