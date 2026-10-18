import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { createConnectApiClient } from './connect-api.js';

const SERVER_INFO = { name: '1password-connect-plugin', version: '0.1.0' };
const connectApi = createConnectApiClient();

function safeLog(entry) {
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

function errorClass(error) {
  const name = error instanceof Error ? error.name : 'Error';
  return /^[A-Za-z][A-Za-z0-9]*$/u.test(name) ? name : 'Error';
}

if (connectApi.configured) {
  safeLog({
    event: 'connect_route_selected',
    siteId: connectApi.siteId,
    routeFingerprint: connectApi.routeFingerprint,
  });
} else {
  safeLog({
    event: 'connect_configuration_unavailable',
    siteId: connectApi.siteId,
  });
}

const server = new McpServer(SERVER_INFO, {
  capabilities: { tools: {} },
});

server.registerTool('connect_list_vaults', {
  title: 'List Connect vault identifiers',
  description: 'Return only public vault identifiers from the Connect API. Never returns vault item contents.',
  inputSchema: z.strictObject({}),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
}, async () => {
  const metadata = await connectApi.listVaults();
  return {
    content: [{ type: 'text', text: JSON.stringify(metadata) }],
    isError: metadata.status !== 'ok',
  };
});

server.server.onerror = (error) => {
  safeLog({ event: 'mcp_server_error', errorClass: errorClass(error) });
};

serveStdio(() => server, {
  legacy: 'reject',
  onerror: (error) => safeLog({ event: 'mcp_transport_error', errorClass: errorClass(error) }),
});
