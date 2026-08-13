import mongoose from 'mongoose';

// Append-only audit trail for integration lifecycle events (the
// SubscriptionEvent pattern): who connected, rotated, or disconnected an
// external integration, which links were made or removed, and when a sync
// started failing or recovered. Rows are never updated or deleted; the
// Integrations page renders them newest-first as History.
//
// Deliberately NOT AccessLog — that collection records platform staff reading
// customer data under a support grant. A customer's own admin wiring up their
// own integration is not vendor access, and logging it there would bury the
// signal AccessLog exists to carry.
//
// byUserId null = the worker (sync transitions have no human behind them).
// `sync-failed` is written ONCE per transition into the errored state, not per
// failing run — a 15-minute cron must not turn one revoked key into a wall of
// identical rows (the provider's own hourly-bucket logic, adapted).
const integrationEventSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // One integration today; a field rather than an assumption so a second
    // provider's history doesn't need a second collection.
    provider: { type: String, default: 'fbtime' },

    type: {
      type: String,
      enum: [
        'connected',
        'disconnected',
        'key-rotated',
        'figure-changed',
        'link-created',
        'link-removed',
        'auto-matched',
        'sync-failed',
        'sync-recovered',
      ],
      required: true,
    },

    // Machine detail for the row: {code:'KEY_REVOKED'}, {count: 12},
    // {userId, fbtimePersonId}, {from:'adjustedHours', to:'workedHours'}, …
    // Never the API key or any part of it beyond the public prefix.
    detail: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

integrationEventSchema.index({ organizationId: 1, createdAt: -1 });

export const IntegrationEvent = mongoose.model('IntegrationEvent', integrationEventSchema);
