# 1Password Connect systemd user unit verification

Date: 2026-10-25 UTC 14:06
Host: `vm-infrastructure`

## Applied change

- Installed the repository unit, which omits the unsupported
  `SupplementaryGroups` setting.
- Removed the host-only drop-in that cleared that setting.
- Reloaded the user manager, confirmed the unit was enabled, and restarted only
  `onepassword-connect.service`. The Infra_MCP hub was not restarted or
  redeployed.

## Results

- `systemctl --user status onepassword-connect.service`: `active (exited)`;
  `ExecStart` completed with status 0. `systemctl --user show` reported
  `ActiveState=active`, `SubState=exited`, `UnitFileState=enabled`.
- Connect API `GET /health`: HTTP 200.
- Connect API `GET /heartbeat`: HTTP 200.
- Authenticated `GET /v1/vaults`: HTTP 200. Vault names: `Chrome`, `PW`,
  `仕事用`, `Automation`.
- The user manager is lingering, and its group list includes Docker GID 983;
  the account is in the `docker` group. The enabled user unit therefore has
  Docker access after the user manager starts at boot.

No token, credential, or vault item data was printed or recorded.
