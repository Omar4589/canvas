import mongoose from 'mongoose';

// One per organization: the ENTITLEMENT record — is this org allowed in, and at
// what level. Deliberately separate from payment collection: today an account
// manager (super admin) sets these states by hand and invoices are sent outside
// the app; later a Stripe webhook can write this same record through the same
// status chokepoint without reworking any gating. `internal` = Doorline's own /
// demo orgs — permanently free, never gated, excluded from statements.
const subscriptionSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      unique: true,
    },
    // trial → active → past_due → suspended → canceled, plus `internal`.
    // Transitions are account-manager-driven (any → any); trial expiry is the one
    // COMPUTED transition — entitlementFor() treats a trial past trialEndsAt as
    // suspended at read time, so no cron ever has to flip a bit.
    status: {
      type: String,
      enum: ['trial', 'active', 'past_due', 'suspended', 'canceled', 'internal'],
      default: 'trial',
      index: true,
    },
    // When `status` last changed — the offline-grace boundary: a mobile submission
    // stamped BEFORE this instant is accepted even while writes are blocked, so a
    // canvasser's queued work recorded while the org was entitled always flushes.
    statusChangedAt: { type: Date, default: Date.now },
    trialEndsAt: { type: Date, default: null },
    // Per-org negotiated rate (default $300/campaign/month). Overriding this is
    // how exceptions happen — pilot pricing, multi-campaign deals, big-universe
    // campaigns — with no code change. Universe size is NEVER enforced in code;
    // the household soft cap is a contract-level guideline only.
    pricePerCampaignCents: { type: Number, default: 30000 },
    billingContact: {
      name: { type: String, default: '', trim: true },
      email: { type: String, default: '', trim: true },
    },
    // Internal account-manager notes (LOI terms, grandfathered deals). Never
    // exposed to org admins — only the super-admin billing endpoints return it.
    notes: { type: String, default: '' },
    // Who owns status writes. Webhooks (the future Stripe phase) only apply when
    // source is 'stripe', so a manual override always wins.
    source: { type: String, enum: ['manual', 'stripe'], default: 'manual' },
    stripeCustomerId: { type: String, default: null },
  },
  { timestamps: true }
);

export const Subscription = mongoose.model('Subscription', subscriptionSchema);
