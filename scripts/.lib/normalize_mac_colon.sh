# shellcheck shell=bash
# About:
#   Normalizes a MAC address into lowercase colon-separated form.
#
# Usage:
#   source ./scripts/.lib/normalize_mac_colon.sh
#   normalized="$(normalize_mac_colon "AA-BB-CC-DD-EE-FF")"
#
# Notes:
#   Accepts plain hex, colon-separated, or dash-separated MAC input.
#   Returns nonzero if the value is not a valid 12-hex-character MAC.

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/normalize_mac_hex12.sh"
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/mac_colon.sh"

normalize_mac_colon() {
  local normalized

  normalized="$(normalize_mac_hex12 "${1:-}")" || return 1
  mac_colon "$normalized"
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
