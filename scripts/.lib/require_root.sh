# shellcheck shell=bash
# About:
#   Ensures a script is being run as root.
#
# Usage:
#   source ./scripts/.lib/require_root.sh
#   require_root "$0" "$@"
#
# Notes:
#   Prints a sudo hint and exits with status 1 when not running as root.

require_root() {
  local script_name="$1"
  shift || true

  if [[ "$EUID" -ne 0 ]]; then
    echo "Error: This script must be run as root. Use sudo:" >&2
    echo "       sudo $script_name $*" >&2
    exit 1
  fi
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
