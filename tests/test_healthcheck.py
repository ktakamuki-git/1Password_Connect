from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "deploy" / "docker" / "connect_healthcheck.py"
SPEC = importlib.util.spec_from_file_location("connect_healthcheck", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
HEALTHCHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HEALTHCHECK)


class FakeResponse:
    status = 200

    def __init__(self, payload: Any) -> None:
        self.body = json.dumps(payload).encode("utf-8")

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: Any) -> None:
        return None

    def read(self) -> bytes:
        return self.body


class HealthcheckTests(unittest.TestCase):
    def test_active_sync_and_sqlite_dependencies_are_healthy(self) -> None:
        payload = {
            "name": "1Password Connect API",
            "version": "1.8.3",
            "dependencies": [
                {"service": "sync", "status": "ACTIVE"},
                {"service": "sqlite", "status": "ACTIVE"},
            ],
        }
        self.assertTrue(
            HEALTHCHECK.check_health(
                endpoint="http://connect-api:8080/health",
                opener=lambda *_args, **_kwargs: FakeResponse(payload),
            )
        )

    def test_inactive_sync_dependency_is_unhealthy(self) -> None:
        payload = {
            "dependencies": [
                {"service": "sync", "status": "TOKEN_NEEDED"},
                {"service": "sqlite", "status": "ACTIVE"},
            ]
        }
        self.assertFalse(
            HEALTHCHECK.check_health(
                endpoint="http://connect-api:8080/health",
                opener=lambda *_args, **_kwargs: FakeResponse(payload),
            )
        )

    def test_missing_dependencies_fail_closed(self) -> None:
        self.assertFalse(
            HEALTHCHECK.check_health(
                endpoint="http://connect-api:8080/health",
                opener=lambda *_args, **_kwargs: FakeResponse({}),
            )
        )


if __name__ == "__main__":
    unittest.main()
