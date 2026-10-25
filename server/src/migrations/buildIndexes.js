import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';

// Build every index the schemas DECLARE but that prod may be missing, because
// `autoIndex` is off in production (config/db.js) — so a new `index:true` /
// schema.index() never gets built on deploy. This makes the live DB match the code.
//
//   node src/migrations/buildIndexes.js            # dry run — list what's missing
//   node src/migrations/buildIndexes.js --apply    # build the missing ones (SAFE: createIndexes never drops)
//   node src/migrations/buildIndexes.js --apply --sync   # also DROP indexes not in any schema (careful)
//
// `--apply` (createIndexes) is idempotent and additive: existing indexes are left
// alone, only missing declared ones are built. Use `--sync` only if you intend to
// prune hand-created indexes that aren't in the schemas.
const APPLY = process.argv.includes('--apply');
const SYNC = process.argv.includes('--sync');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, '../models');

async function main() {
  // Register every model without letting registration auto-build anything — we build
  // deliberately below. On the connection too: connectDb turns autoIndex back on outside
  // production, and a dry run there built the indexes while it listed them, so it listed only
  // those it got to first (2026-10-20). The connection's own option outranks that global.
  mongoose.set('autoIndex', false);
  for (const f of fs.readdirSync(MODELS_DIR).filter((n) => n.endsWith('.js'))) {
    await import(path.join(MODELS_DIR, f));
  }
  await connectDb(process.env.MONGODB_URI, { autoIndex: false });

  const names = Object.keys(mongoose.models).sort();
  const mode = APPLY ? (SYNC ? 'APPLY + SYNC (build missing, drop extraneous)' : 'APPLY (build missing)') : 'DRY RUN';
  console.log(`${names.length} models · mode: ${mode}\n`);

  let totalMissing = 0;
  const failed = [];
  for (const name of names) {
    const Model = mongoose.models[name];
    const declared = Model.schema.indexes(); // [[keys, options], ...] — includes field-level index:true
    if (!declared.length) continue;
    let existing = [];
    try {
      existing = await Model.collection.indexes();
    } catch {
      /* collection doesn't exist yet — every declared index is "missing" */
    }
    const existingSigs = new Set(existing.map((i) => JSON.stringify(i.key)));
    const missing = declared.filter(([keys]) => !existingSigs.has(JSON.stringify(keys)));
    totalMissing += missing.length;

    if (missing.length) {
      console.log(`${name} (${Model.collection.collectionName}) — MISSING ${missing.length}/${declared.length}:`);
      for (const [keys, opts] of missing) {
        const o = opts && Object.keys(opts).filter((k) => k !== 'background').length ? ` ${JSON.stringify(opts)}` : '';
        console.log(`   + ${JSON.stringify(keys)}${o}`);
      }
    }

    if (APPLY) {
      // Per model: one model's failure (a unique index over existing duplicates, say) is reported
      // and the run goes on to the next, instead of leaving every later model's indexes unbuilt.
      try {
        if (SYNC) await Model.syncIndexes();
        else await Model.createIndexes();
      } catch (err) {
        failed.push(name);
        console.error(`   ✗ ${name}: ${err?.message || err}`);
      }
    }
  }

  if (failed.length) {
    console.error(`\n${failed.length} model(s) failed to build: ${failed.join(', ')} — fix and re-run; the rest were built.`);
    process.exitCode = 1;
  }
  if (APPLY) {
    console.log(`\nDone — ${SYNC ? 'synced' : 'built missing'} indexes across ${names.length - failed.length} of ${names.length} models.`);
  } else {
    console.log(
      totalMissing
        ? `\n${totalMissing} declared index(es) not present. Re-run with --apply to build them.`
        : '\nAll declared indexes are already present. Nothing to build.'
    );
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
