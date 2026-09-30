# shellcheck shell=bash
# Switch ordinary tmux clients after a BIOS handoff while keeping ttyd's
# website clients attached to their station session.

wistron_web_tmux_client() {
    local pid="$1" proc_root="${2:-/proc}" name parent depth=0
    while [[ "$pid" =~ ^[0-9]+$ ]] && ((pid > 1 && depth < 64)); do
        [[ -r "$proc_root/$pid/comm" && -r "$proc_root/$pid/status" ]] || return 2
        IFS= read -r name < "$proc_root/$pid/comm" || return 2
        [[ "$name" == "ttyd" ]] && return 0
        parent="$(awk '/^PPid:/ { print $2; exit }' "$proc_root/$pid/status")"
        [[ "$parent" =~ ^[0-9]+$ && "$parent" != "$pid" ]] || return 2
        pid="$parent"
        ((depth += 1))
    done
    [[ "$pid" == "1" ]] && return 1
    return 2
}

wistron_switch_native_clients() {
    local station="$1" bios="$2" proc_root="${3:-/proc}" clients client_tty client_pid classification
    [[ "$station" =~ ^stn_[1-9][0-9]{0,5}$ && "$bios" =~ ^bs_[a-f0-9]{12}$ ]] || return 1
    clients="$(tmux list-clients -t "=$station" -F '#{client_tty}|#{client_pid}' 2>/dev/null)" || return 0
    while IFS='|' read -r client_tty client_pid; do
        [[ "$client_tty" == /dev/* && "$client_pid" =~ ^[0-9]+$ ]] || continue
        classification=0
        wistron_web_tmux_client "$client_pid" "$proc_root" || classification=$?
        if ((classification == 0)); then
            continue
        elif ((classification != 1)); then
            echo "Could not identify tmux client $client_tty; leaving it on $station." >&2
            continue
        fi
        tmux switch-client -c "$client_tty" -t "=$bios" || return 1
    done <<< "$clients"
}
