# shellcheck shell=bash
# About:
#   Shared error printer for shell scripts.
#
# Usage:
#   source ./scripts/.lib/err.sh
#   err "Something went wrong"
#
# Notes:
#   Prints a red "Error:" prefix to stderr.

err() {
  local red='\033[0;31m'
  local nc='\033[0m'
  echo -e "${red}Error:${nc} $*" >&2
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
