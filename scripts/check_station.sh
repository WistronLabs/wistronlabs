#!/bin/bash
# About:
#   Inspects a station tmux session and emits JSON describing L10 activity, status, and latest result details.
#
# Usage:
#   ./check_station.sh <station_name>
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/.lib"

# shellcheck disable=SC1091
source "$LIB_DIR/err.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/runtime_mode.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/require_server_location.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/normalize_service_tag.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/backend_curl.sh"

STATION_NAME="$1"
if [ -z "$STATION_NAME" ]; then
  echo "Usage: $0 <station_name>"
  exit 1
fi

# Endpoint expects numeric station id, while tmux target may be "stn_<num>".
STATION_ID=$(echo "$STATION_NAME" | sed -E 's/^[sS][tT][nN][_-]?//' | xargs)


require_server_location

BASH_PID=$(tmux list-panes -a -F "#{pane_pid} #{session_name}:#{window_index}.#{pane_index}" | grep -w "$STATION_NAME" | cut -d" " -f1)

NORMALIZED_NAME=$(for w in ${STATION_NAME//[^[:alnum:]]/ }; do printf '%s ' "${w^}"; done | sed 's/ $//')


if [ -z "$BASH_PID" ]; then
  jq -nc --arg station "$NORMALIZED_NAME" \
    --arg message "No existing tmux session for $NORMALIZED_NAME." \
    '{station: $station, status: 3, message: $message, details: null}'
  exit 1
fi
pane=$(tmux capture-pane -p -t "$STATION_NAME" | grep -v -e '^\s*$' -e 'falab@franklin:~' -e '0:bash.*localhost\"')
progress_plan=$(tmux show-options -v -t "$STATION_NAME" @l10_progress_plan 2>/dev/null || true)
progress_run=$(tmux show-options -v -t "$STATION_NAME" @l10_progress_run 2>/dev/null || true)

CURRENT_STATION_TAG=""
if is_backend_mode && [[ -n "${SERVER_LOCATION:-}" ]]; then
  station_api_base="${STATION_API_BASE_URL:-https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1}"
  station_json=$(backend_curl -fsS --max-time 5 "${station_api_base%/}/stations/$STATION_ID" 2>/dev/null || true)
  if [[ -n "$station_json" ]]; then
    CURRENT_STATION_TAG=$(printf '%s' "$station_json" | jq -r '.system_service_tag // empty' 2>/dev/null || true)
    CURRENT_STATION_TAG="$(normalize_service_tag "$CURRENT_STATION_TAG")"

  fi
fi



DETAILS="null"
NEWEST_CHILD=$(pgrep -P "$BASH_PID" -afn)
NEWEST_CHILD_PID=""
NEWEST_CHILD_CMD=""

if [[ -n "$NEWEST_CHILD" ]]; then
  read -r NEWEST_CHILD_PID _ NEWEST_CHILD_CMD _ <<<"$NEWEST_CHILD"
fi

if [ -z "$NEWEST_CHILD" ]; then
  
  CODE="0"
  MESSAGE="L10 Diagnostic Test is not running."
elif [[ "$NEWEST_CHILD_CMD" == "./l10_test.sh" ]]; then
  PID_INFO=$(cut -d" " -f3 "/proc/$NEWEST_CHILD_PID/stat")
  
  if [ "$PID_INFO" == "T" ]; then
    CODE="0"
    MESSAGE="L10 Diagnostic Test is not running."

  else
    CODE="1"
    MESSAGE="L10 Diagnostic Test is running."
  fi

elif [[ "$NEWEST_CHILD_CMD" == "./gb300_l10_test.sh" ]]; then
  PID_INFO=$(cut -d" " -f3 "/proc/$NEWEST_CHILD_PID/stat")
  
  if [ "$PID_INFO" == "T" ]; then
    CODE="0"
    MESSAGE="L10 Diagnostic Test is not running."

  else
    CODE="1"
    MESSAGE=" GB300 L10 Diagnostic Test is running."
  fi

elif [[ "$NEWEST_CHILD_CMD" == "./wait_l10_test.sh" ]]; then
  PID_INFO=$(cut -d" " -f3 "/proc/$NEWEST_CHILD_PID/stat")
  
  if [ "$PID_INFO" == "T" ]; then
    CODE="0"
    MESSAGE="L10 Diagnostic Test is not running."

  else
    CODE="1"
    MESSAGE=" Waiting L10 Diagnostic Test is running."
  fi

else
  CODE="0"
  MESSAGE="L10 Diagnostic Test is not running."
fi

if [[ "$CODE" != "1" && $(echo "$pane" | grep -c "logs are located at ") -gt 0 ]]; then
  log_location=$(echo "$pane" | grep "logs are located at " | sed -e "s/logs are located at //g")
  service_tag=$(echo "$pane" | grep "logs are located at " | grep -oP "\/[A-z0-9]{6,7}\/" | sed -e "s/\///g")
  service_tag=$(echo "$service_tag" | tr '[:lower:]' '[:upper:]' | xargs)
  final_result=$(cat "$log_location"*.log | grep "Final Result: " | tail -n1 | sed "s/Final Result: //g")

  # Only emit PASS/FAIL/Something Went Wrong when the station endpoint
  # confirms the currently assigned service tag matches this log's service tag.
  if [[ -n "$CURRENT_STATION_TAG" && "$CURRENT_STATION_TAG" == "$service_tag" ]]; then
    if echo "$final_result" | grep -qi "PASS"; then
      CODE="4"
      MESSAGE="$service_tag PASS"
    elif echo "$final_result" | grep -qi "FAIL"; then
      CODE="5"
      MESSAGE="$service_tag FAIL"
    else
      CODE="5"
      MESSAGE="Something Went Wrong"
    fi
  fi
fi

if [ "$CODE" == "1" ]; then
  # Only count results from this run. Missing tmux history means progress is
  # unknown, rather than an elapsed-time estimate.
  progress_pane=""
  if [[ -n "$progress_run" ]]; then
    full_pane=$(tmux capture-pane -p -S - -t "$STATION_NAME" 2>/dev/null || true)
    progress_pane=$(printf '%s\n' "$full_pane" | awk -v marker="L10_PROGRESS_START=$progress_run" '
      $0 == marker { seen=1; next }
      seen { print }
    ')
  fi
  finished_tests=$(printf '%s\n' "$progress_pane" | grep -P "^(Testing|Dumping).*\[ [0-9]+\:[0-9]{2}s \]" | sed -E "s/^(Testing|Dumping) //g" | sed -E "s/ \[ [0-9]+\:[0-9]{2}s \]$//g")
  test_current=$(printf '%s\n' "$pane" | grep -P "^(Testing|Dumping)" | tail -n1 | sed -E "s/^(Testing|Dumping) //g" | sed -E "s/ .*$//g")
  if [[ -n $test_current ]]; then
    MESSAGE="$MESSAGE ($test_current)"
  fi
  test_ok=$(echo "$finished_tests" | grep " OK$" | sed -E "s/ OK$//g")
  test_fail=$(echo "$finished_tests" | grep " FAILED$" | sed -E "s/ FAILED$//g")
  test_skip=$(echo "$finished_tests" | grep " SKIPPED$" | sed -E "s/ SKIPPED$//g")
  test_timeout=$(echo "$finished_tests" | grep " TIMEOUT$" | sed -E "s/ TIMEOUT$//g")
  DETAILS=$(jq -nc \
    --arg current "$test_current" \
    --arg ok "$test_ok" \
    --arg failed "$test_fail" \
    --arg timeout "$test_timeout" \
    --arg skipped "$test_skip" '
    def lines: split("\n") | map(select(length > 0));
    (if $current == "" then {} else {"CURRENT TEST": $current} end)
    + (if $ok == "" then {} else {OK: ($ok | lines)} end)
    + (if $failed == "" then {} else {FAILED: ($failed | lines)} end)
    + (if $timeout == "" then {} else {TIMEOUT: ($timeout | lines)} end)
    + (if $skipped == "" then {} else {SKIPPED: ($skipped | lines)} end)
  ')
  if [[ -n "$progress_plan" && -n "$progress_pane" ]] &&
    jq -e 'type == "array" and length > 0' <<< "$progress_plan" >/dev/null 2>&1; then
    progress=$(jq -nc --argjson plan "$progress_plan" --argjson details "$DETAILS" '
      def completed: (($details.OK // []) + ($details.FAILED // []) + ($details.TIMEOUT // []) + ($details.SKIPPED // []));
      if ((completed - $plan) | length) > 0 then null
      else
        [range(0; $plan | length) as $i |
          select(completed | index($plan[$i])) | $i] as $done |
        [range(0; $plan | length) as $i |
          select((($details.FAILED // []) + ($details.TIMEOUT // [])) | index($plan[$i])) | $i] as $failed |
        {completed: ($done | length), total: ($plan | length), failedIndices: $failed}
      end
    ')
    if [[ "$progress" != "null" ]]; then
      DETAILS=$(jq -nc --argjson details "$DETAILS" --argjson progress "$progress" '$details + {PROGRESS: $progress}')
    fi
  fi
fi

# Let jq escape terminal text; hand-built JSON breaks on quotes and backslashes.
jq -nc --arg station "$NORMALIZED_NAME" --argjson status "$CODE" \
  --arg message "$MESSAGE" --argjson details "$DETAILS" \
  '{station: $station, status: $status, message: $message, details: $details}'

# Authors:
#   Giovanni Leon - giovanni_leon@wistron.com
