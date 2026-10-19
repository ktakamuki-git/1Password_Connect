import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const TEST_TOKEN = 'synthetic-test-token-not-a-credential';
const SECRET_CANARY = 'SYNTHETIC_SECRET_CANARY_DO_NOT_RETURN';
const TOOL_NAME = 'connect_list_vaults';
const PLUGIN_ENTRY = fileURLToPath(new URL('../src/index.js', import.meta.url));
const PACKAGE_ROOT = path.resolve(path.dirname(PLUGIN_ENTRY), '..');

async function startMockApi({ status = 200, body = [] } = {}) {
  const observations = { requests: 0, authAccepted: false, methods: [], paths: [] };
  const server = createServer((request, response) => {
    observations.requests += 1;
    observations.methods.push(request.method);
    observations.paths.push(request.url);
    observations.authAccepted = request.headers.authorization === `Bearer ${TEST_TOKEN}`;
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    response.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    observations,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function withHubClient({ siteId = 'appv4', origin, token = TEST_TOKEN }, run) {
  const env = {
    CONNECT_SITE_ID: siteId,
    OP_CONNECT_HOST: origin,
    OP_CONNECT_TOKEN: token,
    PATH: process.env.PATH ?? '',
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [PLUGIN_ENTRY],
    cwd: PACKAGE_ROOT,
    env,
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const notifications = [];
  const client = new Client({ name: 'hub-contract-test', version: '1.0.0' }, {
    versionNegotiation: { mode: { pin: '2026-07-28' } },
    listMaxPages: 8,
    enforceStrictCapabilities: true,
  });
  client.setNotificationHandler('notifications/message', (notification) => {
    notifications.push(notification);
  });
  try {
    await client.connect(transport);
    return await run({ client, notifications, getStderr: () => stderr });
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

function responseText(result) {
  return (result?.content ?? []).filter((item) => item.type === 'text').map((item) => item.text).join('\n');
}

function callAudits(stderr) {
  return stderr.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
    .filter((entry) => entry.event === 'tool_call_audit');
}

test('Hub-equivalent stdio client discovers one read-only tool and receives only vault ID metadata', async () => {
  const api = await startMockApi({
    body: [{
      id: 'vault-public-id-1',
      name: 'Sensitive Vault Name',
      items: [{ password: SECRET_CANARY }],
    }],
  });
  try {
    await withHubClient({ origin: api.origin }, async ({ client, notifications, getStderr }) => {
      const listing = await client.listTools();
      assert.deepEqual(listing.tools.map((tool) => tool.name), [TOOL_NAME]);
      assert.equal(listing.tools[0].inputSchema.type, 'object');
      assert.deepEqual(listing.tools[0].inputSchema.properties, {});
      assert.equal(listing.tools[0].inputSchema.additionalProperties, false);
      assert.equal(listing.tools[0].annotations.readOnlyHint, true);
      assert.equal(listing.tools[0].annotations.destructiveHint, false);

      const result = await client.callTool({ name: TOOL_NAME, arguments: {} });
      const text = responseText(result);
      const metadata = JSON.parse(text);
      assert.equal(result.isError, false);
      assert.equal(metadata.status, 'ok');
      assert.equal(metadata.siteId, 'appv4');
      assert.deepEqual(metadata.vaultIds, ['vault-public-id-1']);
      assert.match(metadata.routeFingerprint, /^[a-f0-9]{16}$/u);
      assert.match(metadata.correlationId, /^[a-f0-9-]{36}$/u);
      assert.equal(result.structuredContent, undefined);
      assert.ok(!text.includes('Sensitive Vault Name'));
      assert.ok(!text.includes(SECRET_CANARY));
      assert.ok(!text.includes(TEST_TOKEN));
      assert.equal(api.observations.authAccepted, true);
      assert.deepEqual(api.observations.methods, ['GET']);
      assert.deepEqual(api.observations.paths, ['/v1/vaults']);
      assert.deepEqual(notifications, []);
      assert.ok(!getStderr().includes(SECRET_CANARY));
      assert.ok(!getStderr().includes(TEST_TOKEN));
      const [audit] = callAudits(getStderr());
      assert.equal(audit.correlationId, metadata.correlationId);
      assert.equal(audit.tool, TOOL_NAME);
      assert.equal(audit.status, 'ok');
      assert.ok(Number.isInteger(audit.durationMs) && audit.durationMs >= 0);
      assert.deepEqual(Object.keys(audit).sort(), ['correlationId', 'durationMs', 'event', 'status', 'tool']);
    });
  } finally {
    await api.close();
  }
});

test('Connect HTTP errors become safe metadata and never expose the response body', async () => {
  const api = await startMockApi({ status: 401, body: { detail: SECRET_CANARY, token: TEST_TOKEN } });
  try {
    await withHubClient({ origin: api.origin }, async ({ client, notifications, getStderr }) => {
      const result = await client.callTool({ name: TOOL_NAME, arguments: {} });
      const text = responseText(result);
      const metadata = JSON.parse(text);
      assert.equal(result.isError, true);
      assert.equal(metadata.status, 'unauthorized');
      assert.equal(metadata.httpStatus, 401);
      assert.match(metadata.correlationId, /^[a-f0-9-]{36}$/u);
      assert.ok(!text.includes(SECRET_CANARY));
      assert.ok(!text.includes(TEST_TOKEN));
      assert.equal(api.observations.requests, 1);
      assert.deepEqual(notifications, []);
      assert.ok(!getStderr().includes(SECRET_CANARY));
      assert.ok(!getStderr().includes(TEST_TOKEN));
      const [audit] = callAudits(getStderr());
      assert.equal(audit.correlationId, metadata.correlationId);
      assert.equal(audit.tool, TOOL_NAME);
      assert.equal(audit.status, 'unauthorized');
      assert.ok(Number.isInteger(audit.durationMs) && audit.durationMs >= 0);
    });
  } finally {
    await api.close();
  }
});

test('The plugin rejects unknown tool names and invalid arguments without reflecting input or contacting Connect', async () => {
  const api = await startMockApi();
  try {
    await withHubClient({ origin: api.origin }, async ({ client, notifications, getStderr }) => {
      for (const name of [`unknown_${SECRET_CANARY}`, `write_${SECRET_CANARY}`, `delete_${SECRET_CANARY}`]) {
        const result = await client.callTool({ name, arguments: { [SECRET_CANARY]: SECRET_CANARY } });
        assert.equal(result.isError, true);
        assert.equal(JSON.parse(responseText(result)).status, 'tool_not_allowed');
        assert.ok(!JSON.stringify(result).includes(SECRET_CANARY));
      }
      const invalidArgsResult = await client.callTool({
        name: TOOL_NAME,
        arguments: { [SECRET_CANARY]: SECRET_CANARY },
      });
      assert.equal(invalidArgsResult.isError, true);
      assert.equal(JSON.parse(responseText(invalidArgsResult)).status, 'invalid_arguments');
      assert.ok(!JSON.stringify(invalidArgsResult).includes(SECRET_CANARY));
      assert.equal(invalidArgsResult.structuredContent, undefined);
      assert.equal(api.observations.requests, 0);
      assert.deepEqual(notifications, []);
      assert.ok(!getStderr().includes(SECRET_CANARY));
      assert.ok(!getStderr().includes(TEST_TOKEN));
    });
  } finally {
    await api.close();
  }
});

test('An explicit site configuration is honored and recorded without returning the endpoint', async () => {
  const api = await startMockApi({ body: [{ id: 'vault-main-1', name: 'Main Vault' }] });
  try {
    await withHubClient({ siteId: 'main-ubutsu2', origin: api.origin }, async ({ client, getStderr }) => {
      const result = await client.callTool({ name: TOOL_NAME, arguments: {} });
      const text = responseText(result);
      const metadata = JSON.parse(text);
      assert.equal(metadata.siteId, 'main-ubutsu2');
      assert.deepEqual(metadata.vaultIds, ['vault-main-1']);
      assert.ok(!text.includes(api.origin));
      assert.ok(getStderr().includes('connect_route_selected'));
      assert.ok(getStderr().includes('main-ubutsu2'));
      assert.ok(!getStderr().includes(api.origin));
      assert.ok(!getStderr().includes(TEST_TOKEN));
      assert.equal(api.observations.requests, 1);
    });
  } finally {
    await api.close();
  }
});

test('The plugin rejects REST redirects instead of silently switching routes', async () => {
  const redirected = await startMockApi({ body: [{ id: 'wrong-site-vault' }] });
  const sourceServer = createServer((_request, response) => {
    response.statusCode = 302;
    response.setHeader('location', `${redirected.origin}/v1/vaults`);
    response.end(SECRET_CANARY);
  });
  sourceServer.listen(0, '127.0.0.1');
  await once(sourceServer, 'listening');
  const address = sourceServer.address();
  try {
    await withHubClient({ origin: `http://127.0.0.1:${address.port}` }, async ({ client, getStderr }) => {
      const result = await client.callTool({ name: TOOL_NAME, arguments: {} });
      const text = responseText(result);
      const metadata = JSON.parse(text);
      assert.equal(result.isError, true);
      assert.equal(metadata.status, 'connect_unavailable');
      assert.equal(redirected.observations.requests, 0);
      assert.ok(!text.includes(SECRET_CANARY));
      assert.ok(!getStderr().includes(SECRET_CANARY));
    });
  } finally {
    await new Promise((resolve, reject) => sourceServer.close((error) => error ? reject(error) : resolve()));
    await redirected.close();
  }
});
