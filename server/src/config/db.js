import mongoose from 'mongoose';

export async function connectDb(uri) {
  if (!uri) throw new Error('MONGODB_URI is required');
  mongoose.set('strictQuery', true);
  // Auto-build indexes only OUTSIDE production. In production, schema changes —
  // especially new unique indexes like Person's — are built by the controlled
  // migration AFTER it dedups existing data. Auto-building on boot against
  // existing duplicates fails silently in the background and leaves no unique
  // guard, so resolvePerson upserts would race to create duplicate Persons.
  mongoose.set('autoIndex', process.env.NODE_ENV !== 'production');
  await mongoose.connect(uri);
  return mongoose.connection;
}
