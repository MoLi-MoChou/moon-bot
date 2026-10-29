#!/bin/sh
# One-command Moon Bot web install for a server (plan 阶段 A): fetch the published image,
# write the environment file once, start the container and wait until /healthz answers.
#
#   curl -fsSL https://raw.githubusercontent.com/MoLi-MoChou/moon-bot/main/deploy/install.sh | sh
#   ./deploy/install.sh --tag main --port 8290 --dir /opt/moon-bot
#
# Options:
#   --tag <tag>          image tag to run: main, latest, a short sha or vX.Y.Z (default: latest)
#   --dir <path>         where the compose file and data live (default: /opt/moon-bot, else ~/moon-bot)
#   --port <port>        host port (default: 8290)
#   --registry <image>   another registry/repository
#   --password <value>   MOON_BOT_PASSWORD; without it, a random one is generated and printed once
#   --name <container>   container name (default: moon-bot); a second instance needs its own
#   --yes                skip the confirmation of the target directory
#
# The data folder is created empty on a first install and never touched again; .env is
# written only when it does not exist yet, so a rerun is an upgrade, not a reset.
set -eu
REPO="MoLi-MoChou/moon-bot"
REGISTRY="ghcr.io/zk020106/moon-bot"
TAG="latest"
PORT="8290"
DIR=""
PASSWORD="${MOON_BOT_PASSWORD:-}"
CONTAINER="${MOON_BOT_CONTAINER:-moon-bot}"
ASSUME_YES=""
RAW_BASE="https://raw.githubusercontent.com"

say() { printf '%s\n' "$*"; }
die() { printf 'install: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG=${2:?--tag needs a value}; shift 2 ;;
    --dir) DIR=${2:?--dir needs a value}; shift 2 ;;
    --port) PORT=${2:?--port needs a value}; shift 2 ;;
    --registry) REGISTRY=${2:?--registry needs a value}; shift 2 ;;
    --password) PASSWORD=${2:?--password needs a value}; shift 2 ;;
    --name) CONTAINER=${2:?--name needs a value}; shift 2 ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "docker is required"
docker compose version >/dev/null 2>&1 || die "docker compose (the plugin) is required"

if [ -z "$DIR" ]; then
  if [ -w /opt ] 2>/dev/null; then DIR=/opt/moon-bot; else DIR="$HOME/moon-bot"; fi
fi
mkdir -p "$DIR"

# The compose file travels with the release it runs; a piped install fetches it.
here=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || printf '')
if [ -n "$here" ] && [ -f "$here/docker-compose.yml" ]; then
  cp "$here/docker-compose.yml" "$DIR/docker-compose.yml"
else
  say "install: fetching docker-compose.yml for $TAG"
  curl -fsSL "$RAW_BASE/$REPO/$TAG/deploy/docker-compose.yml" -o "$DIR/docker-compose.yml" \
    || die "could not fetch docker-compose.yml for $TAG"
fi

if [ -n "$ASSUME_YES" ]; then :; else
  say "install: will run Moon Bot from $REGISTRY:$TAG"
  say "         data and .env in $DIR, port $PORT"
  printf 'Continue? [Y/n] '
  answer=""
  read -r answer || answer=""
  case "$answer" in ''|y|Y|yes|Yes) ;; *) die "cancelled" ;; esac
fi

if [ ! -f "$DIR/.env" ]; then
  if [ -z "$PASSWORD" ]; then
    PASSWORD=$(node -e 'const c=require("crypto");const a="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";let s="";for(const x of c.randomBytes(32))s+=a[x%a.length];console.log(s)' 2>/dev/null \
      || od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
    generated=1
  fi
  umask 077
  {
    printf 'MOON_BOT_PASSWORD=%s\n' "$PASSWORD"
    printf 'MOON_BOT_TAG=%s\n' "$TAG"
    printf 'MOON_BOT_REGISTRY=%s\n' "$REGISTRY"
    printf 'MOON_BOT_PORT=%s\n' "$PORT"
    printf 'MOON_BOT_CONTAINER=%s\n' "$CONTAINER"
    printf '# Provider keys, as the service reads them (or set them up in Settings).\n'
    printf '# SENSENOVA_API_KEY=\n'
  } > "$DIR/.env"
  chmod 600 "$DIR/.env"
  if [ "${generated:-}" = "1" ]; then
    say ""
    say "install: the password below is the only way into the web page — keep it:"
    say ""
    say "    $PASSWORD"
    say ""
  fi
else
  say "install: keeping the existing $DIR/.env"
  # The tag is the one thing an upgrade must be able to move.
  if grep -q '^MOON_BOT_TAG=' "$DIR/.env"; then
    sed -i "s/^MOON_BOT_TAG=.*/MOON_BOT_TAG=$TAG/" "$DIR/.env" 2>/dev/null || true
  fi
fi

cd "$DIR"
say "install: pulling $REGISTRY:$TAG"
docker compose pull

# A bind mount is created root-owned, while the image runs as node (uid 1000): a fresh
# install would start and then fail to write /data/attachments. Hand the folder to the
# image's own user before the container starts; as root, plain chown is enough.
mkdir -p "$DIR/data"
if [ "$(id -u)" = "0" ]; then
  chown -R 1000:1000 "$DIR/data"
else
  say "install: handing $DIR/data to the container user"
  docker run --rm --user 0 -v "$DIR/data:/data" --entrypoint chown "$REGISTRY:$TAG" -R node:node /data
fi
docker compose up -d

say "install: waiting for /healthz"
i=0
while [ $i -lt 60 ]; do
  state=$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  [ "$state" = "healthy" ] && break
  sleep 2; i=$((i + 1))
done
[ "$state" = "healthy" ] || { docker compose logs --tail 40 || true; die "the container did not become healthy"; }

revision=$(docker exec "$CONTAINER" cat /opt/moon-bot/REVISION 2>/dev/null || echo "$TAG")
say ""
say "install: Moon Bot is up — http://<this server>:$PORT/login"
say "         REVISION $revision, data in $DIR/data, container $CONTAINER"
say "         update later with: cd $DIR && docker compose pull && docker compose up -d"
