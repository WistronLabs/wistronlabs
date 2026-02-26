#!/usr/bin/env bash


#requires jq and curl

if [[ -z "${SERVER_LOCATION:-}" ]]; then
  echo "Error: SERVER_LOCATION is not set." >&2
  exit 1
fi

API_URL="https://backend.$SERVER_LOCATION.wistronlabs.com/api/v1/stations"

if ! json=$(curl -fsS --max-time 8 "$API_URL"); then
  echo "Error: unable to fetch stations from $API_URL" >&2
  exit 1
fi

mapfile -t stations < <(printf '%s\n' "$json" | jq -r '.[].station_name')

if ((${#stations[@]} == 0)); then
  echo "Error: no stations returned by API." >&2
  exit 1
fi

for st in "${stations[@]}"; do
    echo "Checking station $st…"

    # run check_station.sh and capture output
    output=$(./check_station.sh "stn_$st")

    # parse fields
    status=$(echo "$output" | jq -r '.status')
    message=$(echo "$output" | jq -r '.message')

    echo "  status=$status, message=\"$message\""

    payload=$(jq -nc --argjson status "$status" --arg message "$message" \
      '{status: $status, message: $message}')

    # PATCH to API
    curl -s -X PATCH "$API_URL/$st" \
        -H "Content-Type: application/json" \
        -d "$payload"
done
