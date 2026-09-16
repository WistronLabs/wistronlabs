#!/usr/bin/env bash
set -euo pipefail
# Run from a checkout on the Ubuntu testing host. Does not alter tmux sessions.
if [[ $EUID -ne 0 ]]; then
  echo 'Run with sudo: sudo bash terminal_host/install.sh' >&2
  exit 1
fi
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
id falab >/dev/null
NODE_PATH_FOR_SERVICE="$(command -v node || true)"
if [[ ${1:-} == --node && $# == 2 ]]; then
  NODE_PATH_FOR_SERVICE="$2"
elif [[ $# != 0 ]]; then
  echo 'Usage: sudo bash terminal_host/install.sh [--node /absolute/path/to/node]' >&2
  exit 1
fi
if [[ "$NODE_PATH_FOR_SERVICE" != /* || ! -x "$NODE_PATH_FOR_SERVICE" ]]; then
  echo 'Node is not visible to sudo. If node works as falab, run:' >&2
  echo '  sudo bash terminal_host/install.sh --node "$(command -v node)"' >&2
  exit 1
fi
# Paths are embedded in a systemd unit; reject characters requiring special quoting.
if [[ ! "$NODE_PATH_FOR_SERVICE" =~ ^/[a-zA-Z0-9_./+-]+$ ]]; then
  echo 'Use a Node executable path without spaces or special characters.' >&2
  exit 1
fi
command -v tmux >/dev/null || { echo 'Install tmux first.' >&2; exit 1; }
command -v ttyd >/dev/null || { echo 'Install ttyd 1.7.4+ first.' >&2; exit 1; }
ttyd --help 2>&1 | grep -q -- '--writable' || { echo 'ttyd must support -W/--writable (1.7.4+).' >&2; exit 1; }
"$NODE_PATH_FOR_SERVICE" -e 'if (+process.versions.node.split(".")[0] < 20) process.exit(1)' || { echo 'Node.js 20+ required.' >&2; exit 1; }
install -d -m 0755 /opt/wistron-terminals
install -m 0644 "$ROOT/terminal_host/server.cjs" /opt/wistron-terminals/server.cjs
install -m 0644 "$ROOT/website_backend/src/services/terminalProxy.js" /opt/wistron-terminals/terminalProxy.js
# Resolve executable paths instead of assuming distribution-specific install locations.
TTYD_PATH=$(command -v ttyd)
sed -e "s|ExecStart=/usr/bin/node |ExecStart=$NODE_PATH_FOR_SERVICE |" \
    -e "/Environment=TERMINAL_WORKING_DIRECTORY/a Environment=TTYD_BINARY=$TTYD_PATH" \
    "$ROOT/terminal_host/wistron-terminals.service" > /etc/systemd/system/wistron-terminals.service
systemctl daemon-reload
systemctl enable wistron-terminals.service
systemctl restart wistron-terminals.service
systemctl --no-pager status wistron-terminals.service
