import { test } from 'node:test';
import assert from 'node:assert';
import * as server from '../src/services/site/demoOptions.js';
import * as web from '../../client/src/marketing/demoOptions.js';

// The demo form's selects exist twice: what the dialog offers (client/src/marketing/demoOptions.js)
// and what POST /api/demo-request accepts (server/src/services/site/demoOptions.js — production server
// code never imports from client/). If they drift, a person picking an option the server doesn't know
// gets "please check the details" and the lead is lost. Pinned here, value for value.
test('the server accepts exactly the options the demo form offers', () => {
  for (const key of ['ROLES', 'TEAM_SIZES', 'HEARD_ABOUT', 'WHEN', 'WHEN_AT_AAPC', 'WHEN_AFTER']) {
    assert.deepStrictEqual(server[key], web[key], key);
  }
  assert.strictEqual(String(server.SOURCE_PATTERN), String(web.SOURCE_PATTERN), 'SOURCE_PATTERN');
});
