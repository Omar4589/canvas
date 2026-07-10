import mongoose from 'mongoose';

// Append-only audit trail for billing changes (the FlagReview persisted-decision
// pattern): who moved an org between billing states — or edited its rate/contact
// — and why. Rows are never updated or deleted; the Billing tab's History section
// renders them newest-first. `reason` is required by the routes for suspend and
// cancel transitions.
const subscriptionEventSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Status transitions carry from/to; field-only edits (rate, contact, notes)
    // leave them null and describe themselves in `changes`.
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    changes: { type: mongoose.Schema.Types.Mixed, default: null },
    reason: { type: String, default: '' },
  },
  { timestamps: true }
);

subscriptionEventSchema.index({ organizationId: 1, createdAt: -1 });

export const SubscriptionEvent = mongoose.model('SubscriptionEvent', subscriptionEventSchema);
