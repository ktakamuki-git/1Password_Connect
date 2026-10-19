# Oyama central Connect Docker Compose reference

This manifest is a one-site Connect runtime reference for Oyama only. The user confirms one existing API/Sync pair is already running on Oyama and a post-fix `docker ps` succeeded. APPv4 and Ubutsu2 are Hub targets and must not receive additional Connect servers. This task did not apply/restart this Compose manifest or inspect credential values.

## Before applying at a site

1. For future approved maintenance, confirm the Oyama host and intended Docker Engine using its approved operator session. The earlier Runner UID 999 denial was followed by user-provided `docker ps` success and is not a current blocker. Do not inspect other Hub sites as Connect deployment targets.
2. The existing credential file belongs only to the Oyama Connect runtime. Do not request a new credential or display its contents. Any handoff/change requires separate authorization.
3. Copy `.env.example` to an untracked `.env` and set `CONNECT_CREDENTIALS_FILE` to that local file path. This is only a path reference; do not put a Connect token or credentials JSON content in the environment file.
4. Review the chosen Connect release and host-specific file permissions, firewall, and app route before starting.

The top-level Compose secret mounts the Oyama credential file read-only to both Connect containers at `/run/secrets/connect_credentials`;

## Network and data

The API container continues to listen on port 8080 for the central Oyama runtime. Its host bind remains `127.0.0.1`; that loopback address is usable only by processes in the same network namespace. APPv4/Ubutsu2 Hub plugins require an already existing route to Oyama and the existing configured endpoint; verify those without widening the bind or creating a route.

The Compose file configures reciprocal manual bus peers on an internal port: API uses `connect-sync:11223` and Sync uses `connect-api:11223`. Keep these symmetric service references on the same Compose network, and do not add `NET_BROADCAST`. Keep the default Compose network private to this project.

## Health and first startup

The official API `GET /health` endpoint reports dependency state and may return HTTP 200 with `sync: TOKEN_NEEDED` and `sqlite: ACTIVE` before the first authenticated API request. That is the documented pending state before initial sync, not by itself a startup failure. The official Kubernetes example documents that an authenticated `GET /v1/vaults` initializes the connection to 1Password.com and completes the first Vault sync.

The `connect-healthcheck` observer checks that the API responds and `sync` plus `sqlite` are both `ACTIVE`. It runs as UID 65532 with a read-only root filesystem, no Linux capabilities, and no-new-privileges. While sync is `TOKEN_NEEDED`, the observer reports unhealthy/not-ready. Do not treat that status alone as a startup failure; use the ordered startup procedure below. It does not set Docker health status on the Connect API or Sync containers and never reads credentials or an API token.

## Initial startup and app cutover

1. Start the two Connect services and verify both processes/containers are running. Check API `GET /heartbeat` returns HTTP 200; this is a liveness check only.
2. After the site's secret handoff has been separately approved, issue an authenticated API `GET /v1/vaults` with the existing token from the approved secret store. This starts the first sync. Do not put the token in shell history, command arguments, logs, or chat, and do not save the initial response body.
3. Wait until API `GET /health` reports both `sync` and `sqlite` as `ACTIVE`. If the optional observer is enabled, its unhealthy state before this point is expected. It is not a startup gate.
4. After readiness, compare only allowed Vault identifiers from an authenticated `GET /v1/vaults`; do not read item contents. Switch the site-local application to this API only after the health and Vault identity checks pass.

The observer is optional under the `monitoring` Compose profile. Default Compose startup runs only Connect API and Sync (two containers per site; six total for three sites). Enabling the observer adds one optional monitoring container per site and does not modify, restart, block, or gate either Connect service.

## Start the optional observer

Run this command from the repository root to start the optional health observer with the `monitoring` Compose profile:

```sh
python deploy/docker/compose_wrapper.py --env-file deploy/docker/.env --profile monitoring up -d
```

The observer only reports readiness; it does not gate or control API/Sync startup.

## Static tests and local validation

Validate the default mapping (host 8080 to container 8080):

```sh
python deploy/docker/compose_wrapper.py --env-file deploy/docker/.env config
```

For a different host port, set the process environment. For example:

```sh
CONNECT_API_HOST_PORT=18080 python deploy/docker/compose_wrapper.py --env-file deploy/docker/.env config
```

PowerShell equivalent: set `$env:CONNECT_API_HOST_PORT = "18080"`, run the wrapper command above, then clear it with `Remove-Item Env:CONNECT_API_HOST_PORT`. The plugin route must use the same selected host port.

The saved tests do not need a 1Password account, credential file, Docker daemon, or network. Run them locally when the repository is available:

```sh
python -m pip install -r tests/requirements.txt
python -m unittest discover -s tests -v
```

After separate host/runtime and credential-file handoff checks, Compose syntax can be checked without starting containers:

```sh
python deploy/docker/compose_wrapper.py --env-file deploy/docker/.env config
```

Tests require Python 3.10 or later. The current CI pipelines are verification-only on the three Hub target runners; they do not deploy or restart the Oyama Connect pair. The historical 2026-10-18 runner snapshot is superseded by successful non-shared `appv4`/`ubutsu2`/`oyama-wsl` verification jobs.

## Official references
- [Official Connect API GHCR package and 1.8.3 manifest digest](https://github.com/1Password/connect/pkgs/container/connect-api/)
- [Official Connect Sync GHCR package and 1.8.3 manifest digest](https://github.com/1Password/connect/pkgs/container/connect-sync/)
- [Connect changelog](https://github.com/1Password/connect/blob/main/CHANGELOG.md)
- [Published Connect security advisories](https://github.com/1Password/connect/security/advisories)
- [Docker Engine port publishing and localhost caveat](https://docs.docker.com/engine/network/port-publishing/)
- [Docker Desktop WSL backend and distribution isolation](https://docs.docker.com/desktop/features/wsl/)

- [1Password Docker Compose example](https://github.com/1Password/connect/blob/main/examples/docker/compose/docker-compose.yaml)
- [Connect server configuration and shared data volume](https://www.1password.dev/connect/server-configuration)
- [Connect API health response](https://www.1password.dev/connect/api-reference/get-server-health)
- [Official Connect API image tags](https://hub.docker.com/r/1password/connect-api/tags)
- [Official Connect Sync image tags](https://hub.docker.com/r/1password/connect-sync/tags)
