# 1Password Connect MCP plugin

This package is a local stdio MCP server for the PP2 Hub. The Hub starts this plugin as a downstream process; the plugin calls the configured site-local 1Password Connect REST API. It does not modify PP2 core or add another relay layer.

## Runtime contract

- Requires Node.js 24 and the pinned MCP server SDK 2.3.1.
- The process is pinned to one site at startup using `CONNECT_SITE_ID`, `OP_CONNECT_HOST`, and `OP_CONNECT_TOKEN`. Supported site IDs are `appv4`, `main-ubutsu2`, and `oyama-wsl`.
- The Hub must provide these variables through its existing environment allow-list and existing secret handling. This package does not create, retrieve, persist, or distribute credentials.
- The MCP tool `connect_list_vaults` performs only authenticated `GET /v1/vaults`. It returns site ID, a non-secret route fingerprint, status, and vault IDs. It never returns vault names, item data, credential files, or tokens.
- The caller cannot select a site or supply a URL. The process uses its single configured endpoint and rejects redirects; it has no cross-site fallback. A user-directed route change is a configuration change and is recorded at startup by site ID and route fingerprint.
- Plugin success/tool-error results and plugin logs contain only defined metadata. The Hub caller must enforce this package's tool allow-list before sending `tools/call` and project protocol errors to public metadata before exposing them to Chat. There are no secret-returning tools or custom human-approval/authentication flows. Existing Hub authentication and OS permissions remain the boundary.
- stdout is reserved for MCP protocol messages. Diagnostic events go to stderr and contain no endpoint or credential values.

## Local verification

Install the pinned dependencies and run the mock contract tests:

```sh
npm ci
npm run check
npm test
```

The tests launch the plugin with a Hub-equivalent MCP client and a loopback-only mock Connect REST server. They use only synthetic test tokens and response canaries; they do not contact 1Password or use site credentials.
