#!/bin/sh
# Roll back one deploy: the tag update.sh replaced last time (plan 阶段 A). With no
# argument it reads .previous; `./rollback.sh <tag>` names a tag by hand. The data folder
# and .env stay as they are — only the container is replaced.
set -eu
cd "$(dirname "$0")"
COMPOSE="docker compose -f docker-compose.yml"
HEALTH_TRIES=${HEALTH_TRIES:-30}
HEALTH_WAIT=${HEALTH_WAIT:-2}

[ -f .env ] || { echo "rollback: .env is missing beside this script" >&2; exit 1; }

previous_tag=${1:-$(sed -n 's/^MOON_BOT_PREVIOUS_TAG=//p' .previous 2>/dev/null | tail -1)}
previous_image=$(sed -n 's/^MOON_BOT_PREVIOUS_IMAGE=//p' .previous 2>/dev/null | tail -1)
[ -n "$previous_tag" ] || { echo "rollback: no previous tag recorded; pass one: ./rollback.sh <tag>" >&2; exit 1; }

health() {
  i=0
  while [ "$i" -lt "$HEALTH_TRIES" ]; do
    state=$(docker inspect moon-bot --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
    [ "$state" = "healthy" ] && return 0
    [ "$state" = "unhealthy" ] && return 1
    sleep "$HEALTH_WAIT"; i=$((i + 1))
  done
  return 1
}

write_tag() {
  tag=$1
  if grep -q '^MOON_BOT_TAG=' .env 2>/dev/null; then
    tmp=$(mktemp)
    sed "s/^MOON_BOT_TAG=.*/MOON_BOT_TAG=$tag/" .env > "$tmp" && cat "$tmp" > .env && rm -f "$tmp"
  else
    printf '\nMOON_BOT_TAG=%s\n' "$tag" >> .env
  fi
}

echo "rollback: to tag $previous_tag${previous_image:+ (image $previous_image)}"
write_tag "$previous_tag"
$COMPOSE pull || true
$COMPOSE up -d
if health; then
  echo "rollback: healthy — $previous_tag"
  exit 0
fi
echo "rollback: $previous_tag did not become healthy" >&2
exit 1
