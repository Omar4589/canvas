import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// The automatic-pause rollback companion (docs/PROPOSAL_PACE_PAUSE.md §N), run as the Heroku console would:
// a dry run changes nothing; --apply resolves every open pause and moves each member's restart point.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/pace_resolve node --test test/resolveOpenPacePauses.int.test.js

const { Organization } = await import('../src/models/Organization.js');
const { Membership } = await import('../src/models/Membership.js');
const { PacePause } = await import('../src/models/PacePause.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const run = promisify(execFile);
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations/resolveOpenPacePauses.js');
const resolveOpen = (...flags) => run(process.execPath, [SCRIPT, ...flags], { env: { ...process.env, MONGODB_URI: URI } });

const pause = (organizationId, userId, status) => ({
  organizationId, campaignId: new mongoose.Types.ObjectId(), userId, status,
  firedAt: new Date(), triggerActivityId: new mongoose.Types.ObjectId(), triggerAt: new Date(), day: '2026-10-24',
  timeZone: 'America/Los_Angeles', config: { doorSec: 15, surveySec: 45, travelMps: 11.2, window: 20, failsToPause: 8, sameVisitSec: 600 },
});

const ids = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, Membership, PacePause]) await M.deleteMany({});
  const a = await Organization.create({ name: 'Org A', slug: 'org-a', isActive: true });
  const b = await Organization.create({ name: 'Org B', slug: 'org-b', isActive: true });
  const [u1, u2, u3] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  await Membership.insertMany([
    { userId: u1, organizationId: a._id, role: 'canvasser', isActive: true },
    { userId: u2, organizationId: b._id, role: 'canvasser', isActive: true },
    { userId: u3, organizationId: b._id, role: 'canvasser', isActive: true },
  ]);
  await PacePause.insertMany([pause(a._id, u1, 'paused'), pause(b._id, u2, 'paused'), pause(b._id, u3, 'resolved')]);
  Object.assign(ids, { a, b, u1, u2, u3 });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

test('a dry run counts the open pauses per org and changes nothing', { skip }, async () => {
  const { stdout } = await resolveOpen();
  assert.match(stdout, /Open automatic pauses: 2/);
  assert.match(stdout, /Org A: 1/);
  assert.match(stdout, /Org B: 1/);
  assert.match(stdout, /Dry run — nothing was changed/);
  assert.strictEqual(await PacePause.countDocuments({ status: 'paused' }), 2);
  assert.strictEqual(await Membership.countDocuments({ paceRestartAt: { $ne: null } }), 0);
});

test('--apply resolves every open pause as switch_off and moves each member\'s restart point', { skip }, async () => {
  const { stdout } = await resolveOpen('--apply');
  assert.match(stdout, /Resolved 2 open pause\(s\)/);
  assert.strictEqual(await PacePause.countDocuments({ status: 'paused' }), 0);
  assert.strictEqual(await PacePause.countDocuments({ resolvedVia: 'switch_off' }), 2);
  const moved = await Membership.find({ paceRestartAt: { $ne: null } }, 'userId').lean();
  assert.deepStrictEqual(moved.map((m) => String(m.userId)).sort(), [String(ids.u1), String(ids.u2)].sort());
  await assert.rejects(resolveOpen('--force'), (e) => e.code === 2);
});
