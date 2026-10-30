#!/bin/sh
# Non-destructive deployment safety drill. It uses a temporary data directory and a
# throwaway container on port 8297; it never reads or writes a real Moon Bot install.
#
# Build a local image first, or set MOON_BOT_DRILL_IMAGE to one already available:
#   docker build -t moon-bot:drill .
#   ./deploy/drill.sh
set -eu

command -v docker >/dev/null 2>&1 || { echo "drill: docker is required" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "drill: docker compose (the plugin) is required" >&2; exit 1; }

SOURCE_IMAGE=${MOON_BOT_DRILL_IMAGE:-moon-bot:latest}
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/moon-bot-drill.XXXXXX")
DEPLOY="$ROOT/deploy"
DATA="$DEPLOY/data"
GOOD_REPOSITORY="moon-bot-drill-good-$$"
GOOD_IMAGE="$GOOD_REPOSITORY:local"
BAD_REPOSITORY="moon-bot-drill-bad-$$"
BAD_IMAGE="$BAD_REPOSITORY:local"
OUTPUT="$ROOT/update-output"
mkdir -p "$DEPLOY" "$DATA"
chmod 777 "$ROOT" "$DEPLOY" "$DATA"
cleanup() {
  docker compose -p moon-bot-drill -f "$DEPLOY/docker-compose.yml" down >/dev/null 2>&1 || true
  docker image rm "$BAD_IMAGE" "$GOOD_IMAGE" >/dev/null 2>&1 || true
  rm -rf -- "$ROOT"
}
trap cleanup EXIT INT TERM

docker image inspect "$SOURCE_IMAGE" >/dev/null 2>&1 || {
  echo "drill: image $SOURCE_IMAGE is not available; build it or set MOON_BOT_DRILL_IMAGE" >&2
  exit 1
}
docker tag "$SOURCE_IMAGE" "$GOOD_IMAGE"
cp "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/docker-compose.yml" "$DEPLOY/docker-compose.yml"
cp "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/update.sh" "$DEPLOY/update.sh"
cp "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/rollback.sh" "$DEPLOY/rollback.sh"
chmod 700 "$DEPLOY/update.sh" "$DEPLOY/rollback.sh"
cat > "$DEPLOY/.env" <<EOF
MOON_BOT_PASSWORD=drill-only-password
MOON_BOT_TAG=local
MOON_BOT_REGISTRY=$GOOD_REPOSITORY
MOON_BOT_PORT=8297
MOON_BOT_CONTAINER=moon-bot-drill
MOON_BOT_SNAPSHOT_DIR=.snapshots
MOON_BOT_SNAPSHOT_RETENTION=2
EOF
chmod 600 "$DEPLOY/.env"

# Seed only a harmless marker. The healthy service creates and migrates its own SQLite store;
# pre-creating an empty database would not represent a real installation.
printf 'before-drill\n' > "$DATA/marker.txt"

wait_healthy() {
  i=0
  while [ "$i" -lt 45 ]; do
    state=$(docker inspect moon-bot-drill --format '{{.State.Health.Status}}' 2>/dev/null || echo missing)
    [ "$state" = healthy ] && return 0
    [ "$state" = unhealthy ] && return 1
    sleep 1
    i=$((i + 1))
  done
  return 1
}

cd "$DEPLOY"
export COMPOSE_PROJECT_NAME=moon-bot-drill
docker compose up -d >/dev/null
wait_healthy
test "$(curl -fsS http://127.0.0.1:8297/healthz | tr -d '\n')" != ""

# A healthy update proves the snapshot is made only after the old container stops.
MOON_BOT_SKIP_PULL=1 HEALTH_TRIES=45 HEALTH_WAIT=1 ./update.sh local > "$OUTPUT" 2>&1
SNAPSHOT=$(sed -n 's/^update: snapshot saved at //p' "$OUTPUT" | tail -1)
test -n "$SNAPSHOT"
test -f "$SNAPSHOT/data.tar.gz"
test -f "$SNAPSHOT/manifest"
test "$(cat "$DATA/marker.txt")" = before-drill
! grep -q 'drill-only-password' "$OUTPUT"

# The bad image changes user_version and then stays alive without serving /healthz.
cat > "$ROOT/Dockerfile.bad" <<EOF
FROM $GOOD_IMAGE
ENV NODE_PATH=/opt/moon-bot/packages/core/node_modules
CMD ["node", "-e", "const Database=require('better-sqlite3');const db=new Database('/data/store.sqlite3');db.pragma('user_version = 999');db.close();setTimeout(() => {}, 3600000)"]
EOF
docker build -q -t "$BAD_IMAGE" -f "$ROOT/Dockerfile.bad" "$ROOT" >/dev/null
sed -i "s#MOON_BOT_REGISTRY=.*#MOON_BOT_REGISTRY=$BAD_REPOSITORY#" .env
set +e
MOON_BOT_SKIP_PULL=1 HEALTH_TRIES=10 HEALTH_WAIT=1 ./update.sh local > "$OUTPUT" 2>&1
status=$?
set -e
test "$status" -ne 0
grep -q 'leaving the new container for diagnosis' "$OUTPUT"
grep -q 'rollback.sh --restore' "$OUTPUT"
test "$(docker inspect moon-bot-drill --format '{{.State.Status}}' 2>/dev/null || true)" = running

# Explicit restore puts the old data back and starts the snapshot's previous image.
HEALTH_TRIES=45 HEALTH_WAIT=1 ./rollback.sh --restore "$SNAPSHOT" > "$OUTPUT" 2>&1
wait_healthy
test "$(cat "$DATA/marker.txt")" = before-drill
test "$(curl -fsS http://127.0.0.1:8297/healthz | tr -d '\n')" != ""
! grep -q 'drill-only-password' "$OUTPUT"
printf 'drill: PASS (temporary data=%s, container=moon-bot-drill, port=8297)\n' "$ROOT"
