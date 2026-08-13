import { setFbtimeFake, FbtimeApiError } from '../../src/services/fbtime/client.js';

// The in-process FbTime Partner API, for tests. A key prefixed `fbt_test_`
// routes here instead of the network (services/fbtime/client.js) — the
// mailer's test-transport idea, adapted. Install per-test with the responses
// you want; uninstall in after() so one file's fake can never answer another
// file's requests.
//
//   installFbtimeFake({
//     ping: { ok: true, organization: { id: 'org1', name: 'Fox Bryant' }, ... },
//     people: [{ id: 'p1', firstName: 'Maria', ... }],   // served in one page
//     hours: ({ params }) => ({ people: [...], range: {...} }),  // or a plain object
//     error: { code: 'KEY_REVOKED', status: 401 },       // every call throws this
//   })
//
// Handlers can be values or functions of ({ apiKey, path, params }); functions
// let a test vary the response per call (e.g. second pull drops a day).

let calls = [];

export const fbtimeCalls = () => calls;

export const installFbtimeFake = (config = {}) => {
  calls = [];
  setFbtimeFake(({ apiKey, path, params }) => {
    calls.push({ apiKey, path, params });

    if (config.error) {
      const { code = null, status = null, message } = config.error;
      throw new FbtimeApiError(message || `test fake: ${code || 'error'}`, { code, status });
    }

    const resolve = (v) => (typeof v === 'function' ? v({ apiKey, path, params }) : v);

    if (path === '/ping') {
      return resolve(
        config.ping ?? {
          ok: true,
          organization: { id: 'fbtorg000000000000000001', name: 'Test FbTime Org' },
          key: { name: 'Doorline (test)', prefix: 'fbt_test_', scopes: ['timesheets:read', 'roster:read'] },
          serverTime: new Date().toISOString(),
          apiVersion: 1,
        }
      );
    }
    if (path === '/people') {
      const people = resolve(config.people) ?? [];
      return {
        people,
        pagination: { page: 1, limit: 500, total: people.length, totalPages: 1 },
      };
    }
    if (path === '/hours') {
      return resolve(config.hours) ?? { people: [], totals: {}, range: params };
    }
    throw new FbtimeApiError('test fake: unknown path ' + path, { code: 'NOT_FOUND', status: 404 });
  });
};

export const uninstallFbtimeFake = () => {
  calls = [];
  setFbtimeFake(null);
};
