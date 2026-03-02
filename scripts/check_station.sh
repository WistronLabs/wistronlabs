#!/bin/bash

STATION_NAME="$1"
if [ -z "$STATION_NAME" ]; then
  echo "Usage: $0 <station_name>"
  exit 1
fi

# Endpoint expects numeric station id, while tmux target may be "stn_<num>".
STATION_ID=$(echo "$STATION_NAME" | sed -E 's/^[sS][tT][nN][_-]?//' | xargs)


# Check if SERVER_LOCATION environment variable is set
if [[ -z "${SERVER_LOCATION:-}" ]]; then
  err "Environment variable SERVER_LOCATION is not set." >&2
  echo "       Please export SERVER_LOCATION in your shell (e.g. in ~/.bashrc)." >&2
  exit 1
fi

BASH_PID=$(tmux list-panes -a -F "#{pane_pid} #{session_name}:#{window_index}.#{pane_index}" | grep -w "$STATION_NAME" | cut -d" " -f1)

NORMALIZED_NAME=$(for w in ${STATION_NAME//[^[:alnum:]]/ }; do printf '%s ' "${w^}"; done | sed 's/ $//')


if [ -z "$BASH_PID" ]; then

  # emit JSON
  printf '{\n'
  printf '  "station": "%s",\n' "$NORMALIZED_NAME"
  printf '  "status": %d,\n'    "3"
  # escape any quotes in the message
  escaped_msg=${MESSAGE//\"/\\\"}
  printf '  "message": "%s"\n'  "No existing tmux session for $NORMALIZED_NAME."
  printf '}\n'
  exit 1
fi
pane=$(tmux capture-pane -p -t $STATION_NAME | grep -v -e '^\s*$' -e 'falab@franklin:~' -e '0:bash.*localhost\"')
ok=0
failed=0

CURRENT_STATION_TAG=""
if [[ -n "${SERVER_LOCATION:-}" ]]; then
  station_json=$(curl -fsS --max-time 5 "https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/stations/$STATION_ID" 2>/dev/null || true)
  if [[ -n "$station_json" ]]; then
    CURRENT_STATION_TAG=$(printf '%s' "$station_json" | jq -r '.system_service_tag // empty' 2>/dev/null || true)
    CURRENT_STATION_TAG=$(echo "$CURRENT_STATION_TAG" | tr '[:lower:]' '[:upper:]' | xargs)

  fi
fi




NEWEST_CHILD=$(pgrep -P "$BASH_PID" -afn)
if [ -z "$NEWEST_CHILD" ]; then
  
  CODE="0"
  MESSAGE="L10 Diagnostic Test is not running."
elif [ $(echo $NEWEST_CHILD | cut -d" " -f3) ==  "./l10_test.sh" ]; then
  NEWEST_CHILD_PID=$(echo $NEWEST_CHILD | cut -d" " -f1)
  PID_INFO=$(cat /proc/$NEWEST_CHILD_PID/stat | cut -d" " -f3)
  
  if [ "$PID_INFO" == "T" ]; then
    CODE="0"
    MESSAGE="L10 Diagnostic Test is not running."

  else
    CODE="1"
    MESSAGE="L10 Diagnostic Test is running."
  fi

elif [ $(echo $NEWEST_CHILD | cut -d" " -f3) ==  "./gb300_l10_test.sh" ]; then
  NEWEST_CHILD_PID=$(echo $NEWEST_CHILD | cut -d" " -f1)
  PID_INFO=$(cat /proc/$NEWEST_CHILD_PID/stat | cut -d" " -f3)
  
  if [ "$PID_INFO" == "T" ]; then
    CODE="0"
    MESSAGE="L10 Diagnostic Test is not running."

  else
    CODE="1"
    MESSAGE=" GB300 L10 Diagnostic Test is running."
  fi

elif [ $(echo $NEWEST_CHILD | cut -d" " -f3) ==  "./wait_l10_test.sh" ]; then
  NEWEST_CHILD_PID=$(echo $NEWEST_CHILD | cut -d" " -f1)
  PID_INFO=$(cat /proc/$NEWEST_CHILD_PID/stat | cut -d" " -f3)
  
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

if [[ $(echo $pane | grep -c "logs are located at ") -gt 0 ]]; then
  log_location=$(echo "$pane" | grep "logs are located at " | sed -e "s/logs are located at //g")
  service_tag=$(echo "$pane" | grep "logs are located at " | grep -oP "\/[A-z0-9]{6,7}\/" | sed -e "s/\///g")
  service_tag=$(echo "$service_tag" | tr '[:lower:]' '[:upper:]' | xargs)
  final_result=$(cat $log_location*.log | grep "Final Result: " | tail -n1 | sed "s/Final Result: //g")

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

if [ "$CODE" == "0" ]; then
  ok=0
  failed=0
elif [ "$CODE" == "1" ]; then
  ok=$(echo "$pane" | grep -c "Testing.*OK \[")
  failed=$(echo "$pane" | grep -c "Testing.*FAILED \[")
fi

# emit JSON
printf '{\n'
printf '  "station": "%s",\n' "$NORMALIZED_NAME"
printf '  "status": %d,\n'    "$CODE"
printf '  "ok": %d,\n'        "$ok"
printf '  "failed": %d, \n'   "$failed"
# escape any quotes in the message
escaped_msg=${MESSAGE//\"/\\\"}
printf '  "message": "%s"\n'  "$escaped_msg"
printf '}\n'
