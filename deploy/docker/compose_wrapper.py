"""Validate the host API port before invoking Docker Compose."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

DEFAULT_API_HOST_PORT = 8080


def resolve_api_host_port(value: str | None) -> int:
    """Return a canonical TCP port, defaulting to 8080, or reject invalid input."""
    if value is None or value == "":
        return DEFAULT_API_HOST_PORT
    if not value.isascii() or not value.isdecimal():
        raise ValueError("CONNECT_API_HOST_PORT must be a decimal port from 1 to 65535")
    port = int(value, 10)
    if not 1 <= port <= 65535:
        raise ValueError("CONNECT_API_HOST_PORT must be a decimal port from 1 to 65535")
    return port


def main(argv: list[str] | None = None) -> int:
    try:
        host_port = resolve_api_host_port(os.environ.get("CONNECT_API_HOST_PORT"))
    except ValueError:
        print("Invalid CONNECT_API_HOST_PORT; expected a decimal TCP port from 1 to 65535.", file=sys.stderr)
        return 2

    repo_root = Path(__file__).resolve().parents[2]
    compose_file = Path(__file__).resolve().parent / "compose.yaml"
    env = os.environ.copy()
    env["CONNECT_API_HOST_PORT"] = str(host_port)
    command = ["docker", "compose", "-f", str(compose_file), *(sys.argv[1:] if argv is None else argv)]
    try:
        return subprocess.run(command, cwd=repo_root, env=env, check=False).returncode
    except FileNotFoundError:
        print("Docker CLI was not found; Compose was not run.", file=sys.stderr)
        return 127


if __name__ == "__main__":
    raise SystemExit(main())
