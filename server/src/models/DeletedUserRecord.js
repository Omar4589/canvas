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
// which the field records no longer directly identify the person (they remain keyed to the
// account id — de-identified, not anonymous; keep this wording in sync with the policy).
const deletedUserRecordSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // Identity as it stood at the moment of deletion — NAME ONLY. Attribution needs a name,
    // not a mailbox: the published deletion promise is that contact details (email, phone,
    // password) are removed immediately, so the snapshot never carries them.
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    // LEGACY ONLY — never written since the name-only change. Declared so the purge's $unset
    // and migrate:deletion-snapshots can strip them from rows that predate it.
    email: { type: String, default: undefined },
    phone: { type: String, default: undefined },
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
    // WHO ordered the deletion, and by which door. Deliberately NOT scrubbed by
    // purgeDeletedIdentities (which only blanks firstName/lastName and unsets email/phone):
    // these describe the ACTOR, not the person deleted, so attribution for a staff-initiated
    // deletion outlives the subject's PII rather than competing with it. Retaining "an admin
    // did this on this date" is the opposite of a privacy problem — the alternative is an
    // irreversible destruction of a customer's account with nothing on record.
    //
    // `reason` used to be a parameter of deleteAccount() that was destructured and then never
    // referenced; both callers passed a value into a void. It is persisted now.
    //   'self'        — the account holder, in-app (DELETE /auth/account)
    //   'operator'    — npm run delete:account, honouring an emailed request
    //   'super_admin' — the console, break-glass (DELETE /super-admin/users/:userId)
    reason: {
      type: String,
      enum: ['self', 'operator', 'super_admin'],
      default: 'self',
    },
    // null for a self-deletion — there is no third party to name.
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export const DeletedUserRecord = mongoose.model('DeletedUserRecord', deletedUserRecordSchema);
