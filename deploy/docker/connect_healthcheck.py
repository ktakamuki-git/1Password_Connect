"""Rootless Docker Compose health probe for the 1Password Connect API."""
from __future__ import annotations

import json
import os
import sys
from typing import Any, Callable
from urllib.request import urlopen

DEFAULT_HEALTH_URL = "http://connect-api:8080/health"
REQUIRED_DEPENDENCIES = ("sync", "sqlite")


def payload_is_healthy(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    dependencies = payload.get("dependencies")
    if not isinstance(dependencies, list):
        return False
    states = {
        dependency.get("service"): dependency.get("status")
        for dependency in dependencies
        if isinstance(dependency, dict)
    }
    return all(states.get(service) == "ACTIVE" for service in REQUIRED_DEPENDENCIES)


def check_health(
    endpoint: str | None = None,
    opener: Callable[..., Any] = urlopen,
) -> bool:
    health_url = endpoint or os.environ.get("CONNECT_API_HEALTH_URL", DEFAULT_HEALTH_URL)
    try:
        with opener(health_url, timeout=3) as response:
            if response.status != 200:
                return False
            payload = json.loads(response.read())
    except (OSError, TimeoutError, ValueError):
        return False
    return payload_is_healthy(payload)


def main() -> int:
    return 0 if check_health() else 1


if __name__ == "__main__":
    sys.exit(main())
