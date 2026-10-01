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
site_lower="$(printf '%s' "$site" | tr '[:upper:]' '[:lower:]')"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for path in "$root/terminal_host/install.sh" "$root/scripts/station_status_json_gen.sh" "$root/website_backend/src/services/terminalProxy.js"; do
  [[ -f "$path" ]] || { echo "Missing staged file: $path" >&2; exit 1; }
done
id falab >/dev/null
command -v apt-get >/dev/null || { echo "This installer requires Ubuntu/Debian apt-get." >&2; exit 1; }

missing=()
for binary in cupsd lpstat jq curl tmux ttyd; do
  command -v "$binary" >/dev/null || missing+=("$binary")
done
if (( ${#missing[@]} > 0 )); then
  echo "Installing missing host packages: ${missing[*]}"
  apt-get update
  apt-get install -y cups cups-client cups-filters jq curl tmux ttyd
fi
systemctl enable --now cups.service
test -S /run/cups/cups.sock || { echo "CUPS socket is missing." >&2; exit 1; }
lpstat -r | grep -q 'scheduler is running' || { echo "CUPS scheduler is not running." >&2; exit 1; }

# The terminal installer checks Node and ttyd versions and updates the unit.
node_path="$(command -v node || true)"
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
  local file="$1" key
  [[ -r "$file" ]] || return 1
  key="$(sed -n 's/^INTERNAL_API_KEY=//p' "$file" | tail -n 1)"
  key="${key#\"}"; key="${key%\"}"
  [[ "$key" =~ ^[A-Za-z0-9_-]+$ ]] || return 1
  printf '%s' "$key"
}
prod_key="$(read_key "$prod_secrets")" || {
  echo "Missing INTERNAL_API_KEY in $prod_secrets. Deploy the production backend first." >&2
  exit 1
}
dev_key="$(read_key "$dev_secrets" 2>/dev/null || true)"
env_tmp="$(mktemp /etc/wistronlabs/station-status.env.XXXXXX)"
trap 'rm -f "$env_tmp"' EXIT
{
  printf 'WISTRON_MODE=backend\nSERVER_LOCATION=%s\n' "$site_lower"
  printf 'STATION_API_BASE_URL=http://127.0.0.1:4000/api/v1\n'
  printf 'STATION_DEV_API_BASE_URL=http://127.0.0.1:4100/api/v1\n'
  printf 'INTERNAL_API_KEY=%s\n' "$prod_key"
  [[ -z "$dev_key" ]] || printf 'DEV_INTERNAL_API_KEY=%s\n' "$dev_key"
} > "$env_tmp"
chown root:falab "$env_tmp"
chmod 0640 "$env_tmp"
if ! cmp -s "$env_tmp" /etc/wistronlabs/station-status.env; then
  mv -f "$env_tmp" /etc/wistronlabs/station-status.env
fi

for name in service timer; do
  install -m 0644 "$root/host_services/wistron-station-status.$name" \
    "/etc/systemd/system/wistron-station-status.$name"
done
systemctl daemon-reload

# An older crontab may already post station status. Keep it working until
# explicitly migrated, rather than starting a second writer.
legacy_cron=0
for account in falab root; do
  if crontab -u "$account" -l 2>/dev/null | grep -Eq '^[^#]*station_status_json_gen\.sh'; then
    legacy_cron=1
  fi
done
if grep -ERq '^[^#]*station_status_json_gen\.sh' /etc/crontab /etc/cron.d 2>/dev/null; then
  legacy_cron=1
fi
if [[ "$legacy_cron" -eq 1 ]]; then
  systemctl disable --now wistron-station-status.timer >/dev/null 2>&1 || true
  echo "Existing cron updater detected. Timer left disabled to avoid duplicate posts."
  echo "Remove that cron entry and rerun this installer to migrate to systemd."
else
  systemctl enable --now wistron-station-status.timer
  systemctl start wistron-station-status.service
fi

systemctl is-active --quiet wistron-terminals.service || { echo "Web terminal service is down." >&2; exit 1; }
systemctl is-active --quiet cups.service || { echo "CUPS is down." >&2; exit 1; }
echo "Host services ready for $site. Printer queues and drivers were preserved."
lpstat -e || true
systemctl --no-pager --plain status wistron-station-status.timer || true
