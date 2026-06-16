# shellcheck shell=bash
# About:
#   Opens an interactive config picker sourced from backend DPN records.
#
# Usage:
#   source ./scripts/.lib/pick_config_from_backend.sh
#   CONFIG="$(pick_config_from_backend)"
#
# Notes:
#   Requires SERVER_LOCATION, curl, jq, and fzf.
#   Prints the selected config to stdout.

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/runtime_mode.sh"

pick_config_from_backend() {
  local api_base dpn_json

  if is_field_mode; then
    field_default_config
    return 0
  fi

  if [[ -z "${SERVER_LOCATION:-}" ]]; then
    echo "Error: environment variable SERVER_LOCATION is not set." >&2
    echo "       Please export SERVER_LOCATION in your shell, for example: export SERVER_LOCATION=frk" >&2
    exit 1
  fi

  api_base="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1"
  dpn_json="$(curl -fsS --max-time 10 "$api_base/systems/dpn")"

  printf '%s\n' "$dpn_json" |
    jq -r '.[].config // empty' |
    awk 'NF' |
    sort -u |
    fzf --prompt='Config> ' --height=10 --border
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
