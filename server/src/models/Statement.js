import mongoose from 'mongoose';

// A FROZEN monthly statement — what we actually invoiced, preserved exactly as it read the day we
// sent it.
//
// Everywhere else, billing is computed LIVE from CanvassActivity (services/billing/statement.js).
// That is the right default — the running meter has to reflect reality — but it means an invoice
// is only ever a snapshot of the present. Three ordinary actions silently rewrite the past:
//   • changing the org (or a campaign's) rate re-prices every month ever computed,
//   • reactivating an archived campaign clears `archivedAt` and re-bills the months it sat idle,
//   • revising the rules themselves (RULES_VERSION) changes what every prior month would say.
// None are bugs. All of them mean "what does March owe?" can answer differently in June than it
// did in April, with nothing to reconcile against.
//
// Issuing a statement freezes the answer. A month with an issued row bills from THIS document; a
// month without one keeps computing live. The current month therefore never has one (the issue
// route refuses an unfinished month), so the live meter and the org's Billing page are untouched.
//
// Rows are never edited. A wrong statement is VOIDED with a reason and reissued — both rows
// survive, the voided one pointing at its replacement via `supersededByStatementId`. Same
// append-only discipline as SubscriptionEvent, and the same reason: the audit is the product.
//
// THREE SANCTIONED EXCEPTIONS to "never edited", all of them recording something that happened
// AFTER the invoice was sent rather than changing what it said:
//   • `supersededByStatementId`, back-stamped on a voided row when its replacement is issued.
//   • the payment trio (`paidAt`, `paidByUserId`, `paymentRef`), written by POST …/statement/:id/paid
//     and cleared by …/unpaid — both audited as SubscriptionEvent rows carrying the previous values,
//     so the history survives even though the fields do not.
//   • the one-shot `dueAt`/`termsDays` backfill for statements issued before due dates existed
//     (migrations/backfillStatementDueDates.js).
// Nothing may edit `lines`, `totalCents`, `rateCents` or `rulesVersion`. A wrong figure is still a
// void-and-reissue, and voiding is REFUSED while a statement is marked paid — unmark it first, so
// money state and invoice state move in separately audited steps.
//
// Contains no CUSTOMER personal data — campaign names, counts, dates, dollars. It does carry staff
// attribution ids (`issuedByUserId`, `voidedByUserId`, `paidByUserId`) and `paymentRef`, a
// staff-typed reference (an invoice or check number) whose "no personal data" claim holds by
// discipline: the UI helper, docs/BILLING.md and the PRIVACY_VERIFICATION watchlist all say
// reference numbers only, never a person's name or card details. Deleted with the organization like
// every other org-scoped collection (services/platform/deleteOrganization.js), which is what keeps
// the "no invoice retention" line in docs/PRIVACY_VERIFICATION.md true — including for an UNPAID
// statement, which the delete confirmation says out loud.

// One campaign's line, frozen. Mirrors a `monthlyStatement` line, plus the inputs that DECIDED it
// (`firstKnockAt`, `archivedAt`, `reason`, `rateCents`) — a total alone is unfalsifiable, and two
// years from now those four fields are the only way to answer "why was this campaign on that
// invoice?" once the campaign has been reactivated and the rules have moved on.
const lineSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    name: { type: String, default: '' },
    timeZone: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    firstKnockAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    households: { type: Number, default: 0 },
    knocksThisMonth: { type: Number, default: 0 },
    restrictedDoorsThisMonth: { type: Number, default: 0 },
    billableDoorsThisMonth: { type: Number, default: 0 },
    billRestrictedDoors: { type: Boolean, default: false },
    billable: { type: Boolean, default: false },
    // Why — 'billable' | 'start-grace' | 'end-grace' | 'floor' | 'before-start' |
    // 'archived-earlier' | 'no-field-visit' (services/billing/billingMonths.js).
    reason: { type: String, default: '' },
    // The first month this campaign could bill: the first-visit month, or the one after it when the
    // start grace applied (billingMonths.billingStartMonth). decideMonth has always returned it and
    // statementLine used to drop it, so "first knock Sep 28, bills from October" needed the reader
    // to know the grace rule. Null for a campaign that has never been to the field. Legacy frozen
    // rows lack it; statementDrift's field list is explicit, so its absence can never read as drift.
    billingStartMonth: { type: String, default: null },
    // This campaign's resolved rate, which may differ from the statement's org-level `rateCents`.
    rateCents: { type: Number, default: 0 },
    amountCents: { type: Number, default: 0 },
  },
  { _id: false }
);

const statementSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    month: { type: String, required: true }, // 'YYYY-MM'
    // 'issued' is the live invoice for that month; 'void' is retained history. There is no
    // 'draft' — an unissued month simply has no row.
    status: { type: String, enum: ['issued', 'void'], default: 'issued', index: true },
    // The ORG's rate at issue time. Frozen so a later renegotiation can't reprice this invoice.
    rateCents: { type: Number, required: true },
    // Which generation of the billing rules produced this (services/billing/statement.js).
    // Without it, a frozen statement and a live recompute can disagree and you cannot tell
    // whether that is drift or a deliberate rule change.
    rulesVersion: { type: Number, required: true },
    lines: { type: [lineSchema], default: [] },
    totalCents: { type: Number, required: true },
    issuedAt: { type: Date, default: Date.now },
    issuedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // The invoice number in whatever the account manager actually bills from — the join back to
    // the money, since Doorline doesn't collect payment.
    externalRef: { type: String, default: '', trim: true, maxlength: 200 },
    // WHEN THIS FALLS DUE, frozen at issue time from the org's `paymentTermsDays` (net-30 by
    // default). Frozen for the same reason `rateCents` is: renegotiating terms must not silently
    // move the due date of an invoice already sent. `termsDays` records WHICH terms produced it,
    // so a due date two years from now can still explain itself.
    //
    // Null on statements issued before due dates existed. Readers resolve that through
    // invoicingState.effectiveDueAt (issuedAt + the org's CURRENT terms), which is exactly what
    // migrations/backfillStatementDueDates.js persists — so the read path and the migration agree
    // by construction, and nothing is wrong before it runs.
    termsDays: { type: Number, default: null },
    dueAt: { type: Date, default: null },
    // PAYMENT — recorded, never collected. Doorline sends no invoices and takes no money (the
    // account manager bills outside the app), so this is bookkeeping: "that one came in". Null
    // means unpaid, which with a passed `dueAt` is what makes a statement overdue. There are no
    // partial payments by design — a half-paid invoice is a conversation, not a data structure.
    paidAt: { type: Date, default: null },
    paidByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // A REFERENCE NUMBER ONLY — check number, transfer id, the invoice number it settled. Never a
    // person's name, never card or bank details: see the model header.
    paymentRef: { type: String, default: '', trim: true, maxlength: 200 },
    voidedAt: { type: Date, default: null },
    voidedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    voidReason: { type: String, default: '' },
    // Set on a VOIDED row when a replacement is issued for the same month.
    supersededByStatementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Statement', default: null },
  },
  { timestamps: true }
);

// ONE live issued statement per org-month, unlimited voided ones. The partial filter is what makes
// that expressible (the Person.js uid/svid idiom) — a plain unique index would forbid the second
// void, and no index at all would let two concurrent issues both win.
//
// This index IS the race guard: there are no transactions in this codebase (the deploy and the test
// harness both run standalone mongod), so the issue route relies on catching the duplicate-key
// error. Production has `autoIndex` off (config/db.js), so `npm run migrate:build-indexes --apply`
// MUST run before the issue route is reachable, or double-issue silently succeeds.
statementSchema.index(
  { organizationId: 1, month: 1 },
  { unique: true, partialFilterExpression: { status: 'issued' } }
);
// Listing an org's statements newest-first.
statementSchema.index({ organizationId: 1, month: -1 });

export const Statement = mongoose.model('Statement', statementSchema);
