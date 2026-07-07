# shellcheck shell=bash
# About:
#   Runs curl with BMC HTTP basic-auth credentials derived from CONFIG.
#
# Usage:
#   source ./scripts/.lib/curl_auth.sh
#   curl_auth https://example/redfish/v1/
#
# Notes:
#   Uses CONFIG to choose credentials for BMC web or Redfish requests.
#   Supports Config 7, F, D, and the default admin/admin path.

curl_auth() {
  if [[ "${CONFIG:-}" == "7" ]]; then
    curl -u root:changeme "$@"
  elif [[ "${CONFIG:-}" == "F" ]]; then
    curl -u root:0penBmc "$@"
  elif [[ "${CONFIG:-}" == "D" ]]; then
    curl -u root:calvin "$@"
  else
    curl -u admin:admin "$@"
  fi
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
