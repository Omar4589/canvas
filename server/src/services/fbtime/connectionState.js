import { FbTimeConnection } from '../../models/FbTimeConnection.js';
import { IntegrationEvent } from '../../models/IntegrationEvent.js';

// The ONE errored transition, shared by the hours sync and the door step.
//
// Conditional on the KEY THIS RUN USED and on the connection still being 'connected':
//   · a sweep that loaded the old key before an admin's Replace key must not mark the
//     connection now holding the working new key as errored (the old key was revoked
//     on purpose — the documented rotation);
//   · an already-errored connection re-probed by the nightly job must not write a
//     second `sync-failed` — the event is written only when this update changed the row,
//     once per transition, like it always was.
// When the transition doesn't apply, the error fields still refresh (key-filtered) so
// the status card can say why, with no event.
export const markErroredIfCurrent = async (connectionId, usedKey, err) => {
  const summary = `${err?.code || 'ERROR'}: ${String(err?.message || '').slice(0, 200)}`;
  const now = new Date();
  if (!usedKey) return { transitioned: false };
  const res = await FbTimeConnection.updateOne(
    { _id: connectionId, keyCiphertext: usedKey, status: 'connected' },
    { $set: { status: 'errored', lastSyncError: summary, lastErrorAt: now } }
  );
  if (res.modifiedCount === 1) {
    const conn = await FbTimeConnection.findById(connectionId).select('organizationId').lean();
    if (conn) {
      await IntegrationEvent.create({
        organizationId: conn.organizationId,
        byUserId: null, // the worker
        type: 'sync-failed',
        detail: { code: err?.code || null },
      });
    }
    return { transitioned: true };
  }
  await FbTimeConnection.updateOne(
    { _id: connectionId, keyCiphertext: usedKey },
    { $set: { lastSyncError: summary, lastErrorAt: now } }
  );
  return { transitioned: false };
};
