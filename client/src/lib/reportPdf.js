import { percentsTo100 } from './percent.js';
import { deriveReportSections, formatCount } from './reportDerive.js';
import { formatWeekRange } from './datePresets.js';

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
const DEFAULT_BAR = '#4f46e5';

// Approximate the on-screen accent tokens with print-friendly hexes (a PDF is always light).
const ACCENT_HEX = { brand: '#4f46e5', green: '#16a34a', blue: '#2563eb', amber: '#d97706', red: '#dc2626' };

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6) return [99, 102, 241];
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [99, 102, 241];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const accentRgb = (a) => hexToRgb(ACCENT_HEX[a] || '#111827');

export async function generateReportPdf(report, { campaignName = '', orgName = '' } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  let y = MARGIN;

  const sections = deriveReportSections(report);

  const ensure = (h) => {
    if (y + h > pageH - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };
  const setFont = (size, style = 'normal', color = DARK) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };

  // ── Header ──────────────────────────────────────────────────────────────────
  setFont(20, 'bold', DARK);
  doc.text(campaignName || report.title || 'Weekly report', MARGIN, y);
  y += 18;
  if (orgName) {
    setFont(11, 'normal', GRAY);
    doc.text(orgName, MARGIN, y);
    y += 15;
  }
  setFont(10.5, 'normal', GRAY);
  const titlePrefix = report.title && (campaignName || orgName) ? `${report.title}  ·  ` : '';
  doc.text(`${titlePrefix}${formatWeekRange(report.weekStart, report.weekEnd)}`, MARGIN, y);
  y += 12;
  doc.setDrawColor(TRACK[0], TRACK[1], TRACK[2]);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  y += 22;

  // ── Activity at a glance (KPI grid, 2 columns) ──────────────────────────────
  setFont(10.5, 'bold', GRAY);
  doc.text('ACTIVITY AT A GLANCE', MARGIN, y);
  y += 14;
  if (sections.isQuietWeek) {
    setFont(9, 'normal', SUBTLE);
    doc.text('Quiet week — no new doors knocked in this period. Totals below are cumulative.', MARGIN, y);
    y += 14;
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
            ? `+${formatCount(k.delta)} this week`
            : k.deltaZeroText || '';
      if (sub) {
        setFont(8.5, 'normal', SUBTLE);
        doc.text(String(sub), x + 12, y + 52);
      }
    });
    y += cellH + 10;
  }
  y += 6;

  // ── A labeled-bars block (contact / support / each survey question) ─────────
  const barsBlock = (title, subtitle, items, emphasis = false) => {
    const estHeight = (subtitle ? 30 : 18) + Math.max(1, items.length) * 24 + 14;
    ensure(estHeight);
    setFont(emphasis ? 14 : 13, 'bold', DARK);
    doc.text(String(title), MARGIN, y);
    y += subtitle ? 13 : 16;
    if (subtitle) {
      setFont(9, 'normal', GRAY);
      doc.text(String(subtitle), MARGIN, y);
      y += 15;
    }
    if (!items.length) {
      setFont(9.5, 'normal', SUBTLE);
      doc.text('No responses yet.', MARGIN, y);
      y += 18;
      return;
    }
    const percents = percentsTo100(items.map((it) => it.count || 0));
    const max = Math.max(1, ...items.map((it) => it.count || 0));
    items.forEach((it, idx) => {
      ensure(24);
      setFont(9.5, 'normal', GRAY);
      doc.text(String(it.label), MARGIN, y);
      setFont(9.5, 'bold', DARK);
      doc.text(`${formatCount(it.count)}  (${percents[idx]}%)`, MARGIN + contentW, y, { align: 'right' });
      const trackY = y + 5;
      doc.setFillColor(TRACK[0], TRACK[1], TRACK[2]);
      doc.roundedRect(MARGIN, trackY, contentW, 6, 3, 3, 'F');
      const fillW = Math.max(2, ((it.count || 0) / max) * contentW);
      const [r, g, b] = hexToRgb(it.color || DEFAULT_BAR);
      doc.setFillColor(r, g, b);
      doc.roundedRect(MARGIN, trackY, fillW, 6, 3, 3, 'F');
      y += 24;
    });
    y += 10;
  };

  barsBlock(sections.contact.title, sections.contact.subtitle, sections.contact.items);
  if (sections.support) {
    barsBlock(sections.support.title, sections.support.subtitle, sections.support.items, true);
  }
  sections.others.forEach((b) => barsBlock(b.title, null, b.items));

  // ── Canvasser observations ──────────────────────────────────────────────────
  if (report.observations?.length) {
    ensure(30);
    setFont(10.5, 'bold', GRAY);
    doc.text('CANVASSER OBSERVATIONS', MARGIN, y);
    y += 16;
    report.observations.forEach((s) => {
      ensure(30);
      setFont(12, 'bold', DARK);
      doc.text(String(s.heading || ''), MARGIN, y);
      y += 14;
      setFont(10, 'normal', GRAY);
      doc.splitTextToSize(String(s.body || ''), contentW).forEach((ln) => {
        ensure(14);
        doc.text(ln, MARGIN, y);
        y += 13;
      });
      y += 10;
    });
  }

  doc.save(`weekly-report-${report.weekEnd || 'export'}.pdf`);
}
