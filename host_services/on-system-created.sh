#!/usr/bin/env bash
# /opt/hooks/on-system-created.sh
# Usage: on-system-created.sh <UNIT_TAG> <RACK_TAG>

set -o pipefail

UNIT_TAG="${1:-}"
RACK_TAG="${2:-}"

[ -z "$UNIT_TAG" ] && exit 0
[ -z "$RACK_TAG" ] && exit 0

REMOTE_NAME="${HOOK_RCLONE_REMOTE:-dell-mft}"
REMOTE="${REMOTE_NAME}:/L11/${RACK_TAG}.1/"
STAGING_BASE="/opt/docker/l11_logs_staging"
WORKDIR="${STAGING_BASE}/${UNIT_TAG}"
COLLECT_DIR="${WORKDIR}/collected"
FINAL_DIR="/var/www/html/l10_logs/${UNIT_TAG}"
TMP_TAR="/tmp/L11_logs_ST_${UNIT_TAG}_RT_${RACK_TAG}.tgz"
TAR_ROOT="L11_logs_ST_${UNIT_TAG}_RT_${RACK_TAG}"

LOGFILE="/var/log/host-runner/${UNIT_TAG}_$(date +%s).log"
mkdir -p /var/log/host-runner
exec > >(tee -a "$LOGFILE") 2>&1

log() { printf '[hook] %s\n' "$*" >&2; }

rm -rf "$WORKDIR" 2>/dev/null || true
mkdir -p "$WORKDIR" "$COLLECT_DIR" "$FINAL_DIR" || true
chown -R falab:falab "$FINAL_DIR" 2>/dev/null || true

if ! rclone lsd "$REMOTE" >/dev/null 2>&1; then
  log "Rack folder in MFT not found: $REMOTE"
  exit 0
fi

###############################################################################
# FAST PATH: NVIDIA BUG REPORT FLOW FIRST
###############################################################################
log "Scanning $REMOTE for matching nvidia-bug-report files first..."

BUG_LIST="$(
  rclone lsf "$REMOTE" \
    --files-only \
    --max-depth 1 2>/dev/null \
  | awk -v rack="${RACK_TAG}.1" -v unit="${UNIT_TAG}" '
      BEGIN {
        IGNORECASE=1
      }
      index(tolower($0), tolower(rack)) &&
      index(tolower($0), tolower(unit)) &&
      index(tolower($0), "nvidia-bug-report") {
        print
      }
    '
)"

if [[ -n "$BUG_LIST" ]]; then
  log "Found matching nvidia-bug-report file(s). Copying the below files from $REMOTE to $COLLECT_DIR/$TAR_ROOT ..."
  printf '%s\n' "$BUG_LIST" | sed 's/^/[hook]   - /'

  mkdir -p "$COLLECT_DIR/$TAR_ROOT" || true

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    rclone copyto "${REMOTE}${file}" "${COLLECT_DIR}/${TAR_ROOT}/${file}" \
      --transfers=1 --checkers=4 --low-level-retries 1 \
      --stats=0 --stats-one-line -q || true
  done <<< "$BUG_LIST"

  if ! find "$COLLECT_DIR/$TAR_ROOT" -maxdepth 1 -type f -iname '*nvidia-bug-report*' | grep -q .; then
    log "Matching nvidia-bug-report files were found, but none were copied successfully."
    rm -rf "$WORKDIR" 2>/dev/null || true
    exit 0
  fi

  log "Creating tar ${TMP_TAR} ..."
  rm -f "$TMP_TAR" 2>/dev/null || true
  tar -czf "$TMP_TAR" -C "$COLLECT_DIR" "$TAR_ROOT" 2>/dev/null || {
    log "Tar creation failed"
    rm -rf "$WORKDIR" 2>/dev/null || true
    exit 0
  }

  log "Moving tar to ${FINAL_DIR}/ ..."
  mv -f "$TMP_TAR" "$FINAL_DIR/" 2>/dev/null || true
  chown -R falab:falab "$FINAL_DIR" 2>/dev/null || true

  rm -rf "$WORKDIR" 2>/dev/null || true
  log "Done."
  exit 0
fi

###############################################################################
# FALLBACK: FAIL ARCHIVE FLOW
###############################################################################
log "No matching nvidia-bug-report files found. Scanning $REMOTE for FAIL archives..."

FAIL_LIST="$(
  rclone lsf "$REMOTE" \
    --filter '+ *[Ff][Aa][Ii][Ll]*.tgz' \
    --filter '+ *[Ff][Aa][Ii][Ll]*.tar.gz' \
    --filter '- *' \
    --files-only \
    --max-depth 1 2>/dev/null
)"

if [[ -z "$FAIL_LIST" ]]; then
  log "No FAIL archives found in $REMOTE; nothing to do."
  rm -rf "$WORKDIR" 2>/dev/null || true
  exit 0
fi

log "Copying the below FAIL archives from $REMOTE to $WORKDIR ..."
printf '%s\n' "$FAIL_LIST" | sed 's/^/[hook]   - /'

rclone copy "$REMOTE" "$WORKDIR" \
  --filter '+ *[Ff][Aa][Ii][Ll]*.tgz' \
  --filter '+ *[Ff][Aa][Ii][Ll]*.tar.gz' \
  --filter '- *' \
  --transfers=4 --checkers=8 --low-level-retries 1 \
  --stats=0 --stats-one-line -q || true

log "Untarring archives in $WORKDIR ..."
find "$WORKDIR" -type f \( -iname '*.tgz' -o -iname '*.tar.gz' \) -print0 2>/dev/null \
| while IFS= read -r -d '' arch; do
    dir="$(dirname "$arch")"
    tar -xzf "$arch" -C "$dir" 2>/dev/null || true
  done

find "$WORKDIR" -type f \( -iname '*.tgz' -o -iname '*.tar.gz' \) -delete 2>/dev/null || true

log "Searching for folder(s) inside the extracted folder tree that contains ${UNIT_TAG} in their name..."
FOUND_ANY=0

declare -A TOPS=()

while IFS= read -r -d '' d; do
  rel="${d#"$WORKDIR"/}"
  top="${rel%%/*}"
  [[ -n "$top" && "$top" != "collected" ]] && TOPS["$top"]=1
done < <(find "$WORKDIR" -mindepth 1 -type d -iname "*${UNIT_TAG}*" -print0 2>/dev/null)

if (( ${#TOPS[@]} == 0 )); then
  log "No extracted folder tree contains a directory with name containing ${UNIT_TAG}; nothing to collect"
  rm -rf "$WORKDIR" 2>/dev/null || true
  exit 0
fi

for top in "${!TOPS[@]}"; do
  log "Collecting fail folder $top into the new L11 logs archive for ${UNIT_TAG}..."
  if mv "$WORKDIR/$top" "$COLLECT_DIR/" 2>/dev/null; then
    FOUND_ANY=1
  fi
done

if (( FOUND_ANY == 0 )); then
  log "Found matching Service Tag folders, but collection failed (move errors / permissions / name collisions)."
  rm -rf "$WORKDIR" 2>/dev/null || true
  exit 0
fi

log "Creating tar ${TMP_TAR} ..."
rm -f "$TMP_TAR" 2>/dev/null || true
tar -czf "$TMP_TAR" -C "$COLLECT_DIR" . \
  --transform "s|^\./|${TAR_ROOT}/|" 2>/dev/null || {
    log "Tar creation failed"
    rm -rf "$WORKDIR" 2>/dev/null || true
    exit 0
  }

log "Moving tar to ${FINAL_DIR}/ ..."
mv -f "$TMP_TAR" "$FINAL_DIR/" 2>/dev/null || true
chown -R falab:falab "$FINAL_DIR" 2>/dev/null || true

rm -rf "$WORKDIR" 2>/dev/null || true
log "Done."
exit 0
