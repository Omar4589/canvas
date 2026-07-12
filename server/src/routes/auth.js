import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from '../models/User.js';
import { Membership } from '../models/Membership.js';
import { CampaignManager } from '../models/CampaignManager.js';
import { signUserToken } from '../services/auth/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import { MIN_CLIENT_API_VERSION } from '../config/clientVersion.js';
import { strongPasswordSchema } from '../utils/validators.js';
import {
  checkDeletionBlockers,
  deleteAccount,
  AccountDeletionError,
} from '../services/users/deleteAccount.js';

const router = Router();

// A temporary password (admin reset) is only usable for this long. After that the
// user must ask an admin to reset again — this bounds how long a leaked temp
// password is a working key to the user's other orgs. See passwordGate.js.
const TEMP_PASSWORD_TTL_HOURS = 72;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  // A user's own new password must meet the complexity rules (not just min 8).
  newPassword: strongPasswordSchema,
});

// Deleting an account is irreversible, so it is re-authenticated: a phone left unlocked on
// a table must not be enough to destroy someone's login mid-campaign.
const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1),
});

const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().trim().max(40).optional().nullable(),
});

async function loadMembershipsForUser(userId) {
  const rows = await Membership.find({ userId, isActive: true })
    .populate({ path: 'organizationId', select: 'name slug isActive timeZone' })
    .lean();
  const active = rows.filter((m) => m.organizationId && m.organizationId.isActive);

  // For a team lead, ship the campaigns they manage (per org) so the client can scope
  // its console + nav to those campaigns without an extra round-trip on load.
  const grantsByOrg = new Map();
  if (active.some((m) => m.role === 'lead')) {
    const grants = await CampaignManager.find({ userId }).select('organizationId campaignId').lean();
    for (const g of grants) {
      const k = String(g.organizationId);
      if (!grantsByOrg.has(k)) grantsByOrg.set(k, []);
      grantsByOrg.get(k).push(String(g.campaignId));
    }
  }

  return active.map((m) => ({
    membershipId: String(m._id),
    organizationId: String(m.organizationId._id),
    organizationName: m.organizationId.name,
    organizationSlug: m.organizationId.slug,
    organizationTimeZone: m.organizationId.timeZone || 'America/New_York',
    role: m.role,
    // Only admins with billingAccess see the Billing surface (the bill-payers).
    billingAccess: !!m.billingAccess,
    // Only leads carry a managed-campaign scope; admins/canvassers omit it.
    ...(m.role === 'lead'
      ? { managedCampaignIds: grantsByOrg.get(String(m.organizationId._id)) || [] }
      : {}),
    // null acknowledgedAt = the user hasn't dismissed the "added to org" banner yet.
    isNew: !m.acknowledgedAt,
  }));
}

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase() });
    // A deleted account can never log in again — that is the difference between deletion and
    // the admin deactivate toggle, and Apple is explicit that a reversible disable does not
    // satisfy 5.1.1(v). The scrubbed tombstone email means this lookup can't match anyway,
    // but the guard is stated rather than relied upon.
    if (!user || !user.isActive || user.deletedAt) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await user.verifyPassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.mustChangePassword && user.tempPasswordSetAt) {
      const ageMs = Date.now() - new Date(user.tempPasswordSetAt).getTime();
      if (ageMs > TEMP_PASSWORD_TTL_HOURS * 60 * 60 * 1000) {
        return res.status(401).json({
          error: 'This temporary password has expired. Ask an admin to reset it again.',
          code: 'TEMP_PASSWORD_EXPIRED',
        });
      }
    }

    User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).catch(() => {});

    const token = signUserToken(user);
    const memberships = await loadMembershipsForUser(user._id);
    res.json({ token, user: user.toSafeJSON(), memberships, minClientApiVersion: MIN_CLIENT_API_VERSION });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const memberships = await loadMembershipsForUser(req.user._id);
    res.json({ user: req.user.toSafeJSON(), memberships, minClientApiVersion: MIN_CLIENT_API_VERSION });
  } catch (err) {
    next(err);
  }
});

// Self-service password change. Doubles as the forced "set a new password" step
// after an admin issues a temporary one. Only needs requireAuth — a locked-out
// multi-org user has no active org, so this must NOT depend on orgContext.
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const ok = await req.user.verifyPassword(currentPassword);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'New password must be different from the current one.' });
    }

    const passwordHash = await User.hashPassword(newPassword);
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { passwordHash, mustChangePassword: false, tempPasswordSetAt: null },
      { new: true }
    );
    const memberships = await loadMembershipsForUser(user._id);
    res.json({ user: user.toSafeJSON(), memberships });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Self-service profile update — name + phone only. Email is intentionally NOT
// editable here: it's globally unique and shared across all of a user's orgs, so
// email changes go through an admin (with the multi-org guard). Like
// change-password, this only needs requireAuth — no org context.
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const { firstName, lastName, phone } = updateProfileSchema.parse(req.body);
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { firstName, lastName, phone: phone || null },
      { new: true }
    );
    const memberships = await loadMembershipsForUser(user._id);
    res.json({ user: user.toSafeJSON(), memberships });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// Dismiss the "you were added to this org" banner. A user can only acknowledge
// their OWN memberships (scoped by req.user._id) — no org-admin rights needed.
router.post('/memberships/:membershipId/acknowledge', requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.membershipId)) {
      return res.status(400).json({ error: 'Invalid membershipId' });
    }
    const membership = await Membership.findOneAndUpdate(
      { _id: req.params.membershipId, userId: req.user._id, acknowledgedAt: null },
      { acknowledgedAt: new Date() },
      { new: true }
    );
    if (!membership) return res.status(404).json({ error: 'Membership not found or already acknowledged' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  res.json({ ok: true });
});

// --- Account deletion (App Store 5.1.1(v) / Google Play account-deletion policy) ---------
//
// Both stores require a self-serve path that a user can complete INSIDE the app — no
// "email your admin", no link out to a website. Apple: "Apps not operating in highly
// regulated industries should not require people to make a phone call, send an email, or go
// through other support flows." Canvassing is not a regulated industry, so we owe a real
// button. See services/users/deleteAccount.js for what deletion actually does.

// What would happen, and what stands in the way. The mobile deletion sheet calls this first
// so it can show the consequences honestly rather than discovering a blocker on submit.
router.get('/account/deletion-check', requireAuth, async (req, res, next) => {
  try {
    const { blockers } = await checkDeletionBlockers(req.user._id);
    res.json({
      canDelete: blockers.length === 0,
      blockers,
      // Stated plainly because both stores require the user be TOLD what survives deletion:
      // Apple ("If local laws or regulations require that you maintain some data, let your
      // users know") and Play ("users must be clearly informed about such retention
      // practices"). The knock ledger is the organization's work record, not the user's
      // personal content — see DeletedUserRecord.
      retained: {
        days: Number(process.env.DELETED_IDENTITY_RETENTION_DAYS || 180),
        summary:
          "The doors you knocked and the survey answers you recorded stay with the campaign — they're the organization's records, not yours. Your name is kept alongside them for a limited period so your organization can verify past field work, then permanently anonymized.",
      },
    });
  } catch (err) {
    if (err instanceof AccountDeletionError) {
      return res.status(400).json({ error: err.message, code: err.code, ...err.details });
    }
    next(err);
  }
});

// Terminal. Scrubs the identity, releases every book/effort/campaign the user was holding,
// and shuts the login for good. Requires the current password: a deletion is not something
// that should be possible from a phone somebody left unlocked on a table.
router.delete('/account', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword } = deleteAccountSchema.parse(req.body);
    const ok = await req.user.verifyPassword(currentPassword);
    if (!ok) return res.status(401).json({ error: 'That password is incorrect.' });

    const result = await deleteAccount(req.user._id, { reason: 'self' });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AccountDeletionError) {
      const status = err.code === 'BLOCKED' ? 409 : 400;
      return res.status(status).json({ error: err.message, code: err.code, ...err.details });
    }
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

export default router;
