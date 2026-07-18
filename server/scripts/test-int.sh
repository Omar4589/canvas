#!/usr/bin/env bash
#
# One-command integration test runner. Boots a throwaway mongod, runs every *.int.test.js file
# (each in its OWN database to avoid cross-file collisions — see the "one-file-per-DB" convention),
# and tears the mongod down. The int suites skip when MONGODB_URI_TEST is unset, so this wires it up.
#
#   npm run test:int
#
# Needs `mongod` on PATH (brew install mongodb-community). Override the port with MONGO_TEST_PORT.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # server/
# Random default port: two CONCURRENT runs of this script (say, one in a terminal and one from an
# agent) used to share :27779 — and since db names derive from file paths, each run's per-file
# cleanup wiped the OTHER run's data mid-test. That produced phantom one-off failures (a vanished
# ImportJob, suites dying at connect) that never reproduced in isolation. Pin MONGO_TEST_PORT only
# when you genuinely want two runs on one mongod.
PORT="${MONGO_TEST_PORT:-$((20000 + RANDOM % 20000))}"
DATADIR="$(mktemp -d)"
MONGO_PID=""

cleanup() {
  [ -n "$MONGO_PID" ] && kill "$MONGO_PID" 2>/dev/null || true
  rm -rf "$DATADIR" 2>/dev/null || true
}
trap cleanup EXIT

command -v mongod >/dev/null 2>&1 || { echo "mongod not found on PATH (brew install mongodb-community)"; exit 1; }

echo "Starting throwaway mongod on :$PORT …"
mongod --dbpath "$DATADIR" --port "$PORT" --bind_ip 127.0.0.1 --nounixsocket >/dev/null 2>&1 &
MONGO_PID=$!

# Wait for it to accept connections.
ready=0
for i in $(seq 1 30); do
  if node -e "const n=require('net');const s=n.connect($PORT,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null; then
    ready=1; break
  fi
  sleep 1
done
[ "$ready" = "1" ] || { echo "mongod did not become ready"; exit 1; }

# Every integration test file (test/ + co-located under src/). Filenames have no spaces.
FILES="$(cd "$HERE" && find test src -name '*.int.test.js' 2>/dev/null | sort)"
COUNT="$(printf '%s\n' "$FILES" | grep -c . || true)"
echo "Running $COUNT integration test file(s) against mongodb://127.0.0.1:$PORT"

FAIL=0
for f in $FILES; do
  db="itest_$(printf '%s' "$f" | tr '/.' '__')"
  echo ""
  echo "── $f"
  if ! MONGODB_URI_TEST="mongodb://127.0.0.1:$PORT/$db" node --test --test-force-exit "$HERE/$f"; then
    FAIL=1
  fi
done

echo ""
[ "$FAIL" = "0" ] && echo "✓ all integration suites passed" || echo "✗ some integration suites failed"
exit $FAIL
