# 1Password Connect systemd user unit (vm-infrastructure)

Date: 2026-10-25

## Runtime configuration

- Unit: `~/.config/systemd/user/onepassword-connect.service`
- Source: [`deploy/systemd/user/onepassword-connect.service`](../../deploy/systemd/user/onepassword-connect.service)
- User: `kiyohisa`, a member of the `docker` group (GID 983); Docker socket is
  `root:docker` mode `0660`.
- The `systemd --user` manager has Docker GID 983 in its supplementary group
  list. The unit intentionally has no `SupplementaryGroups` directive because
  a user manager cannot assign service supplementary groups.
- User lingering is enabled and the unit is enabled under `default.target`, so
  it starts with the user manager after boot.
- The obsolete local drop-in
  `onepassword-connect.service.d/10-no-supplementary-groups.conf` was removed.
- `Type=oneshot` and `RemainAfterExit=yes` keep systemd tracking the stack while
  the Compose wrapper starts the API and Sync containers.

The Connect credentials remain in the host-only credentials file and API token
environment file. Neither is tracked here; values were not printed or copied
into this document.

See [verification](../verification/2026-10-25-onepassword-connect-systemd-user.md)
for the post-change service and API checks.
