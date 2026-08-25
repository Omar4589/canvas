import mongoose from 'mongoose';

// An organization's opt-in link to FbTime's Partner API — the add-on that
// replaces the derived first-to-last-knock span with measured hours in
// doors-per-hour. One per organization, created by the org's OWN admin pasting
// an API key they minted inside FbTime; that act is the consent that makes this
// a customer integration rather than a disclosure (see docs/FBTIME_INTEGRATION.md
// and the provider contract, FbTimeApp/docs/PARTNER_API.md).
//
// Orgs that never create one see zero change anywhere — every reader goes
// through services/reports/hoursSource.js, which treats "no connection" as
// "estimated hours, exactly as before".
const fbTimeConnectionSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      unique: true,
    },

    // connected — syncing normally. errored — the provider refused the key
    // (revoked/expired/org-inactive); the deep sync re-pings and self-heals if
    // the key works again. disconnected — the admin turned it off; the row is
    // kept so history and links survive, but the ciphertext is cleared and the
    // hours cache is deleted.
    status: {
      type: String,
      enum: ['connected', 'errored', 'disconnected'],
      default: 'connected',
    },

    // The API key, sealed via utils/sealedSecret.js (AES-256-GCM, env master
    // key). NEVER stored plaintext and NEVER echoed by any route — keyPrefix is
    // the only displayable part, same rule as the provider's own audit log.
    keyCiphertext: { type: String, default: null },
    keyPrefix: { type: String, default: null }, // e.g. "fbt_live_a1b2c3d4"

    // Which of the three wire figures divides doors-per-hour. Owner-ruled
    // default: adjustedHours — FbTime's "Adjusted total", the payroll figure.
    // Stored under the WIRE names deliberately: the provider renamed paidHours
    // to adjustedHours precisely so nobody translates between a screen and a
    // payload, and inventing local names here would reintroduce that bug.
    hourFigure: {
      type: String,
      enum: ['grossHours', 'adjustedHours', 'workedHours'],
      default: 'adjustedHours',
    },

    // The FbTime organization this key reads, captured from GET /ping at
    // connect time. This is the wrong-customer-key guard's record: the admin
    // confirmed this exact name before Connect, and a later key-rotate that
    // resolves a DIFFERENT org requires explicit confirmation.
    fbtimeOrgId: { type: String, default: null },
    fbtimeOrgName: { type: String, default: null },

    connectedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    connectedAt: { type: Date, default: null },

    // Sync bookkeeping. lastSyncError holds the provider's machine code plus a
    // short message ("KEY_REVOKED: This API key has been revoked."), so the
    // status card can say why without anyone reading worker logs.
    lastSyncAt: { type: Date, default: null },
    lastSyncError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },

    // When an admin last pressed "Refresh hours now" — the cooldown stamp for
    // the manual deep pull, not a sync-progress fact (lastSyncAt is that).
    manualSyncRequestedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const FbTimeConnection = mongoose.model('FbTimeConnection', fbTimeConnectionSchema);
