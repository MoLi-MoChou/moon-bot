#!/bin/sh
# Roll back a deploy, or explicitly restore a data snapshot before starting the old image.
#
#   ./rollback.sh                         # use the previous tag from .previous
#   ./rollback.sh <tag>                   # roll back to a tag by hand
#   ./rollback.sh --restore <snapshot>    # restore data.tar.gz, then use its previous tag
set -eu
cd "$(dirname "$0")"
DEPLOY_DIR=$(pwd -P)
COMPOSE="docker compose -f docker-compose.yml"
HEALTH_TRIES=${HEALTH_TRIES:-30}
HEALTH_WAIT=${HEALTH_WAIT:-2}

[ -f .env ] || { echo "rollback: .env is missing beside this script" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "rollback: docker is required" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "rollback: docker compose (the plugin) is required" >&2; exit 1; }

env_value() {
  sed -n "s/^$1=//p" .env 2>/dev/null | tail -1
}
CONTAINER=$(env_value MOON_BOT_CONTAINER)
CONTAINER=${CONTAINER:-moon-bot}
REGISTRY=$(env_value MOON_BOT_REGISTRY)
REGISTRY=${REGISTRY:-ghcr.io/zk020106/moon-bot}
DATA_DIR="$DEPLOY_DIR/data"
SNAPSHOT_CONFIG=$(env_value MOON_BOT_SNAPSHOT_DIR)
SNAPSHOT_CONFIG=${SNAPSHOT_CONFIG:-.snapshots}
if [ -L "$SNAPSHOT_CONFIG" ]; then
  echo "rollback: refusing to use a symlink as the snapshot directory" >&2
  exit 1
fi
if [ "${SNAPSHOT_CONFIG#/}" != "$SNAPSHOT_CONFIG" ]; then
  SNAPSHOT_DIR=$SNAPSHOT_CONFIG
else
  SNAPSHOT_DIR="$DEPLOY_DIR/$SNAPSHOT_CONFIG"
fi
mkdir -p "$SNAPSHOT_DIR"
SNAPSHOT_DIR=$(CDPATH= cd -P -- "$SNAPSHOT_DIR" && pwd)
if [ -L "$DATA_DIR" ]; then
  echo "rollback: refusing to use a symlink as the data directory" >&2
  exit 1
fi
case "$SNAPSHOT_DIR" in
  "$DATA_DIR"|"$DATA_DIR"/*)
    echo "rollback: snapshot directory must not be inside data" >&2
    exit 1
    ;;
esac

restore_path=
case "${1:-}" in
  --restore)
    [ $# -eq 2 ] || { echo "rollback: --restore needs a snapshot directory" >&2; exit 1; }
    restore_path=$2
    ;;
  --help|-h)
    sed -n '2,8p' "$0"
    exit 0
    ;;
esac

if [ -n "$restore_path" ]; then
  case "$restore_path" in
    /*) snapshot=$restore_path ;;
    *) snapshot="$DEPLOY_DIR/$restore_path" ;;
  esac
  [ -d "$snapshot" ] || { echo "rollback: snapshot directory does not exist" >&2; exit 1; }
  [ ! -L "$snapshot" ] || { echo "rollback: refusing a symlink snapshot directory" >&2; exit 1; }
  snapshot=$(CDPATH= cd -P -- "$snapshot" && pwd)
  case "$snapshot" in
    "$SNAPSHOT_DIR"/snapshot-*) ;;
    *) echo "rollback: snapshot must be inside $SNAPSHOT_DIR" >&2; exit 1 ;;
  esac
  [ -f "$snapshot/data.tar.gz" ] || { echo "rollback: snapshot is missing data.tar.gz" >&2; exit 1; }
  [ ! -L "$snapshot/data.tar.gz" ] || { echo "rollback: snapshot archive must not be a symlink" >&2; exit 1; }
  [ -f "$snapshot/manifest" ] || { echo "rollback: snapshot is missing manifest" >&2; exit 1; }
  [ ! -L "$snapshot/manifest" ] || { echo "rollback: snapshot manifest must not be a symlink" >&2; exit 1; }
  previous_tag=$(sed -n 's/^previous_tag=//p' "$snapshot/manifest" | tail -1)
  [ -n "$previous_tag" ] || { echo "rollback: snapshot has no previous tag" >&2; exit 1; }
else
  case "${1:-}" in
    '') previous_tag=$(sed -n 's/^MOON_BOT_PREVIOUS_TAG=//p' .previous 2>/dev/null | tail -1) ;;
    *) previous_tag=$1 ;;
  esac
fi
previous_image=$(sed -n 's/^MOON_BOT_PREVIOUS_IMAGE=//p' .previous 2>/dev/null | tail -1)
[ -n "$previous_tag" ] || { echo "rollback: no previous tag recorded; pass one: ./rollback.sh <tag>" >&2; exit 1; }
case "$previous_tag" in
  ''|*[!A-Za-z0-9._-]*) echo "rollback: tag contains unsupported characters" >&2; exit 1 ;;
esac

health() {
  i=0
  while [ "$i" -lt "$HEALTH_TRIES" ]; do
    state=$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo missing)
    [ "$state" = healthy ] && return 0
    [ "$state" = unhealthy ] && return 1
    sleep "$HEALTH_WAIT"
    i=$((i + 1))
  done
  return 1
}

write_tag() {
  tag=$1
  tmp=$(mktemp .env.rollback.XXXXXX)
  if grep -q '^MOON_BOT_TAG=' .env 2>/dev/null; then
    sed "s/^MOON_BOT_TAG=.*/MOON_BOT_TAG=$tag/" .env > "$tmp"
  else
    cat .env > "$tmp"
    printf '\nMOON_BOT_TAG=%s\n' "$tag" >> "$tmp"
  fi
  chmod 600 "$tmp" 2>/dev/null || true
  mv "$tmp" .env
}

restore_snapshot() {
  snapshot=$1
  [ ! -L "$DATA_DIR" ] || { echo "rollback: refusing to use a symlink as the data directory" >&2; return 1; }
  mkdir -p "$DATA_DIR"
  staging=$(mktemp -d "$DEPLOY_DIR/.restore.XXXXXX")
  cleanup() { rm -rf -- "$staging"; }
  trap cleanup EXIT INT TERM
  if ! tar -xzf "$snapshot/data.tar.gz" -C "$staging"; then
    echo "rollback: snapshot archive is not readable" >&2
    return 1
  fi
  # The archive is created from data/ and must not escape the staging directory.
  [ -f "$staging/store.sqlite3" ] || [ -f "$staging/state.json" ] || {
    echo "rollback: snapshot does not look like a Moon Bot data directory" >&2
    return 1
  }
  if find "$staging" -type l -print -quit | grep -q .; then
    echo "rollback: snapshot contains symlinks and was not restored" >&2
    return 1
  fi
  if find "$staging" -type f ! -perm -u=r -print -quit | grep -q .; then
    echo "rollback: snapshot contains unreadable files and was not restored" >&2
    return 1
  fi
  $COMPOSE down >/dev/null 2>&1 || true
  backup="$DEPLOY_DIR/.data-before-restore-$$"
  if [ -e "$backup" ]; then
    echo "rollback: temporary restore backup already exists" >&2
    return 1
  fi
  mv "$DATA_DIR" "$backup"
  if ! mv "$staging" "$DATA_DIR"; then
    mv "$backup" "$DATA_DIR"
    echo "rollback: could not install restored data" >&2
    return 1
  fi
  rm -rf -- "$backup"
  trap - EXIT INT TERM
}

if [ -n "$restore_path" ]; then
  echo "rollback: restoring snapshot $snapshot"
  restore_snapshot "$snapshot"
fi

echo "rollback: to tag $previous_tag${previous_image:+ (image recorded)}"
write_tag "$previous_tag"
# Prefer the exact image recorded by update.sh. This matters after --restore: .env may
# still name the failed registry/tag, so pulling that tag would restart the bad image.
if [ -n "$previous_image" ] && docker image inspect "$previous_image" >/dev/null 2>&1; then
  docker tag "$previous_image" "$REGISTRY:$previous_tag" >/dev/null 2>&1 || true
else
  # Pull is best effort for a manual rollback when the old image is not in the local cache.
  $COMPOSE pull >/dev/null 2>&1 || true
fi
$COMPOSE up -d >/dev/null 2>&1
if health; then
  echo "rollback: healthy — $previous_tag"
  exit 0
fi
echo "rollback: $previous_tag did not become healthy" >&2
exit 1
