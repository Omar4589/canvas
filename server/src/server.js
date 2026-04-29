import 'dotenv/config';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';

const PORT = Number(process.env.PORT || 4000);

async function main() {
  await connectDb(process.env.MONGODB_URI);
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[canvass-server] listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('[canvass-server] failed to start', err);
  process.exit(1);
});
