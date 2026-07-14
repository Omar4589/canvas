#!/usr/bin/env bash
#
# Proves a mongodump archive is ACTUALLY RESTORABLE — by restoring it.
#
# A dump file you have never restored is not a backup, it is a hope. This spins up a throwaway
# mongod on a spare port, restores the archive into it, and prints a census of what came back.
# Compare that census to what production says (npm run audit:cross-org-identity in the Heroku
# Run console). If they match, you have a real safety net for the irreversible migration.
#
# Nothing here touches production. It only reads the archive file.
#
#   ./verify-backup.sh ~/doorline-preflight.archive.gz
set -euo pipefail

ARCHIVE="${1:?usage: ./verify-backup.sh <path-to-archive.gz>}"
[ -f "$ARCHIVE" ] || { echo "No such archive: $ARCHIVE"; exit 1; }

PORT=27950
DATADIR="$(mktemp -d)"
cleanup() { kill "${MPID:-}" 2>/dev/null || true; rm -rf "$DATADIR" 2>/dev/null || true; }
trap cleanup EXIT

SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  RESTORE TEST — is this archive actually usable?"
echo "  archive: $ARCHIVE  ($SIZE)"
echo "════════════════════════════════════════════════════════════"
echo ""

if [ ! -s "$ARCHIVE" ]; then
  echo "  ✗ THE ARCHIVE IS EMPTY. The dump did not work. DO NOT DEPLOY."
  exit 1
fi

echo "Starting a throwaway mongod on :$PORT …"
mongod --dbpath "$DATADIR" --port "$PORT" --bind_ip 127.0.0.1 --nounixsocket >/dev/null 2>&1 &
MPID=$!
for _ in $(seq 1 30); do
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
echo "── What came back ──────────────────────────────────────────"
echo ""
mongosh "mongodb://127.0.0.1:$PORT" --quiet --eval '
  const dbs = db.adminCommand({ listDatabases: 1 }).databases
    .map(d => d.name).filter(n => !["admin","config","local"].includes(n));
  if (!dbs.length) { print("  ✗ NO APPLICATION DATABASE IN THE ARCHIVE. DO NOT DEPLOY."); quit(1); }

  for (const name of dbs) {
    const d = db.getSiblingDB(name);
    print("  database: " + name);
    // The collections that actually matter for the migration you are about to run.
    const KEY = ["organizations","users","persons","voters","households","campaigns","canvassactivities","surveyresponses","memberships"];
    let voters = 0, persons = 0;
    for (const c of KEY) {
      const n = d.getCollection(c).countDocuments({});
      if (c === "voters") voters = n;
      if (c === "persons") persons = n;
      print("    " + c.padEnd(20) + n);
    }
    print("");
    // The exact thing the irreversible migration touches.
    const noOrg = d.persons.countDocuments({ organizationId: { $exists: false } });
    print("    Persons with NO organizationId : " + noOrg + "   (these are what migrate:persons-org-scope stamps)");
  }
' || { echo "  ✗ could not read the restored data"; exit 1; }

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✓ THE ARCHIVE RESTORED CLEANLY."
echo ""
echo "  Now compare the numbers above with what production reports:"
echo "      Heroku → Run console →  npm run audit:cross-org-identity"
echo ""
echo "  If the org / voter / household counts match, you have a real"
echo "  safety net and you may proceed to maintenance mode."
echo "════════════════════════════════════════════════════════════"
echo ""
