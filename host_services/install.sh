#!/usr/bin/env bash
set -euo pipefail

# Run as root from a staged repository tree on an onsite Ubuntu host.
if [[ $# -lt 1 || $# -gt 2 || ! "$1" =~ ^(TSS|FRK)$ || ( $# -eq 2 && "$2" != --prepare ) ]]; then
  echo "Usage: sudo bash host_services/install.sh TSS|FRK [--prepare]" >&2
  exit 2
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi
site="$1"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for path in "$root/terminal_host/install.sh" "$root/scripts/station_status_json_gen.sh" "$root/website_backend/src/services/terminalProxy.js" "$root/host_services/host-runner.py" "$root/host_services/on-system-created.sh"; do
  [[ -f "$path" ]] || { echo "Missing staged file: $path" >&2; exit 1; }
done
id falab >/dev/null
command -v apt-get >/dev/null || { echo "This installer requires Ubuntu/Debian apt-get." >&2; exit 1; }

missing=()
for binary in cupsd lpstat jq curl tmux ttyd rclone python3; do
  command -v "$binary" >/dev/null || missing+=("$binary")
done
if (( ${#missing[@]} > 0 )); then
  echo "Installing missing host packages: ${missing[*]}"
  apt-get update
  apt-get install -y cups cups-client cups-filters jq curl tmux ttyd rclone python3 python3-flask
fi
if ! python3 -c 'import flask' >/dev/null 2>&1; then
  apt-get update
  apt-get install -y python3-flask
fi
systemctl enable --now cups.service
test -S /run/cups/cups.sock || { echo "CUPS socket is missing." >&2; exit 1; }
lpstat -r | grep -q 'scheduler is running' || { echo "CUPS scheduler is not running." >&2; exit 1; }

# Preserve the host's current Node binary, including nvm installs that are
# absent from sudo's noninteractive PATH.
node_path=""
if [[ -f /etc/systemd/system/wistron-terminals.service ]]; then
  node_path="$(sed -n 's/^ExecStart=\([^ ]*\) .*/\1/p' /etc/systemd/system/wistron-terminals.service | head -n 1)"
fi
if [[ -z "$node_path" || ! -x "$node_path" ]]; then
  node_path="$(command -v node || true)"
fi
[[ -n "$node_path" ]] || { echo "Node.js 20+ is required on the host. See TERMINALS.md." >&2; exit 1; }
bash "$root/terminal_host/install.sh" --node "$node_path"
if [[ "${2:-}" == --prepare ]]; then
  echo "Host sockets ready for backend container startup."
  exit 0
fi

scripts_dest=/opt/wistron-host-services/scripts
install -d -m 0755 "$scripts_dest" /etc/wistronlabs
cp -a "$root/scripts/." "$scripts_dest/"
find "$scripts_dest" -maxdepth 1 -type f -name '*.sh' -exec chmod 0755 {} +

prod_secrets=/opt/docker/website_backend/env/secrets.env
dev_secrets=/opt/docker/website_backend_dev/env/secrets.env
read_key() {
  local file="$1" name="$2" key
  [[ -r "$file" ]] || return 1
  key="$(sed -n "s/^${name}=//p" "$file" | tail -n 1)"
  key="${key#\"}"; key="${key%\"}"
  [[ "$key" =~ ^[A-Za-z0-9_-]+$ ]] || return 1
  printf '%s' "$key"
}
prod_key="$(read_key "$prod_secrets" INTERNAL_API_KEY)" || {
  echo "Missing INTERNAL_API_KEY in $prod_secrets. Deploy the production backend first." >&2
  exit 1
}
dev_key="$(read_key "$dev_secrets" INTERNAL_API_KEY 2>/dev/null || true)"
webhook_token="$(read_key "$prod_secrets" WEBHOOK_TOKEN)" || {
  echo "Missing WEBHOOK_TOKEN in $prod_secrets." >&2
  exit 1
}

# Keep the existing station status unit name, ten-second cadence, and
# environment file. Only point ExecStart at the deployed revision.
status_env=/home/falab/.config/wistron-station-status.env
if [[ ! -d /home/falab/.config ]]; then
  install -d -m 0700 -o falab -g falab /home/falab/.config
fi
env_tmp="$(mktemp /home/falab/.config/wistron-station-status.env.XXXXXX)"
trap 'rm -f "$env_tmp"' EXIT
{
  printf 'INTERNAL_API_KEY=%s\n' "$prod_key"
  [[ -z "$dev_key" ]] || printf 'DEV_INTERNAL_API_KEY=%s\n' "$dev_key"
} > "$env_tmp"
chown falab:falab "$env_tmp"
chmod 0600 "$env_tmp"
if ! cmp -s "$env_tmp" "$status_env"; then
  mv -f "$env_tmp" "$status_env"
fi

if [[ ! -f /etc/systemd/system/station_status_json_gen.service ]]; then
  sed "s/SITE_PLACEHOLDER/$site/" "$root/host_services/station_status_json_gen.service" \
    > /etc/systemd/system/station_status_json_gen.service
  chmod 0644 /etc/systemd/system/station_status_json_gen.service
fi
if [[ ! -f /etc/systemd/system/station_status_json_gen.timer ]]; then
  install -m 0644 "$root/host_services/station_status_json_gen.timer" \
    /etc/systemd/system/station_status_json_gen.timer
fi
install -d -m 0755 /etc/systemd/system/station_status_json_gen.service.d
cat > /etc/systemd/system/station_status_json_gen.service.d/90-wistron-deploy.conf <<'UNIT'
[Service]
ExecStart=
ExecStart=/usr/bin/flock -n /tmp/station_status_json_gen.lock /opt/wistron-host-services/scripts/station_status_json_gen.sh
UNIT

# The backend submits on-system-created work to host-runner. Preserve any
# existing site drop-ins, including TSS's rclone configuration.
command -v rclone >/dev/null || { echo "rclone is required by the system-created hook." >&2; exit 1; }
python3 -c 'import flask' >/dev/null || { echo "python3-flask is required by host-runner." >&2; exit 1; }
install -d -m 0755 /opt/hooks
install_if_changed() {
  local source_file="$1" target_file="$2" changed_var="$3" tmp
  if ! cmp -s "$source_file" "$target_file"; then
    tmp="$(mktemp "$(dirname "$target_file")/.wistron-install.XXXXXX")"
    install -m 0755 -o root -g root "$source_file" "$tmp"
    mv -f "$tmp" "$target_file"
    printf -v "$changed_var" '%s' 1
  fi
  chown root:root "$target_file"
  chmod 0755 "$target_file"
}
runner_changed=0
install_if_changed "$root/host_services/host-runner.py" /usr/local/bin/host-runner.py runner_changed
hook_changed=0
install_if_changed "$root/host_services/on-system-created.sh" /opt/hooks/on-system-created.sh hook_changed
if [[ "$hook_changed" -eq 1 ]]; then
  echo "System-created hook updated."
fi
runner_env=/etc/wistronlabs/host-runner.env
runner_env_tmp="$(mktemp /etc/wistronlabs/host-runner.env.XXXXXX)"
if [[ "$site" == TSS ]]; then hook_remote=dell-mft; else hook_remote=dell; fi
{
  printf 'HOST_RUNNER_TOKEN=%s\n' "$webhook_token"
  printf 'HOOK_RCLONE_REMOTE=%s\n' "$hook_remote"
} > "$runner_env_tmp"
chown root:root "$runner_env_tmp"
chmod 0600 "$runner_env_tmp"
if ! cmp -s "$runner_env_tmp" "$runner_env"; then
  mv -f "$runner_env_tmp" "$runner_env"
  runner_changed=1
else
  rm -f "$runner_env_tmp"
fi
if ! cmp -s "$root/host_services/host-runner.service" /etc/systemd/system/host-runner.service; then
  install -m 0644 "$root/host_services/host-runner.service" /etc/systemd/system/host-runner.service
  runner_changed=1
fi
systemctl daemon-reload
systemctl enable --now station_status_json_gen.timer
if [[ "$runner_changed" -eq 1 ]] || ! systemctl is-active --quiet host-runner.service; then
  systemctl restart host-runner.service
fi
systemctl enable host-runner.service
systemctl start station_status_json_gen.service

systemctl is-active --quiet wistron-terminals.service || { echo "Web terminal service is down." >&2; exit 1; }
systemctl is-active --quiet cups.service || { echo "CUPS is down." >&2; exit 1; }
systemctl is-active --quiet station_status_json_gen.timer || { echo "Station status timer is down." >&2; exit 1; }
systemctl is-active --quiet host-runner.service || { echo "Host runner is down." >&2; exit 1; }
echo "Host services ready for $site. Printer queues and drivers were preserved."
lpstat -e || true
systemctl --no-pager --plain status station_status_json_gen.timer || true
