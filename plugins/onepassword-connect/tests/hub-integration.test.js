import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const HUB_ROOT = process.env.PP2_HUB_ROOT ? path.resolve(process.env.PP2_HUB_ROOT) : undefined;
const PLUGIN_ENTRY = fileURLToPath(new URL('../src/index.js', import.meta.url));
const PACKAGE_ROOT = path.resolve(path.dirname(PLUGIN_ENTRY), '..');
const CONNECT_TOKEN = 'synthetic-connect-token-not-a-credential';
const HUB_TOKEN = 'synthetic-hub-token-not-a-credential';
const SECRET_CANARY = 'SYNTHETIC_SECRET_CANARY_DO_NOT_RETURN';
const TOOL_NAME = 'connect__connect_list_vaults';

function mockConnectApi() {
  const observations = { requests: 0, paths: [], authAccepted: false };
  const server = createServer((request, response) => {
    observations.requests += 1;
    observations.paths.push(request.url);
    observations.authAccepted = request.headers.authorization === `Bearer ${CONNECT_TOKEN}`;
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify([{
      id: 'vault-site-local-1',
      name: `private-name-${SECRET_CANARY}`,
      items: [{ password: SECRET_CANARY }],
    }]));
  });
  return {
    server,
    observations,
    async listen() {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function findFreePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('PP2 Hub -> plugin stdio -> mock Connect REST integration', {
  skip: HUB_ROOT ? false : 'Set PP2_HUB_ROOT to the checked-out PP2 implementation/mcp-hub-core source tree',
}, async () => {
  const [{ validateConfig }, { DownstreamRegistry }, { createHubHttpServer }] = await Promise.all([
    import(pathToFileURL(path.join(HUB_ROOT, 'src/config.js')).href),
    import(pathToFileURL(path.join(HUB_ROOT, 'src/downstream.js')).href),
    import(pathToFileURL(path.join(HUB_ROOT, 'src/http-server.js')).href),
  ]);
  const connectApi = mockConnectApi();
  const connectOrigin = await connectApi.listen();
  const envBefore = {
    CONNECT_SITE_ID: process.env.CONNECT_SITE_ID,
    OP_CONNECT_HOST: process.env.OP_CONNECT_HOST,
    OP_CONNECT_TOKEN: process.env.OP_CONNECT_TOKEN,
  };
  Object.assign(process.env, {
    CONNECT_SITE_ID: 'appv4',
    OP_CONNECT_HOST: connectOrigin,
    OP_CONNECT_TOKEN: CONNECT_TOKEN,
  });

  const envAllowlist = ['PATH', 'CONNECT_SITE_ID', 'OP_CONNECT_HOST', 'OP_CONNECT_TOKEN'];
  if (process.platform === 'win32') envAllowlist.push('SystemRoot');
  const config = validateConfig({
    schemaVersion: 1,
    siteId: 'site-1',
    mcpProtocolVersion: '2026-07-28',
    http: { bind: '127.0.0.1', port: await findFreePort(), path: '/mcp' },
    timeouts: { connectMs: 5_000, requestMs: 5_000, shutdownGraceMs: 2_000, reconnectMs: 100, listRefreshMs: 30_000 },
    downstreams: [{
      alias: 'connect',
      command: process.execPath,
      args: [PLUGIN_ENTRY],
      cwd: PACKAGE_ROOT,
      envAllowlist,
      secretRefs: {},
    }],
  });

  const hubLogs = [];
  const registry = new DownstreamRegistry(config, { logger: (entry) => hubLogs.push(entry) });
  let app;
  let client;
  let clientTransport;
  try {
    await registry.start();
    app = createHubHttpServer({
      config,
      registry,
      logger: (entry) => hubLogs.push(entry),
      // This test-only authenticator gates loopback requests without creating
      // or changing a production authentication mechanism.
      authenticator: {
        async authenticate(request) {
          return request.headers.get('authorization') === `Bearer ${HUB_TOKEN}`
            ? { clientId: 'synthetic-integration-client', scopes: [] }
            : null;
        },
      },
    });
    const address = await app.listen();
    clientTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${HUB_TOKEN}` } },
    });
    client = new Client({ name: 'hub-plugin-integration-test', version: '1.0.0' }, {
      versionNegotiation: { mode: { pin: '2026-07-28' } },
      enforceStrictCapabilities: true,
    });
    await client.connect(clientTransport);

    const listing = await client.listTools();
    assert.deepEqual(listing.tools.map((tool) => tool.name), [TOOL_NAME]);
    assert.equal(listing.tools[0].inputSchema.additionalProperties, false);
    const result = await client.callTool({ name: TOOL_NAME, arguments: {} });
    const text = result.content.filter((entry) => entry.type === 'text').map((entry) => entry.text).join('\n');
    const metadata = JSON.parse(text);
    assert.equal(result.isError, false);
    assert.equal(metadata.siteId, 'appv4');
    assert.equal(metadata.status, 'ok');
    assert.deepEqual(metadata.vaultIds, ['vault-site-local-1']);
    assert.ok(!JSON.stringify(result).includes(SECRET_CANARY));
    assert.ok(!JSON.stringify(result).includes(CONNECT_TOKEN));
    assert.equal(connectApi.observations.requests, 1);
    assert.deepEqual(connectApi.observations.paths, ['/v1/vaults']);
    assert.equal(connectApi.observations.authAccepted, true);
    assert.ok(!JSON.stringify(hubLogs).includes(SECRET_CANARY));
    assert.ok(!JSON.stringify(hubLogs).includes(CONNECT_TOKEN));
  } finally {
    await client?.close().catch(() => {});
    await clientTransport?.close().catch(() => {});
    await app?.close().catch(() => {});
    await registry.stop().catch(() => {});
    await connectApi.close();
    for (const [name, value] of Object.entries(envBefore)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
