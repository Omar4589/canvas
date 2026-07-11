import mongoose from 'mongoose';

// Tuned connection options. `maxPoolSize` is PER PROCESS, so total Atlas connections =
// sum across every web + worker dyno; keep it modest and predictable (default 20 for web,
// smaller for the worker via override) rather than the driver default of 100/process, which
// scales unbounded with dyno count. `socketTimeoutMS` caps a hung query so it can't hold a
// pooled connection open forever (driver default is 0 = infinite → pool exhaustion risk).
function baseOptions() {
  const opts = {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 20,
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 2,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 120000,
    retryWrites: true,
    retryReads: true,
  };
  // Wire compression is opt-in: it needs the snappy/zstd native dep installed, so gate it behind
  // an env var (`MONGO_COMPRESSORS=snappy` or `zstd`) to avoid breaking the build when absent.
  const compressors = String(process.env.MONGO_COMPRESSORS || '').trim();
  if (compressors) opts.compressors = compressors.split(',').map((c) => c.trim()).filter(Boolean);
  return opts;
}

export async function connectDb(uri, overrides = {}) {
  if (!uri) throw new Error('MONGODB_URI is required');
  mongoose.set('strictQuery', true);
  // Auto-build indexes only OUTSIDE production. In production, schema changes —
  // especially new unique indexes like Person's — are built by the controlled
  // migration AFTER it dedups existing data. Auto-building on boot against
  // existing duplicates fails silently in the background and leaves no unique
  // guard, so resolvePerson upserts would race to create duplicate Persons.
  mongoose.set('autoIndex', process.env.NODE_ENV !== 'production');
  await mongoose.connect(uri, { ...baseOptions(), ...overrides });
  return mongoose.connection;
}
