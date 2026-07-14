#!/usr/bin/env bash
#
# Proves a mongodump archive is ACTUALLY RESTORABLE — by restoring it — and then tells you exactly
# what the irreversible migration is going to do to it.
#
# A dump file you have never restored is not a backup, it is a hope. This spins up a throwaway mongod
# on a spare port, restores the archive into it, and reads the result.
#
# Two things this script learned the hard way:
#
#   1. It used to count a collection called `persons`. The real one is `people` — Mongoose pluralizes
#      Person irregularly. countDocuments() on a collection that does not exist returns 0 without
#      erroring, so it printed "Persons with NO organizationId: 0" — total reassurance — when the true
#      answer was EVERY Person in the database. It reported zero blast radius when the blast radius
#      was 100%. Hence: a MISSING collection is now a hard failure, distinct from an empty one.
#
#   2. It used to shell out to mongosh, which on this machine is a broken Homebrew build (it links
#      against a Homebrew node whose icu4c has moved). We use the repo's own mongodb driver instead —
#      the same one the app runs on. mongod/mongorestore are Go binaries and are unaffected.
#
# Nothing here touches production. It only reads the archive file.
#
#   ./verify-backup.sh ~/doorline-preflight.archive.gz
set -euo pipefail

ARCHIVE="${1:?usage: ./verify-backup.sh <path-to-archive.gz>}"
[ -f "$ARCHIVE" ] || { echo "No such archive: $ARCHIVE"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=27950
DATADIR="$(mktemp -d)"
cleanup() { kill "${MPID:-}" 2>/dev/null || true; rm -rf "$DATADIR" 2>/dev/null || true; }
trap cleanup EXIT

SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "  RESTORE TEST — is this archive actually usable?"
echo "  archive: $ARCHIVE  ($SIZE)"
echo "════════════════════════════════════════════════════════════════════"
echo ""

if [ ! -s "$ARCHIVE" ]; then
  echo "  ✗ THE ARCHIVE IS EMPTY. The dump did not work. DO NOT DEPLOY."
  exit 1
fi

echo "Starting a throwaway mongod on :$PORT …"
mongod --dbpath "$DATADIR" --port "$PORT" --bind_ip 127.0.0.1 --nounixsocket >/dev/null 2>&1 &
MPID=$!
for _ in $(seq 1 40); do
  if node -e "const n=require('net');const s=n.connect($PORT,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null; then break; fi
  sleep 1
done

echo "Restoring…"
if ! mongorestore --uri="mongodb://127.0.0.1:$PORT" --archive="$ARCHIVE" --gzip --quiet; then
  echo ""
  echo "  ✗ RESTORE FAILED. This archive is not a usable backup. DO NOT DEPLOY."
  exit 1
fi

echo ""
MONGO_PORT="$PORT" node "$HERE/scripts/census.mjs"
