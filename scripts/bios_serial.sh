#!/bin/bash
set -euo pipefail

IPMI_USER="admin"
IPMI_PASS="admin"

SSH_USER="root"
SSH_PASS="changeme"

RED='\033[0;31m'
NC='\033[0m' # No Color

err() {
    echo -e "${RED}Error:${NC} $*" >&2
}


# Check if exactly two arguments are provided
if [ $# -ne 2 ]; then
    echo "Usage: $0 <-i IP_ADDRESS | -m MAC_ADDRESS | -t SERVICE_TAG>"
    echo "  -i    Specify BMC using its IP address"
    echo "  -m    Specify BMC using its MAC address"
    echo "  -t    Specify system by Service Tag (pull BMC MAC from backend)"
    exit 1
fi

ADDRESS_TYPE="$1"
ADDRESS_VALUE="$2"

normalize_mac_to_hex12() {
    local raw="${1:-}"
    raw=$(echo "$raw" | tr -d ':-[:space:]')
    if [[ ! "$raw" =~ ^[A-Fa-f0-9]{12}$ ]]; then
        return 1
    fi
    echo "$raw"
}

# Simple validation for IP address format
if [[ "$ADDRESS_TYPE" = "-i" ]]; then

    if ! [[ "$ADDRESS_VALUE" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
        err "Invalid IP address format."
        echo "Needs to be in 123.456.789.012 format"
        exit 1
    fi

    IP="$ADDRESS_VALUE"

    MAC=$(awk -v ip="$ADDRESS_VALUE" '
        $1 == "lease" && $2 == ip {found=1}
        found && /hardware ethernet/ {gsub(";", "", $3); print $3; exit}
    ' /var/lib/dhcp/dhcpd.leases)

    if [[ -z "$MAC" ]]; then
        err "There is no system with that IP"
        echo "Please check the IP address or wait for a lease to appear"
        exit 1
    fi

elif [[ "$ADDRESS_TYPE" = "-m" ]]; then

    if ! [[ "$ADDRESS_VALUE" =~ ^[A-Fa-f0-9]{12}$ ]]; then
        err "Invalid MAC address format."
        echo "Needs to be in 001A2B3C4D5E format"
        exit 1
    fi

    # Normalize to aa:bb:cc:dd:ee:ff
    ADDRESS_VALUE=$(echo "$ADDRESS_VALUE" | tr 'A-F' 'a-f' | sed 's/\(..\)/\1:/g' | sed 's/:$//')

    IP=$(awk -v mac="$ADDRESS_VALUE" '
        /lease/ {ip=$2}
        /hardware ethernet/ {
            gsub(";", "", $3)
            if ($3 == mac) last_ip = ip
        }
        END { if (last_ip != "") print last_ip }
    ' /var/lib/dhcp/dhcpd.leases)

    if [[ -z "$IP" ]]; then
        err "The MAC Address given does not have a valid IP yet"
        echo "please wait for an IP address to be assigned or recheck your mac"
        exit 1
    fi

    MAC="$ADDRESS_VALUE"
elif [[ "$ADDRESS_TYPE" = "-t" || "$ADDRESS_TYPE" = "-T" ]]; then
    SERVICE_TAG=$(echo "$ADDRESS_VALUE" | tr '[:lower:]' '[:upper:]' | xargs)
    if [[ -z "$SERVICE_TAG" ]]; then
        err "Service Tag cannot be empty."
        exit 1
    fi

    if [[ -z "${SERVER_LOCATION:-}" ]]; then
        err "Environment variable SERVER_LOCATION is not set."
        echo "Please export SERVER_LOCATION in your shell (e.g. in ~/.bashrc)."
        exit 1
    fi

    if ! command -v jq >/dev/null 2>&1; then
        err "jq is required but not installed."
        exit 1
    fi

    tmp_json=$(mktemp)
    http_code=$(curl -sS --max-time 5 -o "$tmp_json" -w "%{http_code}" \
      "https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/systems/$SERVICE_TAG" 2>/dev/null || true)
    if [[ "$http_code" != "200" ]]; then
        rm -f "$tmp_json"
        err "Service Tag $SERVICE_TAG not found"
        exit 1
    fi
    sys_json=$(cat "$tmp_json")
    rm -f "$tmp_json"

    bmc_raw=$(printf '%s' "$sys_json" | jq -r '.bmc_mac // empty')
    if [[ -z "$bmc_raw" || "$bmc_raw" == "null" ]]; then
        err "BMC MAC has not been set for $SERVICE_TAG yet."
        exit 1
    fi

     if ! [[ "$bmc_raw" =~ ^[A-Fa-f0-9]{12}$ ]]; then
        err "Backend returned an invalid BMC MAC for $SERVICE_TAG: $bmc_raw"
        exit 1
    fi

    # Reuse existing MAC flow after backend lookup
    ADDRESS_VALUE=$(echo "$bmc_raw" | tr 'A-F' 'a-f' | sed 's/\(..\)/\1:/g' | sed 's/:$//')

    IP=$(awk -v mac="$ADDRESS_VALUE" '
        /lease/ {ip=$2}
        /hardware ethernet/ {
            gsub(";", "", $3)
            if ($3 == mac) last_ip = ip
        }
        END { if (last_ip != "") print last_ip }
    ' /var/lib/dhcp/dhcpd.leases)

    if [[ -z "$IP" ]]; then
        err "The MAC Address given does not have a valid IP yet"
        echo "please wait for an IP address to be assigned or recheck your mac"
        exit 1
    fi

    MAC="$ADDRESS_VALUE"
else
    err "Invalid type, must be -i (ip), -m (mac), or -t (service tag)"
    exit 1
fi

MAC_NO_COLONS="${MAC//:/}"
SESSION_NAME="bs_${MAC_NO_COLONS}"

# If session already exists, just attach
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    tmux attach -t "$SESSION_NAME"
    exit 0
fi

# Probe IPMI quickly (don’t hang forever) - try admin/admin first, then root/0penBmc with -C 17
if timeout 4 ipmitool -I lanplus -U "admin" -P "admin" -H "$IP" chassis power status >/dev/null 2>&1; then
    IPMI_USER="admin"
    IPMI_PASS="admin"
    IPMI_CIPHER=""   # none

elif timeout 4 ipmitool -I lanplus -U "root" -P "0penBmc" -H "$IP" -C 17 chassis power status >/dev/null 2>&1; then
    IPMI_USER="root"
    IPMI_PASS="0penBmc"
    IPMI_CIPHER="-C 17"

else
    IPMI_USER=""
    IPMI_PASS=""
    IPMI_CIPHER=""
fi

if [[ -n "$IPMI_USER" ]]; then
    # IPMI works -> use SOL (with whatever cipher was selected)
    ipmitool -I lanplus -U "$IPMI_USER" -P "$IPMI_PASS" -H "$IP" $IPMI_CIPHER sol deactivate >/dev/null 2>&1 || true

    tmux new-session -s "$SESSION_NAME" \
      "ipmitool -I lanplus -U '$IPMI_USER' -P '$IPMI_PASS' -H '$IP' $IPMI_CIPHER sol activate"
else
    sshpass -p "$SSH_PASS" ssh \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=10 \
      "${SSH_USER}@${IP}" \
      "stop -script HOST/console" >/dev/null 2>&1 || true

    tmux new-session -s "$SESSION_NAME" \
      "sshpass -p '$SSH_PASS' ssh -tt -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${SSH_USER}@${IP} 'start -script HOST/console'"

    # If SSH failed immediately, tmux session won't exist -> show error
    if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        err "Unable to connect to $IP via IPMI (admin/admin or root/0penBmc -C 17) or SSH console (Config 7)." >&2
        echo "Please ensure the system is powered on and accessible." >&2
        exit 2
    fi
fi


tmux attach -t "$SESSION_NAME"
