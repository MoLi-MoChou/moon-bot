# Moon Bot web: run and deploy

Local, from `app/`:

    npm ci && MOON_BOT_PASSWORD=choose-one npm run web      # http://127.0.0.1:8290

Docker, from the repository root:

    docker build -t moon-bot .
    docker run -d -p 8290:8290 -e MOON_BOT_PASSWORD=choose-one -v moon-bot-data:/data moon-bot

Server with compose: copy the repository, put `.env` next to `deploy/docker-compose.yml`
(`MOON_BOT_PASSWORD=…`, and a provider key such as `SENSENOVA_API_KEY=…`), optionally seed
the provider settings — copy `settings.example.json` to `deploy/data/settings.json` — then
`docker compose -f deploy/docker-compose.yml up -d --build`. Data (Bots, chats, memory,
settings) lives in `deploy/data`, mounted at `/data`; providers may also be configured in
the interface, under Settings, and the key stays in the container's environment.

Environment: `MOON_BOT_PASSWORD` (required off loopback), `MOON_BOT_WEB_HOST` (0.0.0.0 in
the image), `MOON_BOT_WEB_PORT` (8290), `MOON_BOT_DATA` (/data), `MOON_BOT_WORKSPACE`.
In the web version the desktop-only parts (window controls, app updater, data-folder
move) are hidden; updates come with a redeploy.
