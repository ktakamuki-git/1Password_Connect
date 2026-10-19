# Docker Compose candidate

This is a one-site Compose candidate based on the official 1Password example. It pins API and Sync to the official GHCR multi-architecture 1.8.3 image-index digests (API `sha256:a0cefa9fb93999b1ca67325ec3a79b38f3d3803a0790a6ec6630d4657896a54f`, Sync `sha256:5b6dcfa57e86f44b4d8a766b0edbf0321c519a9b6d327ed0a79d8583b6c7bfb5`). On 2026-10-19, both official package pages labeled 1.8.3 Public Latest. The Docker Hub listing reported linux/amd64 compressed sizes of 23.89 MB (API) and 21.62 MB (Sync), 45.51 MB total per host as transfer-compressed image size; this is not unpacked disk use, RAM, or the synced Vault cache size. GHCR index digests and Docker Hub platform digest labels are registry-specific; do not substitute one for the other. The official changelog currently has no 1.8.3 entry and the GitHub advisory page shows no published advisories; neither observation is a vulnerability assessment. Never auto-follow `latest`. This candidate has not been applied or started on APPv4, MainUbutsu2, or MiniPC-Oyama.

## Before applying at a site

1. Confirm the selected host and the Docker Engine it will use. Inspect `docker context show` and `docker info` in the approved host session. Docker Desktop's WSL backend runs its own `docker-desktop` distro/Engine; a Docker Engine installed inside the target WSL distro is a separate daemon with separate images, volumes, and ports. Identify one intended daemon per site, avoid unintentionally running both, and check host port collisions. MiniPC-Oyama is reported to use WSL; confirm its distribution, runtime, and localhost routing before applying. Do not assume Windows-native behavior or add host port forwarding.
2. Obtain the user's separate safe credential-file handoff for that site. Connect cannot bootstrap its own initial credentials file from the Vault it has not started syncing; the file must arrive through an independent approved secret handoff first. Once Connect is authenticated and synced, it can serve other consumer secrets through a separately designed consumer path. Place the file in a protected local path, readable by the official Connect image's runtime identity. The repository does not contain the file or its contents.
3. Copy `.env.example` to an untracked `.env` and set `CONNECT_CREDENTIALS_FILE` to that local file path. This is only a path reference; do not put a Connect token or credentials JSON content in the environment file.
4. Review the chosen Connect release and host-specific file permissions, firewall, and app route before starting.

The top-level Compose secret mounts the credentials file read-only to both Connect containers at `/run/secrets/connect_credentials`; `OP_SESSION` points to that file. The API access token belongs to the consuming application's approved secret store and is intentionally absent from this Compose project. The current MCP plugin only lists Vault identifiers; it does not read item secrets or supply them to the consuming application, so it does not yet remove any existing consumer-side secret retrieval dependency.

## Network and data

The API container continues to listen on port 8080. The host-side TCP port is configurable with `CONNECT_API_HOST_PORT`, default 8080, valid range 1–65535. Use `python deploy/docker/compose_wrapper.py` for Compose commands; it validates the value before invoking Docker Compose. The host bind remains `127.0.0.1` and Sync/bus ports are never published. Set the PP2 Hub plugin's `OP_CONNECT_HOST` to `http://127.0.0.1:<same host port>` when the Hub runs as a host Node process with the plugin child in the same network namespace. This matches the inspected Hub source model but is not deployment evidence. If the Hub runs in another namespace, inspect that route before use; do not widen the bind address silently. Docker Engine versions before 28.0.0 have a documented caveat where another host on the same L2 segment may reach localhost-published ports; verify the selected Engine version.

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

Tests require Python 3.10 or later. The wrapper validates `CONNECT_API_HOST_PORT`; omitted or empty uses 8080, valid values are decimal TCP ports 1–65535, and malformed/out-of-range values exit before Docker Compose runs. The API remains bound to loopback and the container port remains 8080. GitLab job trigger/protection follows existing project rules and the user's instruction; no new manual/protected gate is required by this design. No pipeline was started for these changes. The 2026-10-18 runner inventory recorded the group runners without tags and the project jobs/builds disabled; that historical snapshot does not define new project policy.

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
