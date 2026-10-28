#!/bin/sh
# Update Moon Bot to a published image, snapshot data safely, and prove it came up.
#
#   ./update.sh            # the tag in .env, else latest
#   ./update.sh <tag>      # a short sha, main, latest, v1.2.3
#
# The current container is stopped before the data snapshot is taken. If the new image
# fails health and has changed SQLite's user_version, it stays running for diagnosis:
# restoring data is an explicit operator action (`rollback.sh --restore`).
set -eu
cd "$(dirname "$0")"
DEPLOY_DIR=$(pwd -P)
COMPOSE="docker compose -f docker-compose.yml"
HEALTH_TRIES=${HEALTH_TRIES:-30}
HEALTH_WAIT=${HEALTH_WAIT:-2}

[ -f .env ] || { echo "update: put .env beside this script first (MOON_BOT_PASSWORD, provider keys)" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "update: docker is required" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "update: docker compose (the plugin) is required" >&2; exit 1; }

env_value() {
  sed -n "s/^$1=//p" .env 2>/dev/null | tail -1
}

CONTAINER=$(env_value MOON_BOT_CONTAINER)
CONTAINER=${CONTAINER:-moon-bot}
REGISTRY=$(env_value MOON_BOT_REGISTRY)
REGISTRY=${REGISTRY:-ghcr.io/moli-mochou/moon-bot}
DATA_DIR="$DEPLOY_DIR/data"
SNAPSHOT_CONFIG=$(env_value MOON_BOT_SNAPSHOT_DIR)
SNAPSHOT_CONFIG=${SNAPSHOT_CONFIG:-.snapshots}
SNAPSHOT_RETENTION=$(env_value MOON_BOT_SNAPSHOT_RETENTION)
SNAPSHOT_RETENTION=${SNAPSHOT_RETENTION:-5}

case "$SNAPSHOT_RETENTION" in
  ''|*[!0-9]*) echo "update: MOON_BOT_SNAPSHOT_RETENTION must be a positive integer" >&2; exit 1 ;;
  0) echo "update: MOON_BOT_SNAPSHOT_RETENTION must be at least 1" >&2; exit 1 ;;
esac

if [ -L "$DATA_DIR" ]; then
  echo "update: refusing to use a symlink as the data directory" >&2
  exit 1
fi
mkdir -p "$DATA_DIR"
if [ -L "$SNAPSHOT_CONFIG" ]; then
  echo "update: refusing to use a symlink as the snapshot directory" >&2
  exit 1
fi
if [ "${SNAPSHOT_CONFIG#/}" != "$SNAPSHOT_CONFIG" ]; then
  SNAPSHOT_DIR=$SNAPSHOT_CONFIG
else
  SNAPSHOT_DIR="$DEPLOY_DIR/$SNAPSHOT_CONFIG"
fi
mkdir -p "$SNAPSHOT_DIR"
SNAPSHOT_DIR=$(CDPATH= cd -P -- "$SNAPSHOT_DIR" && pwd)
case "$SNAPSHOT_DIR" in
  "$DATA_DIR"|"$DATA_DIR"/*)
    echo "update: snapshot directory must not be inside data" >&2
    exit 1
    ;;
esac
chmod 700 "$SNAPSHOT_DIR" 2>/dev/null || true

tag_of() { env_value MOON_BOT_TAG; }
write_tag() {
  tag=$1
  tmp=$(mktemp .env.update.XXXXXX)
  if grep -q '^MOON_BOT_TAG=' .env 2>/dev/null; then
    sed "s/^MOON_BOT_TAG=.*/MOON_BOT_TAG=$tag/" .env > "$tmp"
  else
    cat .env > "$tmp"
    printf '\nMOON_BOT_TAG=%s\n' "$tag" >> "$tmp"
  fi
  chmod 600 "$tmp" 2>/dev/null || true
  mv "$tmp" .env
}

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

# Read the store schema without opening the production database on the host. The image
# already contains better-sqlite3, and the read-only bind mount prevents this helper from
# changing data. A missing store is version zero; an unreadable store is an error.
schema_version() {
  image=$1
  if [ ! -f "$DATA_DIR/store.sqlite3" ]; then
    printf '0\n'
    return 0
  fi
  version=$(docker run --rm --user 1000:1000 -e NODE_PATH=/opt/moon-bot/core/node_modules -v "$DATA_DIR:/data:ro" --entrypoint node "$image" \
    --input-type=commonjs -e 'const Database=require("better-sqlite3");const db=new Database("/data/store.sqlite3",{readonly:true});process.stdout.write(String(db.pragma("user_version",{simple:true})));db.close()' \
    2>/dev/null) || return 1
  case "$version" in
    ''|*[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$version"
}

prune_snapshots() {
  names=$(for path in "$SNAPSHOT_DIR"/snapshot-*; do
    [ -d "$path" ] || continue
    [ -L "$path" ] && continue
    basename "$path"
  done | LC_ALL=C sort)
  count=$(printf '%s\n' "$names" | awk 'NF { n += 1 } END { print n + 0 }')
  remove=$((count - SNAPSHOT_RETENTION))
  [ "$remove" -gt 0 ] || return 0
  printf '%s\n' "$names" | awk -v n="$remove" 'NF && NR <= n { print }' | while IFS= read -r name; do
    path="$SNAPSHOT_DIR/$name"
    case "$path" in
      "$SNAPSHOT_DIR"/snapshot-*) ;;
      *) continue ;;
    esac
    [ -d "$path" ] || continue
    [ -L "$path" ] && continue
    rm -rf -- "$path"
  done
}

current=$(tag_of)
current=${current:-latest}
target=${1:-$current}
case "$target" in
  ''|*[!A-Za-z0-9._-]*) echo "update: tag contains unsupported characters" >&2; exit 1 ;;
esac

target_image="$REGISTRY:$target"
running=0
previous_image=
if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  running=1
  previous_image=$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || true)
else
  previous_image=$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || true)
fi
schema_image=${previous_image:-$REGISTRY:$current}

# Pull first. A missing tag therefore leaves the container, .env and snapshots untouched.
echo "update: pulling $target"
if ! docker pull "$target_image" >/dev/null 2>&1; then
  echo "update: could not pull tag $target; nothing was changed" >&2
  exit 1
fi

# Keep the old installation running if any part of the stop-and-snapshot phase fails.
resume_old() {
  if [ "$running" -eq 1 ]; then
    $COMPOSE up -d >/dev/null 2>&1 || true
  fi
}

if [ "$running" -eq 1 ]; then
  if ! $COMPOSE stop >/dev/null 2>&1; then
    echo "update: could not stop the current container; nothing was changed" >&2
    exit 1
  fi
fi

baseline_status=ok
baseline_schema=0
if baseline_schema=$(schema_version "$schema_image"); then
  :
else
  baseline_status=unknown
  baseline_schema=unknown
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
safe_current=$(printf '%s' "$current" | tr -c 'A-Za-z0-9._-' '_')
snapshot="$SNAPSHOT_DIR/snapshot-$stamp-$safe_current-$$"
if ! mkdir "$snapshot" 2>/dev/null; then
  resume_old
  echo "update: could not create a snapshot directory" >&2
  exit 1
fi
snapshot_failed() {
  rm -rf -- "$snapshot"
  resume_old
  echo "update: data snapshot failed; the old container was left in place" >&2
  exit 1
}
umask 077
if ! tar -czf "$snapshot/data.tar.gz" -C "$DATA_DIR" . >/dev/null 2>&1; then
  snapshot_failed
fi
chmod 600 "$snapshot/data.tar.gz" 2>/dev/null || true
cat > "$snapshot/manifest" <<EOF
format=1
container=$CONTAINER
previous_tag=$current
previous_image=$previous_image
schema_version=$baseline_schema
schema_status=$baseline_status
target_tag=$target
created_at=$stamp
EOF
chmod 600 "$snapshot/manifest" 2>/dev/null || true

# .previous contains no environment values or payloads; it is only deployment metadata.
cat > .previous <<EOF
MOON_BOT_PREVIOUS_TAG=$current
MOON_BOT_PREVIOUS_IMAGE=$previous_image
MOON_BOT_SNAPSHOT=$snapshot
MOON_BOT_SCHEMA_VERSION=$baseline_schema
MOON_BOT_SCHEMA_STATUS=$baseline_status
EOF
chmod 600 .previous 2>/dev/null || true
prune_snapshots

echo "update: snapshot saved at $snapshot"
write_tag "$target"

rollback_previous() {
  [ -n "$previous_image" ] || {
    echo "update: no previous image is available for automatic rollback" >&2
    return 1
  }
  echo "update: rolling back to $current"
  if ! $COMPOSE down >/dev/null 2>&1; then
    echo "update: could not stop the failed container" >&2
    return 1
  fi
  write_tag "$current"
  if ! docker image inspect "$previous_image" >/dev/null 2>&1; then
    docker pull "$REGISTRY:$current" >/dev/null 2>&1 || {
      echo "update: the previous image is not available locally" >&2
      return 1
    }
  fi
  docker tag "$previous_image" "$REGISTRY:$current" >/dev/null 2>&1 || true
  if ! $COMPOSE up -d >/dev/null 2>&1 || ! health; then
    echo "update: the previous image did not become healthy either" >&2
    return 1
  fi
  echo "update: rolled back to $current"
  return 0
}

if $COMPOSE up -d >/dev/null 2>&1 && health; then
  revision=$(docker exec "$CONTAINER" cat /opt/moon-bot/REVISION 2>/dev/null || echo unknown)
  echo "update: healthy — $target (REVISION $revision)"
  exit 0
fi

echo "update: the new image did not become healthy" >&2
new_status=ok
new_schema=0
if new_schema=$(schema_version "$target_image"); then
  :
else
  new_status=unknown
  new_schema=unknown
fi
if [ "$baseline_status" != ok ] || [ "$new_status" != ok ] || [ "$new_schema" != "$baseline_schema" ]; then
  echo "update: SQLite schema changed or could not be inspected; leaving the new container for diagnosis" >&2
  echo "update: snapshot: $snapshot" >&2
  echo "update: restore with: ./rollback.sh --restore $snapshot" >&2
  exit 1
fi

echo "update: schema is unchanged; attempting the previous image" >&2
rollback_previous || true
exit 1
