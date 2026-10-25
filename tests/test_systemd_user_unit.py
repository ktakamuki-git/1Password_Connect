from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UNIT_PATH = ROOT / "deploy" / "systemd" / "user" / "onepassword-connect.service"


class SystemdUserUnitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = UNIT_PATH.read_text(encoding="utf-8")

    def test_unit_is_installed_as_a_user_unit(self) -> None:
        # The unit is installed under ~/.config/systemd/user, so it must be
        # pulled in by the user manager's default target.
        self.assertIn("WantedBy=default.target", self.text)

    def test_user_unit_does_not_set_supplementary_groups(self) -> None:
        # A `systemd --user` manager cannot set supplementary groups for a unit.
        # Docker access comes from the operator user already being a member of
        # the docker group, so no SupplementaryGroups directive belongs here.
        directives = [
            line.strip()
            for line in self.text.splitlines()
            if line.strip().startswith("SupplementaryGroups=")
        ]
        self.assertEqual(
            directives,
            [],
            "SupplementaryGroups is not valid in a systemd --user unit",
        )

    def test_oneshot_lifecycle_is_preserved(self) -> None:
        self.assertIn("Type=oneshot", self.text)
        self.assertIn("RemainAfterExit=yes", self.text)

    def test_compose_commands_are_preserved(self) -> None:
        self.assertIn(
            "ExecStart=/usr/bin/python3 %h/1Password_Connect/deploy/docker/compose_wrapper.py up -d",
            self.text,
        )
        self.assertIn(
            "ExecStop=/usr/bin/python3 %h/1Password_Connect/deploy/docker/compose_wrapper.py down",
            self.text,
        )

    def test_compose_project_environment_is_preserved(self) -> None:
        self.assertIn(
            "Environment=CONNECT_CREDENTIALS_FILE=%h/.config/1password-connect/1password-credentials.json",
            self.text,
        )
        self.assertIn("Environment=CONNECT_API_HOST_PORT=8080", self.text)
        self.assertIn("Environment=COMPOSE_PROJECT_NAME=opconnect-infra-qemu117", self.text)


if __name__ == "__main__":
    unittest.main()
