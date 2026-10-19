import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport, serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { createConnectApiClient } from './connect-api.js';

const SERVER_INFO = { name: '1password-connect-plugin', version: '0.1.0' };
const TOOL_NAME = 'connect_list_vaults';
const SAFE_STATUSES = new Set([
  'ok', 'configuration_invalid', 'configuration_missing', 'connect_unavailable',
  'unauthorized', 'forbidden', 'rate_limited', 'upstream_error', 'http_error',
  'invalid_upstream_response', 'tool_not_allowed', 'invalid_arguments', 'internal_error',
]);
const connectApi = createConnectApiClient();
const emptyArguments = z.strictObject({});

function safeLog(entry) {
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

function errorClass(error) {
  // Error.name can be caller-controlled; diagnostics use a fixed safe label.
  return 'Error';
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

server.registerTool(TOOL_NAME, {
  title: 'List Connect vault identifiers',
  description: 'Return only public vault identifiers from the Connect API. Never returns vault item contents.',
  inputSchema: emptyArguments,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
}, async () => ({ content: [], isError: true }));

function safeToolResult(metadata, isError) {
  return {
    content: [{ type: 'text', text: JSON.stringify(metadata) }],
    isError,
  };
}

function boundedStatus(value) {
  return SAFE_STATUSES.has(value) ? value : 'internal_error';
}

server.server.setRequestHandler('tools/call', async (request) => {
  const correlationId = randomUUID();
  const startedAt = performance.now();
  const requestedName = request?.params?.name;
  const auditTool = requestedName === TOOL_NAME ? TOOL_NAME : 'unknown';
  let status = 'internal_error';

  try {
    if (requestedName !== TOOL_NAME) {
      status = 'tool_not_allowed';
      return safeToolResult({ correlationId, status }, true);
    }

    const rawArguments = request.params.arguments === undefined ? {} : request.params.arguments;
    const parsedArguments = emptyArguments.safeParse(rawArguments);
    if (!parsedArguments.success) {
      status = 'invalid_arguments';
      return safeToolResult({ correlationId, status }, true);
    }

    const metadata = await connectApi.listVaults();
    status = boundedStatus(metadata.status);
    return safeToolResult({ ...metadata, correlationId, status }, status !== 'ok');
  } catch (error) {
    safeLog({ event: 'tool_handler_error', errorClass: errorClass(error) });
    status = 'internal_error';
    return safeToolResult({ siteId: connectApi.siteId, correlationId, status }, true);
  } finally {
    safeLog({
      event: 'tool_call_audit',
      correlationId,
      tool: auditTool,
      status: boundedStatus(status),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  }
});

server.server.onerror = (error) => {
  safeLog({ event: 'mcp_server_error', errorClass: errorClass(error) });
};

const transport = new StdioServerTransport();
const sendProtocolMessage = transport.send.bind(transport);
transport.send = async (message) => {
  if (message && typeof message === 'object' && 'error' in message) {
    const code = Number.isInteger(message.error?.code) ? message.error.code : -32603;
    return sendProtocolMessage({
      jsonrpc: message.jsonrpc,
      id: message.id,
      error: { code, message: 'protocol_error', data: { status: 'protocol_error' } },
    });
  }
  return sendProtocolMessage(message);
};

serveStdio(() => server, {
  legacy: 'reject',
  transport,
  onerror: (error) => safeLog({ event: 'mcp_transport_error', errorClass: errorClass(error) }),
});
