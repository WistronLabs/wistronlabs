# shellcheck shell=bash
# About:
#   Prompts interactively until a non-empty service tag is entered.
#
# Usage:
#   source ./scripts/.lib/prompt_service_tag.sh
#   SERVICE_TAG="$(prompt_service_tag)"
#
# Notes:
#   Returned value is trimmed and uppercased.

prompt_service_tag() {
  local value

  while true; do
    read -r -p "Service Tag: " value
    value="$(printf '%s' "$value" | tr '[:lower:]' '[:upper:]' | xargs)"
    if [[ -n "$value" ]]; then
      printf '%s\n' "$value"
      return 0
    fi
    echo "Error: Service Tag cannot be empty." >&2
  done
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
