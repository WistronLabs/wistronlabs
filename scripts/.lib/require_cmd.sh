# shellcheck shell=bash
# About:
#   Validates that a required command exists in PATH.
#
# Usage:
#   source ./scripts/.lib/require_cmd.sh
#   require_cmd jq
#
# Notes:
#   Exits with status 1 and prints an error if the command is missing.

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: $1 is required but not installed." >&2
    exit 1
  fi
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
