// Integration-test preload (scripts/test-int.sh passes it with `node --import`).
//
// Some ledger reads are HINTED to a named index (services/memberships/restampCoordinator.js INDEX
// HINTS), and a hint naming an index that doesn't exist fails the query outright. In production the
// indexes exist (the release dry-runs build-indexes). In a fresh test database they may not yet:
// Mongoose builds a schema's indexes in the background, racing a suite's first query, and Model.init()
// is memoized, so nothing rebuilds them after a suite drops its database. So build the hinted ones
// here, right after connecting and right after any drop.
//
// Connection-level on purpose, through mongoose.connection.db rather than the models: a model-based
// version hung the runner's drop_db helper.
import mongoose from 'mongoose';
import { Db } from 'mongodb';

const HINTED = [
  ['canvassactivities', { userId: 1, timestamp: -1 }],
  ['canvassactivities', { campaignId: 1, timestamp: -1 }],
  ['surveyresponses', { userId: 1 }],
  ['surveyresponses', { campaignId: 1, submittedAt: -1 }],
];

const ensureHintedIndexes = async (db) => {
  if (!db) return;
  for (const [collection, keys] of HINTED) await db.collection(collection).createIndex(keys);
};

const connect = mongoose.connect.bind(mongoose);
mongoose.connect = async (...args) => {
  const conn = await connect(...args);
  await ensureHintedIndexes(mongoose.connection.db);
  return conn;
};

const dropDatabase = Db.prototype.dropDatabase;
Db.prototype.dropDatabase = async function dropThenRebuild(...args) {
  const result = await dropDatabase.apply(this, args);
  try {
    await ensureHintedIndexes(this);
  } catch (err) {
    console.error('[testIndexPreload] rebuilding hinted indexes after a drop failed:', err.message);
  }
  return result;
};
