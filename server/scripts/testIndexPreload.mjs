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
//
// The same race hides a UNIQUE index from the suites: the background build fails silently when a
// suite's fixtures already hold a duplicate (config/db.js), and the suite then passes on data
// production refuses. So the unique indexes the app relies on are built here too, before any
// fixture — same keys, options and name as the model's, or createIndex conflicts with the
// model's own build (test/liveIndex.int.test.js checks they match).
import mongoose from 'mongoose';
import { Db } from 'mongodb';

const HINTED = [
  ['canvassactivities', { userId: 1, timestamp: -1 }],
  ['canvassactivities', { campaignId: 1, timestamp: -1 }],
  ['surveyresponses', { userId: 1 }],
  ['surveyresponses', { campaignId: 1, submittedAt: -1 }],
];

const ENFORCED = [
  // One live pass per walk list (models/Pass.js, docs/PROPOSAL_WALK_LIST_ARCHIVE.md §C.12).
  [
    'passes',
    { status: 1, effortId: 1 },
    {
      unique: true,
      partialFilterExpression: { status: 'active', effortId: { $type: 'objectId' } },
      name: 'one_live_pass_per_walk_list',
    },
  ],
  // One link per client report (models/ReportShareLink.js REPORT_ONE_LINK_GUARD,
  // docs/PROPOSAL_CLIENT_REPORT_LINKS.md).
  ['reportsharelinks', { reportId: 1 }, { unique: true, partialFilterExpression: { oneLinkGuard: true }, name: 'report_one_link_guard' }],
];

const ensureTestIndexes = async (db) => {
  if (!db) return;
  for (const [collection, keys, options] of [...HINTED, ...ENFORCED]) await db.collection(collection).createIndex(keys, options);
};

const connect = mongoose.connect.bind(mongoose);
mongoose.connect = async (...args) => {
  const conn = await connect(...args);
  await ensureTestIndexes(mongoose.connection.db);
  return conn;
};

const dropDatabase = Db.prototype.dropDatabase;
Db.prototype.dropDatabase = async function dropThenRebuild(...args) {
  const result = await dropDatabase.apply(this, args);
  try {
    await ensureTestIndexes(this);
  } catch (err) {
    console.error('[testIndexPreload] rebuilding test indexes after a drop failed:', err.message);
  }
  return result;
};
