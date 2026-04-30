import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
// Resolve the server's .env relative to this file so the script works no matter
// what directory it was invoked from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { SurveyTemplate } from '../models/SurveyTemplate.js';

async function seedDefaultSurvey(adminId) {
  const existing = await SurveyTemplate.findOne();
  if (existing) {
    console.log('Survey template already exists, skipping survey seed.');
    return;
  }
  const survey = await SurveyTemplate.create({
    name: 'Default canvass survey',
    isActive: true,
    version: 1,
    createdBy: adminId,
    questions: [
      {
        key: 'top_issue',
        label: 'What is your top issue?',
        type: 'text',
        required: false,
        order: 1,
      },
      {
        key: 'support',
        label: 'Can we count on your support?',
        type: 'single_choice',
        options: ['Yes', 'Maybe', 'No', 'Undecided'],
        required: true,
        order: 2,
      },
      {
        key: 'yard_sign',
        label: 'Can you help us by taking a yard sign?',
        type: 'single_choice',
        options: ['Yes', 'No'],
        required: false,
        order: 3,
      },
    ],
  });
  console.log(`Seeded default survey: ${survey._id}`);
}

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
    console.log(`Admin with email ${email} already exists. No changes.`);
  } else {
    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      firstName,
      lastName,
      email,
      passwordHash,
      role: 'admin',
      isActive: true,
    });
    console.log(`Created admin: ${user.email} (id ${user._id})`);
  }

  const adminUser = existing || (await User.findOne({ email }));
  await seedDefaultSurvey(adminUser._id);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
