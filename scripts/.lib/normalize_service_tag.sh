# shellcheck shell=bash
# About:
#   Normalizes a service tag by trimming whitespace and uppercasing it.
#
# Usage:
#   source ./scripts/.lib/normalize_service_tag.sh
#   SERVICE_TAG="$(normalize_service_tag "$raw_tag")"
#
# Notes:
#   Prints the normalized value to stdout.

normalize_service_tag() {
  printf '%s' "${1:-}" | tr '[:lower:]' '[:upper:]' | xargs
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
