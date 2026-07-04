import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { Tag } from '../../models/Tag.js';
import { normalizeTag } from '../../services/surveys/tags.js';
import { renameTag, mergeTags, deleteTag, tagUsage } from '../../services/surveys/tagOps.js';

const router = Router();
// Team leads may READ the tag library (to filter walk lists / reports by tag);
// managing the library (create/rename/merge/delete) stays with org admins per route.
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

function activeOrgId(req) {
  return req.activeOrg?._id;
}
function ensureOrgScoped(req, res) {
  if (!activeOrgId(req)) {
    res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
    return false;
  }
  return true;
}

// GET /admin/tags — the org's tag library + per-tag usage counts.
router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const [tags, usage] = await Promise.all([
      Tag.find({ organizationId: orgId }).sort({ name: 1 }).lean(),
      tagUsage(orgId),
    ]);
    res.json({
      tags: tags.map((t) => ({
        ...t,
        usage: usage.get(t.normalizedName) || { surveys: 0, options: 0, savedSearches: 0 },
      })),
    });
  } catch (err) {
    next(err);
  }
});

const nameSchema = z.object({ name: z.string().min(1) });

// POST /admin/tags — create. Upserts by normalizedName, so a case-variant returns the
// existing tag instead of fracturing.
router.post('/', requireOrgRole('admin'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { name } = nameSchema.parse(req.body);
    const display = name.trim();
    const normalizedName = normalizeTag(display);
    if (!normalizedName) return res.status(400).json({ error: 'Tag name required' });
    const existing = await Tag.findOne({ organizationId: orgId, normalizedName });
    if (existing) return res.json({ tag: existing, existed: true });
    const tag = await Tag.create({ organizationId: orgId, name: display, normalizedName, createdBy: req.user._id });
    res.status(201).json({ tag, existed: false });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    if (err.code === 11000) {
      const existing = await Tag.findOne({ organizationId: activeOrgId(req), normalizedName: normalizeTag(req.body?.name) });
      return res.json({ tag: existing, existed: true });
    }
    next(err);
  }
});

// PATCH /admin/tags/:id — rename (bulk-rewrites every option tag, palette, and saved-search
// filter for that tag). Renaming onto an existing tag is a merge — blocked with a hint.
router.patch('/:id', requireOrgRole('admin'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { name } = nameSchema.parse(req.body);
    const display = name.trim();
    const newNorm = normalizeTag(display);
    if (!newNorm) return res.status(400).json({ error: 'Tag name required' });
    const tag = await Tag.findOne({ _id: req.params.id, organizationId: orgId });
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    if (newNorm !== tag.normalizedName) {
      const clash = await Tag.findOne({ organizationId: orgId, normalizedName: newNorm });
      if (clash) {
        return res.status(409).json({
          error: `A tag "${clash.name}" already exists. Merge into it instead.`,
          code: 'tag-exists',
          tagId: String(clash._id),
        });
      }
    }
    const counts = await renameTag(orgId, tag, display);
    res.json({ tag: await Tag.findById(tag._id).lean(), counts });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

const mergeSchema = z.object({ targetId: z.string().min(1) });

// POST /admin/tags/:id/merge — merge this tag INTO targetId, then delete this one.
router.post('/:id/merge', requireOrgRole('admin'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const { targetId } = mergeSchema.parse(req.body);
    if (String(targetId) === String(req.params.id)) {
      return res.status(400).json({ error: 'Cannot merge a tag into itself' });
    }
    const [source, target] = await Promise.all([
      Tag.findOne({ _id: req.params.id, organizationId: orgId }),
      Tag.findOne({ _id: targetId, organizationId: orgId }),
    ]);
    if (!source || !target) return res.status(404).json({ error: 'Tag not found' });
    const counts = await mergeTags(orgId, source, target);
    res.json({ counts });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// DELETE /admin/tags/:id — delete + cascade (untag every option/palette/saved-search).
// The client confirms first using the usage counts from GET /admin/tags.
router.delete('/:id', requireOrgRole('admin'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const tag = await Tag.findOne({ _id: req.params.id, organizationId: orgId });
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    const counts = await deleteTag(orgId, tag);
    res.json({ counts });
  } catch (err) {
    next(err);
  }
});

export default router;
