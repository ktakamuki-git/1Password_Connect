import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectApiClient } from '../src/connect-api.js';

const TEST_TOKEN = 'synthetic-connect-token-not-a-credential';
const SECRET_CANARY = 'SYNTHETIC_SECRET_CANARY_DO_NOT_RETURN';
const VALID_ENV = Object.freeze({
  CONNECT_SITE_ID: 'appv4',
  OP_CONNECT_HOST: 'http://127.0.0.1:8300',
  OP_CONNECT_TOKEN: TEST_TOKEN,
});

function fakeResponse(status, payload, { jsonError, body } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: body ?? { cancel: async () => {} },
    async json() {
      if (jsonError) throw jsonError;
      return payload;
    },
  };
}

function clientWithFetch(fetchImpl, env = VALID_ENV) {
  return createConnectApiClient({ env, fetchImpl });
}

test('missing and invalid configuration fail closed without making an HTTP request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('unexpected request'); };
  const missing = await clientWithFetch(fetchImpl, { CONNECT_SITE_ID: 'appv4' }).listVaults();
  assert.equal(missing.status, 'configuration_missing');
  assert.equal(calls, 0);

  const invalidSite = await clientWithFetch(fetchImpl, { ...VALID_ENV, CONNECT_SITE_ID: 'appv3' }).listVaults();
  assert.equal(invalidSite.siteId, 'unconfigured');
  assert.equal(invalidSite.status, 'configuration_invalid');
  assert.equal(calls, 0);

  const invalidHost = await clientWithFetch(fetchImpl, {
    ...VALID_ENV,
    OP_CONNECT_HOST: `http://127.0.0.1:8300/path?marker=${SECRET_CANARY}`,
  }).listVaults();
  assert.equal(invalidHost.status, 'configuration_invalid');
  assert.ok(!JSON.stringify(invalidHost).includes(SECRET_CANARY));
  assert.equal(calls, 0);
});

test('network and timeout failures return safe status metadata', async (t) => {
  for (const [label, failure] of [
    ['connection failure', new TypeError(`socket failed ${SECRET_CANARY}`)],
    ['timeout', Object.assign(new Error(`timeout ${SECRET_CANARY}`), { name: 'TimeoutError' })],
  ]) {
    await t.test(label, async () => {
      const result = await clientWithFetch(async () => { throw failure; }).listVaults();
      assert.equal(result.status, 'connect_unavailable');
      assert.ok(!JSON.stringify(result).includes(SECRET_CANARY));
      assert.ok(!JSON.stringify(result).includes(TEST_TOKEN));
    });
  }
});

test('non-success HTTP responses discard bodies and return bounded status metadata', async (t) => {
  const expected = new Map([[401, 'unauthorized'], [403, 'forbidden'], [429, 'rate_limited'], [503, 'upstream_error']]);
  for (const [status, resultStatus] of expected) {
    await t.test(String(status), async () => {
      let cancelled = false;
      const response = fakeResponse(status, null, {
        body: { cancel: async () => { cancelled = true; } },
      });
      const result = await clientWithFetch(async () => response).listVaults();
      assert.equal(result.status, resultStatus);
      assert.equal(result.httpStatus, status);
      assert.equal(cancelled, true);
      assert.ok(!JSON.stringify(result).includes(SECRET_CANARY));
    });
  }
});

test('malformed JSON and invalid vault payloads are rejected without reflecting upstream data', async (t) => {
  const malformed = await clientWithFetch(async () => fakeResponse(200, null, {
    jsonError: new SyntaxError(`bad JSON ${SECRET_CANARY}`),
  })).listVaults();
  assert.equal(malformed.status, 'invalid_upstream_response');
  assert.ok(!JSON.stringify(malformed).includes(SECRET_CANARY));

  const invalidPayloads = [
    ['non-array payload', { id: 'not-an-array' }],
    ['non-string identifier', [{ id: 17, name: SECRET_CANARY }]],
    ['identifier with control characters', [{ id: `${SECRET_CANARY}\ninvalid` }]],
    ['too many vaults', Array.from({ length: 1_001 }, (_, index) => ({ id: `vault-${index}` }))],
  ];
  for (const [label, payload] of invalidPayloads) {
    await t.test(label, async () => {
      const result = await clientWithFetch(async () => fakeResponse(200, payload)).listVaults();
      assert.equal(result.status, 'invalid_upstream_response');
      assert.ok(!JSON.stringify(result).includes(SECRET_CANARY));
    });
  }
});

test('vault listing sends only the fixed authenticated GET and projects IDs only', async () => {
  let observedUrl;
  let observedInit;
  const result = await clientWithFetch(async (url, init) => {
    observedUrl = String(url);
    observedInit = init;
    return fakeResponse(200, [
      { id: 'vault-z', name: SECRET_CANARY },
      { id: 'vault-a', items: [{ password: SECRET_CANARY }] },
      { id: 'vault-z', name: 'duplicate' },
    ]);
  }).listVaults();

  assert.deepEqual(result.vaultIds, ['vault-a', 'vault-z']);
  assert.ok(!JSON.stringify(result).includes(SECRET_CANARY));
  assert.equal(observedUrl, 'http://127.0.0.1:8300/v1/vaults');
  assert.equal(observedInit.method, 'GET');
  assert.equal(observedInit.headers.authorization, `Bearer ${TEST_TOKEN}`);
  assert.equal(observedInit.headers.accept, 'application/json');
  assert.equal(observedInit.redirect, 'error');
  assert.equal(observedInit.body, undefined);
  assert.ok(observedInit.signal instanceof AbortSignal);
});
