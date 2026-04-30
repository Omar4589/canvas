import { Router } from 'express';
import authRouter from './auth.js';
import adminUsersRouter from './admin/users.js';
import adminImportsRouter from './admin/imports.js';
import adminGeocodingRouter from './admin/geocoding.js';
import adminReportsRouter from './admin/reports.js';
import adminSurveysRouter from './admin/surveys.js';
import adminConfigRouter from './admin/config.js';
import adminHouseholdsRouter from './admin/households.js';
import mobileBootstrapRouter from './mobile/bootstrap.js';
import mobileCanvassRouter from './mobile/canvass.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

router.use('/auth', authRouter);
router.use('/admin/users', adminUsersRouter);
router.use('/admin/imports', adminImportsRouter);
router.use('/admin/geocoding', adminGeocodingRouter);
router.use('/admin/reports', adminReportsRouter);
router.use('/admin/surveys', adminSurveysRouter);
router.use('/admin/config', adminConfigRouter);
router.use('/admin/households', adminHouseholdsRouter);
router.use('/mobile', mobileBootstrapRouter);
router.use('/mobile', mobileCanvassRouter);

export default router;
