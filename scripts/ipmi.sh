#!/bin/bash
# About:
#   Resolves a BMC target from service tag, IP, or MAC input and runs either a
#   raw ipmitool command or an enabled legacy shortcut code with config-based
#   credentials.
#
# Usage:
#   ./ipmi.sh [target flags] [modifier flags] [ipmi arguments...]
#   ./ipmi.sh [target flags] [modifier flags] -n CODE [ARG]
#   ./ipmi.sh [target flags] [modifier flags] [SHORTCUT_FLAG] [ARG]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/.lib"

# shellcheck disable=SC1091
source "$LIB_DIR/err.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_cmd.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/normalize_mac_hex12.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/mac_colon.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/normalize_service_tag.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/prompt_service_tag.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/resolve_ip_from_mac.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/fetch_system_from_backend.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/pick_config_from_backend.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_server_location.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/ipmi.sh"

SERVICE_TAG=""
BMC_IP=""
BMC_MAC=""
CONFIG=""
SHORTCUT_CODE=""
SHORTCUT_NAME=""

POWER_STATUS=1
POWER_ON=$((POWER_STATUS + 1))
POWER_OFF=$((POWER_ON + 1))
POWER_CYCLE=$((POWER_OFF + 1))
POWER_RESET=$((POWER_CYCLE + 1))
SERIAL_NUMBER=$((POWER_RESET + 1))
BMC_INFO=$((SERIAL_NUMBER + 1))
BMC_GUID=$((BMC_INFO + 1))
BMC_RESET_COLD=$((BMC_GUID + 1))
BMC_SELFTEST=$((BMC_RESET_COLD + 1))
FRU_PRINT=$((BMC_SELFTEST + 1))
SDR_INFO=$((FRU_PRINT + 1))
SDR_TYPE_LIST=$((SDR_INFO + 1))
SDR_TYPE_TYPE=$((SDR_TYPE_LIST + 1))
SDR_GET=$((SDR_TYPE_TYPE + 1))
SDR_ELIST=$((SDR_GET + 1))
SDR_LIST=$((SDR_ELIST + 1))
SENSOR_LIST=$((SDR_LIST + 1))
SOL_ACTIVATE=$((SENSOR_LIST + 1))
SOL_DEACTIVATE=$((SOL_ACTIVATE + 1))
LAN_PRINT=$((SOL_DEACTIVATE + 1))
USER_LIST=$((LAN_PRINT + 1))
SEL_INFO=$((USER_LIST + 1))
SEL_ELIST=$((SEL_INFO + 1))
SEL_GET=$((SEL_ELIST + 1))
SEL_DELETE=$((SEL_GET + 1))
SEL_CLEAR=$((SEL_DELETE + 1))
SEL_TIME_GET=$((SEL_CLEAR + 1))
SEL_TIME_SET=$((SEL_TIME_GET + 1))
CLEAR_SBIOS=$((SEL_TIME_SET + 1))
BMC_REBOOT=$((CLEAR_SBIOS + 1))
BMC_RESTORE=$((BMC_REBOOT + 1))

print_help() {
  cat <<'EOF'
Usage:
  ./ipmi.sh [target flags] [modifier flags] [ipmi arguments...]
  ./ipmi.sh [target flags] [modifier flags] -n CODE [ARG]
  ./ipmi.sh [target flags] [modifier flags] [SHORTCUT_FLAG] [ARG]

Target Flags:
  -t SERVICE_TAG    Pull BMC MAC and config from backend, then resolve BMC IP
  -i BMC_IP         Use BMC IP directly
  -m BMC_MAC        Resolve BMC IP from DHCP lease using BMC MAC

Modifier Flags:
  -c CONFIG         Sets the target config used to choose IPMI credentials
  -n CODE           Run the legacy shortcut codes instead of raw ipmitool args
  -l                List available shortcut codes and string flags
  -h                Show this help text

Notes:
  - If no -t/-i/-m target is provided, the script prompts for a Service Tag.
  - -t, -i, and -m are mutually exclusive.
  - -c cannot be used with -t. Service Tag mode pulls config from backend.
  - -n flag cannot be used with raw ipmitool arguments.
  - If no raw ipmitool arguments are provided, defaults to "chassis power status"

Run ./ipmi.sh -l to list available shortcut codes and string flags.

Examples:
  ./ipmi.sh -t TESTYB4
  ./ipmi.sh -t TESTYB4 chassis power on
  ./ipmi.sh -i 192.168.1.50 -c F chassis power status
  ./ipmi.sh -m aabbccddeeff -c 7 chassis power status
  ./ipmi.sh -t TESTYB4 -n 11 0
  ./ipmi.sh -t TESTYB4 --fru-print 0
  ./ipmi.sh -t TESTYB4 --sdr-elist fan
  ./ipmi.sh -l
EOF
}

print_shortcut_list() {
  printf 'Available -n Codes:\n'
  printf '  %-3s %-18s %s\n' "${POWER_STATUS}." "power status" "--power-status"
  printf '  %-3s %-18s %s\n' "${POWER_ON}." "power on" "--power-on"
  printf '  %-3s %-18s %s\n' "${POWER_OFF}." "power off" "--power-off"
  printf '  %-3s %-18s %s\n' "${POWER_CYCLE}." "power cycle" "--power-cycle"
  printf '  %-3s %-18s %s\n' "${POWER_RESET}." "power reset" "--power-reset"
  printf '  %-3s %-18s %s\n' "${SERIAL_NUMBER}." "serial number" "--serial-number"
  printf '  %-3s %-18s %s\n' "${BMC_INFO}." "bmc info" "--bmc-info"
  printf '  %-3s %-18s %s\n' "${BMC_GUID}." "bmc guid" "--bmc-guid"
  printf '  %-3s %-18s %s\n' "${BMC_RESET_COLD}." "bmc reset cold" "--bmc-reset-cold"
  printf '  %-3s %-18s %s\n' "${BMC_SELFTEST}." "bmc selftest" "--bmc-selftest"
  printf '  %-3s %-18s %s\n' "${FRU_PRINT}." "fru print" "--fru-print [fru_id]"
  printf '  %-3s %-18s %s\n' "${SDR_INFO}." "sdr info" "--sdr-info"
  printf '  %-3s %-18s %s\n' "${SDR_TYPE_LIST}." "sdr type list" "--sdr-type-list"
  printf '  %-3s %-18s %s\n' "${SDR_TYPE_TYPE}." "sdr type type" "--sdr-type-type [SENSOR_TYPE]"
  printf '  %-3s %-18s %s\n' "${SDR_GET}." "sdr get" "--sdr-get [SENSOR_ID]"
  printf '  %-3s %-18s %s\n' "${SDR_ELIST}." "sdr elist" "--sdr-elist [filter]"
  printf '  %-3s %-18s %s\n' "${SDR_LIST}." "sdr list" "--sdr-list [filter]"
  printf '  %-3s %-18s %s\n' "${SENSOR_LIST}." "sensor list" "--sensor-list [filter]"
  printf '  %-3s %-18s %s\n' "${LAN_PRINT}." "lan print" "--lan-print"
  printf '  %-3s %-18s %s\n' "${USER_LIST}." "user list" "--user-list"
  printf '  %-3s %-18s %s\n' "${SEL_INFO}." "sel info" "--sel-info"
  printf '  %-3s %-18s %s\n' "${SEL_ELIST}." "sel elist" "--sel-elist [filter]"
  printf '  %-3s %-18s %s\n' "${SEL_GET}." "sel get" "--sel-get [ID]"
  printf '  %-3s %-18s %s\n' "${SEL_DELETE}." "sel delete" "--sel-delete [ID]"
  printf '  %-3s %-18s %s\n' "${SEL_CLEAR}." "sel clear" "--sel-clear"
  printf '  %-3s %-18s %s\n' "${SEL_TIME_GET}." "sel time get" "--sel-time-get"
  printf '  %-3s %-18s %s\n' "${SEL_TIME_SET}." "sel time set" "--sel-time-set [MM/DD/YYYY HH:MM:SS]"
  printf '  %-3s %-18s %s\n' "${CLEAR_SBIOS}." "clear sbios" "--clear-sbios"
  printf '  %-3s %-18s %s\n' "${BMC_REBOOT}." "bmc reboot" "--bmc-reboot"
  printf '  %-3s %-18s %s\n' "${BMC_RESTORE}." "bmc restore" "--bmc-restore"
}

is_valid_ip() {
  local ip="$1"
  local ip_regex="^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$"
  [[ "$ip" =~ $ip_regex ]]
}

set_shortcut_code() {
  local code="$1"
  local name="$2"

  if [[ -n "$SHORTCUT_CODE" ]]; then
    err "Use only one shortcut command per invocation."
    exit 1
  fi

  SHORTCUT_CODE="$code"
  SHORTCUT_NAME="$name"
}

shortcut_code_for_flag() {
  case "$1" in
    --power-status) printf '%s\n' "$POWER_STATUS" ;;
    --power-on) printf '%s\n' "$POWER_ON" ;;
    --power-off) printf '%s\n' "$POWER_OFF" ;;
    --power-cycle) printf '%s\n' "$POWER_CYCLE" ;;
    --power-reset) printf '%s\n' "$POWER_RESET" ;;
    --serial-number) printf '%s\n' "$SERIAL_NUMBER" ;;
    --bmc-info) printf '%s\n' "$BMC_INFO" ;;
    --bmc-guid) printf '%s\n' "$BMC_GUID" ;;
    --bmc-reset-cold) printf '%s\n' "$BMC_RESET_COLD" ;;
    --bmc-selftest) printf '%s\n' "$BMC_SELFTEST" ;;
    --fru-print) printf '%s\n' "$FRU_PRINT" ;;
    --sdr-info) printf '%s\n' "$SDR_INFO" ;;
    --sdr-type-list) printf '%s\n' "$SDR_TYPE_LIST" ;;
    --sdr-type-type) printf '%s\n' "$SDR_TYPE_TYPE" ;;
    --sdr-get) printf '%s\n' "$SDR_GET" ;;
    --sdr-elist) printf '%s\n' "$SDR_ELIST" ;;
    --sdr-list) printf '%s\n' "$SDR_LIST" ;;
    --sensor-list) printf '%s\n' "$SENSOR_LIST" ;;
    --sol-activate) printf '%s\n' "$SOL_ACTIVATE" ;;
    --sol-deactivate) printf '%s\n' "$SOL_DEACTIVATE" ;;
    --lan-print) printf '%s\n' "$LAN_PRINT" ;;
    --user-list) printf '%s\n' "$USER_LIST" ;;
    --sel-info) printf '%s\n' "$SEL_INFO" ;;
    --sel-elist) printf '%s\n' "$SEL_ELIST" ;;
    --sel-get) printf '%s\n' "$SEL_GET" ;;
    --sel-delete) printf '%s\n' "$SEL_DELETE" ;;
    --sel-clear) printf '%s\n' "$SEL_CLEAR" ;;
    --sel-time-get) printf '%s\n' "$SEL_TIME_GET" ;;
    --sel-time-set) printf '%s\n' "$SEL_TIME_SET" ;;
    --clear-sbios) printf '%s\n' "$CLEAR_SBIOS" ;;
    --bmc-reboot) printf '%s\n' "$BMC_REBOOT" ;;
    --bmc-restore) printf '%s\n' "$BMC_RESTORE" ;;
    *)
      return 1
      ;;
  esac
}

is_enabled_shortcut_code() {
  case "$1" in
    "$POWER_STATUS"|"$POWER_ON"|"$POWER_OFF"|"$POWER_CYCLE"|"$POWER_RESET"|"$SERIAL_NUMBER"|"$BMC_INFO"|"$BMC_GUID"|"$BMC_RESET_COLD"|"$BMC_SELFTEST"|"$FRU_PRINT"|"$SDR_INFO"|"$SDR_TYPE_LIST"|"$SDR_TYPE_TYPE"|"$SDR_GET"|"$SDR_ELIST"|"$SDR_LIST"|"$SENSOR_LIST"|"$LAN_PRINT"|"$USER_LIST"|"$SEL_INFO"|"$SEL_ELIST"|"$SEL_GET"|"$SEL_DELETE"|"$SEL_CLEAR"|"$SEL_TIME_GET"|"$SEL_TIME_SET"|"$CLEAR_SBIOS"|"$BMC_REBOOT"|"$BMC_RESTORE")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

shortcut_arg_rule() {
  case "$1" in
    "$POWER_STATUS"|"$POWER_ON"|"$POWER_OFF"|"$POWER_CYCLE")
      printf 'none\n'
      ;;
    "$POWER_RESET"|"$SERIAL_NUMBER"|"$BMC_INFO"|"$BMC_GUID"|"$BMC_RESET_COLD"|"$BMC_SELFTEST")
      printf 'none\n'
      ;;
    "$FRU_PRINT")
      printf 'optional\n'
      ;;
    "$SDR_INFO"|"$SDR_TYPE_LIST")
      printf 'none\n'
      ;;
    "$SDR_TYPE_TYPE"|"$SDR_GET")
      printf 'required\n'
      ;;
    "$SDR_ELIST")
      printf 'optional\n'
      ;;
    "$SDR_LIST"|"$SENSOR_LIST")
      printf 'optional\n'
      ;;
    "$SOL_ACTIVATE"|"$SOL_DEACTIVATE"|"$LAN_PRINT"|"$USER_LIST"|"$SEL_INFO")
      printf 'none\n'
      ;;
    "$SEL_ELIST")
      printf 'optional\n'
      ;;
    "$SEL_GET"|"$SEL_DELETE")
      printf 'required\n'
      ;;
    "$SEL_CLEAR"|"$SEL_TIME_GET")
      printf 'none\n'
      ;;
    "$SEL_TIME_SET")
      printf 'rest\n'
      ;;
    "$CLEAR_SBIOS"|"$BMC_REBOOT"|"$BMC_RESTORE")
      printf 'none\n'
      ;;
    *)
      printf 'unsupported\n'
      ;;
  esac
}

execute_shortcut() {
  case "$SHORTCUT_CODE" in
    "$POWER_STATUS")
      ipmi chassis power status
      ;;
    "$POWER_ON")
      ipmi chassis power on
      ;;
    "$POWER_OFF")
      ipmi chassis power off
      ;;
    "$POWER_CYCLE")
      ipmi chassis power cycle
      ;;
    "$POWER_RESET")
      ipmi chassis power reset
      ;;
    "$SERIAL_NUMBER")
      ipmi fru print 0 | grep "Product Serial"
      ;;
    "$BMC_INFO")
      ipmi mc info
      ;;
    "$BMC_GUID")
      ipmi mc guid
      ;;
    "$BMC_RESET_COLD")
      ipmi mc reset cold
      ;;
    "$BMC_SELFTEST")
      ipmi mc selftest
      ;;
    "$FRU_PRINT")
      if [[ ${#SHORTCUT_ARGS[@]} -eq 1 ]]; then
        ipmi fru print "${SHORTCUT_ARGS[0]}"
      else
        ipmi fru print
      fi
      ;;
    "$SDR_INFO")
      ipmi sdr info
      ;;
    "$SDR_TYPE_LIST")
      ipmi sdr type list
      ;;
    "$SDR_TYPE_TYPE")
      ipmi sdr type "${SHORTCUT_ARGS[0]}"
      ;;
    "$SDR_GET")
      ipmi sdr get "${SHORTCUT_ARGS[0]}"
      ;;
    "$SDR_ELIST")
      if [[ ${#SHORTCUT_ARGS[@]} -eq 1 ]]; then
        ipmi sdr elist | grep -i -- "${SHORTCUT_ARGS[0]}"
      else
        ipmi sdr elist
      fi
      ;;
    "$SDR_LIST")
      if [[ ${#SHORTCUT_ARGS[@]} -eq 1 ]]; then
        ipmi sdr list | grep -i -- "${SHORTCUT_ARGS[0]}"
      else
        ipmi sdr list
      fi
      ;;
    "$SENSOR_LIST")
      if [[ ${#SHORTCUT_ARGS[@]} -eq 1 ]]; then
        ipmi sensor list | grep -i -- "${SHORTCUT_ARGS[0]}"
      else
        ipmi sensor list
      fi
      ;;
    "$SOL_ACTIVATE")
      ipmi sol activate
      ;;
    "$SOL_DEACTIVATE")
      ipmi sol deactivate
      ;;
    "$LAN_PRINT")
      ipmi lan print
      ;;
    "$USER_LIST")
      ipmi user list
      ;;
    "$SEL_INFO")
      ipmi sel info
      ;;
    "$SEL_ELIST")
      if [[ ${#SHORTCUT_ARGS[@]} -eq 1 ]]; then
        ipmi sel elist | grep -i -- "${SHORTCUT_ARGS[0]}"
      else
        ipmi sel elist
      fi
      ;;
    "$SEL_GET")
      ipmi sel get "${SHORTCUT_ARGS[0]}"
      ;;
    "$SEL_DELETE")
      ipmi sel delete "${SHORTCUT_ARGS[0]}"
      ;;
    "$SEL_CLEAR")
      ipmi sel clear
      ;;
    "$SEL_TIME_GET")
      ipmi sel time get
      ;;
    "$SEL_TIME_SET")
      ipmi sel time set "${SHORTCUT_ARGS[@]}"
      ;;
    "$CLEAR_SBIOS")
      ipmi chassis bootdev none clear-cmos=yes
      ;;
    "$BMC_REBOOT")
      ipmi raw 0x6 0x2
      ;;
    "$BMC_RESTORE")
      ipmi raw 0x32 0x66
      ;;
    *)
      err "Shortcut code $SHORTCUT_CODE is not supported."
      exit 1
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|-T)
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
    -c)
      shift
      if [[ $# -eq 0 || "$1" == -* ]]; then
        err "-c requires a config value."
        exit 1
      fi
      CONFIG="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
      shift
      ;;
    -n)
      shift
      if [[ $# -eq 0 || "$1" == -* ]]; then
        err "-n requires a shortcut code."
        exit 1
      fi
      if ! is_enabled_shortcut_code "$1"; then
        err "Shortcut code $1 is not enabled in ipmi.sh."
        exit 1
      fi
      set_shortcut_code "$1" "code-$1"
      shift
      ;;
    -l|-L|--list)
      print_shortcut_list
      exit 0
      ;;
    -h|-H|--help)
      print_help
      exit 0
      ;;
    --*)
      if shortcut_flag_code="$(shortcut_code_for_flag "$1")"; then
        if ! is_enabled_shortcut_code "$shortcut_flag_code"; then
          err "Shortcut flag $1 is not enabled in ipmi.sh."
          exit 1
        fi
        set_shortcut_code "$shortcut_flag_code" "$1"
        shift
      else
        err "Unknown option: $1"
        print_help
        exit 1
      fi
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

IPMI_ARGS=()
SHORTCUT_ARGS=()

if [[ -n "$SHORTCUT_CODE" ]]; then
  SHORTCUT_ARGS=("$@")
else
  IPMI_ARGS=("$@")
  if [[ ${#IPMI_ARGS[@]} -eq 0 ]]; then
    IPMI_ARGS=(chassis power status)
  fi
fi

require_cmd ipmitool
require_cmd jq
require_cmd curl

target_count=0
[[ -n "$SERVICE_TAG" ]] && target_count=$((target_count + 1))
[[ -n "$BMC_IP" ]] && target_count=$((target_count + 1))
[[ -n "$BMC_MAC" ]] && target_count=$((target_count + 1))

if ((target_count > 1)); then
  err "Use only one target: -t, -i, or -m."
  exit 1
fi

if [[ -n "$SERVICE_TAG" && -n "$CONFIG" ]]; then
  err "Do not use -c with -t. Service tag mode pulls config from backend."
  exit 1
fi

if ((target_count == 0)); then
  SERVICE_TAG="$(prompt_service_tag)"
fi

if [[ -n "$SERVICE_TAG" ]]; then
  require_server_location
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
  require_server_location
  require_cmd fzf
  CONFIG="$(pick_config_from_backend)"
  if [[ -z "$CONFIG" ]]; then
    err "No config selected."
    exit 1
  fi
fi

if [[ -n "$SHORTCUT_CODE" && ${#IPMI_ARGS[@]} -gt 0 ]]; then
  err "Shortcut mode cannot be mixed with raw ipmitool arguments."
  exit 1
fi

echo "BMC_IP=$BMC_IP"
echo "CONFIG=$CONFIG"

if [[ -n "$SHORTCUT_CODE" ]]; then
  shortcut_rule="$(shortcut_arg_rule "$SHORTCUT_CODE")"
  case "$shortcut_rule" in
    none)
      if [[ ${#SHORTCUT_ARGS[@]} -ne 0 ]]; then
        err "$SHORTCUT_NAME does not accept an extra argument."
        exit 1
      fi
      ;;
    required)
      if [[ ${#SHORTCUT_ARGS[@]} -ne 1 ]]; then
        err "$SHORTCUT_NAME requires exactly one argument."
        exit 1
      fi
      ;;
    optional)
      if [[ ${#SHORTCUT_ARGS[@]} -gt 1 ]]; then
        err "$SHORTCUT_NAME accepts at most one optional argument."
        exit 1
      fi
      ;;
    rest)
      if [[ ${#SHORTCUT_ARGS[@]} -eq 0 ]]; then
        err "$SHORTCUT_NAME requires at least one argument."
        exit 1
      fi
      ;;
    *)
      err "Shortcut code $SHORTCUT_CODE is not supported."
      exit 1
      ;;
  esac

  execute_shortcut
else
  ipmi "${IPMI_ARGS[@]}"
fi

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
#   Philip Phan - philip_phan@wistron.com
