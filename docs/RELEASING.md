# Releasing Moon Bot

Two artifacts ship from one tag: the desktop installers (Windows NSIS + portable, Linux
AppImage) and the web image every server pulls. `main` is always releasable; a release is a
tag on `main`, never a branch.

## Versions and the tag

`app/package.json` holds the version the desktop apps install as; `core/package.json` follows
it. The desktop workflow refuses a `v*` tag that does not match `app/package.json`, so bump
both first:

```sh
node scripts/version.mjs            # print the current versions and the tag they imply
node scripts/version.mjs 0.2.1      # write both manifests (commit the result)
```

## Cutting a release

1. `dev` is green and merged into `main` (pull requests go to `dev`; a release is the only
   reason `main` moves on its own).
2. Bump the version (above) and commit it.
3. `git tag v0.2.1 && git push origin main v0.2.1`.
4. Two workflows run on the tag:
   - **Desktop** builds the Windows and Linux installers, checks the packaged app on each and
     publishes a GitHub pre-release with the update metadata the installed apps read.
   - **Web image** runs the browser end-to-end check against the mock model first, and only
     then publishes the root Dockerfile to GHCR.
5. Watch both workflows; a red end-to-end job means no image was published, which is the
   intended failure mode — fix forward, do not publish by hand.

## What the web image carries

| Tag | When |
|---|---|
| `ghcr.io/moli-mochou/moon-bot:<short sha>` | every push to `main` and every tag |
| `:main`, `:latest` | every push to `main` (and a tag made from `main`) |
| `:vX.Y.Z` | the release tag |

Each image names its commit twice: the `org.opencontainers.image.revision` label and
`/opt/moon-bot/REVISION`. `/healthz` reports it too, so a deploy can prove what is running
without a shell:

```sh
curl -s https://<server>:8290/healthz      # {"ok":true,"revision":"abc1234"}
```

## Deploying a release to a server

A first install (or a rebuild of the whole stack) is one command:

```sh
curl -fsSL https://raw.githubusercontent.com/MoLi-MoChou/moon-bot/main/deploy/install.sh | sh
```

It writes `.env` once (generating a password and printing it), starts the container on 8290 and
waits for `/healthz`; the data folder is created empty and never touched again. To upgrade an
install, either rerun it (`--tag vX.Y.Z`) or use `deploy/update.sh` in the install directory:
it records the running tag, pulls, restarts, and rolls itself back when the new tag does not
become healthy. `deploy/rollback.sh` repeats that by hand.

Never edit `.env` from a release step, never point a deploy at a data folder you did not mean,
and never publish a version that did not pass the workflows above.

## Rollback

- **Web**: `deploy/rollback.sh` (or `deploy/update.sh <previous tag>`) — the previous tag is
  recorded in `.previous` before every update.
- **Desktop**: users install the previous release from GitHub Releases; the updater follows
  the feed, so a bad release is fixed by publishing the next version, not by deleting one.
