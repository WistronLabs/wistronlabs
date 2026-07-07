# shellcheck shell=bash
# About:
#   Runs ipmitool with BMC credentials derived from CONFIG and target BMC_IP.
#
# Usage:
#   source ./scripts/.lib/ipmi.sh
#   CONFIG="7"
#   BMC_IP="192.168.1.50"
#   ipmi chassis power status
#
# Notes:
#   Requires BMC_IP and CONFIG to already be set by the caller.
#   Supports Config 7, F, D, and the default admin/admin path.

ipmi() {
  if [[ -z "${BMC_IP:-}" ]]; then
    echo "Error: BMC_IP must be set before calling ipmi." >&2
    return 1
  fi

  case "${CONFIG:-}" in
    7)
      ipmitool -I lanplus -H "$BMC_IP" -U root -P changeme "$@"
      ;;
    F)
      ipmitool -I lanplus -H "$BMC_IP" -U root -P 0penBmc -C 17 "$@"
      ;;
    D)
      ipmitool -I lanplus -H "$BMC_IP" -U root -P calvin "$@"
      ;;
    *)
      ipmitool -I lanplus -H "$BMC_IP" -U admin -P admin "$@"
      ;;
  esac
}

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
