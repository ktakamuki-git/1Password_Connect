# qemu/117 Connect verification

| Item | Result |
| --- | --- |
| Docker | docker-ce 29.x + compose plugin (official docker.com apt) |
| Compose project | `opconnect-infra-qemu117` |
| API bind | `127.0.0.1:8080` |
| Credentials | `~/.config/1password-connect/1password-credentials.json` (operator) |
| Hub token env | `~/.config/infra-mcp/onepassword-connect.env` (operator) |

Post-deploy checks (2026-10-25, no secret values):

- `GET /health` after first authenticated `GET /v1/vaults`: `sqlite` **ACTIVE**; `sync` may be **TOKEN_NEEDED** until first API call, then progresses to **ACTIVE**.
- One `GET /v1/vaults` (names only): **PASS** — `["PW", "仕事用", "Automation", "Chrome"]`
- Credentials file must be **world-readable (644)** for Docker Compose `secrets.file` mount (documented in `deploy_qemu117.sh`).

Git remotes: **GitHub** `ktakamuki-git/1Password_Connect`, **GitLab** canonical source unchanged.
