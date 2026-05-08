import { Router } from 'express';
import { requireAuth, requireOrgMember } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';

const router = Router();
router.use(requireAuth, orgContext, requireOrgMember);

router.get('/mapbox-token', (req, res) => {
  const token = process.env.MAPBOX_PUBLIC_TOKEN || '';
  res.json({
    token,
    isReady: Boolean(token && token.startsWith('pk.')),
  });
});

export default router;
