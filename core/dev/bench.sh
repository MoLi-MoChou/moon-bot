#!/bin/sh
# Mock test bench: the scripted mock model (dev/mock-llm.ts) plus Moon Bot's own service on
# a loopback port, with its data in <checkout>/.moon-bot-test-<name>. Editing src/client
# needs `npm run build` and a page reload; host code needs a restart.
#
#   dev/bench.sh <name> <web-port> <mock-port> [start|stop|reset|status]
#
# `reset` wipes its Bot team and Sessions before starting. Processes are tracked by pid files
# and stopped by process group, never by name.
# Environment: MOON_BOT_PASSWORD (default: bench), CONTEXT_WINDOW, CHECK_RATIO, MOCK_DELAY_MS.
set -eu
NAME=${1:?usage: bench.sh <name> <web-port> <mock-port> [start|stop|reset|status]}
WEB_PORT=${2:?usage: bench.sh <name> <web-port> <mock-port> [start|stop|reset|status]}
MOCK_PORT=${3:?usage: bench.sh <name> <web-port> <mock-port> [start|stop|reset|status]}
ACTION=${4:-start}
case "$NAME" in *[!a-z0-9-]*|'') echo "bench name must match [a-z0-9-]+" >&2; exit 1 ;; esac
if [ "$WEB_PORT" = 3080 ]; then echo "port 3080 belongs to the real service" >&2; exit 1; fi

PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(dirname "$PLUGIN")"
HOME_DIR="$ROOT/.moon-bot-test-$NAME"
PASSWORD="${MOON_BOT_PASSWORD:-bench}"

alive() { [ -f "$HOME_DIR/$1.pid" ] && kill -0 "-$(cat "$HOME_DIR/$1.pid")" 2>/dev/null; }

# Each process runs in its own session (setsid), so its pid is also its process group. The
# process writes its own pid: the `$!` of a background job is the subshell that runs setsid,
# not the session leader it forks. dash's kill takes no `--`.
stop_one() {
  file="$HOME_DIR/$1.pid"
  [ -f "$file" ] || return 0
  pid=$(cat "$file")
  kill -TERM "-$pid" 2>/dev/null || true
  i=0
  while kill -0 "-$pid" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.2; i=$((i + 1)); done
  kill -KILL "-$pid" 2>/dev/null || true
  rm -f "$file"
}

start_mock() {
  alive mock && return 0
  # setsid: the process leads its own group, so stop_one can signal the whole tree.
  # The shell writes its own pid before exec, so the file names the leader, not a subshell.
  MOCK_PORT="$MOCK_PORT" setsid sh -c 'echo $$ > "$1"; exec node "$2"' _ "$HOME_DIR/mock.pid" "$PLUGIN/dev/mock-llm.ts" > "$HOME_DIR/mock.log" 2>&1 &
  i=0
  while [ $i -lt 50 ]; do
    if curl -sf "http://127.0.0.1:$MOCK_PORT/v1/models" > /dev/null 2>&1; then return 0; fi
    sleep 0.2; i=$((i + 1))
  done
  echo "the mock model did not answer on $MOCK_PORT" >&2
  return 1
}

start_service() {
  alive service && return 0
  MOON_BOT_DATA="$HOME_DIR/data" \
  MOON_BOT_WEB_PORT="$WEB_PORT" \
  MOON_BOT_PASSWORD="$PASSWORD" \
  MOON_BOT_UI="$ROOT/app/ui/dist" \
  LLM_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" \
  CONTEXT_WINDOW="${CONTEXT_WINDOW:-}" \
  CHECK_RATIO="${CHECK_RATIO:-}" \
    setsid sh -c 'echo $$ > "$1"; exec node "$2"' _ "$HOME_DIR/service.pid" "$PLUGIN/dist/service/main.js" > "$HOME_DIR/service.log" 2>&1 &
  i=0
  while [ $i -lt 100 ]; do
    if curl -sf "http://127.0.0.1:$WEB_PORT/healthz" > /dev/null 2>&1; then return 0; fi
    sleep 0.2; i=$((i + 1))
  done
  echo "the service did not answer on $WEB_PORT; see $HOME_DIR/service.log" >&2
  return 1
}

mkdir -p "$HOME_DIR"
case "$ACTION" in
  start)
    start_mock
    start_service
    echo "bench $NAME: http://127.0.0.1:$WEB_PORT (password $PASSWORD), mock $MOCK_PORT"
    echo "        log: $HOME_DIR/service.log"
    ;;
  stop)
    stop_one service
    stop_one mock
    ;;
  reset)
    stop_one service
    stop_one mock
    rm -rf "$HOME_DIR/data"
    ;;
  status)
    alive service && echo "service: running ($(cat "$HOME_DIR/service.pid"))" || echo "service: stopped"
    alive mock && echo "mock: running ($(cat "$HOME_DIR/mock.pid"))" || echo "mock: stopped"
    ;;
  *) echo "usage: bench.sh <name> <web-port> <mock-port> [start|stop|reset|status]" >&2; exit 1 ;;
esac
