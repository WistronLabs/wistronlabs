# shellcheck shell=bash
# Authenticate station-side API traffic with the site machine credential.
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/require_internal_api_key.sh"

backend_curl() {
  require_internal_api_key
  curl -H "Authorization: Bearer ${INTERNAL_API_KEY}" "$@"
}
