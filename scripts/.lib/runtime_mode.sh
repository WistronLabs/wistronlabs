# shellcheck shell=bash
# About:
#   Shared runtime-mode helpers for backend and field workflows.
#
# Usage:
#   source ./scripts/.lib/runtime_mode.sh
#   if is_field_mode; then ...; fi
#
# Notes:
#   Backend mode is the default when WISTRON_MODE is unset.

RUNTIME_MODE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_MODE_SCRIPTS_DIR="$(cd "$RUNTIME_MODE_LIB_DIR/.." && pwd)"

WISTRON_MODE="${WISTRON_MODE:-backend}"
FIELD_STATIONS_FILE="${FIELD_STATIONS_FILE:-$RUNTIME_MODE_SCRIPTS_DIR/config/field_stations.json}"
FIELD_DEFAULT_CONFIG="${FIELD_DEFAULT_CONFIG:-}"

is_backend_mode() {
  [[ "${WISTRON_MODE:-backend}" == "backend" ]]
}

is_field_mode() {
  [[ "${WISTRON_MODE:-backend}" == "field" ]]
}

require_field_mode_disabled() {
  local script_name="${1:-This script}"

  if is_field_mode; then
    echo "Error: $script_name is not available in field mode." >&2
    exit 1
  fi
}

write_default_field_stations_file() {
  local target_file="$1"
  local target_dir
  local default_config

  target_dir="$(dirname "$target_file")"
  default_config="$(field_default_config)"

  mkdir -p "$target_dir"
  cat > "$target_file" <<EOF
{
  "default_config": "$default_config",
  "stations": [
    { "id": 1, "enabled": true }
  ]
}
EOF
}

require_field_stations_file() {
  if [[ ! -f "$FIELD_STATIONS_FILE" ]]; then
    write_default_field_stations_file "$FIELD_STATIONS_FILE"
  fi
}

field_default_config() {
  local json_value

  if [[ -n "${FIELD_DEFAULT_CONFIG:-}" ]]; then
    printf '%s\n' "$FIELD_DEFAULT_CONFIG"
    return 0
  fi

  if [[ ! -f "$FIELD_STATIONS_FILE" ]]; then
    printf 'F\n'
    return 0
  fi

  if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required to read the field stations file." >&2
    exit 1
  fi

  json_value="$(jq -r '.default_config // empty' "$FIELD_STATIONS_FILE")"
  if [[ -n "$json_value" && "$json_value" != "null" ]]; then
    printf '%s\n' "$json_value"
  else
    printf 'F\n'
  fi
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
