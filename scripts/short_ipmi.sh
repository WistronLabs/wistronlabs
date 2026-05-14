#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
NC='\033[0m'

SERVICE_TAG=""
BMC_IP=""
BMC_MAC=""
CONFIG=""

err() {
  echo -e "${RED}Error:${NC} $*" >&2
}

print_help() {
  cat <<'EOF'
Usage:
  ./short_ipmi.sh [target] [ipmi arguments...]

Targets:
  -s SERVICE_TAG    Pull BMC MAC and config from backend, then resolve BMC IP
  -i BMC_IP         Use BMC IP directly
  -m BMC_MAC        Resolve BMC IP from DHCP lease using BMC MAC
  -c CONFIG         Required with -i/-m unless you want to pick config with fzf
  -h                Show this help and exit

Flags are case-insensitive, so -S, -I, -M, -C, and -H also work.

Notes:
  - If no -s/-i/-m target is provided, the script prompts for a Service Tag.
  - -s, -i, and -m are mutually exclusive.
  - If no IPMI arguments are provided, defaults to: chassis power status

Examples:
  ./short_ipmi.sh -s TESTYB4
  ./short_ipmi.sh -s TESTYB4 chassis power on
  ./short_ipmi.sh -i 192.168.1.50 -c F chassis power status
  ./short_ipmi.sh -m aabbccddeeff -c 7 chassis power status
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "$1 is required but not installed."
    exit 1
  fi
}

normalize_mac_hex12() {
  local raw
  raw="$(
    printf '%s' "${1:-}" |
      tr -d '[:space:]' |
      tr -d ':' |
      tr -d '-' |
      tr '[:upper:]' '[:lower:]'
  )"
  [[ "$raw" =~ ^[0-9a-f]{12}$ ]] || return 1
  printf '%s\n' "$raw"
}

mac_colon() {
  printf '%s' "$1" | sed 's/\(..\)/\1:/g; s/:$//'
}

normalize_service_tag() {
  printf '%s' "${1:-}" | tr '[:lower:]' '[:upper:]' | xargs
}

is_valid_ip() {
  local ip="$1"
  local ip_regex="^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$"
  [[ "$ip" =~ $ip_regex ]]
}

prompt_service_tag() {
  local value

  while true; do
    read -r -p "Service Tag: " value
    value="$(normalize_service_tag "$value")"
    if [[ -n "$value" ]]; then
      printf '%s\n' "$value"
      return 0
    fi
    err "Service Tag cannot be empty."
  done
}

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

fetch_system_from_backend() {
  local service_tag="$1"
  local api_base tmp_json http_code

  if [[ -z "${SERVER_LOCATION:-}" ]]; then
    err "Environment variable SERVER_LOCATION is not set."
    echo "Please export SERVER_LOCATION in your shell, for example: export SERVER_LOCATION=frk" >&2
    exit 1
  fi

  api_base="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1"
  tmp_json="$(mktemp)"
  http_code="$(curl -sS --max-time 5 -o "$tmp_json" -w "%{http_code}" \
    "$api_base/systems/$service_tag" 2>/dev/null || true)"

  if [[ "$http_code" != "200" ]]; then
    rm -f "$tmp_json"
    case "$http_code" in
      404) err "System $service_tag not found in tracking website." ;;
      *) err "Backend returned HTTP $http_code when fetching $service_tag." ;;
    esac
    exit 1
  fi

  cat "$tmp_json"
  rm -f "$tmp_json"
}

pick_config_from_backend() {
  local api_base dpn_json

  if [[ -z "${SERVER_LOCATION:-}" ]]; then
    err "Environment variable SERVER_LOCATION is not set."
    echo "Please export SERVER_LOCATION in your shell, for example: export SERVER_LOCATION=frk" >&2
    exit 1
  fi

  api_base="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1"
  dpn_json="$(curl -fsS --max-time 10 "$api_base/systems/dpn")"

  printf '%s\n' "$dpn_json" |
    jq -r '.[].config // empty' |
    awk 'NF' |
    sort -u |
    fzf --prompt='Config> ' --height=10 --border
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|-S)
      shift
      if [[ $# -gt 0 && "$1" != -* ]]; then
        SERVICE_TAG="$(normalize_service_tag "$1")"
        shift
      else
        SERVICE_TAG="$(prompt_service_tag)"
      fi
      ;;
    -i|-I)
      shift
      if [[ $# -eq 0 || "$1" == -* ]]; then
        err "-i requires a BMC IP address."
        exit 1
      fi
      BMC_IP="$1"
      shift
      ;;
    -m|-M)
      shift
      if [[ $# -eq 0 || "$1" == -* ]]; then
        err "-m requires a BMC MAC address."
        exit 1
      fi
      if ! BMC_MAC="$(normalize_mac_hex12 "$1")"; then
        err "Invalid BMC MAC. Enter exactly 12 hex characters, with or without : or - separators."
        exit 1
      fi
      shift
      ;;
    -c|-C)
      shift
      if [[ $# -eq 0 || "$1" == -* ]]; then
        err "-c requires a config value."
        exit 1
      fi
      CONFIG="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
      shift
      ;;
    -h|-H|--help)
      print_help
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      err "Unknown option: $1"
      print_help
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

IPMI_ARGS=("$@")
if [[ ${#IPMI_ARGS[@]} -eq 0 ]]; then
  IPMI_ARGS=(chassis power status)
fi

require_cmd ipmitool
require_cmd jq
require_cmd curl

target_count=0
[[ -n "$SERVICE_TAG" ]] && target_count=$((target_count + 1))
[[ -n "$BMC_IP" ]] && target_count=$((target_count + 1))
[[ -n "$BMC_MAC" ]] && target_count=$((target_count + 1))

if ((target_count > 1)); then
  err "Use only one target: -s, -i, or -m."
  exit 1
fi

if ((target_count == 0)); then
  SERVICE_TAG="$(prompt_service_tag)"
fi

if [[ -n "$SERVICE_TAG" ]]; then
  sys_json="$(fetch_system_from_backend "$SERVICE_TAG")"
  bmc_raw="$(printf '%s' "$sys_json" | jq -r '.bmc_mac // empty')"
  config_raw="$(printf '%s' "$sys_json" | jq -r '.config // empty')"

  if ! BMC_MAC="$(normalize_mac_hex12 "$bmc_raw")"; then
    err "BMC MAC is missing or invalid for $SERVICE_TAG."
    exit 1
  fi

  if [[ -z "$config_raw" || "$config_raw" == "null" ]]; then
    err "System $SERVICE_TAG has no known config in tracking website."
    exit 1
  fi

  CONFIG="$(printf '%s' "$config_raw" | tr '[:lower:]' '[:upper:]')"
fi

if [[ -n "$BMC_IP" ]]; then
  if ! is_valid_ip "$BMC_IP"; then
    err "Invalid IP address: $BMC_IP"
    exit 1
  fi
else
  BMC_MAC_COLON="$(mac_colon "$BMC_MAC")"
  BMC_IP="$(resolve_ip_from_mac "$BMC_MAC_COLON")"
  if [[ -z "$BMC_IP" ]]; then
    err "The BMC MAC does not have a valid IP yet."
    echo "Please wait for an IP address to be assigned or recheck the MAC." >&2
    exit 1
  fi
fi

if [[ -z "$CONFIG" ]]; then
  require_cmd fzf
  CONFIG="$(pick_config_from_backend)"
  if [[ -z "$CONFIG" ]]; then
    err "No config selected."
    exit 1
  fi
fi

echo "BMC_IP=$BMC_IP"
echo "CONFIG=$CONFIG"

case "$CONFIG" in
  7)
    exec ipmitool -U root -P changeme -I lanplus -H "$BMC_IP" "${IPMI_ARGS[@]}"
    ;;
  F)
    exec ipmitool -U root -P 0penBmc -I lanplus -H "$BMC_IP" -C 17 "${IPMI_ARGS[@]}"
    ;;
  D)
    exec ipmitool -U root -P calvin -I lanplus -H "$BMC_IP" "${IPMI_ARGS[@]}"
    ;;
  *)
    exec ipmitool -U admin -P admin -I lanplus -H "$BMC_IP" "${IPMI_ARGS[@]}"
    ;;
esac
