# shellcheck shell=bash
# About:
#   Fetches a system JSON record from the Wistron backend by service tag.
#
# Usage:
#   source ./scripts/.lib/fetch_system_from_backend.sh
#   sys_json="$(fetch_system_from_backend "$SERVICE_TAG")"
#
# Notes:
#   Requires SERVER_LOCATION to be set.
#   Prints the raw JSON response on success and exits on error.

fetch_system_from_backend() {
  local service_tag="$1"
  local api_base tmp_json http_code

  if [[ -z "${SERVER_LOCATION:-}" ]]; then
    echo "Error: environment variable SERVER_LOCATION is not set." >&2
    echo "       Please export SERVER_LOCATION in your shell, for example: export SERVER_LOCATION=frk" >&2
    exit 1
  fi

  api_base="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1"
  tmp_json="$(mktemp)"
  http_code="$(curl -sS --max-time 5 -o "$tmp_json" -w "%{http_code}" \
    "$api_base/systems/$service_tag" 2>/dev/null || true)"

  if [[ "$http_code" != "200" ]]; then
    rm -f "$tmp_json"
    case "$http_code" in
      404) echo "Error: System $service_tag not found in tracking website." >&2 ;;
      *) echo "Error: Backend returned HTTP $http_code when fetching $service_tag." >&2 ;;
    esac
    exit 1
  fi

  cat "$tmp_json"
  rm -f "$tmp_json"
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
