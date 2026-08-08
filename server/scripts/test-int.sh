#!/usr/bin/env bash
#
# One-command integration test runner. Boots a throwaway mongod, runs every *.int.test.js file
# (each in its OWN database to avoid cross-file collisions — see the "one-file-per-DB" convention),
# and tears the mongod down. The int suites skip when MONGODB_URI_TEST is unset, so this wires it up.
#
#   npm run test:int                                   # the whole marathon
#   npm run test:int -- test/teamLead.int.test.js …    # just the named file(s)
#
# Needs `mongod` on PATH (brew install mongodb-community). Override the port with MONGO_TEST_PORT.
#
# SELF-HEALING: the marathon used to hoard all ~80 suites' databases in one mongod, which
# reliably ABORTED (SIGABRT) partway through a full run — every suite after it then "failed"
# with connection noise, twice burning an afternoon on phantom failures. Three fixes below:
# the WiredTiger cache is capped, each suite's database is DROPPED as soon as it passes, and
# if mongod dies anyway the runner restarts it on a fresh datadir and retries that ONE suite
# before counting a failure.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # server/
# Random default port: two CONCURRENT runs of this script (say, one in a terminal and one from an
# agent) used to share :27779 — and since db names derive from file paths, each run's per-file
# cleanup wiped the OTHER run's data mid-test. That produced phantom one-off failures (a vanished
# ImportJob, suites dying at connect) that never reproduced in isolation. Pin MONGO_TEST_PORT only
# when you genuinely want two runs on one mongod.
PORT="${MONGO_TEST_PORT:-$((20000 + RANDOM % 20000))}"
DATADIR=""
MONGO_PID=""

cleanup() {
  [ -n "$MONGO_PID" ] && kill "$MONGO_PID" 2>/dev/null || true
  [ -n "$DATADIR" ] && rm -rf "$DATADIR" 2>/dev/null || true
}
trap cleanup EXIT

command -v mongod >/dev/null 2>&1 || { echo "mongod not found on PATH (brew install mongodb-community)"; exit 1; }

mongo_alive() {
  node -e "const n=require('net');const s=n.connect($PORT,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null
}

start_mongo() {
  # A fresh datadir every (re)start: after a SIGABRT the old one may be corrupt, and every
  # database in it belongs to an already-finished suite anyway.
  [ -n "$MONGO_PID" ] && kill "$MONGO_PID" 2>/dev/null || true
  [ -n "$DATADIR" ] && rm -rf "$DATADIR" 2>/dev/null || true
  DATADIR="$(mktemp -d)"
  # The cache cap is load-bearing: WiredTiger defaults to half of RAM, and the marathon's
  # accumulated collections + a default cache is exactly the mix that got mongod killed.
  mongod --dbpath "$DATADIR" --port "$PORT" --bind_ip 127.0.0.1 --nounixsocket \
    --wiredTigerCacheSizeGB 0.5 >/dev/null 2>&1 &
  MONGO_PID=$!
  for i in $(seq 1 30); do
    if mongo_alive; then return 0; fi
    sleep 1
  done
  echo "mongod did not become ready"
  return 1
}

drop_db() {
  # Best-effort: dropping each finished suite's database is what keeps one mongod healthy
  # across the whole marathon. A failure here is not a test failure.
  MONGO_DROP_URI="mongodb://127.0.0.1:$PORT/$1" node -e '
    const { MongoClient } = require("mongodb");
    const c = new MongoClient(process.env.MONGO_DROP_URI, { serverSelectionTimeoutMS: 3000 });
    c.connect().then(() => c.db().dropDatabase()).then(() => c.close()).then(() => process.exit(0), () => process.exit(0));
  ' 2>/dev/null || true
}

echo "Starting throwaway mongod on :$PORT …"
start_mongo || exit 1

# Every integration test file (test/ + co-located under src/) — or just the ones named as
# arguments. Filenames have no spaces.
if [ "$#" -gt 0 ]; then
  FILES="$(printf '%s\n' "$@")"
else
  FILES="$(cd "$HERE" && find test src -name '*.int.test.js' 2>/dev/null | sort)"
fi
COUNT="$(printf '%s\n' "$FILES" | grep -c . || true)"
echo "Running $COUNT integration test file(s) against mongodb://127.0.0.1:$PORT"

FAIL=0
for f in $FILES; do
  db="itest_$(printf '%s' "$f" | tr '/.' '__')"
  echo ""
  echo "── $f"
  if MONGODB_URI_TEST="mongodb://127.0.0.1:$PORT/$db" node --test --test-force-exit "$HERE/$f"; then
    drop_db "$db"
    continue
  fi
  # The suite failed. If mongod died out from under it, that is the RUNNER's failure, not
  # the suite's: restart on a fresh datadir and give this one suite a second run.
  if ! mongo_alive; then
    echo "↻ mongod died during $f — restarting and retrying that suite once"
    start_mongo || exit 1
    if MONGODB_URI_TEST="mongodb://127.0.0.1:$PORT/$db" node --test --test-force-exit "$HERE/$f"; then
      drop_db "$db"
      continue
    fi
  fi
  FAIL=1
done

echo ""
[ "$FAIL" = "0" ] && echo "✓ all integration suites passed" || echo "✗ some integration suites failed"
exit $FAIL
