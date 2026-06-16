#!/bin/bash
# About:
#   Resolves the latest DHCP IP address for a provided BMC MAC address.
#
# Usage:
#   ./get_ip.sh [MAC_ADDRESS]
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/.lib"

# shellcheck disable=SC1091
source "$LIB_DIR/err.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/normalize_mac_hex12.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/mac_colon.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/resolve_ip_from_mac.sh"

if [[ -z "${1:-}" ]]; then
  read -r -p "Enter MAC address (e.g., 001A2B3C4D5E): " BMC_MAC
else
  BMC_MAC="$1"
fi

if ! BMC_MAC_HEX="$(normalize_mac_hex12 "$BMC_MAC")"; then
  err "Invalid MAC address. Enter exactly 12 hex characters, with or without : or - separators."
  exit 1
fi

BMC_MAC_COLON="$(mac_colon "$BMC_MAC_HEX")"
BMC_IP="$(resolve_ip_from_mac "$BMC_MAC_COLON")"

if [[ -z "$BMC_IP" ]]; then
  err "The MAC address does not have a valid IP yet."
  echo "Please wait for an IP address to be assigned or recheck the MAC." >&2
  exit 1
fi

printf '%s\n' "$BMC_IP"

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
