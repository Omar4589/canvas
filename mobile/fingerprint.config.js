// Why this file exists: on 2026-07-13 an OTA went out under a runtimeVersion no installed
// binary had, so it reached nobody — while an Android crash sat unfixed on every phone. The
// cause: @expo/fingerprint hashes inputs that cannot change the native binary, so two inert
// edits silently orphaned the fleet:
//   · app.json "version" (0.1.0 → 1.0.0). Inert for us — eas.json sets appVersionSource
//     "remote", so the store version comes from EAS servers, not this field.
//   · eas.json's `submit` block (ascAppId). Read only by `eas submit`, never compiled into
//     anything.
// A third class was added on 2026-07-28, after the same trap fired again: a `test` script added
// to mobile/package.json moved BOTH platform fingerprints and ota:check rightly blocked the
// publish (fixed by 65570ec, which moved the runner to the root package.json). npm scripts are
// build-time tooling — they are never compiled into the binary — so none of them belong in the
// hash. `PackageJsonScriptsAll` drops the whole `packageJson:scripts` source, which supersedes
// the narrower stock skip below. Native DEPENDENCIES are unaffected: they reach the hash through
// autolinking, not through this source, so adding a native module still moves the fingerprint.
//
// This config stops exactly those three classes of edit from moving the fingerprint. Everything
// that DOES reach the binary (plugins, native deps, permissions, icons, build profiles) still
// hashes as before.
//
// WARNING: editing THIS file changes every fingerprint — it may only change in a commit that
// also ships a new native build. Never touch it in an OTA-only change. The `ota:check` script
// is the backstop that catches it loudly if someone does.

module.exports = {
  // NOTE: this REPLACES @expo/fingerprint's default skip set (normalizeOptionsAsync spreads
  // the config over the defaults), so the stock default must be re-listed explicitly.
  sourceSkips: [
    'PackageJsonScriptsAll', // no npm script reaches the binary; supersedes the stock skip below
    'PackageJsonAndroidAndIosScriptsIfNotContainRun', // the stock default — re-listed on purpose
    'ExpoConfigVersions', // app.json version / android.versionCode / ios.buildNumber
  ],

  // eas.json is hashed whole-file with no field-level skip, so strip the submit-only section
  // before it reaches the hash. Called once per streamed chunk of each hashed file; `this` is
  // the per-file transform stream, so buffering on it is isolated per file. Every path returns
  // deterministic bytes — on any parse surprise we hash the raw file rather than something
  // chunk-boundary-dependent.
  fileHookTransform(source, chunk, isEndOfFile) {
    if (source.type !== 'file' || source.filePath !== 'eas.json') return chunk;
    this._easBuf ??= [];
    if (chunk != null) this._easBuf.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (!isEndOfFile) return null; // withhold until the whole file has streamed
    const whole = Buffer.concat(this._easBuf).toString('utf8');
    this._easBuf = null;
    try {
      const json = JSON.parse(whole);
      delete json.submit; // submit config never reaches the binary
      return JSON.stringify(json);
    } catch {
      return whole; // unparseable eas.json: hash it raw (deterministic, just un-stripped)
    }
  },
};
