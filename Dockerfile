# Moon Bot standalone web version: the app's UI served by Moon Bot's own service
# (core/src/service) in a normal browser behind a password page.
#
#   docker build -t moon-bot .
#   docker run -d -p 8290:8290 -e MOON_BOT_PASSWORD=... -v moon-bot-data:/data moon-bot
FROM node:22-bookworm-slim AS ui

# The window's UI: the same React surface the desktop app loads, built by vite.
WORKDIR /opt/moon-bot
# One root lockfile for both workspaces: the manifests come first, so the install layer
# caches while the sources change.
COPY package.json package-lock.json ./
COPY scripts/ scripts/
COPY core/package.json core/tsconfig.json core/
COPY app/package.json app/vite.config.js app/
COPY app/ui/ app/ui/
# The window compiles the Bot views from core's TypeScript sources.
COPY core/src/ core/src/
# npm ci cannot focus one workspace, so the whole tree installs; the electron binary is
# never fetched here, and the node_modules leave with the stage.
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund \
 && cd app && npx vite build && rm -rf node_modules ../node_modules core/node_modules

FROM node:22-bookworm-slim

# bubblewrap confines the Bots' shell commands; git, curl and python3 are there for the
# Bots to use.
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap ca-certificates curl git python3 tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/moon-bot
# The manifests again, so the runtime install layer caches on its own. The root
# postinstall script rides along: the install runs it to build core's artifacts.
COPY package.json package-lock.json ./
COPY scripts/ scripts/
COPY core/package.json core/tsconfig.json core/
COPY app/package.json app/
# Host/service ship as TypeScript sources; Node will not strip types under node_modules.
# The build needs the dev dependencies (esbuild, typescript), so the tree installs once
# whole; a second, production-only install replaces it, and the desktop-only packages
# (pnpm, the updater) leave with it: the web service runs core alone.
COPY core/ core/
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund \
 && node core/scripts/build-host.mjs \
 && rm -rf node_modules core/node_modules app/node_modules \
 && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund \
 && rm -rf app/node_modules/pnpm app/node_modules/electron-updater \
 && npm cache clean --force
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
