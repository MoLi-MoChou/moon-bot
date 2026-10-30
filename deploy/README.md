# Moon Bot web: run and deploy

Local, from `apps/desktop/`:

    npm ci && MOON_BOT_PASSWORD=choose-one npm run web      # http://127.0.0.1:8290

Docker, from the repository root (a one-off build, for trying it out):

    docker build --build-arg REVISION=$(git rev-parse --short HEAD) -t moon-bot .
    docker run -d -p 8290:8290 -e MOON_BOT_PASSWORD=choose-one -v moon-bot-data:/data moon-bot

## One command on a server

```sh
curl -fsSL https://raw.githubusercontent.com/MoLi-MoChou/moon-bot/main/deploy/install.sh | sh
```

`deploy/install.sh` writes `.env` once (a generated password is printed once), creates `./data`
and hands it to the container user, starts the container on 8290 and waits for `/healthz`.
Re-run it with `--tag vX.Y.Z` to upgrade; the data folder is created empty and never reset.
Options: `--tag`, `--dir`, `--port`, `--registry`, `--password`, `--name`, `--yes`
(`sh deploy/install.sh --help`). `--name` (or `MOON_BOT_CONTAINER` in `.env`) runs a second
instance on the same host — its own container, port and data folder.

`update.sh` pulls the target image **before** it rewrites `MOON_BOT_TAG`, so a tag that does
not exist leaves the install exactly as it was. Before replacing a running container it stops
writes, archives `data/` into a mode-700 snapshot directory, records the SQLite
`user_version`, and keeps only `MOON_BOT_SNAPSHOT_RETENTION` snapshots (default 5). The
archive contains the data only; it never prints its contents or `.env` values.

If a new image fails health without changing the SQLite schema, the script restores the prior
image automatically. If the schema changed (or cannot be inspected), it deliberately leaves
the new container for diagnosis and prints the snapshot plus the explicit recovery command:

```sh
./rollback.sh --restore .snapshots/snapshot-<timestamp>-<tag>-<pid>
```

`rollback.sh --restore` stops the container, validates and extracts the snapshot in a private
staging directory, atomically replaces `data/`, then starts the snapshot's previous tag and
waits for health. A normal `./rollback.sh` still preserves the existing tag/container flow.

The full release procedure — versions, the tag, what the workflows publish, rollback — is in
[docs/RELEASING.md](../docs/RELEASING.md).

## On a server: pull a published image

`.github/workflows/web-image.yml` builds the root Dockerfile and pushes it to GHCR once the
browser end-to-end check is green: a short-sha tag on every push to `main`, plus `:main`
and `:latest`; a `v*` tag also publishes that version.

1. Copy `deploy/` to the server (`docker-compose.yml`, `update.sh`, `rollback.sh`).
2. `cp .env.example .env` and fill in `MOON_BOT_PASSWORD`, the provider keys and — if the
   package is private — `docker login ghcr.io` once with a read-only token.
3. `./update.sh` pulls the tag in `.env` (`latest` unless told otherwise), restarts the
   container and waits for `/healthz`; a tag that does not come up healthy rolls itself
   back to the one that was running. `./rollback.sh` does the same by hand, and
   `./update.sh <tag>` moves to a specific build.

Data (Bots, chats, memory, settings) lives in `deploy/data`, mounted at `/data`; the image
never writes there at build time, so a redeploy replaces the container and keeps the team.
Providers may also be configured in the interface, under Settings.

## Safe local drill

`deploy/drill.sh` is a non-destructive exercise for the snapshot guard. It uses a temporary
filesystem, a throwaway `moon-bot-drill` container, and host port 8297; it removes all of them
on exit. It does not read a configured install or production data. Build a local image first,
then run:

```sh
docker build -t moon-bot:drill .
MOON_BOT_DRILL_IMAGE=moon-bot:drill ./deploy/drill.sh
```

The drill checks a healthy update, bounded snapshot creation, a deliberately unhealthy image
that changes `user_version` (no blind image rollback), and explicit snapshot restoration.

Environment: `MOON_BOT_PASSWORD` (required off loopback), `MOON_BOT_WEB_HOST` (0.0.0.0 in
the image), `MOON_BOT_WEB_PORT` (8290), `MOON_BOT_DATA` (/data), `MOON_BOT_WORKSPACE`.
The image carries its commit in `/opt/moon-bot/REVISION` and in
`org.opencontainers.image.revision`; `update.sh` prints it after a deploy.
In the web version the desktop-only parts (window controls, app updater, data-folder
move) are hidden; updates come with a new image.
