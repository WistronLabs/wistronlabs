# shellcheck shell=bash
# About:
#   Resolves the most recent DHCP lease IP for a colon-form MAC address.
#
# Usage:
#   source ./scripts/.lib/resolve_ip_from_mac.sh
#   BMC_IP="$(resolve_ip_from_mac "aa:bb:cc:dd:ee:ff")"
#
# Notes:
#   Reads from /var/lib/dhcp/dhcpd.leases and prints the IP if found.

resolve_ip_from_mac() {
  local mac_colon_value="$1"
  awk -v mac="$mac_colon_value" '
    /lease/ {ip=$2}
    /hardware ethernet/ {
      gsub(";", "", $3)
      if ($3 == mac) last_ip = ip
    }
    END { if (last_ip != "") print last_ip }
  ' /var/lib/dhcp/dhcpd.leases
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
