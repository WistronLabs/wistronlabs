#!/bin/bash
# About:
#   Opens a BIOS serial or console session for a target BMC using IP, MAC, or
#   service tag input.
#   Backend mode supports -i, -m, and -t. Field mode supports -i and -m only.
#
# Usage:
#   WISTRON_MODE=backend ./bios_serial.sh [<-i IP_ADDRESS | -m MAC_ADDRESS | -t SERVICE_TAG>]
#   WISTRON_MODE=field   ./bios_serial.sh [<-i IP_ADDRESS | -m MAC_ADDRESS>]
#
set -euo pipefail

IPMI_USER="admin"
IPMI_PASS="admin"

SSH_USER="root"
SSH_PASS="changeme"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/.lib"

# shellcheck disable=SC1091
source "$LIB_DIR/err.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/runtime_mode.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/normalize_mac_hex12.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_server_location.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_cmd.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/fetch_system_from_backend.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/resolve_ip_from_mac.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/normalize_service_tag.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/prompt_service_tag.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/backend_curl.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/terminal_client_handoff.sh"

print_help() {
    if is_field_mode; then
        cat <<EOF
Usage:
  ./bios_serial.sh [<-i IP_ADDRESS | -m MAC_ADDRESS>]

Mode:
  field

Options:
  -i    Specify BMC using its IP address
  -m    Specify BMC using its MAC address

Notes:
  - Service tag lookup is disabled in field mode.
  - With no arguments, prompts for the BMC MAC.
EOF
    else
        cat <<EOF
Usage:
  ./bios_serial.sh [<-i IP_ADDRESS | -m MAC_ADDRESS | -t SERVICE_TAG>]

Mode:
  backend

Options:
  -i    Specify BMC using its IP address
  -m    Specify BMC using its MAC address
  -t    Specify system by Service Tag (pull BMC MAC from backend)

With no arguments, uses the system assigned to the current station if possible,
then prompts for a service tag and, if needed, a BMC MAC.
EOF
    fi
}

prompt_bmc_mac() {
    local raw normalized
    while true; do
        read -r -p "BMC MAC: " raw || return 1
        if normalized="$(normalize_mac_hex12 "$raw")"; then
            printf '%s\n' "$normalized"
            return 0
        fi
        echo "Enter exactly 12 hex characters, with or without separators." >&2
    done
}

if [ $# -eq 0 ]; then
    if is_backend_mode; then
        require_server_location
        require_cmd jq
        local_tag=""
        if [[ -n "${TMUX:-}" ]]; then
            station_session="$(tmux display-message -p '#S' 2>/dev/null || true)"
            if [[ "$station_session" =~ ^stn_([1-9][0-9]{0,5})$ ]]; then
                station_number="${BASH_REMATCH[1]}"
                api_base="${STATION_API_BASE_URL:-https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1}"
                if station_json="$(backend_curl -fsS --max-time 8 "${api_base%/}/stations/$station_number" 2>/dev/null)"; then
                    local_tag="$(printf '%s' "$station_json" | jq -r '.system_service_tag // empty')"
                fi
            fi
        fi
        if [[ -n "$local_tag" ]]; then
            echo "Using system $local_tag assigned to station $station_number."
        else
            echo "Enter the service tag for the BIOS serial session."
            local_tag="$(prompt_service_tag)"
        fi
        SERVICE_TAG="$local_tag"
        if sys_json="$(fetch_system_from_backend "$local_tag")"; then
            bmc_raw="$(printf '%s' "$sys_json" | jq -r '.bmc_mac // empty')"
            if [[ -n "$bmc_raw" ]] && normalize_mac_hex12 "$bmc_raw" >/dev/null 2>&1; then
                ADDRESS_TYPE="-m"
                ADDRESS_VALUE="$bmc_raw"
            else
                echo "No BMC MAC is recorded for $local_tag."
            fi
        else
            echo "Enter the BMC MAC to continue."
        fi
    fi
    if [[ -z "${ADDRESS_VALUE:-}" ]]; then
        ADDRESS_TYPE="-m"
        ADDRESS_VALUE="$(prompt_bmc_mac)"
    fi
elif [ $# -eq 2 ]; then
    ADDRESS_TYPE="$1"
    ADDRESS_VALUE="$2"
else
    print_help
    exit 1
fi

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

    if ! mac_raw="$(normalize_mac_hex12 "$ADDRESS_VALUE")"; then
        err "Invalid MAC address format."
        echo "Needs to be in 001A2B3C4D5E format"
        exit 1
    fi

    # Normalize to aa:bb:cc:dd:ee:ff
    ADDRESS_VALUE=$(printf '%s' "$mac_raw" | sed 's/\(..\)/\1:/g; s/:$//')
    IP="$(resolve_ip_from_mac "$ADDRESS_VALUE")"

    if [[ -z "$IP" ]]; then
        err "The MAC Address given does not have a valid IP yet"
        echo "please wait for an IP address to be assigned or recheck your mac"
        exit 1
    fi

    MAC="$ADDRESS_VALUE"
elif [[ "$ADDRESS_TYPE" = "-t" || "$ADDRESS_TYPE" = "-T" ]]; then
    if is_field_mode; then
        err "Service tag lookup is not available in field mode. Use -i or -m."
        exit 1
    fi

    SERVICE_TAG="$(normalize_service_tag "$ADDRESS_VALUE")"
    if [[ -z "$SERVICE_TAG" ]]; then
        err "Service Tag cannot be empty."
        exit 1
    fi

    require_server_location
    require_cmd jq
    sys_json="$(fetch_system_from_backend "$SERVICE_TAG")"

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
    IP="$(resolve_ip_from_mac "$ADDRESS_VALUE")"

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

MAC_NO_COLONS="$(printf '%s' "${MAC//:/}" | tr '[:upper:]' '[:lower:]')"
SESSION_NAME="bs_${MAC_NO_COLONS}"
IN_STATION_TMUX=0
if [[ -n "${TMUX:-}" ]]; then
    IN_STATION_TMUX=1
fi

announce_bios_session() {
    local station_session event_value
    [[ "$IN_STATION_TMUX" == "1" ]] || return 0
    station_session="$(tmux display-message -p '#S' 2>/dev/null)" || return 0
    [[ "$station_session" =~ ^stn_[1-9][0-9]{0,5}$ ]] || return 0
    [[ "${WISTRON_BIOS_DEFER_ANNOUNCE:-0}" == "1" ]] && return 0
    # The website offers BIOS as a separate viewer choice while its station
    # tmux client remains on this session.
    event_value="${MAC_NO_COLONS}:$(date +%s%N)"
    if [[ "${SERVICE_TAG:-}" =~ ^[A-Za-z0-9-]{1,32}$ ]]; then
        event_value+=":$(printf '%s' "$SERVICE_TAG" | tr '[:lower:]' '[:upper:]')"
    fi
    tmux set-option -t "=$station_session:" @wistron_bios_open "$event_value" 2>/dev/null || true
}

handoff_station_clients() {
    local station_session
    [[ "$IN_STATION_TMUX" == "1" && "${WISTRON_BIOS_DEFER_ANNOUNCE:-0}" != "1" ]] || return 0
    station_session="$(tmux display-message -p '#S' 2>/dev/null)" || return 0
    [[ "$station_session" =~ ^stn_[1-9][0-9]{0,5}$ ]] || return 0
    if ! wistron_switch_native_clients "$station_session" "$SESSION_NAME"; then
        echo "WARNING - BIOS is ready, but a terminal client could not switch automatically." >&2
    fi
}

# A station pane must never attach another tmux client inside itself.
if tmux has-session -t "=$SESSION_NAME" 2>/dev/null; then
    if [[ "$IN_STATION_TMUX" == "1" ]]; then
        announce_bios_session
        echo "BIOS serial session $SESSION_NAME is ready. Website viewers can open it beside the station."
        handoff_station_clients
    else
        tmux attach-session -t "=$SESSION_NAME"
    fi
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
elif timeout 4 ipmitool -I lanplus -U "root" -P "calvin" -H "$IP" chassis power status >/dev/null 2>&1; then
    IPMI_USER="root"
    IPMI_PASS="calvin"
    IPMI_CIPHER=""
else
    IPMI_USER=""
    IPMI_PASS=""
    IPMI_CIPHER=""
fi

if [[ -n "$IPMI_USER" ]]; then
    # IPMI works -> use SOL (with whatever cipher was selected)
    ipmitool -I lanplus -U "$IPMI_USER" -P "$IPMI_PASS" -H "$IP" $IPMI_CIPHER sol deactivate >/dev/null 2>&1 || true

    tmux new-session -d -s "$SESSION_NAME" \
      "ipmitool -I lanplus -U '$IPMI_USER' -P '$IPMI_PASS' -H '$IP' $IPMI_CIPHER sol activate"
else
    sshpass -p "$SSH_PASS" ssh \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=10 \
      "${SSH_USER}@${IP}" \
      "stop -script HOST/console" >/dev/null 2>&1 || true

    tmux new-session -d -s "$SESSION_NAME" \
      "sshpass -p '$SSH_PASS' ssh -tt -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${SSH_USER}@${IP} 'start -script HOST/console'"

    # If SSH failed immediately, tmux session won't exist -> show error
    if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        err "Unable to connect to $IP via IPMI (admin/admin or root/0penBmc -C 17) or SSH console (Config 7)." >&2
        echo "Please ensure the system is powered on and accessible." >&2
        exit 2
    fi
fi


if ! tmux has-session -t "=$SESSION_NAME" 2>/dev/null; then
    err "BIOS serial session $SESSION_NAME exited before it could be opened."
    exit 2
fi

if [[ "$IN_STATION_TMUX" == "1" ]]; then
    announce_bios_session
    echo "BIOS serial session $SESSION_NAME is ready. Website viewers can open it beside the station."
    handoff_station_clients
else
    tmux attach-session -t "=$SESSION_NAME"
fi

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
