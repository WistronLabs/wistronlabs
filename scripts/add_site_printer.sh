#!/usr/bin/env bash
set -euo pipefail

# Add one driver-backed CUPS printer on the onsite server.
# Usage: sudo ./scripts/add_site_printer.sh QUEUE_NAME PRINT_SERVER_IP PORT /path/to/driver.ppd
#    or: sudo ./scripts/add_site_printer.sh QUEUE_NAME PRINT_SERVER_IP PORT drv:///sample.drv/zebra.ppd

if [[ "$#" -ne 4 ]]; then
  echo "Usage: $0 QUEUE_NAME PRINT_SERVER_IP PORT DRIVER_PPD_OR_MODEL" >&2
  exit 2
fi
queue_name="$1"
server_ip="$2"
server_port="$3"
driver_spec="$4"

if [[ "$(id -u)" -ne 0 ]]; then echo "Run as root." >&2; exit 1; fi
if [[ ! "$queue_name" =~ ^[a-zA-Z][a-zA-Z0-9_-]{0,39}$ ]]; then echo "Invalid queue name." >&2; exit 1; fi
if [[ ! "$server_ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then echo "Use a print-server IPv4 address." >&2; exit 1; fi
IFS=. read -r a b c d <<< "$server_ip"
for octet in "$a" "$b" "$c" "$d"; do
  if (( 10#$octet > 255 )); then echo "Invalid IPv4 address." >&2; exit 1; fi
done
if [[ ! "$server_port" =~ ^[0-9]{1,5}$ ]] || (( server_port < 1 || server_port > 65535 )); then echo "Invalid port." >&2; exit 1; fi

if ! command -v lpadmin >/dev/null 2>&1 || ! command -v cupsd >/dev/null 2>&1; then
  apt-get update
  apt-get install -y cups cups-client cups-filters
fi
systemctl enable --now cups
driver_args=()
if [[ -r "$driver_spec" ]]; then
  driver_args=(-P "$driver_spec")
elif [[ "$driver_spec" == drv://* ]] && lpinfo -m | awk -v model="$driver_spec" '$1 == model { found = 1 } END { exit !found }'; then
  driver_args=(-m "$driver_spec")
else
  echo "Driver is not a readable PPD or installed CUPS model: $driver_spec" >&2
  exit 1
fi
lpadmin -p "$queue_name" -E -v "socket://${server_ip}:${server_port}" "${driver_args[@]}"
cupsenable "$queue_name"
cupsaccept "$queue_name"
lpstat -p "$queue_name"
