import 'dotenv/config';
import { createRedis } from '../queues/connection.js';
import { keptLines, KEPT_LINES, KEPT_DAYS } from '../middleware/memoryWatch.js';

// The memory tripwire's lines, read back from Redis (middleware/memoryWatch.js; docs/OPERATIONS.md, "The
// memory tripwire"). READ-ONLY: it never writes. Heroku's log keeps only its last 1,500 lines, minutes
// during field hours, so a spike noticed later on the Metrics tab is no longer in it. The web dyno keeps
// its newest 300 [memory-watch] lines in Redis for 30 days after the last, and this prints them.
//
//   npm run report:memory-watch
//
// Any time, from the repo root (Heroku dashboard → More → Run console). Oldest first, each with its time
// in Central, the owner's clock, and the dyno that wrote it. Route patterns, times and sizes only: the
// tripwire never writes a name, an id or a link.

const OWNER_TIME_ZONE = 'America/Chicago';
const when = (d) =>
  d.toLocaleString('en-US', {
    timeZone: OWNER_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });

const main = async () => {
  const extra = process.argv.slice(2);
  if (extra.length) {
    console.error(`Unknown argument: ${extra.join(' ')}\nUsage: npm run report:memory-watch`);
    process.exit(2);
  }
  // Its own connection, dropped when done. Bounded: an unreachable Redis would otherwise be waited out
  // forever (maxRetriesPerRequest: null).
  const redis = createRedis();
  try {
    const kept = await Promise.race([
      keptLines(redis),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Redis did not answer within 10 seconds (REDIS_URL).')), 10000).unref();
      }),
    ]);
    console.log("The memory tripwire's lines, as the website's server kept them (read-only; oldest first)\n");
    if (!kept.length) {
      console.log(`None kept: nothing has set off the tripwire in the last ${KEPT_DAYS} days, or since it began keeping lines.`);
    } else {
      for (const k of kept) console.log(`${when(k.at)}  ${k.dyno}  ${k.line.replace(/^\[memory-watch\] /, '')}`);
      const span = kept.length === 1 ? when(kept[0].at) : `${when(kept[0].at)} to ${when(kept.at(-1).at)}`;
      console.log(`\n${kept.length} line(s), ${span}.`);
      console.log(`Only the newest ${KEPT_LINES} are kept, and none ${KEPT_DAYS} days after the last.`);
    }
    console.log('Nothing was changed.');
  } finally {
    redis.disconnect();
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
