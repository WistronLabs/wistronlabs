#!/bin/bash
# About:
#   Clears DHCP leases and restarts the DHCP service.
#
# Usage:
#   sudo ./clear_dhcp.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/.lib"

# shellcheck disable=SC1091
source "$LIB_DIR/require_cmd.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_root.sh"

require_cmd systemctl
require_cmd rm
require_cmd touch
require_root "$0" "$@"

systemctl stop isc-dhcp-server
rm /var/lib/dhcp/dhcpd.leases
touch /var/lib/dhcp/dhcpd.leases
systemctl start isc-dhcp-server

systemctl status isc-dhcp-server --no-pager

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
