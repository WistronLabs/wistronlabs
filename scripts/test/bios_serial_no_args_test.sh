#!/usr/bin/env bash
set -euo pipefail

test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/bin"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cat > "$test_dir/bin/tmux" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$BIOS_TEST_TMUX_LOG"
case "$1" in
  display-message) printf 'stn_12\n' ;;
  has-session) exit 0 ;;
  list-clients) exit 0 ;;
  set-option) exit 0 ;;
  *) exit 1 ;;
esac
EOF
cat > "$test_dir/bin/curl" <<'EOF'
#!/usr/bin/env bash
output_file=""
url="${*: -1}"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then output_file="$2"; shift 2; else shift; fi
done
if [[ "$url" == */stations/12 ]]; then
  if [[ "$BIOS_TEST_CASE" == "assigned" ]]; then
    printf '{"system_service_tag":"TAG123"}\n'
  else
    printf '{"system_service_tag":null}\n'
  fi
elif [[ "$url" == */systems/* && "$BIOS_TEST_CASE" == "assigned" ]]; then
  printf '{"bmc_mac":"AABBCCDDEEFF"}\n' > "$output_file"
  printf '200'
elif [[ "$url" == */systems/* ]]; then
  printf '{"error":"not found"}\n' > "$output_file"
  printf '404'
else
  exit 1
fi
EOF
cat > "$test_dir/bin/awk" <<'EOF'
#!/usr/bin/env bash
printf '192.0.2.10\n'
EOF
cat > "$test_dir/bin/date" <<'EOF'
#!/usr/bin/env bash
printf '1234567890123456789\n'
EOF
chmod +x "$test_dir/bin/"*
export PATH="$test_dir/bin:$PATH"
export SERVER_LOCATION=tss INTERNAL_API_KEY=test TMUX=/tmp/test-tmux
export BIOS_TEST_TMUX_LOG="$test_dir/tmux.log"

export BIOS_TEST_CASE=assigned
bash "$script_dir/bios_serial.sh" > "$test_dir/assigned.out"
rg -q 'Using system TAG123 assigned to station 12' "$test_dir/assigned.out"
rg -q 'BIOS serial session bs_aabbccddeeff is ready' "$test_dir/assigned.out"
rg -q 'aabbccddeeff:1234567890123456789' "$BIOS_TEST_TMUX_LOG"

export BIOS_TEST_CASE=fallback
printf 'MISSING\nAA:BB:CC:DD:EE:FF\n' | bash "$script_dir/bios_serial.sh" > "$test_dir/fallback.out"
rg -q 'Enter the service tag' "$test_dir/fallback.out"
rg -q 'BIOS serial session bs_aabbccddeeff is ready' "$test_dir/fallback.out"
printf 'No-argument BIOS lookup and fallback prompts passed.\n'
