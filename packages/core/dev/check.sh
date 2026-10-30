#!/bin/sh
# One-command check of this checkout, with the mock model only:
#   unit     pnpm test
#   build    client.js and dist/ match their sources
#   lint     pnpm run lint (typecheck included in the repo gate)
#   types    pnpm run typecheck
#   eval     the five-capability evaluation set
#   smoke    a fresh bench and dev/smoke.mjs
#   web      a fresh bench and dev/ui-shots.mjs (sidebar, private chat, group, settings)
# Every process it starts is stopped at the end, also on failure or Ctrl-C.
#
#   dev/check.sh [--skip step,step] [--only step,step] [--out <dir>]
#
# Screenshots and logs go to --out (default: shots/check-<YYYYMMDD-HHMM> beside the checkout).
# Ports follow SLOT=n (0-9, default 0): web 31n0/88n0, smoke 31n1/88n1. Bench data lives in
# <checkout>/.moon-bot-test-check-web and -check-smoke. The web shots need Chrome or Chromium
# (CHROME_BIN, see ui-shots.mjs).
set -u
PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$PLUGIN/../.." && pwd)"
SLOT=${SLOT:-0}
case "$SLOT" in [0-9]) ;; *) echo "SLOT must be one digit" >&2; exit 2 ;; esac
STEPS="unit types build lint eval smoke web"
SKIP=""
ONLY=""
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip) SKIP=$(echo "$2" | tr ',' ' '); shift 2 ;;
    --only) ONLY=$(echo "$2" | tr ',' ' '); shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $1 (see --help)" >&2; exit 2 ;;
  esac
done
for step in $SKIP $ONLY; do
  case " $STEPS " in *" $step "*) ;; *) echo "unknown step $step; steps: $STEPS" >&2; exit 2 ;; esac
done
OUT=${OUT:-"$ROOT/shots/check-$(date +%Y%m%d-%H%M)"}
mkdir -p "$OUT/logs"
OUT="$(cd "$OUT" && pwd)"

WEB_PORT=31${SLOT}0 WEB_MOCK=88${SLOT}0 SMOKE_PORT=31${SLOT}1 SMOKE_MOCK=88${SLOT}1

cleanup() {
  "$PLUGIN/dev/bench.sh" check-smoke "$SMOKE_PORT" "$SMOKE_MOCK" stop >/dev/null 2>&1
  "$PLUGIN/dev/bench.sh" check-web "$WEB_PORT" "$WEB_MOCK" stop >/dev/null 2>&1
}
trap cleanup EXIT
trap 'exit 130' INT TERM

wanted() {
  if [ -n "$ONLY" ]; then case " $ONLY " in *" $1 "*) ;; *) return 1 ;; esac; fi
  case " $SKIP " in *" $1 "*) return 1 ;; esac
  return 0
}

port_free() { ! node -e "const s=require('net').connect($1,'127.0.0.1');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1))"; }
need_ports() {
  for port in "$@"; do
    port_free "$port" || { echo "port $port is in use; stop what holds it or pick another SLOT" >&2; return 1; }
  done
}

step_unit() { cd "$PLUGIN" && pnpm test; }
step_types() { cd "$PLUGIN" && pnpm run typecheck; }
step_build() { cd "$PLUGIN" && node scripts/build-client.ts --check && node scripts/build-host.mjs --check; }
step_lint() { cd "$PLUGIN" && pnpm run lint; }
step_eval() { cd "$PLUGIN" && pnpm run eval; }
step_smoke() {
  cd "$PLUGIN" || return 1
  dev/bench.sh check-smoke "$SMOKE_PORT" "$SMOKE_MOCK" stop >/dev/null
  need_ports "$SMOKE_PORT" "$SMOKE_MOCK" || return 1
  CONTEXT_WINDOW=100000 CHECK_RATIO=0.45 dev/bench.sh check-smoke "$SMOKE_PORT" "$SMOKE_MOCK" reset || return 1
  node dev/smoke.mjs check-smoke "$SMOKE_PORT"
  status=$?
  dev/bench.sh check-smoke "$SMOKE_PORT" "$SMOKE_MOCK" stop
  return $status
}
step_web() {
  cd "$PLUGIN" || return 1
  dev/bench.sh check-web "$WEB_PORT" "$WEB_MOCK" stop >/dev/null
  need_ports "$WEB_PORT" "$WEB_MOCK" || return 1
  dev/bench.sh check-web "$WEB_PORT" "$WEB_MOCK" reset || return 1
  node dev/ui-shots.mjs web "$OUT" check-web "$WEB_PORT"
  status=$?
  dev/bench.sh check-web "$WEB_PORT" "$WEB_MOCK" stop
  return $status
}

status=0
for step in $STEPS; do
  wanted "$step" || continue
  echo "== $step"
  if ! "step_$step" > "$OUT/logs/$step.log" 2>&1; then
    echo "   FAILED (see $OUT/logs/$step.log)"
    tail -20 "$OUT/logs/$step.log" | sed 's/^/   /'
    status=1
  else
    echo "   ok"
  fi
done
[ $status -eq 0 ] && echo "all checks passed (out: $OUT)"
exit $status
