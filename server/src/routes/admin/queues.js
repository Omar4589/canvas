import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import {
  signBullBoardTicket,
  BULL_BOARD_COOKIE,
  BULL_BOARD_BASE_PATH,
} from '../../queues/bullBoard.js';

const router = Router();

// Mint a short-lived cookie that grants access to the Bull Board UI, then point
// the admin's iframe at the clean BULL_BOARD_BASE_PATH (no token in the URL).
router.get('/ticket', requireAuth, requireSuperAdmin, (req, res) => {
  const token = signBullBoardTicket(req.user);
  res.cookie(BULL_BOARD_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: BULL_BOARD_BASE_PATH,
    maxAge: 10 * 60 * 1000,
  });
  res.json({ url: BULL_BOARD_BASE_PATH });
});

export default router;
