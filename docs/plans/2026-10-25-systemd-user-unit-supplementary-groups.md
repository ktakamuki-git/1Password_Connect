# Plan: fix `SupplementaryGroups` in the 1Password Connect systemd user unit

Date: 2026-10-25
Branch: `fix/systemd-user-unit-supplementary-groups`
Owner: infra (vm-infrastructure)

## Problem

`deploy/systemd/user/onepassword-connect.service` is installed as a **systemd
`--user`** unit (`WantedBy=default.target`, installed under
`~/.config/systemd/user/`). It declares:

```ini
SupplementaryGroups=docker
```

A user manager (`systemd --user`) cannot assign supplementary groups to a
service. The host account must already have Docker socket access before its
user manager starts. On vm-infrastructure, `kiyohisa` is a member of `docker`
and the lingering user manager has Docker's GID in its group list.

The service is running on vm-infrastructure; an operator added a local
hot-fix drop-in,
`~/.config/systemd/user/onepassword-connect.service.d/10-no-supplementary-groups.conf`,
which resets the directive:

```ini
[Service]
SupplementaryGroups=
```

That drop-in is machine-local and not tracked in the repository. The source
unit should omit the unsupported directive; group access comes from the login
account and persists across reboot through the enabled user unit and linger.

## Change

- Remove the `SupplementaryGroups=docker` line from
  `deploy/systemd/user/onepassword-connect.service`.
- Docker access is already provided by the operator account (`kiyohisa`) being a
  member of the `docker` group, so no group setting is needed on the unit.
- Add a regression test that fails if a `SupplementaryGroups=` directive is
  present in the user unit.
- Document the as-built change and verification results (step 5).

Nothing else about the unit changes: same description, dependencies, oneshot
type, working directory, environment, `ExecStart`/`ExecStop`, timeout and
`[Install]` target.

## Why this is safe

- The unit runs as the operator user. `id` shows the operator is already in the
  `docker` group (`groups=... 983(docker)`), so the Compose wrapper can talk to
  the Docker socket without any supplementary group on the unit.
- Removing a directive that the user manager cannot apply does not weaken
  isolation: the unit's own user/group identity and the Docker socket
  permissions are unchanged.
- No credential values, tokens or secret files are read, printed or committed.

## Verification plan

1. Static: run the repository unit/contract suite with `python3 -m unittest
   discover -s tests -v` (includes the new regression test).
2. CI: the repository's `Deploy Connect (qemu/117)` GitHub Actions workflow is
   `[self-hosted, vm-infrastructure]` only (no GitHub-hosted minutes) and only
   runs on `main` or manual dispatch. It was not run for this PR; the local
   suite and live host verification below passed.
3. Deploy on vm-infrastructure:
   - install the fixed unit to `~/.config/systemd/user/onepassword-connect.service`,
   - remove the local hot-fix drop-in
     `~/.config/systemd/user/onepassword-connect.service.d/10-no-supplementary-groups.conf`,
   - `systemctl --user daemon-reload && systemctl --user restart onepassword-connect`,
   - confirm `GET /heartbeat` and `GET /health` return HTTP 200 and list vault
     names only (no secret values printed).

## As built

Completed 2026-10-25 on `vm-infrastructure`. See
[`../as-built/2026-10-25-onepassword-connect-systemd-user.md`](../as-built/2026-10-25-onepassword-connect-systemd-user.md)
and
[`../verification/2026-10-25-onepassword-connect-systemd-user.md`](../verification/2026-10-25-onepassword-connect-systemd-user.md)
for deployed state and verification evidence.

## Out of scope

- No change to Compose, images, ports, credentials handling or the monitoring
  observer.
- No new authentication, RBAC or permission separation.
