import jwt from 'jsonwebtoken';

export function signUserToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  const expiresIn = process.env.JWT_EXPIRES_IN || '30d';
  return jwt.sign(
    { sub: String(user._id), email: user.email, isSuperAdmin: !!user.isSuperAdmin },
    secret,
    { expiresIn }
  );
}

export function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return jwt.verify(token, secret);
}

// Short-lived access token issued after a correct share-link password, authorizing the public
// report reads for that one link. `kind: 'share'` distinguishes it from a user token.
export function signShareToken({ shareId, campaignId }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return jwt.sign(
    { kind: 'share', shareId: String(shareId), campaignId: String(campaignId) },
    secret,
    { expiresIn: '24h' }
  );
}
