import mongoose from 'mongoose';

// The identity of a self-deleted account, kept for a bounded and disclosed window so an
// org can still attribute past field work — above all the GPS/quality flags — to a real
// person after they delete themselves.
//
// Why this has to exist. Scrubbing the User doc is what satisfies the stores, but it also
// destroys the only join key the fraud audit has: flagDetection resolves a flagged
// canvasser through User.firstName/lastName/email. Without this snapshot, a canvasser
// could fabricate a day of billable doors, delete their account, and leave the org holding
// a GPS trail it cannot attach to anybody — then rejoin later under the freed email with a
// clean flag history. The flagged rows survive a scrub; the *attribution* is what dies.
//
// Both stores allow this. Play names "security, fraud prevention or regulatory compliance"
// as legitimate grounds for retention, and Apple permits retained data provided the user is
// told — so the in-app deletion sheet and the privacy policy both say, in plain language,
// that the org keeps a record of who did the field work.
//
// Readable by admins of the orgs the person belonged to, and by super-admins. Nothing else
// joins it. purgeDeletedIdentities.js scrubs the snapshot once retentionUntil passes, after
// which attribution is permanently anonymous.
const deletedUserRecordSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // Identity as it stood at the moment of deletion. The User row no longer carries any
    // of it — this is the only copy.
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: null },
    // Every org that might need to attribute this person's work. A User is global across
    // orgs, so one delete tap pulls them out of all of them at once.
    organizationIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    ],
    deletedAt: { type: Date, required: true },
    // After this date the snapshot is scrubbed too. Default DELETED_IDENTITY_RETENTION_DAYS
    // (180) — long enough to cover a campaign cycle plus its billing dispute window.
    retentionUntil: { type: Date, required: true, index: true },
    purgedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const DeletedUserRecord = mongoose.model('DeletedUserRecord', deletedUserRecordSchema);
