import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const SECRET_CANARY = 'SYNTHETIC_SECRET_CANARY_DO_NOT_RETURN';
const TOOL_NAME = 'connect_list_vaults';
const PLUGIN_ENTRY = fileURLToPath(new URL('../src/index.js', import.meta.url));
const PACKAGE_ROOT = path.resolve(path.dirname(PLUGIN_ENTRY), '..');

function audits(stderr) {
  return stderr.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
    .filter((entry) => entry.event === 'tool_call_audit');
}

test('official MCP stdio client exercises bounded plugin responses and sanitized JSON-RPC errors', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [PLUGIN_ENTRY],
    cwd: PACKAGE_ROOT,
    env: {
      CONNECT_SITE_ID: 'appv4',
      PATH: process.env.PATH ?? '',
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const requests = [];
  const send = transport.send.bind(transport);
  transport.send = async (message) => {
    if (message?.method === 'tools/call') requests.push(message);
    return send(message);
  };
  const notifications = [];
  const client = new Client({ name: 'protocol-boundary-test', version: '1.0.0' }, {
    versionNegotiation: { mode: { pin: '2026-07-28' } },
    enforceStrictCapabilities: true,
  });
  client.setNotificationHandler('notifications/message', (message) => notifications.push(message));

  try {
    await client.connect(transport);
    for (const name of [`unknown_${SECRET_CANARY}`, `write_${SECRET_CANARY}`, `delete_${SECRET_CANARY}`]) {
      const result = await client.callTool({ name, arguments: { [SECRET_CANARY]: SECRET_CANARY } });
      assert.equal(result.isError, true);
      assert.equal(JSON.parse(result.content[0].text).status, 'tool_not_allowed');
      assert.ok(!JSON.stringify(result).includes(SECRET_CANARY));
    }

    const invalidArguments = await client.callTool({
      name: TOOL_NAME,
      arguments: { [SECRET_CANARY]: SECRET_CANARY },
    });
    assert.equal(invalidArguments.isError, true);
    assert.equal(JSON.parse(invalidArguments.content[0].text).status, 'invalid_arguments');
    assert.ok(!JSON.stringify(invalidArguments).includes(SECRET_CANARY));

    const safeRequest = requests.at(-1);
    assert.ok(safeRequest);
    const rawId = 'raw-invalid-envelope';
    const response = new Promise((resolve, reject) => {
      const previous = transport.onmessage;
      const timer = setTimeout(() => reject(new Error('Timed out waiting for sanitized protocol error')), 5_000);
      transport.onmessage = (message) => {
        if (message?.id === rawId) {
          clearTimeout(timer);
          resolve(message);
          return;
        }
        previous?.(message);
      };
    });
    await send({
      ...safeRequest,
      id: rawId,
      params: { name: 17, arguments: { [SECRET_CANARY]: SECRET_CANARY } },
    });
    const malformed = await response;
    assert.equal(malformed.error.message, 'protocol_error');
    assert.equal(malformed.error.data.status, 'protocol_error');
    assert.ok(!JSON.stringify(malformed).includes(SECRET_CANARY));

    for (const [label, argumentsValue] of [
      ['null', null],
      ['string', `argument_${SECRET_CANARY}`],
      ['array', [`argument_${SECRET_CANARY}`]],
    ]) {
      const invalidBody = new Promise((resolve, reject) => {
        const invalidId = `invalid-arguments-${label}`;
        const previous = transport.onmessage;
        const timer = setTimeout(() => reject(new Error('Timed out waiting for invalid-arguments response')), 5_000);
        transport.onmessage = (message) => {
          if (message?.id === invalidId) {
            clearTimeout(timer);
            resolve(message);
            return;
          }
          previous?.(message);
        };
      });
      await send({
        ...safeRequest,
        id: `invalid-arguments-${label}`,
        params: { name: TOOL_NAME, arguments: argumentsValue },
      });
      const invalidResult = await invalidBody;
      assert.equal(invalidResult.error.message, 'protocol_error');
      assert.equal(invalidResult.error.data.status, 'protocol_error');
      assert.ok(!JSON.stringify(invalidResult).includes(SECRET_CANARY));
    }

    const malformedProcess = spawn(process.execPath, [PLUGIN_ENTRY], {
      cwd: PACKAGE_ROOT,
      env: {
        CONNECT_SITE_ID: 'appv4',
        PATH: process.env.PATH ?? '',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let malformedStdout = '';
    let malformedStderr = '';
    malformedProcess.stdout.setEncoding('utf8').on('data', (chunk) => { malformedStdout += chunk; });
    malformedProcess.stderr.setEncoding('utf8').on('data', (chunk) => { malformedStderr += chunk; });
    malformedProcess.stdin.end(`{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"${SECRET_CANARY}\"}} trailing_${SECRET_CANARY}\n`);
    const malformedExit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        malformedProcess.kill();
        reject(new Error('Timed out waiting for malformed JSON process exit'));
      }, 5_000);
      malformedProcess.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      malformedProcess.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    assert.equal(malformedExit, 0);
    assert.ok(!malformedStdout.includes(SECRET_CANARY));
    assert.ok(!malformedStderr.includes(SECRET_CANARY));
    assert.ok(!malformedStdout.includes('trailing_'));
    assert.ok(!malformedStderr.includes('trailing_'));

    const validButUnconfigured = await client.callTool({ name: TOOL_NAME, arguments: {} });
    const metadata = JSON.parse(validButUnconfigured.content[0].text);
    assert.equal(metadata.status, 'configuration_missing');
    assert.match(metadata.correlationId, /^[a-f0-9-]{36}$/u);
    assert.deepEqual(notifications, []);
    assert.ok(!stderr.includes(SECRET_CANARY));

    const callAudits = audits(stderr);
    assert.deepEqual(callAudits.map((entry) => entry.status), [
      'tool_not_allowed', 'tool_not_allowed', 'tool_not_allowed', 'invalid_arguments', 'configuration_missing',
    ]);
    assert.ok(callAudits.every((entry) => entry.tool === 'unknown' || entry.tool === TOOL_NAME));
    assert.ok(callAudits.every((entry) => /^[a-f0-9-]{36}$/u.test(entry.correlationId)));
    assert.equal(new Set(callAudits.map((entry) => entry.correlationId)).size, callAudits.length);
    assert.ok(callAudits.every((entry) => Number.isInteger(entry.durationMs) && entry.durationMs >= 0));
    assert.ok(callAudits.every((entry) => !Object.hasOwn(entry, 'input') && !Object.hasOwn(entry, 'arguments')));
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
});
