import { OrgBranding } from '../../models/OrgBranding.js';
import { sanitizeLogo } from './png.js';

// An organization's report logo (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F8): stored as the FRESH
// PNG services/branding/png.js writes, one document per organization. Read by the admin branding
// routes and the client's GET /share/:token/logo.

/** The logo's PNG bytes, or null when the organization has none. */
export const logoBytesOf = async (organizationId) => {
  const doc = await OrgBranding.findOne({ organizationId }, { logo: 1 });
  return doc?.logo?.length ? Buffer.from(doc.logo) : null;
};

/** What the branding card shows — never the bytes. */
export const brandingOf = async (organizationId) => {
  const doc = await OrgBranding.findOne({ organizationId }, { width: 1, height: 1, bytes: 1, updatedAt: 1 }).lean();
  return doc
    ? { hasLogo: true, width: doc.width, height: doc.height, bytes: doc.bytes, updatedAt: doc.updatedAt || null }
    : { hasLogo: false, width: null, height: null, bytes: null, updatedAt: null };
};

const isDup = (err) => err?.code === 11000 || err?.code === 11001;

/**
 * Check, re-encode and store an upload — an upsert on organizationId (unique). Two uploads racing on
 * a brand-new document can both try the insert; the loser retries as the update it then is.
 * Throws a LogoError for anything the check refuses.
 */
export const saveLogo = async ({ organizationId, upload, by }) => {
  const { png, width, height, bytes } = await sanitizeLogo(upload);
  const write = () =>
    OrgBranding.findOneAndUpdate(
      { organizationId },
      { $set: { logo: png, width, height, bytes, updatedBy: by || null } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  try {
    await write();
  } catch (err) {
    if (!isDup(err)) throw err;
    await write();
  }
  return brandingOf(organizationId);
};

export const removeLogo = async (organizationId) => {
  const r = await OrgBranding.deleteOne({ organizationId });
  return r.deletedCount > 0;
};
