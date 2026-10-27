import 'dotenv/config';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { syncClientReportIndexes } from './services/reports/clientReportIndexes.js';
import { syncPacePauseIndexes } from './services/audit/pacePause.js';

const PORT = Number(process.env.PORT || 4000);

async function main() {
  // A request waits at most 30 s for a database connection — Heroku's router has given up on it by
  // then anyway. A crew change's hold (services/memberships/setCoordinator.js, 150 s) is sized to cover
  // a renewal, this wait and one 60 s ledger write. Set here, on the web dyno only: config/db.js's
  // shared options also reach the worker and the console scripts.
  await connectDb(process.env.MONGODB_URI, { waitQueueTimeoutMS: 30000 });
  // The client-report collections this dyno WRITES (series, area cells) get their indexes before
  // the first request can — autoIndex is off in production (services/reports/clientReportIndexes.js).
  await syncClientReportIndexes('canvass-server');
  // Automatic pause's one-open-pause-per-canvasser index must exist before a door can write a pause.
  await syncPacePauseIndexes('canvass-server');
  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`[canvass-server] listening on http://localhost:${PORT}`);
  });

  // Heroku stops this dyno once a day (scheduled cycling) and on every deploy/restart, by
  // sending SIGTERM. Without a handler the process just dies, and any request in flight at
  // that instant has its connection dropped with no response — logged by the router as H13.
  // Mirror worker.js: stop accepting new connections, let in-flight requests finish, drop
  // idle keep-alive sockets (which would otherwise hold close() open), and exit well inside
  // the 30s window after which Heroku SIGKILLs (R12).
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[canvass-server] ${signal} — draining in-flight requests…`);
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => {
      console.error('[canvass-server] drain timed out — exiting');
      process.exit(0);
    }, 25000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[canvass-server] failed to start', err);
  process.exit(1);
});
