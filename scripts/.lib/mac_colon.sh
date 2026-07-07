# shellcheck shell=bash
# About:
#   Formats a 12-character MAC string into colon-separated form.
#
# Usage:
#   source ./scripts/.lib/mac_colon.sh
#   mac_colon "aabbccddeeff"
#
# Notes:
#   Input is expected to already be normalized to 12 hex characters.

mac_colon() {
  printf '%s' "$1" | sed 's/\(..\)/\1:/g; s/:$//'
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
