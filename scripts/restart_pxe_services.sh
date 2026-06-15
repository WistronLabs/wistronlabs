#!/bin/bash
# About:
#   Restarts PXE-related services and prints their status.
#
# Usage:
#   sudo ./restart_pxe_services.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/.lib"

# shellcheck disable=SC1091
source "$LIB_DIR/require_cmd.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_root.sh"

require_cmd systemctl
require_root "$0" "$@"

systemctl restart tftpd-hpa
systemctl restart isc-dhcp-server
systemctl restart apache2

systemctl status  tftpd-hpa --no-pager
echo ""
systemctl status  isc-dhcp-server --no-pager
echo ""
systemctl status  apache2 --no-pager

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
