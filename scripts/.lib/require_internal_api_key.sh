# shellcheck shell=bash
# About:
#   Ensures INTERNAL_API_KEY is set before authenticated backend calls.
#
# Usage:
#   source ./scripts/.lib/require_internal_api_key.sh
#   require_internal_api_key
#
# Notes:
#   Standardized version for scripts that PATCH or otherwise authenticate.

require_internal_api_key() {
  if [[ -z "${INTERNAL_API_KEY:-}" ]]; then
    echo "Error: environment variable INTERNAL_API_KEY is not set." >&2
    echo "       Please export INTERNAL_API_KEY in your shell (e.g. in ~/.bashrc)." >&2
    exit 1
  fi
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
