#!/bin/bash
# About:
#   Clears the local SSH known_hosts file.
#
# Usage:
#   ./clear_known_hosts.sh
#

set -euo pipefail

: > ~/.ssh/known_hosts

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
