#!/bin/sh
# Update Moon Bot web to a published image and prove it came up (plan 阶段 A):
#
#   ./update.sh            # the tag in .env, else latest
#   ./update.sh <tag>      # a short sha, main, latest, v1.2.3
#
# The tag that was running goes to .previous before anything moves, so a failed health
# check rolls back by itself; rollback.sh repeats that by hand. The data folder and the
# .env are never touched — a redeploy only replaces the container.
set -eu
cd "$(dirname "$0")"
COMPOSE="docker compose -f docker-compose.yml"
HEALTH_TRIES=${HEALTH_TRIES:-30}
HEALTH_WAIT=${HEALTH_WAIT:-2}

[ -f .env ] || { echo "update: put .env beside this script first (MOON_BOT_PASSWORD, provider keys)" >&2; exit 1; }

tag_of() { sed -n 's/^MOON_BOT_TAG=//p' .env 2>/dev/null | tail -1; }
write_tag() {
  tag=$1
  if grep -q '^MOON_BOT_TAG=' .env 2>/dev/null; then
    tmp=$(mktemp)
    sed "s/^MOON_BOT_TAG=.*/MOON_BOT_TAG=$tag/" .env > "$tmp" && cat "$tmp" > .env && rm -f "$tmp"
  else
    printf '\nMOON_BOT_TAG=%s\n' "$tag" >> .env
  fi
}

current=$(tag_of)
current=${current:-latest}
target=${1:-$current}

# Remember what is running now, for rollback: the tag, and the exact image id behind it.
if docker ps --format '{{.Names}}' | grep -qx moon-bot; then
  running=$(docker inspect moon-bot --format '{{.Config.Image}}' 2>/dev/null || echo "")
  printf 'MOON_BOT_PREVIOUS_TAG=%s\nMOON_BOT_PREVIOUS_IMAGE=%s\n' "$current" "$running" > .previous
  echo "update: running $running (tag $current)"
else
  printf 'MOON_BOT_PREVIOUS_TAG=\nMOON_BOT_PREVIOUS_IMAGE=\n' > .previous
  echo "update: no container yet"
fi

health() {
  # The compose health check already curls /healthz; ask docker for its verdict.
  i=0
  while [ "$i" -lt "$HEALTH_TRIES" ]; do
    state=$(docker inspect moon-bot --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
    [ "$state" = "healthy" ] && return 0
    [ "$state" = "unhealthy" ] && return 1
    sleep "$HEALTH_WAIT"; i=$((i + 1))
  done
  return 1
}

rollback_previous() {
  previous_image=$(sed -n 's/^MOON_BOT_PREVIOUS_IMAGE=//p' .previous 2>/dev/null | tail -1)
  [ -n "$previous_image" ] || { echo "update: nothing to roll back to" >&2; return 1; }
  echo "update: rolling back to $previous_image"
  $COMPOSE down
  docker tag "$previous_image" "${MOON_BOT_REGISTRY:-ghcr.io/moli-mochou/moon-bot}:$current"
  $COMPOSE up -d
  health || { echo "update: the previous image did not come up either" >&2; return 1; }
  echo "update: rolled back to $current"
}

write_tag "$target"
echo "update: pulling ${MOON_BOT_REGISTRY:-ghcr.io/moli-mochou/moon-bot}:$target"
$COMPOSE pull
$COMPOSE up -d
if health; then
  revision=$(docker exec moon-bot cat /opt/moon-bot/REVISION 2>/dev/null || echo unknown)
  echo "update: healthy — $target (REVISION $revision)"
  exit 0
fi
echo "update: the new image did not become healthy; rolling back" >&2
rollback_previous
exit 1
