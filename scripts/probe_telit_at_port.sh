#!/usr/bin/env bash

# Probe Telit modem serial ports and pick the first that answers to AT
#
# Usage:
#   ./probe_telit_at_port.sh               # scans common Telit ports
#   ./probe_telit_at_port.sh /dev/ttyUSB2  # test a specific port
#   BAUD=115200 ./probe_telit_at_port.sh   # override baud (default 115200)
#   ./probe_telit_at_port.sh --print-port  # print only the detected port
#
# Exit codes:
#   0  success; AT port found
#   1  no port responded
#   2  invalid args or environment

set -euo pipefail

BAUD="${BAUD:-115200}"
PRINT_ONLY=0

usage() {
  cat <<EOF
Probe Telit modem serial ports and pick the first that answers to AT

Options:
  --print-port     Only print the detected port path on success
  -h, --help       Show this help

Environment:
  BAUD=115200      Serial speed (default: 115200)

Examples:
  ./probe_telit_at_port.sh
  ./probe_telit_at_port.sh /dev/ttyUSB2 /dev/ttyUSB3
  BAUD=921600 ./probe_telit_at_port.sh --print-port
EOF
}

ports=()
while (( $# )); do
  case "$1" in
    --print-port)
      PRINT_ONLY=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    --)
      shift; while (( $# )); do ports+=("$1"); shift; done ;;
    -*)
      echo "Unknown option: $1" >&2; usage; exit 2 ;;
    *)
      ports+=("$1"); shift ;;
  esac
done

# Default scan set: Telit often exposes AT on ttyUSB2 or ttyUSB3
if (( ${#ports[@]} == 0 )); then
  for p in /dev/ttyUSB2 /dev/ttyUSB3 /dev/ttyUSB0 /dev/ttyUSB1 /dev/ttyUSB4 /dev/ttyUSB5 /dev/ttyACM0 /dev/ttyACM1; do
    [[ -e "$p" ]] && ports+=("$p")
  done
fi

if (( ${#ports[@]} == 0 )); then
  echo "No candidate serial ports found. Plug the modem or pass ports explicitly." >&2
  exit 2
fi

log() {
  (( PRINT_ONLY == 0 )) && echo "$*"
}

test_port() {
  local port="$1"

  # Quickly skip if not char device or not accessible
  [[ -c "$port" ]] || return 2

  # If busy, skip but inform
  if command -v fuser >/dev/null 2>&1; then
    if fuser -s "$port" 2>/dev/null; then
      log "[skip] $port is busy (in use by: $(fuser -v "$port" 2>/dev/null | awk 'NR>1{print $1"/"$2}' | paste -sd, -))"
      return 3
    fi
  fi

  # Configure serial line; if this fails it's typically because the port is busy
  if ! stty -F "$port" "$BAUD" -echo -ixon -ixoff -icrnl -opost -crtscts 2>/dev/null; then
    log "[warn] Could not configure $port (maybe busy)"
    return 4
  fi

  # Flush any pending input quickly to avoid reading stale lines
  timeout 0.2 cat "$port" >/dev/null 2>&1 || true

  # Open bidirectional FD
  exec {fd}<>"$port" || return 5
  # Ensure FD is closed on function exit
  local ok=1
  {
    # Send basic attention; send twice to overcome potential initial noise/echo
    printf 'AT\r' >&$fd
    sleep 0.15
    printf 'AT\r' >&$fd

    # Read for up to ~1.5s for an OK
    local start_ts=$(date +%s%3N 2>/dev/null || date +%s)
    local line
    for _ in {1..8}; do
      if IFS= read -r -t 0.25 -u $fd line; then
        # Normalize CRLF -> LF for matching
        line="${line%%$'\r'}"
        [[ -z "$line" ]] && continue
        # log "  [$port] $line"
        if [[ "$line" =~ ^[Oo][Kk]$ ]]; then
          ok=0
          break
        fi
      fi
    done
  } || true
  # Close FD
  exec {fd}>&- || true
  exec {fd}<&- || true

  return $ok
}

log "Probing Telit AT port at ${BAUD} baud..."
found=""
for p in "${ports[@]}"; do
  log ">>> Testing $p"
  if test_port "$p"; then
    found="$p"
    break
  fi
done

if [[ -n "$found" ]]; then
  if (( PRINT_ONLY == 1 )); then
    echo "$found"
  else
    echo "AT port detected: $found"
    # Optional: show brief module info
    if command -v timeout >/dev/null 2>&1 && stty -F "$found" "$BAUD" -echo -ixon -ixoff -icrnl -opost >/dev/null 2>&1; then
      printf 'ATI\r' > "$found" 2>/dev/null || true
      sleep 0.2
      resp=$(timeout 1 cat "$found" 2>/dev/null | tr -d '\0') || true
      if [[ -n "${resp:-}" ]]; then
        echo "--- ATI ---"
        echo "$resp"
        echo "-----------"
      fi
    fi
  fi
  exit 0
fi

echo "No AT response from tested ports." >&2
echo "Tips:" >&2
echo "  - Ensure ModemManager/pppd/chat is stopped for testing." >&2
echo "  - Try a different baud (e.g., BAUD=921600)." >&2
echo "  - Try testing all present USB ACM/USB ports manually." >&2
exit 1

