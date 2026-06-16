# shellcheck shell=bash
# About:
#   Ensures SERVER_LOCATION is set before backend-dependent work begins.
#
# Usage:
#   source ./scripts/.lib/require_server_location.sh
#   require_server_location
#
# Notes:
#   Standardized version for scripts that need backend routing.

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/runtime_mode.sh"

require_server_location() {
  if is_field_mode; then
    return 0
  fi

  if [[ -z "${SERVER_LOCATION:-}" ]]; then
    echo "Error: environment variable SERVER_LOCATION is not set." >&2
    echo "       Please export SERVER_LOCATION in your shell, for example: export SERVER_LOCATION=frk" >&2
    exit 1
  fi
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
