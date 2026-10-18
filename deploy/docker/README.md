# Docker Compose candidate

This is a one-site Compose candidate based on the official 1Password example. It pins both official Connect containers to release 1.8.3. It is code only; it has not been applied or started on APPv4, MainUbutsu2, or MiniPC-Oyama.

## Before applying at a site

1. Confirm the selected host already runs a compatible Docker Compose runtime, confirm storage and local port availability, and verify the app can reach that host's loopback endpoint. MiniPC-Oyama is reported to use WSL; confirm its WSL distribution, runtime, and localhost routing before applying. Do not assume Windows-native behavior or add host port forwarding.
2. Obtain the user's separate safe credential-file handoff for that site. Place the file in a protected local path, readable by the official Connect image's runtime identity. The repository does not contain the file or its contents.
3. Copy `.env.example` to an untracked `.env` and set `CONNECT_CREDENTIALS_FILE` to that local file path. This is only a path reference; do not put a Connect token or credentials JSON content in the environment file.
4. Review the chosen Connect release and host-specific file permissions, firewall, and app route before starting.

The top-level Compose secret mounts the credentials file read-only to both Connect containers at `/run/secrets/connect_credentials`; `OP_SESSION` points to that file. The API access token belongs to the consuming application's approved secret store and is intentionally absent from this Compose project.

## Network and data

The API is published only as `127.0.0.1:8080:8080`. Sync and bus ports are not published to the host. The API and Sync share the project-scoped `connect-data` named volume, which is local to the host running this Compose project. Never move that volume between sites.

The Compose file configures the documented manual bus peers on an internal port so container bus discovery does not require adding `NET_BROADCAST`. Keep the default Compose network private to this project.

## Health

The official Connect API health endpoint reports its dependencies. The separate `connect-healthcheck` container checks that the API responds and its `sync` and `sqlite` dependencies are both `ACTIVE`. It runs as UID 65532 with a read-only root filesystem, no Linux capabilities, and no-new-privileges. Its healthy status is an aggregate observer; it does not set Docker health status on the Connect API or Sync containers individually. It never reads credentials or an API token.

## Static tests and local validation

The saved tests do not need a 1Password account, credential file, Docker daemon, or network. Run them locally when the repository is available:

```sh
python -m pip install -r tests/requirements.txt
python -m unittest discover -s tests -v
```

After separate host/runtime and credential-file handoff checks, Compose syntax can be checked without starting containers:

```sh
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yaml config
```

Tests require Python 3.10 or later. Do not report the saved tests as passing until that test command is actually run. Do not run any GitLab pipeline or runner.

## Official references

- [1Password Docker Compose example](https://github.com/1Password/connect/blob/main/examples/docker/compose/docker-compose.yaml)
- [Connect server configuration and shared data volume](https://www.1password.dev/connect/server-configuration)
- [Connect API health response](https://www.1password.dev/connect/api-reference/get-server-health)
- [Official Connect API image tags](https://hub.docker.com/r/1password/connect-api/tags)
- [Official Connect Sync image tags](https://hub.docker.com/r/1password/connect-sync/tags)
