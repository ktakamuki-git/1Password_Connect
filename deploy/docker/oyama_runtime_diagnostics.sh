#!/usr/bin/env bash
set -euo pipefail
set +x

clean_field() {
  printf '%s' "$1" | LC_ALL=C tr -cd '[:alnum:] ._/@:+,=-' | cut -c1-240
}

printf 'DIAGNOSTIC=oyama-runtime-read-only\n'
printf 'CI_RUNNER_ID=%s\n' "$(clean_field "${CI_RUNNER_ID:-unknown}")"
printf 'CI_RUNNER_DESCRIPTION=%s\n' "$(clean_field "${CI_RUNNER_DESCRIPTION:-unknown}")"
printf 'CI_JOB_ID=%s\n' "$(clean_field "${CI_JOB_ID:-unknown}")"
printf 'HOSTNAME=%s\n' "$(clean_field "$(hostname 2>/dev/null || uname -n)")"
printf 'KERNEL=%s\n' "$(clean_field "$(uname -r)")"
printf 'RUNNER_UID=%s\n' "$(id -u)"
printf 'RUNNER_GID=%s\n' "$(id -g)"
if grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
  printf 'WSL_KERNEL=true\n'
else
  printf 'WSL_KERNEL=false\n'
fi

wsl_systemd=not_configured
if [ -r /etc/wsl.conf ]; then
  parsed_systemd="$(awk '
    BEGIN { section = ""; found = 0 }
    /^[[:space:]]*\[/ {
      section = tolower($0)
      gsub(/^[[:space:]]*\[/, "", section)
      gsub(/\][[:space:]]*$/, "", section)
      next
    }
    section == "boot" && /^[[:space:]]*systemd[[:space:]]*=/ {
      value = tolower($0)
      sub(/^[^=]*=/, "", value)
      gsub(/[[:space:]]/, "", value)
      found = 1
      if (value == "true") print "enabled"
      else if (value == "false") print "disabled"
      else print "unknown"
      exit
    }
    END { if (!found) print "not_configured" }
  ' /etc/wsl.conf 2>/dev/null)"
  if [ -n "$parsed_systemd" ]; then
    wsl_systemd="$parsed_systemd"
  fi
fi
printf 'WSL_SYSTEMD=%s\n' "$wsl_systemd"
printf 'WSL_WINDOWS_AUTOSTART=not_visible_from_guest\n'

unit_state() {
  local unit="$1"
  local action="$2"
  local result
  if ! command -v systemctl >/dev/null 2>&1; then
    printf 'no_systemctl'
    return
  fi
  result="$(systemctl "$action" "$unit" 2>/dev/null || true)"
  case "$action:$result" in
    is-active:active|is-active:inactive|is-active:failed|is-active:activating|is-active:deactivating|is-active:reloading|is-active:unknown|is-enabled:enabled|is-enabled:enabled-runtime|is-enabled:disabled|is-enabled:static|is-enabled:indirect|is-enabled:masked|is-enabled:masked-runtime|is-enabled:generated|is-enabled:transient|is-enabled:linked|is-enabled:linked-runtime|is-enabled:alias|is-enabled:unknown)
      printf '%s' "$result"
      ;;
    *)
      printf 'other_or_unknown'
      ;;
  esac
}
printf 'DOCKER_UNIT_ACTIVE=%s\n' "$(unit_state docker is-active)"
printf 'DOCKER_UNIT_ENABLED=%s\n' "$(unit_state docker is-enabled)"
printf 'GITLAB_RUNNER_UNIT_ACTIVE=%s\n' "$(unit_state gitlab-runner is-active)"
printf 'GITLAB_RUNNER_UNIT_ENABLED=%s\n' "$(unit_state gitlab-runner is-enabled)"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

diagnostic_failed=0
docker_available=1
if ! command -v docker >/dev/null 2>&1; then
  printf 'DOCKER_CLIENT=missing\n'
  docker_available=0
  diagnostic_failed=1
fi

docker_info_format='{{.Name}}|{{.ServerVersion}}|{{.OperatingSystem}}|{{.Architecture}}|{{.KernelVersion}}|{{.CgroupDriver}}|{{.ContainersRunning}}|{{.DockerRootDir}}'
if [ "$docker_available" -eq 1 ]; then
  if docker info --format "$docker_info_format" >"$tmpdir/docker-info" 2>"$tmpdir/docker-info.err"; then
    printf 'DOCKER_ACCESS=available\n'
  else
    if grep -Eiq 'permission denied|access denied|operation not permitted' "$tmpdir/docker-info.err"; then
      printf 'DOCKER_ACCESS=permission_denied\n'
    else
      printf 'DOCKER_ACCESS=unavailable\n'
    fi
    docker_available=0
    diagnostic_failed=1
  fi
fi

if [ "$docker_available" -eq 1 ]; then
  docker_context=unknown
  if docker context show >"$tmpdir/docker-context" 2>/dev/null; then
    docker_context="$(cat "$tmpdir/docker-context")"
  fi
  printf 'DOCKER_CONTEXT=%s\n' "$(clean_field "$docker_context")"

  IFS='|' read -r daemon_name daemon_version daemon_os daemon_arch daemon_kernel cgroup_driver running_count docker_root <"$tmpdir/docker-info"
  printf 'DOCKER_DAEMON_NAME=%s\n' "$(clean_field "$daemon_name")"
  printf 'DOCKER_SERVER_VERSION=%s\n' "$(clean_field "$daemon_version")"
  printf 'DOCKER_OS=%s\n' "$(clean_field "$daemon_os")"
  printf 'DOCKER_ARCH=%s\n' "$(clean_field "$daemon_arch")"
  printf 'DOCKER_KERNEL=%s\n' "$(clean_field "$daemon_kernel")"
  printf 'DOCKER_CGROUP_DRIVER=%s\n' "$(clean_field "$cgroup_driver")"
  printf 'DOCKER_CONTAINERS_RUNNING=%s\n' "$(clean_field "$running_count")"
  printf 'DOCKER_ROOT_DIR=%s\n' "$(clean_field "$docker_root")"

inspect_value() {
  docker inspect --type container --format "$1" "$expected_container" 2>"$tmpdir/docker-inspect.err"
}
inspect_error_reason() {
  if grep -Eiq 'permission denied|access denied|operation not permitted' "$tmpdir/docker-inspect.err"; then
    printf 'permission_denied'
  elif grep -Eiq 'no such (object|container)|not found' "$tmpdir/docker-inspect.err"; then
    printf 'not_found'
  elif grep -Eiq 'template parsing error|error parsing template|template:' "$tmpdir/docker-inspect.err"; then
    printf 'format_error'
  else
    printf 'other_error'
  fi
}
container_count=0
for service in connect-api connect-sync; do
  case "$service" in
    connect-api) expected_container='opconnect-oyama-connect-api-1' ;;
    connect-sync) expected_container='opconnect-oyama-connect-sync-1' ;;
    *) printf 'COMPOSE_SERVICE_MAPPING=unsupported\n'; diagnostic_failed=1; continue ;;
  esac
  printf 'COMPOSE_SERVICE_QUERY=%s\n' "$service"
  printf 'COMPOSE_CONTAINER_NAME_EXPECTED=%s\n' "$expected_container"
  if ! container_names="$(docker ps --all --format '{{.Names}}' --filter "label=com.docker.compose.service=$service" 2>"$tmpdir/docker-ps.err")"; then
    printf 'DOCKER_CONTAINER_LIST=unavailable\n'
    diagnostic_failed=1
    continue
  fi
  name_count="$(printf '%s\n' "$container_names" | awk 'NF { count++ } END { print count + 0 }')"
  if [ "$name_count" -ne 1 ] || ! printf '%s\n' "$container_names" | grep -Fxq "$expected_container"; then
    if [ "$name_count" -eq 0 ]; then
      printf 'COMPOSE_CONTAINER_NAME_RESOLUTION=not_found\n'
    else
      printf 'COMPOSE_CONTAINER_NAME_RESOLUTION=mismatch_or_ambiguous\n'
    fi
    diagnostic_failed=1
    continue
  fi
  printf 'COMPOSE_CONTAINER_NAME_RESOLUTION=matched\n'
  if ! inspected_name="$(inspect_value '{{.Name}}')"; then
    printf 'COMPOSE_CONTAINER_INSPECT=%s\n' "$(inspect_error_reason)"
    diagnostic_failed=1
    continue
  fi
  inspected_name="${inspected_name#/}"
  if [ "$inspected_name" != "$expected_container" ]; then
    printf 'COMPOSE_CONTAINER_NAME_RESOLUTION=inspect_metadata_mismatch\n'
    diagnostic_failed=1
    continue
  fi
  if ! image="$(inspect_value '{{.Config.Image}}')" ||
     ! state="$(inspect_value '{{.State.Status}}')" ||
     ! health="$(inspect_value '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')" ||
     ! restart_policy="$(inspect_value '{{.HostConfig.RestartPolicy.Name}}')" ||
     ! restart_count="$(inspect_value '{{.RestartCount}}')" ||
     ! ports_json="$(inspect_value '{{json .NetworkSettings.Ports}}')" ||
     ! mounts_json="$(inspect_value '{{json .Mounts}}')"; then
    printf 'COMPOSE_CONTAINER_INSPECT=%s\n' "$(inspect_error_reason)"
    diagnostic_failed=1
    continue
  fi
  if ! api_bindings="$(python3 - "$ports_json" <<'PY'
import json
import re
import sys
try:
    ports = json.loads(sys.argv[1])
    if not isinstance(ports, dict):
        raise ValueError("invalid ports")
    bindings = ports.get("8080/tcp")
    if bindings is None:
        print("none")
    elif isinstance(bindings, list):
        output = []
        for item in bindings:
            if not isinstance(item, dict):
                raise ValueError("invalid binding")
            host_ip = item.get("HostIp")
            host_port = item.get("HostPort")
            if not isinstance(host_ip, str) or not re.fullmatch(r"[A-Fa-f0-9:.]{1,64}", host_ip):
                raise ValueError("invalid address")
            if not isinstance(host_port, str) or not re.fullmatch(r"[0-9]{1,5}", host_port):
                raise ValueError("invalid port")
            output.append(f"{host_ip}:{host_port}")
        print(",".join(output) if output else "none")
    else:
        raise ValueError("invalid port list")
except Exception:
    print("invalid")
    sys.exit(1)
PY
  )"; then
    printf 'COMPOSE_PORT_INSPECTION=invalid\n'
    diagnostic_failed=1
    continue
  fi
  if ! data_mount="$(python3 - "$mounts_json" <<'PY'
import json
import re
import sys
try:
    mounts = json.loads(sys.argv[1])
    if not isinstance(mounts, list):
        raise ValueError("invalid mounts")
    matches = [mount for mount in mounts if isinstance(mount, dict) and mount.get("Destination") == "/home/opuser/.op/data"]
    if len(matches) > 1:
        raise ValueError("ambiguous mount")
    if not matches:
        print("")
    else:
        mount = matches[0]
        mount_type = mount.get("Type")
        mount_name = mount.get("Name") or ""
        mount_destination = mount.get("Destination")
        mount_rw = mount.get("RW")
        mount_source = mount.get("Source") or ""
        if mount_type not in {"bind", "volume", "tmpfs", "npipe", "cluster"}:
            raise ValueError("invalid mount type")
        if not isinstance(mount_name, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{0,128}", mount_name):
            raise ValueError("invalid mount name")
        if not isinstance(mount_rw, bool) or not isinstance(mount_source, str):
            raise ValueError("invalid mount attributes")
        if mount_source.startswith("/mnt/") or mount_source.startswith("//") or re.match(r"^[A-Za-z]:/", mount_source):
            source_kind = "windows_mount"
        elif mount_source.startswith("/home/"):
            source_kind = "linux_home"
        elif mount_source.startswith("/var/lib/docker/") or mount_source.startswith("/var/snap/docker/"):
            source_kind = "linux_docker_data"
        else:
            source_kind = "other"
        print(f"{mount_type};{mount_name};{mount_destination};{str(mount_rw).lower()};{source_kind}")
except Exception:
    print("invalid")
    sys.exit(1)
PY
  )"; then
    printf 'CONNECT_DATA_MOUNT_INSPECTION=invalid\n'
    diagnostic_failed=1
    continue
  fi
  container_count=$((container_count + 1))
  printf 'COMPOSE_CONTAINER_INSPECT=available\n'
  printf 'COMPOSE_CONTAINER_NAME=%s\n' "$(clean_field "$inspected_name")"
  printf 'COMPOSE_CONTAINER_IMAGE=%s\n' "$(clean_field "$image")"
  printf 'COMPOSE_SERVICE=%s\n' "$(clean_field "$service")"
  printf 'COMPOSE_STATE=%s\n' "$(clean_field "$state")"
  printf 'COMPOSE_HEALTH=%s\n' "$(clean_field "$health")"
  printf 'COMPOSE_RESTART_POLICY=%s\n' "$(clean_field "$restart_policy")"
  printf 'COMPOSE_RESTART_COUNT=%s\n' "$(clean_field "$restart_count")"
  printf 'COMPOSE_API_8080_BINDINGS=%s\n' "$(clean_field "$api_bindings")"
  if [ -z "$data_mount" ]; then
    printf 'CONNECT_DATA_MOUNT=not_found\n'
  else
    IFS=';' read -r mount_type mount_name mount_destination mount_rw mount_source_kind <<<"$data_mount"
    printf 'CONNECT_DATA_MOUNT_TYPE=%s\n' "$(clean_field "$mount_type")"
    printf 'CONNECT_DATA_MOUNT_NAME=%s\n' "$(clean_field "$mount_name")"
    printf 'CONNECT_DATA_MOUNT_DESTINATION=%s\n' "$(clean_field "$mount_destination")"
    printf 'CONNECT_DATA_MOUNT_RW=%s\n' "$(clean_field "$mount_rw")"
    printf 'CONNECT_DATA_MOUNT_SOURCE_KIND=%s\n' "$mount_source_kind"
  fi
done
if [ "$container_count" -eq 0 ]; then
  printf 'CONNECT_COMPOSE_CONTAINERS=none\n'
fi
else
  printf 'CONNECT_COMPOSE_INSPECTION=skipped_docker_access_unavailable\n'
fi

health_url='http://127.0.0.1:8080/health'
if health_http="$(curl --silent --output "$tmpdir/health.json" --write-out '%{http_code}' --connect-timeout 3 --max-time 5 "$health_url" 2>"$tmpdir/curl.err")"; then
  case "$health_http" in
    [0-9][0-9][0-9]) printf 'CONNECT_HEALTH_HTTP=%s\n' "$health_http" ;;
    *) printf 'CONNECT_HEALTH_HTTP=unknown\n' ;;
  esac
  if [ "$health_http" = "200" ]; then
    if ! python3 - "$tmpdir/health.json" <<'PY'
import json
import re
import sys

allowed_services = ("sync", "sqlite", "account_data", "1Password")
allowed_states = {"ACTIVE", "TOKEN_NEEDED", "INACTIVE", "ERROR", "STARTING"}
try:
    with open(sys.argv[1], "r", encoding="utf-8") as source:
        payload = json.load(source)
    version = payload.get("version") if isinstance(payload, dict) else None
    if isinstance(version, str) and re.fullmatch(r"[A-Za-z0-9._+-]{1,64}", version):
        print("CONNECT_HEALTH_VERSION=" + version)
    else:
        print("CONNECT_HEALTH_VERSION=unknown")
    dependencies = payload.get("dependencies") if isinstance(payload, dict) else None
    states = {}
    if isinstance(dependencies, list):
        for dependency in dependencies:
            if isinstance(dependency, dict):
                service = dependency.get("service")
                status = dependency.get("status")
                if service in allowed_services and isinstance(status, str):
                    states[service] = status if status in allowed_states else "OTHER"
    elif isinstance(dependencies, dict):
        for service in allowed_services:
            status = dependencies.get(service)
            if isinstance(status, str):
                states[service] = status if status in allowed_states else "OTHER"
    ready = True
    for service in allowed_services:
        state = states.get(service, "NOT_REPORTED")
        print(f"CONNECT_HEALTH_{service}={state}")
        if service in ("sync", "sqlite") and state != "ACTIVE":
            ready = False
    print("CONNECT_HEALTH_READY=" + ("true" if ready else "false"))
    if not isinstance(payload, dict):
        sys.exit(1)
    sys.exit(0 if ready else 1)
except Exception:
    print("CONNECT_HEALTH_PAYLOAD=invalid")
    sys.exit(1)
PY
    then
      diagnostic_failed=1
    fi
  else
    printf 'CONNECT_HEALTH_READY=false\n'
    diagnostic_failed=1
  fi
else
  printf 'CONNECT_HEALTH_HTTP=unreachable\n'
  printf 'CONNECT_HEALTH_READY=false\n'
  diagnostic_failed=1
fi

if [ "$diagnostic_failed" -ne 0 ]; then
  printf 'DIAGNOSTIC_RESULT=attention_required\n'
  exit 1
fi
printf 'DIAGNOSTIC_RESULT=healthy\n'
