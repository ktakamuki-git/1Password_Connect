from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, ValidationError


ROOT = Path(__file__).resolve().parents[1]
COMPOSE_PATH = ROOT / "deploy" / "docker" / "compose.yaml"
sys.path.insert(0, str(ROOT / "deploy" / "docker"))
from compose_wrapper import resolve_api_host_port


class ComposeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.compose = yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))
        cls.services = cls.compose["services"]

    def test_site_profile_matches_its_json_schema(self) -> None:
        profile = json.loads(
            (ROOT / "templates" / "connect-site-profile.example.json").read_text()
        )
        schema = json.loads(
            (ROOT / "templates" / "connect-site-profile.schema.json").read_text()
        )
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema)
        validator.validate(profile)

        unsafe = copy.deepcopy(profile)
        unsafe["network"]["public_unauthenticated_api"] = True
        with self.assertRaises(ValidationError):
            validator.validate(unsafe)

    def test_official_connect_images_use_same_pinned_release(self) -> None:
        api = self.services["connect-api"]["image"]
        sync = self.services["connect-sync"]["image"]
        self.assertEqual(
            api,
            "ghcr.io/1password/connect-api:1.8.3@sha256:a0cefa9fb93999b1ca67325ec3a79b38f3d3803a0790a6ec6630d4657896a54f",
        )
        self.assertEqual(
            sync,
            "ghcr.io/1password/connect-sync:1.8.3@sha256:5b6dcfa57e86f44b4d8a766b0edbf0321c519a9b6d327ed0a79d8583b6c7bfb5",
        )
        self.assertNotIn("latest", api)
        api_release = api.split("@", 1)[0].rsplit(":", 1)[1]
        sync_release = sync.split("@", 1)[0].rsplit(":", 1)[1]
        self.assertEqual(api_release, sync_release)
        self.assertNotEqual(api.rsplit("@sha256:", 1)[1], sync.rsplit("@sha256:", 1)[1])

    def test_api_host_port_defaults_and_override_are_validated(self) -> None:
        mapping = self.services["connect-api"]["ports"][0]
        self.assertEqual(mapping, "127.0.0.1:${CONNECT_API_HOST_PORT:-8080}:8080")
        for raw, expected in [(None, 8080), ("", 8080), ("18080", 18080), ("65535", 65535)]:
            with self.subTest(raw=raw):
                port = resolve_api_host_port(raw)
                self.assertEqual(port, expected)
                self.assertEqual(f"127.0.0.1:{port}:8080", f"127.0.0.1:{expected}:8080")

        for invalid in ("0", "65536", "tcp", "80:90", "+8080", " 8080", "８０８０"):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    resolve_api_host_port(invalid)

    def test_only_api_is_bound_to_host_loopback(self) -> None:
        self.assertNotIn("ports", self.services["connect-sync"])
        self.assertNotIn("ports", self.services["connect-healthcheck"])
        self.assertEqual(
            self.services["connect-healthcheck"]["environment"]["CONNECT_API_HEALTH_URL"],
            "http://connect-api:8080/health",
        )

    def test_api_and_sync_share_one_project_local_data_volume(self) -> None:
        expected = "connect-data:/home/opuser/.op/data"
        self.assertIn(expected, self.services["connect-api"]["volumes"])
        self.assertIn(expected, self.services["connect-sync"]["volumes"])
        self.assertNotIn("external", self.compose["volumes"]["connect-data"])

    def test_credentials_are_required_external_read_only_secret_references(self) -> None:
        secret_file = self.compose["secrets"]["connect_credentials"]["file"]
        self.assertIn("${CONNECT_CREDENTIALS_FILE:?", secret_file)
        for name in ("connect-api", "connect-sync"):
            service = self.services[name]
            self.assertIn("connect_credentials", service["secrets"])
            self.assertEqual(
                service["environment"]["OP_SESSION"],
                "/run/secrets/connect_credentials",
            )
            self.assertNotIn("OP_CONNECT_TOKEN", service["environment"])
        env_example = (ROOT / "deploy" / "docker" / ".env.example").read_text()
        self.assertIn("CONNECT_CREDENTIALS_FILE=/absolute/path/to/", env_example)
        self.assertNotIn("eyJ", env_example)

    def test_manual_bus_peers_stay_on_compose_network(self) -> None:
        api = self.services["connect-api"]["environment"]
        sync = self.services["connect-sync"]["environment"]
        self.assertEqual(api["OP_BUS_PORT"], "11223")
        self.assertEqual(api["OP_BUS_PEERS"], "connect-sync:11223")
        self.assertEqual(sync["OP_BUS_PORT"], "11223")
        self.assertEqual(sync["OP_BUS_PEERS"], "connect-api:11223")

    def test_health_probe_is_opt_in_and_does_not_gate_connect_startup(self) -> None:
        probe = self.services["connect-healthcheck"]
        self.assertEqual(probe["profiles"], ["monitoring"])
        self.assertNotIn("connect-healthcheck", self.services["connect-api"].get("depends_on", {}))
        self.assertNotIn("connect-healthcheck", self.services["connect-sync"].get("depends_on", {}))
        self.assertEqual(probe["user"], "65532:65532")
        self.assertTrue(probe["read_only"])
        self.assertIn("ALL", probe["cap_drop"])
        self.assertIn("no-new-privileges:true", probe["security_opt"])
        self.assertEqual(
            probe["healthcheck"]["test"],
            ["CMD", "python", "/opt/connect_healthcheck.py"],
        )
        self.assertEqual(probe["image"], "python:3.14.8-alpine3.24")

    def test_credentials_and_environment_files_are_ignored(self) -> None:
        ignore_rules = (ROOT / ".gitignore").read_text()
        self.assertIn(".env", ignore_rules.splitlines())
        self.assertIn("!.env.example", ignore_rules.splitlines())
        self.assertIn("1password-credentials.json", ignore_rules.splitlines())


if __name__ == "__main__":
    unittest.main()
