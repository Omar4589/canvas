import { User } from '../../models/User.js';

// The two activity clocks a request stamps on an account: lastLoginAt (a password sign-in, routes/
// auth.js) and lastSeenAt (any signed-in request, middleware/auth.js). Both are fire-and-forget at
// their call sites, so either can land AFTER a deletion scrubbed it — the deletedAt filter is what
// keeps a tombstone's clocks null (services/users/deleteAccount.js, the eleven-writer rule).
export const stampSessionClock = (userId, field, { timestamps = true } = {}) =>
  User.updateOne({ _id: userId, deletedAt: null }, { $set: { [field]: new Date() } }, { timestamps });
