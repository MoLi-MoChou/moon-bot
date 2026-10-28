# Moon Bot web: run and deploy

Local, from `app/`:

    npm ci && MOON_BOT_PASSWORD=choose-one npm run web      # http://127.0.0.1:8290

Docker, from the repository root (a one-off build, for trying it out):

    docker build --build-arg REVISION=$(git rev-parse --short HEAD) -t moon-bot .
    docker run -d -p 8290:8290 -e MOON_BOT_PASSWORD=choose-one -v moon-bot-data:/data moon-bot

## One command on a server

```sh
curl -fsSL https://raw.githubusercontent.com/MoLi-MoChou/moon-bot/main/deploy/install.sh | sh
```

`deploy/install.sh` writes `.env` once (a generated password is printed once), starts the
container on 8290 and waits for `/healthz`. Re-run it with `--tag vX.Y.Z` to upgrade; the data
folder is created empty and never reset. Options: `--tag`, `--dir`, `--port`, `--registry`,
`--password`, `--yes` (`sh deploy/install.sh --help`).

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

Environment: `MOON_BOT_PASSWORD` (required off loopback), `MOON_BOT_WEB_HOST` (0.0.0.0 in
the image), `MOON_BOT_WEB_PORT` (8290), `MOON_BOT_DATA` (/data), `MOON_BOT_WORKSPACE`.
The image carries its commit in `/opt/moon-bot/REVISION` and in
`org.opencontainers.image.revision`; `update.sh` prints it after a deploy.
In the web version the desktop-only parts (window controls, app updater, data-folder
move) are hidden; updates come with a new image.
