# shellcheck shell=bash
# About:
#   Normalizes a MAC address into 12 lowercase hex characters.
#
# Usage:
#   source ./scripts/.lib/normalize_mac_hex12.sh
#   normalized="$(normalize_mac_hex12 "AA:BB:CC:DD:EE:FF")"
#
# Notes:
#   Accepts plain hex, colon-separated, or dash-separated MAC input.
#   Returns nonzero if the value is not a valid 12-hex-character MAC.

normalize_mac_hex12() {
  local raw
  raw="$(
    printf '%s' "${1:-}" |
      tr -d '[:space:]' |
      tr -d ':' |
      tr -d '-' |
      tr '[:upper:]' '[:lower:]'
  )"
  [[ "$raw" =~ ^[0-9a-f]{12}$ ]] || return 1
  printf '%s\n' "$raw"
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
