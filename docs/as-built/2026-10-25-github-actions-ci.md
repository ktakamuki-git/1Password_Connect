# GitHub Actions CI and repository runner

Date: 2026-10-25 UTC

## Workflow

- `.github/workflows/ci.yml` runs on pull requests and pushes to `main`.
- The job targets `[self-hosted, vm-infrastructure]`; it has no hosted runner fallback.
- It runs the 20 Python unit tests, ShellCheck on the repository shell scripts,
  and `systemd-analyze --user verify` on the Connect user unit.
- The workflow uses the official `actions/checkout` action and grants read-only
  repository contents permission.

## Runner on vm-infrastructure

- Repository: `ktakamuki-git/1Password_Connect` (repository-level runner).
- Name: `vm-infrastructure-1password-connect`.
- Labels: `self-hosted`, `Linux`, `X64`, `vm-infrastructure`,
  `1password-connect`.
- Official `actions/runner` version 2.338.1 is installed separately in
  `~/.local/share/actions-runner-1password-connect`.
- User service: `github-actions-1password-connect.service`, enabled under the
  user manager and configured to restart on exit.
- The repository registration token was used only during configuration and is
  not persisted in the service or repository.
- The Infra_MCP runner files and service were not changed; the Infra_MCP hub was
  not restarted or redeployed.
