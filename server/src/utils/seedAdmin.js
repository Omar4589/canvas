import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const firstName = process.env.SEED_ADMIN_FIRST_NAME || 'Admin';
  const lastName = process.env.SEED_ADMIN_LAST_NAME || 'User';

  if (!email || !password) {
    console.error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required in .env');
    process.exit(1);
  }

  await connectDb(process.env.MONGODB_URI);

  const existing = await User.findOne({ email });
  if (existing) {
    if (!existing.isSuperAdmin) {
      existing.isSuperAdmin = true;
      await existing.save();
      console.log(`Promoted existing user ${email} to super admin.`);
    } else {
      console.log(`Super admin ${email} already exists. No changes.`);
    }
  } else {
    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      firstName,
      lastName,
      email,
      passwordHash,
      isSuperAdmin: true,
      isActive: true,
    });
    console.log(`Created super admin: ${user.email} (id ${user._id})`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
