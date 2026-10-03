import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Contact % help text, both clients. Not a target voter is named only on a campaign that uses the
// outcome (owner ruling 2026-10-02 — the export copy's rule): `contactRate` never names it and is
// what every other campaign reads; `contactRateNotTargetInUse` names it, and the canvasser table
// (web) and the campaign home (phone) pick it by outcomeInUse. A help popover renders only when
// opened, so no page render can see this text — it is pinned here instead. Both files are plain
// ESM with no React/RN imports, so they load in node (the actionLabels.test.js pattern).
const here = path.dirname(fileURLToPath(import.meta.url));
const web = (await import(path.resolve(here, '../../client/src/lib/metricHelp.js'))).metricHelp;
const mobile = (await import(path.resolve(here, '../../mobile/lib/metricHelp.js'))).metricHelp;

test('the plain Contact % help never names Not a target voter; the in-use form does', () => {
  for (const [name, help] of [['web', web], ['mobile', mobile]]) {
    assert.ok(!/not.a.target/i.test(help.contactRate), `${name}: contactRate is shown on every campaign`);
    assert.match(help.contactRateNotTargetInUse, /Not a target voter/, `${name}: the in-use form names it`);
    // Both forms keep the once-per-door rule, which holds on every campaign.
    for (const k of ['contactRate', 'contactRateNotTargetInUse']) {
      assert.match(help[k], /Each door counts once per pass/, `${name}.${k}`);
    }
  }
});

test('web and phone read the same Contact % help, both forms', () => {
  for (const k of ['contactRate', 'contactRateNotTargetInUse', 'notTarget']) {
    assert.strictEqual(web[k], mobile[k], `metricHelp.${k} differs between client/src/lib and mobile/lib`);
  }
});
