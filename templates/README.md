# Connect site profile template

`connect-site-profile.example.json` is a runtime-neutral, secret-free input profile for one 1Password Connect site. It describes the common invariants for a site without selecting Docker Compose, Kubernetes, or another runtime.

This file is **not** a deployable Compose or Helm manifest. Do not pass it to a deployment tool. Select a runtime and fill site-specific values only after that host's identity, OS, network, runtime, and storage have been confirmed.

Replace placeholders only with approved non-secret references and values. Never put the contents of `1password-credentials.json`, an API token, private key, or other secret into this repository. Keep verification fields at `pending` until the corresponding check has actually passed.

The profile keeps the API and Sync paired at one site and records that they share that site's encrypted data volume. It explicitly disallows cross-site volume sharing and unauthenticated public API exposure. API/Sync image references use the same pinned official release placeholder.

Validate the profile against `connect-site-profile.schema.json` with local tooling after the corresponding local repository is available. GitLab CI remains disabled.
