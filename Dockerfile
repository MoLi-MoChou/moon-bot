# Moon Bot standalone web version: the app's UI served by Moon Bot's own service
# (packages/core/src/service) in a normal browser behind a password page.
#
#   docker build -t moon-bot .
#   docker run -d -p 8290:8290 -e MOON_BOT_PASSWORD=... -v moon-bot-data:/data moon-bot
FROM node:22-bookworm-slim AS ui

# The window's UI: the same React surface the desktop app loads, built by vite.
WORKDIR /opt/moon-bot
# pnpm version must match root package.json packageManager.
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
# One root pnpm lockfile for the workspace: manifests first so the install layer
# caches while the sources change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts/ scripts/
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY packages/contracts/package.json packages/contracts/tsconfig.json packages/contracts/
COPY apps/desktop/package.json apps/desktop/vite.config.js apps/desktop/
COPY apps/connect/package.json apps/connect/
COPY apps/desktop/ui/ apps/desktop/ui/
# The window compiles the Bot views from core's TypeScript sources (+ contracts).
COPY packages/core/src/ packages/core/src/
COPY packages/contracts/src/ packages/contracts/src/
# pnpm install cannot focus one workspace without the lock graph, so the whole tree
# installs; the electron binary is never fetched here, and the node_modules leave
# with the stage.
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile \
 && cd apps/desktop && pnpm exec vite build && rm -rf node_modules ../../node_modules ../connect/node_modules ../../packages/core/node_modules

FROM node:22-bookworm-slim

# bubblewrap confines the Bots' shell commands; git, curl and python3 are there for the
# Bots to use.
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap ca-certificates curl git python3 tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/moon-bot
# pnpm version must match root package.json packageManager.
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
# The manifests again, so the runtime install layer caches on its own. The root
# postinstall script rides along: the install runs it to build core's artifacts.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts/ scripts/
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY packages/contracts/package.json packages/contracts/tsconfig.json packages/contracts/
COPY apps/desktop/package.json apps/desktop/
COPY apps/connect/package.json apps/connect/
# Host/service ship as TypeScript sources; Node will not strip types under node_modules.
# The build needs the dev dependencies (esbuild, typescript), so the tree installs once
# whole; a second, production-only install replaces it, and the desktop-only packages
# (pnpm, the updater) leave with it: the web service runs core + contracts.
COPY packages/core/ packages/core/
COPY packages/contracts/ packages/contracts/
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile \
 && node packages/contracts/scripts/build.mjs \
 && node packages/core/scripts/build-host.mjs \
 && rm -rf node_modules packages/core/node_modules packages/contracts/node_modules apps/desktop/node_modules apps/connect/node_modules \
 && ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile --prod \
 && rm -rf apps/desktop/node_modules/pnpm apps/desktop/node_modules/electron-updater \
 && pnpm store prune || true
COPY --from=ui /opt/moon-bot/apps/desktop/ui/dist/ apps/desktop/ui/dist/
COPY NOTICE LICENSE ./

# The commit the image was built from (plan 阶段 A): the release workflow passes the
# short sha, so an image says what it is without a hand-written file, and update/rollback
# can compare the running container against the tag they meant to deploy.
ARG REVISION=unknown
LABEL org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.title="Moon Bot" \
      org.opencontainers.image.source="https://github.com/MoLi-MoChou/moon-bot"
RUN echo "$REVISION" > /opt/moon-bot/REVISION

ENV NODE_ENV=production \
    MOON_BOT_REVISION=$REVISION \
    MOON_BOT_DATA=/data \
    MOON_BOT_WORKSPACE=/data/workspace \
    MOON_BOT_UI=/opt/moon-bot/apps/desktop/ui/dist \
    MOON_BOT_WEB_HOST=0.0.0.0 \
    MOON_BOT_WEB_PORT=8290
RUN mkdir -p /data/workspace && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8290
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/core/dist/service/main.js"]
