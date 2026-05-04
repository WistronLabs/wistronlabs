#!/bin/bash

set -euo pipefail

RED='\033[0;31m'
NC='\033[0m'

LIVE_MODE=0
LIVE_CHILD=0
LIVE_BIOS_CHILD=0
AUTO_MODE=0
SERVICE_TAG=""

err() {
  echo -e "${RED}Error:${NC} $*" >&2
}

print_help() {
  cat <<'EOF'
Usage:
  ./boot.sh [options]

Options:
  -a, --auto [SERVICE_TAG]
                 Auto mode: pull BMC MAC, Host MAC, and config from backend.
                 If SERVICE_TAG is omitted, you will be prompted for it.
  -l, --live     Live mode: show boot progress and BIOS serial side by side in tmux
  -h, --help     Show this help and exit

What it does:
  - Prompts for BMC MAC and Host MAC as 12 hex characters with no separators
  - Fetches unique configs from the backend and lets you pick one with fzf
  - Writes the matching PXE grub config
  - Waits for BMC and host networking
  - Boots the unit into the Wistron PXE OS
  - Verifies SSH key auth as nvidia

Default mode:
  SSHs into nvidia@HOST_IP when boot is ready.

Live mode:
  Opens tmux with boot progress on the left and BIOS serial on the right.

Examples:
  ./boot.sh
  ./boot.sh -l
  ./boot.sh -a ABC1234
  ./boot.sh -l -a ABC1234
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "$1 is required but not installed."
    exit 1
  fi
}

prompt_mac() {
  local label="$1"
  local value

  while true; do
    read -r -p "$label MAC: " value
    value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
    if [[ "$value" =~ ^[0-9a-f]{12}$ ]]; then
      printf '%s\n' "$value"
      return 0
    fi
    err "Invalid MAC address. Enter exactly 12 hex characters with no separators."
  done
}

mac_colon() {
  printf '%s' "$1" | sed 's/\(..\)/\1:/g; s/:$//'
}

mac_dash() {
  printf '%s' "$1" | sed 's/\(..\)/\1-/g; s/-$//'
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

prompt_service_tag() {
  local value

  while true; do
    read -r -p "Service Tag: " value
    value="$(printf '%s' "$value" | tr '[:lower:]' '[:upper:]' | xargs)"
    if [[ -n "$value" ]]; then
      printf '%s\n' "$value"
      return 0
    fi
    err "Service Tag cannot be empty."
  done
}

check_environment() {
  if [[ -z "${SERVER_LOCATION:-}" ]]; then
    err "Environment variable SERVER_LOCATION is not set."
    echo "       Please export SERVER_LOCATION in your shell, for example: export SERVER_LOCATION=frk" >&2
    exit 1
  fi
}

load_auto_inputs() {
  local api_base tmp_json http_code sys_json bmc_raw host_raw config_raw

  require_cmd curl
  require_cmd jq

  if [[ -z "$SERVICE_TAG" ]]; then
    SERVICE_TAG="$(prompt_service_tag)"
  else
    SERVICE_TAG="$(printf '%s' "$SERVICE_TAG" | tr '[:lower:]' '[:upper:]' | xargs)"
  fi

  api_base="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1"
  tmp_json="$(mktemp)"
  http_code="$(curl -sS --max-time 5 -o "$tmp_json" -w "%{http_code}" \
    "$api_base/systems/$SERVICE_TAG" 2>/dev/null || true)"

  if [[ "$http_code" != "200" ]]; then
    rm -f "$tmp_json"
    case "$http_code" in
      404) err "System $SERVICE_TAG not found in tracking website." ;;
      *) err "Backend returned HTTP $http_code when fetching $SERVICE_TAG." ;;
    esac
    exit 1
  fi

  sys_json="$(cat "$tmp_json")"
  rm -f "$tmp_json"

  bmc_raw="$(printf '%s' "$sys_json" | jq -r '.bmc_mac // empty')"
  host_raw="$(printf '%s' "$sys_json" | jq -r '.host_mac // empty')"
  config_raw="$(printf '%s' "$sys_json" | jq -r '.config // empty')"

  if ! BMC_MAC="$(normalize_mac_hex12 "$bmc_raw")"; then
    err "BMC MAC is missing or invalid for $SERVICE_TAG."
    exit 1
  fi

  if ! HOST_MAC="$(normalize_mac_hex12 "$host_raw")"; then
    err "Host MAC is missing or invalid for $SERVICE_TAG."
    exit 1
  fi

  if [[ -z "$config_raw" || "$config_raw" == "null" ]]; then
    err "System $SERVICE_TAG has no known config in tracking website."
    exit 1
  fi

  CONFIG="$config_raw"
  export SERVICE_TAG BMC_MAC HOST_MAC CONFIG

  echo
  echo "SERVICE_TAG=$SERVICE_TAG"
  echo "BMC_MAC=$BMC_MAC"
  echo "HOST_MAC=$HOST_MAC"
  echo "CONFIG=$CONFIG"
}

load_inputs() {
  local api_base dpn_json

  require_cmd curl
  require_cmd jq
  require_cmd fzf

  api_base="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1"

  BMC_MAC="$(prompt_mac "BMC")"
  HOST_MAC="$(prompt_mac "Host")"

  dpn_json="$(curl -fsS --max-time 10 "$api_base/systems/dpn")"

  CONFIG="$(
    printf '%s\n' "$dpn_json" |
      jq -r '.[].config // empty' |
      awk 'NF' |
      sort -u |
      fzf --prompt='Config> ' --height=10 --border
  )"

  if [[ -z "$CONFIG" ]]; then
    err "No config selected."
    exit 1
  fi

  export BMC_MAC HOST_MAC CONFIG

  echo
  echo "BMC_MAC=$BMC_MAC"
  echo "HOST_MAC=$HOST_MAC"
  echo "CONFIG=$CONFIG"
}

validate_child_inputs() {
  if [[ ! "${BMC_MAC:-}" =~ ^[0-9a-fA-F]{12}$ ]]; then
    err "BMC_MAC must be set to exactly 12 hex characters for live child mode."
    exit 1
  fi
  if [[ ! "${HOST_MAC:-}" =~ ^[0-9a-fA-F]{12}$ ]]; then
    err "HOST_MAC must be set to exactly 12 hex characters for live child mode."
    exit 1
  fi
  if [[ -z "${CONFIG:-}" ]]; then
    err "CONFIG must be set for live child mode."
    exit 1
  fi

  BMC_MAC="$(printf '%s' "$BMC_MAC" | tr '[:upper:]' '[:lower:]')"
  HOST_MAC="$(printf '%s' "$HOST_MAC" | tr '[:upper:]' '[:lower:]')"
  export BMC_MAC HOST_MAC CONFIG
}

start_live_tmux() {
  local session_name script_dir left_cmd right_cmd pane_count boot_done boot_pane_text

  require_cmd tmux
  require_cmd ssh
  require_cmd ssh-keyscan

  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ ! -x "$script_dir/bios_serial.sh" ]]; then
    err "Expected executable BIOS serial script at $script_dir/bios_serial.sh"
    exit 1
  fi

  session_name="boot_${HOST_MAC}"

  if tmux has-session -t "$session_name" 2>/dev/null; then
    pane_count="$(tmux list-panes -t "$session_name:0" 2>/dev/null | wc -l | xargs)"
    boot_done="$(tmux show-option -qv -t "$session_name" @boot_done 2>/dev/null || true)"
    boot_pane_text="$(tmux capture-pane -p -t "$session_name:0.0" -S -80 2>/dev/null || true)"

    if ((pane_count >= 2)) &&
      [[ "$boot_done" != "1" ]] &&
      [[ "$boot_pane_text" != *"Boot pane finished. Press Enter to close..."* ]]; then
      tmux attach -t "$session_name"
      exit 0
    fi

    if [[ "$boot_done" == "1" ]] ||
      [[ "$boot_pane_text" == *"Boot pane finished. Press Enter to close..."* ]]; then
      echo "INFO - Existing $session_name boot pane already finished; recreating live layout."
    else
      echo "INFO - Existing $session_name session has only $pane_count pane; recreating live layout."
    fi
    tmux kill-session -t "$session_name"
  fi

  if tmux has-session -t "$session_name" 2>/dev/null; then
    tmux attach -t "$session_name"
    exit 0
  fi

  left_cmd="cd '$script_dir' && SERVER_LOCATION='$SERVER_LOCATION' BMC_MAC='$BMC_MAC' HOST_MAC='$HOST_MAC' CONFIG='$CONFIG' ./boot.sh --live-child; tmux set-option -t '$session_name' @boot_done 1; echo; read -r -p 'Boot pane finished. Press Enter to close...'"
  right_cmd="cd '$script_dir' && SERVER_LOCATION='$SERVER_LOCATION' BMC_MAC='$BMC_MAC' ./boot.sh --live-bios-child; echo; read -r -p 'BIOS pane finished. Press Enter to close...'"

  tmux new-session -d -s "$session_name" -n boot "$left_cmd"
  tmux set-option -t "$session_name" @boot_done 0
  tmux split-window -h -t "$session_name:0" "$right_cmd"
  tmux select-layout -t "$session_name:0" even-horizontal
  tmux select-pane -t "$session_name:0.0"
  tmux attach -t "$session_name"
}

run_live_bios_child() {
  local script_dir

  if [[ ! "${BMC_MAC:-}" =~ ^[0-9a-fA-F]{12}$ ]]; then
    err "BMC_MAC must be set to exactly 12 hex characters for live BIOS child mode."
    exit 1
  fi

  BMC_MAC="$(printf '%s' "$BMC_MAC" | tr '[:upper:]' '[:lower:]')"
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  echo "==> Waiting for BMC IP before opening BIOS serial"
  wait_for_bmc_ip

  echo
  echo "==> Opening BIOS serial session for BMC $BMC_MAC"
  exec env -u TMUX SERVER_LOCATION="$SERVER_LOCATION" "$script_dir/bios_serial.sh" -m "$BMC_MAC"
}

write_grub_config() {
  local wis_folder mac_dash out

  wis_folder="config_${CONFIG}"
  mac_dash="$(mac_dash "$HOST_MAC")"
  out="/srv/tftp/grub/grub.cfg-${mac_dash}"

  case "$CONFIG" in
    F)
      tee "$out" >/dev/null <<EOF
set timeout=5

menuentry "${wis_folder} L10 Image" {
    linux (http,192.168.1.2:8080)/${wis_folder}/vmlinuz \
        boot=live root=/dev/ram0 live-netdev=enP5p9s0 \
        fetch=http://192.168.1.2:8080/${wis_folder}/${wis_folder}.iso \
        console=ttyS0,115200 console=tty1 fsck.mode=skip ip=dhcp rw vga=0x314 nomodeset ---
    initrd (http,192.168.1.2:8080)/${wis_folder}/initrd.img
}
EOF
      ;;
    7)
      tee "$out" >/dev/null <<EOF
set timeout=5

menuentry "${wis_folder}L10 Image" {
        linux (http,192.168.1.2:8080)/${wis_folder}/vmlinuz \\
                boot=live live-media-path=/live netboot=http \\
                fetch=http://192.168.1.2:8080/${wis_folder}/filesystem.squashfs \\
                ip=dhcp rw fsck.mode=skip console=ttyS0,115200 console=tty1 nomodeset ---
        initrd (http,192.168.1.2:8080)/${wis_folder}/initrd.img
}
EOF
      ;;
    2|4|6|A|A1|B|H1)
      tee "$out" >/dev/null <<EOF
set timeout=5

menuentry "Configs 2-6 A,B Wistron Image (RAM)" {
        linux   (http,192.168.1.2:8080)/wis_vmlinuz ip=dhcp root=/dev/nfs nfsroot=192.168.1.2:/srv/tftp/wis_rootfs_copy
        initrd  (http,192.168.1.2:8080)/wis_initrd_1
}
EOF
      ;;
    *)
      err "No grub.cfg template defined for config $CONFIG"
      exit 1
      ;;
  esac

  chmod 0644 "$out"
  echo "Wrote: $out"
}

ipmi() {
  if [[ "${CONFIG:-}" == "F" ]]; then
    ipmitool -I lanplus -H "$BMC_IP" -U root -P 0penBmc -C 17 "$@"
  else
    ipmitool -I lanplus -H "$BMC_IP" -U admin -P admin "$@"
  fi
}

bmc_check_cmd() {
  if [[ "${CONFIG:-}" == "7" ]]; then
    sshpass -p changeme ssh \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=5 \
      -o LogLevel=ERROR \
      root@"$BMC_IP" 'exit' >/dev/null 2>&1
  else
    ipmi chassis power status >/dev/null 2>&1
  fi
}

wait_for_bmc_ip() {
  local bmc_mac_colon start current elapsed

  bmc_mac_colon="$(mac_colon "$BMC_MAC")"
  start="$(date +%s)"

  while true; do
    current="$(date +%s)"
    elapsed=$((current - start))

    if ((elapsed > 5 * 60)); then
      err "It is taking too long to get a BMC IP, please check the system"
      echo "Possible issues: system is not on, hardware issue"
      exit 1
    fi

    BMC_IP=$(awk -v mac="$bmc_mac_colon" '
      /lease/ {ip=$2}
      /hardware ethernet/ {gsub(";", "", $3); if ($3 == mac) print ip}
      found && /}/ {print ip; found=0}
    ' /var/lib/dhcp/dhcpd.leases | tail -n 1)

    if [[ -n "$BMC_IP" ]]; then
      echo "IP Address for BMC: $BMC_IP"
      return 0
    fi

    printf "%02dh %02dm %02ds - Waiting for BMC IP assignment...\n" \
      $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60))
    sleep 5
  done
}

wait_for_bmc_response() {
  local start current elapsed

  start="$(date +%s)"

  while ! bmc_check_cmd; do
    current="$(date +%s)"
    elapsed=$((current - start))

    if ((elapsed > 5 * 60)); then
      err "It is taking too long to get a valid BMC response"
      echo "This is most likely a BMC hardware issue"
      exit 1
    fi

    echo
    printf "%02dh %02dm %02ds - Waiting for valid BMC response......\n" \
      $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60))
    sleep 5
  done

  echo "INFO - IPMI response received!"
}

power_on_system() {
  if [[ "${CONFIG:-}" == "7" ]]; then
    echo "INFO - Powering on system"
    sshpass -p changeme ssh -tt \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=5 \
      -o LogLevel=ERROR \
      root@"$BMC_IP" 'start -script /SYS'
  else
    echo "INFO - Changing Boot Device to PXE"
    ipmi chassis bootdev pxe

    echo
    echo "INFO - Powering on system"
    ipmi chassis power on
  fi
}

wait_for_host_ip() {
  local host_mac_colon start current elapsed

  host_mac_colon="$(mac_colon "$HOST_MAC")"
  start="$(date +%s)"

  while true; do
    current="$(date +%s)"
    elapsed=$((current - start))

    if ((elapsed > 10 * 60)); then
      echo
      echo "INFO - Recording FRU Data"
      if [[ "${CONFIG:-}" != "7" ]]; then
        ipmi fru print
      fi
      echo

      err "It is taking too long to get a HOST IP, please check if the host is on"
      echo "Recommended Action:"
      echo "  - Re-run this boot.sh while monitoring the system via BIOS serial to confirm the system is booting correctly."
      echo "  - You can monitor the BIOS serial output using:"
      echo "      ./bios_serial <-i IP_ADDRESS | -m MAC_ADDRESS>"
      echo
      exit 1
    fi

    HOST_IP=$(awk -v mac="$host_mac_colon" '
      /lease/ {ip=$2}
      /hardware ethernet/ {gsub(";", "", $3); if ($3 == mac) print ip}
      found && /}/ {print ip; found=0}
    ' /var/lib/dhcp/dhcpd.leases | tail -n 1)

    if [[ -n "$HOST_IP" ]]; then
      echo "IP Address for HOST: $HOST_IP"
      return 0
    fi

    printf "%02dh %02dm %02ds - Waiting for Host IP assignment...\n" \
      $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60))
    sleep 5
  done
}

ssh_ready() {
  ssh \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o ConnectionAttempts=1 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o PreferredAuthentications=publickey \
    -o PasswordAuthentication=no \
    nvidia@"$HOST_IP" 'echo READY' >/dev/null 2>&1
}

wait_for_ssh_ready() {
  local start now elapsed

  start="$(date +%s)"

  while ! ssh_ready; do
    now="$(date +%s)"
    elapsed=$((now - start))

    if ((elapsed > 15 * 60)); then
      echo
      echo "INFO - Recording FRU Data"
      if [[ "${CONFIG:-}" != "7" ]]; then
        ipmi fru print
      fi
      echo

      err "SSH is not fully up (handshake/command) on $HOST_IP after 900 seconds."
      echo "Note: port 22 may be open before sshd is ready (banner exchange timeouts)."
      exit 1
    fi

    printf "%02dh %02dm %02ds - Waiting for SSH handshake/command on HOST %s...\n" \
      $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60)) "$HOST_IP"
    sleep 5
  done

  echo "INFO - SSH is fully up on $HOST_IP"
}

check_key_auth() {
  echo "INFO - Adding SSH host to known_hosts file"
  ssh-keyscan -H "$HOST_IP" >> ~/.ssh/known_hosts 2>/dev/null
  echo

  # check if the authentication key works when SSHing into the Gaines system
  # if it does not work, its 99% not in the right OS (like the stock Ubuntu OS that it comes with)
  if ! ssh -o BatchMode=yes -o ConnectTimeout=5 nvidia@"$HOST_IP" "exit" 2>/dev/null; then
    err "SSH key authentication to nvidia@$HOST_IP failed."
    echo "Possible Cause: The target system is not running the Wistron L10 PXE OS."
    echo "Recommended Action:"
    echo "  - Re-run this boot.sh while monitoring the system via BIOS serial to confirm the correct OS is loaded."
    echo "  - You can monitor the BIOS serial output using:"
    echo "      ./bios_serial <-i IP_ADDRESS | -m MAC_ADDRESS>"
    echo

    if [[ "${CONFIG:-}" != "7" ]]; then
      echo "INFO - Changing Boot Device to PXE"
      ipmi chassis bootdev pxe
      echo
      echo "Powering off system"
      ipmi chassis power off
    fi
    exit 1
  fi

  echo "INFO - SSH key authentication works."
}

run_boot_flow() {
  require_cmd ssh
  require_cmd ssh-keyscan

  if [[ "${CONFIG:-}" == "7" ]]; then
    require_cmd sshpass
  else
    require_cmd ipmitool
  fi

  echo
  echo "==> Write the matching grub config"
  write_grub_config

  echo
  echo "==> Wait for BMC IP"
  wait_for_bmc_ip

  echo
  echo "==> Wait for valid BMC/IPMI response"
  wait_for_bmc_response

  echo
  echo "==> Set PXE boot and power on"
  power_on_system

  echo
  echo "==> Wait for host IP"
  wait_for_host_ip

  echo
  echo "==> Wait for SSH readiness"
  wait_for_ssh_ready

  echo
  echo "==> Add host to known_hosts and check key auth"
  check_key_auth

  if [[ "$LIVE_CHILD" == "1" ]]; then
    echo
    echo "INFO - Boot flow complete. SSH is ready:"
    echo "       ssh nvidia@$HOST_IP"
    return 0
  fi

  echo "INFO - SSHing into nvidia@$HOST_IP"
  exec ssh nvidia@"$HOST_IP"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--auto)
      AUTO_MODE=1
      shift
      if [[ $# -gt 0 && "$1" != -* ]]; then
        SERVICE_TAG="$1"
        shift
      fi
      ;;
    -l|--live)
      LIVE_MODE=1
      shift
      ;;
    --live-child)
      LIVE_CHILD=1
      shift
      ;;
    --live-bios-child)
      LIVE_BIOS_CHILD=1
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      err "Unknown option: $1"
      print_help
      exit 1
      ;;
  esac
done

check_environment

if [[ "$LIVE_BIOS_CHILD" == "1" ]]; then
  run_live_bios_child
  exit 0
fi

if [[ "$LIVE_CHILD" == "1" ]]; then
  validate_child_inputs
  run_boot_flow
  exit 0
fi

if [[ "$AUTO_MODE" == "1" ]]; then
  load_auto_inputs
else
  load_inputs
fi

if [[ "$LIVE_MODE" == "1" ]]; then
  start_live_tmux
  exit 0
fi

run_boot_flow
