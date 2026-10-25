# Moon Bot standalone web version: the app's UI served by Moon Bot's own service
# (core/src/service) in a normal browser behind a password page.
#
#   docker build -t moon-bot .
#   docker run -d -p 8290:8290 -e MOON_BOT_PASSWORD=... -v moon-bot-data:/data moon-bot
FROM node:22-bookworm-slim AS ui

# The window's UI: the same React surface the desktop app loads, built by vite.
WORKDIR /opt/moon-bot
COPY app/package.json app/package-lock.json app/.npmrc app/
COPY app/vite.config.js app/
COPY app/ui/ app/ui/
COPY core/package.json core/tsconfig.json core/
# Client pulls shared (+ siblings); copy whole src tree for the vite UI stage.
COPY core/src/ core/src/
# Vite UI only — skip electron main (scripts/build-main). moon-bot-core is file:../core.
RUN cd app && npm ci --no-audit --no-fund && npx vite build && rm -rf node_modules

FROM node:22-bookworm-slim

# bubblewrap confines the Bots' shell commands; git, curl and python3 are there for the
# Bots to use.
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap ca-certificates curl git python3 tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/moon-bot
COPY core/ core/
# Host/service ship as TypeScript sources; Node will not strip types under node_modules.
# Emit plain JS into core/dist, then install the runtime deps (better-sqlite3 needs its
# install script for the prebuilt binding).
RUN cd core \
 && npm install --no-save --no-audit --no-fund --ignore-scripts esbuild@0.28.2 typescript@5.9.3 @types/better-sqlite3 \
 && node scripts/build-host.mjs \
 && rm -rf node_modules \
 && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=ui /opt/moon-bot/app/ui/dist/ app/ui/dist/
COPY NOTICE LICENSE ./

ENV NODE_ENV=production \
    MOON_BOT_DATA=/data \
    MOON_BOT_WORKSPACE=/data/workspace \
    MOON_BOT_UI=/opt/moon-bot/app/ui/dist \
    MOON_BOT_WEB_HOST=0.0.0.0 \
    MOON_BOT_WEB_PORT=8290
RUN mkdir -p /data/workspace && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8290
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "core/dist/service/main.js"]
