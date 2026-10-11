import jwt from 'jsonwebtoken';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueue, QUEUE_NAMES } from './index.js';

// Bull Board is a cross-tenant job console (all orgs' jobs), so it is
// super-admin only. It's a browser-navigated HTML app and can't carry the
// SPA's Authorization header, so access is granted via a short-lived signed
// cookie minted by the authenticated /api/admin/queues/ticket endpoint.
const TICKET_TTL = '10m';
export const BULL_BOARD_COOKIE = 'bb_token';
export const BULL_BOARD_BASE_PATH = '/admin/queues';

export function signBullBoardTicket(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return jwt.sign(
    { sub: String(user._id), isSuperAdmin: !!user.isSuperAdmin, purpose: 'bullboard' },
    secret,
    { expiresIn: TICKET_TTL }
  );
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1));
  }
  return null;
}

// Only the ticket, and only from its cookie. A session token is not a ticket: it would skip the
// user lookup every API request makes, so a revoked or demoted super admin's token would still open
// this cross-tenant job console, and a ?t= query string lands in the access log in full. The
// console's Jobs page mints the ticket through GET /api/admin/queues/ticket (requireAuth +
// requireSuperAdmin, so the database checks apply there) and sets this cookie, scoped to this path.
export const requireBullBoardAuth = (req, res, next) => {
  const secret = process.env.JWT_SECRET;
  const token = readCookie(req, BULL_BOARD_COOKIE);
  if (!token || !secret) return res.status(403).send('Forbidden');
  try {
    const payload = jwt.verify(token, secret);
    if (payload.purpose !== 'bullboard') return res.status(403).send('Forbidden');
    if (!payload.isSuperAdmin) return res.status(403).send('Super admin only');
    return next();
  } catch {
    return res.status(403).send('Forbidden');
  }
};

export function createBullBoardRouter() {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_BASE_PATH);
  createBullBoard({
    queues: [
      new BullMQAdapter(getQueue(QUEUE_NAMES.IMPORT)),
      new BullMQAdapter(getQueue(QUEUE_NAMES.TURF)),
    ],
    serverAdapter,
  });
  return serverAdapter.getRouter();
}
