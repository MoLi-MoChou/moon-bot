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

A release also walks the hand checklist in `docs/dev/release-checklist.md` on a real
machine (window frame, input method, high DPI, install and upgrade); CI cannot see any of it.

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

## Publishing the connect CLI

`moon-bot-connect` is a separate npm package with its own version and tag; a release of
the product does not publish it and the reverse.

1. `node scripts/version.mjs connect X.Y.Z` (prints the tag it implies), commit.
2. `git tag connect-vX.Y.Z && git push origin main connect-vX.Y.Z`.
3. `.github/workflows/publish-connect.yml` checks the tag against
   `connect/package.json`, runs `npm run verify:package -w moon-bot-connect` (packs the
   tarball, installs it into a throwaway prefix and runs the installed bin) and only then
   runs `npm publish --access public --provenance`.

The workflow needs one repository secret, **`NPM_TOKEN`**: a granular token with
read-and-write access to `moon-bot-connect`. Without it the job fails at the publish step
and nothing reaches the registry. Re-running a tag for a version that is already published
is a green no-op — the job checks the registry first.

To publish by hand instead, run `npm run verify:package -w moon-bot-connect` and then
`npm publish -w moon-bot-connect --access public` from a machine that is logged in. A first
publish of a new package answers `202 Accepted`: the metadata shows up first and the
tarball can 404 for a few minutes while the registry processes it — retry `npm view` rather
than republishing. `verify:package` runs in the `Test` workflow too, on a runner with no
agent CLI installed (the case that made its doctor check fail once). If the account requires 2FA for publishing, use an **Automation** token
(a Publish token aborts with `EOTP`), or stage with `npm stage publish` and approve later
with `npm stage approve <id>`.

## Deploying a release to a server

A first install (or a rebuild of the whole stack) is one command:

```sh
curl -fsSL https://raw.githubusercontent.com/MoLi-MoChou/moon-bot/main/deploy/install.sh | sh
```

It writes `.env` once (generating a password and printing it), starts the container on 8290 and
waits for `/healthz`; the data folder is created empty and never touched again. To upgrade an
install, either rerun it (`--tag vX.Y.Z`) or use `deploy/update.sh` in the install directory.
The update script pulls before changing `.env`, stops the container before archiving `data/`,
records SQLite `user_version`, and retains a bounded number of private snapshots. It only
performs an automatic image rollback when the schema is unchanged and inspected successfully.

Never edit `.env` from a release step, never point a deploy at a data folder you did not mean,
and never publish a version that did not pass the workflows above.

## Rollback

- **Web**: `deploy/rollback.sh` uses `.previous` for an image-only rollback. If a failed image
  migrated SQLite (or schema inspection was inconclusive), `update.sh` intentionally leaves
  the new container in place and prints a recovery command. Restore explicitly, after checking
  the diagnosis, with:

  ```sh
  ./rollback.sh --restore .snapshots/snapshot-<timestamp>-<tag>-<pid>
  ```

  This stops the container, validates the archive in a staging directory, replaces `data/`,
  and starts the snapshot's previous tag. `MOON_BOT_SNAPSHOT_DIR` and
  `MOON_BOT_SNAPSHOT_RETENTION` configure the private snapshot directory and its bound
  (defaults `.snapshots` and 5). Snapshot archives contain application data only; secrets in
  `.env` are never copied or printed.
- **Desktop**: users install the previous release from GitHub Releases; the updater follows
  the feed, so a bad release is fixed by publishing the next version, not by deleting one.
