// Refuses to publish an OTA that no phone can download.
// Run with: node scripts/ota-check.mjs [--platform=android,ios] [--build-profile=<name>] (from mobile/).
//   --platform       default android,ios
//   --build-profile  which build profile's newest finished build to compare against; default
//                    production (the fielded fleet). The two-store Play relaunch uses
//                    --build-profile=playorg to gate updates to the new store account's testers.
//
// app.json sets runtimeVersion: { policy: "fingerprint" }. A phone only downloads an update whose
// fingerprint EXACTLY matches the one baked into its installed binary, and that fingerprint hashes
// app.json / eas.json / package.json / patches/ / autolinked native modules — but never app JS.
// So editing any of those (even something inert, like bumping app.json "version" when eas.json sets
// appVersionSource:"remote", or adding a submit-only ascAppId) re-stamps the update with a hash no
// installed build has. `eas update` still prints "success". The bundle reaches nobody, and nothing
// tells you. That is exactly how Android vc16 shipped with a fingerprint no update was ever
// published under — a build that can never receive an OTA at all.
//
// This compares the working tree's fingerprint against the newest finished build's and exits
// non-zero on a mismatch, so the failure is loud and happens BEFORE the publish.

import { execFileSync } from 'child_process';

const PLATFORMS = (process.argv.find((a) => a.startsWith('--platform='))?.split('=')[1] ?? 'android,ios')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

// Which build profile's newest finished build we compare the tree against. Default 'production'
// keeps `ota:production` (which passes no flag) behaving exactly as before.
const BUILD_PROFILE = process.argv.find((a) => a.startsWith('--build-profile='))?.split('=')[1] ?? 'production';

const run = (args) => execFileSync('npx', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// The tree's fingerprint, from the same resolver EAS uses (so it honors fingerprint.config.js).
function localFingerprint(platform) {
  const out = run(['expo-updates', 'fingerprint:generate', '--platform', platform]);
  const { hash } = JSON.parse(out);
  return hash;
}

// The newest finished build's runtimeVersion. Under the fingerprint policy, a build's runtimeVersion
// IS its fingerprint — so this is the hash every phone running that build will demand.
function latestBuild(platform) {
  const out = run([
    'eas', 'build:list',
    '--platform', platform,
    '--build-profile', BUILD_PROFILE,
    '--status', 'finished',
    '--limit', '1',
    '--json', '--non-interactive',
  ]);
  const [build] = JSON.parse(out);
  return build ?? null;
}

let failed = false;

for (const platform of PLATFORMS) {
  const local = localFingerprint(platform);
  const build = latestBuild(platform);

  if (!build) {
    console.error(`✖ ${platform}: no finished ${BUILD_PROFILE} build found — nothing to publish to.`);
    failed = true;
    continue;
  }

  if (build.runtimeVersion === local) {
    console.log(`✓ ${platform}: ${local.slice(0, 10)}… matches build ${build.appBuildVersion} — the OTA will land.`);
    continue;
  }

  failed = true;
  console.error(
    `\n✖ ${platform}: FINGERPRINT MISMATCH — this update would reach NOBODY.\n` +
      `    tree:  ${local}\n` +
      `    build: ${build.runtimeVersion}  (${build.appBuildVersion}, ${build.appVersion})\n\n` +
      `  A native input changed, so no installed ${platform} build will accept this bundle.\n` +
      `  See exactly which sources moved:\n` +
      `    npx eas fingerprint:compare --build-id ${build.id}\n\n` +
      `  Then either revert that change, or cut a new build and submit it.\n`,
  );
}

// Deliberate override — for the one legitimate case (you have just cut a build and are publishing
// the first update onto it before EAS lists it as finished). It must be loud: an OTA that silently
// reaches nobody is the failure this script exists to prevent.
if (failed && process.env.OTA_ALLOW_MISMATCH === '1') {
  console.warn('\n⚠️  OTA_ALLOW_MISMATCH=1 — publishing anyway. This update may reach no devices.\n');
  process.exit(0);
}

process.exit(failed ? 1 : 0);
