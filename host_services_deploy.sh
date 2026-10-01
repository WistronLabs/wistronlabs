#!/usr/bin/env bash
set -euo pipefail

# Deploy host services from this checkout. Development mode is an explicit
# action because the terminal relay and CUPS are shared with production.
if [[ $# -lt 2 || $# -gt 3 || ! "$1" =~ ^--(prod|dev)$ || ! "$2" =~ ^(TSS|FRK)$ || ( $# -eq 3 && "$3" != --prepare && "$3" != --stage-only ) ]]; then
  echo "Usage: $0 --prod|--dev TSS|FRK [--prepare|--stage-only]" >&2
  exit 2
fi
mode="${1#--}"
site="$2"
phase="${3:-}"
[[ "$phase" != --prepare || "$mode" == prod ]] || {
  echo "--prepare is only used during production backend deployment." >&2
  exit 2
}
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD)"
[[ "$branch" =~ ^[A-Za-z0-9._/-]+$ && "$branch" != HEAD ]] || {
  echo "Use a named git branch with a safe name." >&2
  exit 1
}
if [[ "$mode" == prod && "$branch" != main ]]; then
  echo "Production host services must be deployed from main." >&2
  exit 1
fi
host="$(awk -F '|' -v site="$site" '$1 == site && $7 == "0" { print $2; exit }' "$root/backend_locations.conf")"
[[ -n "$host" ]] || { echo "No production host configured for $site." >&2; exit 1; }
for binary in ssh rsync; do
  command -v "$binary" >/dev/null || { echo "Missing $binary." >&2; exit 1; }
done
remote="falab@$host"
remote_dir="/home/falab/.cache/wistron-host-services/$branch"
ssh_opts=(-o BatchMode=yes -o PasswordAuthentication=no -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new)

echo "Staging $branch host services on $site ($mode)."
ssh "${ssh_opts[@]}" "$remote" "mkdir -p '$remote_dir'"
(
  cd "$root"
  rsync -az --relative -e "ssh ${ssh_opts[*]}" \
    terminal_host/ host_services/ scripts/ \
    website_backend/src/services/terminalProxy.js \
    "$remote:$remote_dir/"
)
if [[ "$phase" == --stage-only ]]; then
  echo "Staged only. On $site, run: sudo bash '$remote_dir/host_services/install.sh' '$site'"
  exit 0
fi
echo "Applying host services. This can briefly reconnect website terminals if relay code changed."
remote_command="sudo -n bash '$remote_dir/host_services/install.sh' '$site'"
[[ -z "$phase" ]] || remote_command+=" '$phase'"
ssh -T "${ssh_opts[@]}" "$remote" \
  "$remote_command"
