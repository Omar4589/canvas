import { formatDate } from './dates.js';

// THE TWO STATEMENT EXPORTS, as pure row builders.
//
// A statement CSV is the artifact most likely to end up attached to an invoice email, so every
// sheet says on its face whether a figure is the FROZEN issued number or a live recompute.
// Exporting an unlabelled sheet is how the two get confused six months later.
//
// Lifted out of OrgBillingPanel unchanged except for the added Payment column: the file now also
// answers "and did they pay it?", which is the question the ledger exists to make askable.

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const money = (cents) => ((cents ?? 0) / 100).toFixed(2);

// One line's shared cells, so the single-month and combined sheets can never describe a campaign
// differently.
const lineCells = (l) => [
  l.name,
  l.households,
  day(l.firstKnockAt),
  // The month the campaign bills FROM — the start grace can put it one after the first visit, and
  // that gap is the single most asked-about thing on an invoice.
  l.billingStartMonth || '',
  day(l.archivedAt),
  l.knocksThisMonth,
  l.restrictedDoorsThisMonth,
  // The org's own invoice figure; equals knocks when it doesn't bill restricted doors.
  l.billRestrictedDoors ? l.billableDoorsThisMonth : l.knocksThisMonth,
  l.billable ? 'yes' : 'no',
  l.reason || '',
  money(l.rateCents),
  money(l.amountCents),
];

const LINE_HEADERS = [
  'Campaign', 'Households', 'First visit', 'Bills from', 'Archived', 'Knocks',
  'Restricted doors', 'Billable doors', 'Billable', 'Reason', 'Rate', 'Amount',
];

// Where a figure came from, in one cell.
export const provenance = (m) => {
  if (!m?.issued && !m?.issuedAt) return 'LIVE — not issued, recomputed on export';
  const by = m.issuedBy ? ` by ${m.issuedBy}` : '';
  const rules = m.rulesVersion ? ` — rules v${m.rulesVersion}` : '';
  const ref = m.externalRef ? ` — ref ${m.externalRef}` : '';
  return `ISSUED ${formatDate(m.issuedAt)}${by}${rules}${ref}`;
};

// And whether the money arrived.
export const paymentCell = (m) => {
  if (!m?.issued && !m?.issuedAt) return '';
  if (m.paymentState === 'settled' || m.totalCents === 0) return 'SETTLED ($0)';
  if (m.paidAt) return `PAID ${day(m.paidAt)}${m.paymentRef ? ` ref ${m.paymentRef}` : ''}`;
  if (m.paymentState === 'overdue') return `OVERDUE — was due ${day(m.dueAt)}`;
  if (m.dueAt) return `UNPAID — due ${day(m.dueAt)}`;
  return 'UNPAID';
};

const fileSlug = (name) => String(name || 'org').replaceAll(/\s+/g, '-').toLowerCase();

// One month.
export const statementCsvRows = ({ month, view, statement, orgName }) => {
  const m = statement ? { ...statement, issued: true } : {};
  return [
    ['Statement', month, provenance(m)],
    ['Payment', paymentCell(m) || 'n/a — not issued'],
    [],
    LINE_HEADERS,
    ...(view?.lines || []).map(lineCells),
    ['Total', '', '', '', '', '', '', '', '', '', '', money(view?.totalCents)],
  ];
};

export const statementCsvName = ({ orgName, month, issued }) =>
  `${fileSlug(orgName)}-statement-${month}-${issued ? 'issued' : 'live'}.csv`;

// Several months on one sheet — the artifact attached to a single invoice covering July AND
// August. Oldest first: an invoice reads forwards even though the screen reads backwards.
export const combinedCsvRows = ({ months, orgName }) => {
  const ordered = [...(months || [])].sort((a, b) => (a.month < b.month ? -1 : 1));
  if (!ordered.length) return [];
  const rows = [
    ['Statements', `${ordered[0].month} to ${ordered[ordered.length - 1].month}`, orgName || ''],
    [],
    ['Month', 'Source', 'Payment', ...LINE_HEADERS],
  ];
  let total = 0;
  for (const m of ordered) {
    const src = provenance(m);
    const pay = paymentCell(m);
    for (const l of m.lines || []) rows.push([m.month, src, pay, ...lineCells(l)]);
    rows.push([`${m.month} subtotal`, '', '', '', '', '', '', '', '', '', '', '', '', '', money(m.totalCents)]);
    rows.push([]);
    total += m.totalCents || 0;
  }
  rows.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', '', money(total)]);
  return rows;
};

export const combinedCsvName = ({ orgName, months }) => {
  const ordered = [...(months || [])].map((m) => m.month).sort();
  return `${fileSlug(orgName)}-statements-${ordered[0]}-to-${ordered[ordered.length - 1]}.csv`;
};
