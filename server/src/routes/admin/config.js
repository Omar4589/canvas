import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/mapbox-token', (req, res) => {
  const token = process.env.MAPBOX_PUBLIC_TOKEN || '';
  res.json({
    token,
    isReady: Boolean(token && token.startsWith('pk.')),
  });
});

export default router;
