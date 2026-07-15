import mongoose from 'mongoose';

// "Please delete our account." A first-class, tracked, SLA-bound request — not an email someone
// remembers to action.
//
// The privacy policy says "a customer may request export or deletion of the information it controls".
// Until now the only mechanism behind that sentence was a super-admin typing an org's slug into a
// confirmation box when they happened to get round to it. There was no record that a request had been
// made, no clock, and nothing that would notice if it were quietly forgotten.
//
// A request is SCHEDULED rather than executed on the spot, deliberately:
//   · it gives a mistaken or coerced request a window to be cancelled;
//   · it gives the customer their export window;
//   · and it turns our SLA into a date a job acts on, instead of a promise a human remembers.
const orgDeletionRequestSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    // Who asked. Either the customer's own admin, or staff acting on a written request.
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    requestedByEmail: { type: String, default: null, trim: true },
    // Verbatim, so the record of WHY survives the person who took the call.
    note: { type: String, default: '', trim: true, maxlength: 2000 },

    requestedAt: { type: Date, default: Date.now },
    // requestedAt + the SLA. The job acts on this date; until then the request can be cancelled.
    scheduledFor: { type: Date, required: true, index: true },

    status: {
      type: String,
      enum: ['scheduled', 'completed', 'cancelled', 'failed'],
      default: 'scheduled',
      index: true,
    },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // A deletion that failed must be loud. Silence here would mean a customer believing their data
    // was gone when it was not.
    error: { type: String, default: null },
    // Retry accounting. A due request that errors is NOT abandoned in 'failed' after one try — the
    // sweep re-attempts it each night, incrementing `attempts`, and only escalates to the terminal
    // 'failed' state (which the retention health surface reports RED) after MAX_ATTEMPTS. So a
    // transient blip self-heals, and a persistent failure becomes visible instead of a false 'done'.
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
  },
  { timestamps: true }
);

orgDeletionRequestSchema.index({ status: 1, scheduledFor: 1 });

export const OrgDeletionRequest = mongoose.model('OrgDeletionRequest', orgDeletionRequestSchema);
