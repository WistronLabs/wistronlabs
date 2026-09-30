#!/usr/bin/env bash
set -euo pipefail

test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/proc" "$test_dir/bin"

process() {
    local pid="$1" name="$2" parent="$3"
    mkdir -p "$test_dir/proc/$pid"
    printf '%s\n' "$name" > "$test_dir/proc/$pid/comm"
    printf 'Name:\t%s\nPPid:\t%s\n' "$name" "$parent" > "$test_dir/proc/$pid/status"
}

process 100 ttyd 1
process 200 tmux 100
process 101 sshd 1
process 300 tmux 101

cat > "$test_dir/bin/tmux" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "list-clients" ]]; then
    printf '/dev/pts/1|200\n/dev/pts/2|300\n/dev/pts/3|400\n'
elif [[ "$1" == "switch-client" ]]; then
    printf '%s\n' "$*" >> "$TMUX_TEST_LOG"
else
    exit 1
fi
EOF
chmod +x "$test_dir/bin/tmux"

export PATH="$test_dir/bin:$PATH"
export TMUX_TEST_LOG="$test_dir/switches"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.lib/terminal_client_handoff.sh"
wistron_switch_native_clients stn_12 bs_aabbccddeeff "$test_dir/proc"

actual="$(cat "$TMUX_TEST_LOG")"
expected='switch-client -c /dev/pts/2 -t =bs_aabbccddeeff'
[[ "$actual" == "$expected" ]] || { printf 'Unexpected switches: %s\n' "$actual" >&2; exit 1; }
printf 'Native tmux client switched; website and unknown clients stayed on station.\n'
