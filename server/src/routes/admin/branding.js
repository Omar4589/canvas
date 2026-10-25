import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { LOGO_MAX_BYTES, LogoError } from '../../services/branding/png.js';
import { brandingOf, logoBytesOf, saveLogo, removeLogo } from '../../services/branding/orgLogo.js';

// Report branding (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F8, G8): the organization's logo on its
// clients' report pages and PDFs. ORG-WIDE, so changing it is admin-only (owner ruling 10-23: it
// changes every campaign's reports); leads see it read-only, or "No logo yet".
//
// The browser converts whatever image the admin picks into a PNG of at most 800 × 320 and 256 KB
// before sending it; the server trusts none of that — services/branding/png.js checks the upload
// strictly and stores a FRESH PNG written from its validated pixels, never the uploaded bytes.
const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

const orgIdOf = (req) => req.activeOrg?._id;
const ensureOrgScoped = (req, res) => {
  if (orgIdOf(req)) return true;
  res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
  return false;
};

// Memory storage: the file is at most 256 KB and is checked and re-encoded in this request, never
// written to disk. One file, no other fields.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_MAX_BYTES, files: 1, fields: 0 },
});

// Any multer refusal (too large, a second file, an extra field) is a 413 with a code the client can
// explain, as routes/admin/imports.js does for its size limit — never the generic 500.
const uploadLogo = (req, res, next) => {
  upload.single('logo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(413).json({
        error:
          err.code === 'LIMIT_FILE_SIZE'
            ? 'This logo is too large — choose a smaller image (at most 256 KB).'
            : 'Send one image, as the "logo" field, and nothing else.',
        code: err.code === 'LIMIT_FILE_SIZE' ? 'LOGO_TOO_LARGE' : 'LOGO_UPLOAD_REFUSED',
      });
    }
    if (err) return next(err);
    next();
  });
};

// The branding card: whether there is a logo, its size, when it last changed.
router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    res.json(await brandingOf(orgIdOf(req)));
  } catch (err) {
    next(err);
  }
});

// The logo itself, for the card's preview (and the builder's PDF): PNG bytes, or 204 when none.
router.get('/logo', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const bytes = await logoBytesOf(orgIdOf(req));
    res.set('Cache-Control', 'no-store');
    if (!bytes) return res.status(204).end();
    res.type('image/png').send(bytes);
  } catch (err) {
    next(err);
  }
});

router.put('/logo', requireOrgRole('admin'), uploadLogo, async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Choose an image to upload.', code: 'LOGO_REQUIRED' });
    }
    res.json(await saveLogo({ organizationId: orgIdOf(req), upload: req.file.buffer, by: req.user._id }));
  } catch (err) {
    if (err instanceof LogoError) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

router.delete('/logo', requireOrgRole('admin'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    await removeLogo(orgIdOf(req));
    res.json(await brandingOf(orgIdOf(req)));
  } catch (err) {
    next(err);
  }
});

export default router;
