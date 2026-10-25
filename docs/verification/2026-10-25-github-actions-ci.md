# GitHub Actions CI verification

Date: 2026-10-25 UTC
Host: `vm-infrastructure`
Repository runner: `vm-infrastructure-1password-connect`

## Local checks

- Runner service: `github-actions-1password-connect.service` enabled and active.
- GitHub repository runner API: online with `vm-infrastructure` and
  `1password-connect` labels.
- Local verification: all 20 unit tests passed; ShellCheck passed for both
  checked shell scripts; `systemd-analyze --user verify` passed.

## Remote check

PR #2 head `ed48402d4372cd5a9ca8430ae2148c1fb0e7a82f` passed in
[GitHub Actions run 40201266131](https://github.com/ktakamuki-git/1Password_Connect/actions/runs/40201266131).
The `verify` job completed successfully on the self-hosted runner, including
the unit suite, ShellCheck, and `systemd-analyze --user verify`. This run used
the repository-level runner; no GitHub-hosted minutes were used. GitHub emitted
an informational Node.js 20 deprecation annotation for `actions/checkout@v4`;
the job succeeded.
