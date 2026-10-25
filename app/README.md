# Moon Bot desktop app

The Electron app for Windows, Linux and macOS. It runs Moon Bot's own runtime — the host
services, the SQLite store and the built-in engine from [`core/`](../core) — in a child process
on a loopback port, and loads that address in its window. There is no DeepSeek Harness install
or profile under it, and a new start begins with an empty team: the app does not read or copy a
DeepSeek Harness install. The design is in
[docs/plans/2026-10-24-standalone-personal-agent.md](../docs/plans/2026-10-24-standalone-personal-agent.md).

## Run

```sh
npm ci
cd ../core && npm run build && cd ../app   # dist/service, which the app's Host runs
node node_modules/electron/install.js     # when npm did not download Electron (no node_modules/electron/dist)
npm start                                 # starts the app
```

When GitHub downloads are slow, set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` before the Electron download. Unset `ELECTRON_RUN_AS_NODE` before `npm start` if your terminal has it (terminals inside some Electron-based editors do): with it, Electron runs as plain Node and the app does not start.

npm installs `moon-bot-core` from `../core` as a copy of its package files (`install-links` in `.npmrc`), so the app runs the runtime of this checkout. Run `npm ci` again after you change `core/` — including its built `dist/` — or merge a branch that changes it: while the version stays the same, `npm install` keeps the old copy.

| Variable | What it sets | Default |
|---|---|---|
| `DS_BOT_HOME` | The data location. When it is set, the app asks nothing at its first start | The folder chosen at the first start |
| `DS_BOT_WORKSPACE` | With `DS_BOT_HOME`: the team workspace | A workspace in the data location |
| `DS_BOT_SHELL_DATA` | The app's own data (window, Chromium storage, `locations.json`) | Electron's `userData` (Windows: `%APPDATA%\Moon Bot`; macOS: `~/Library/Application Support/Moon Bot`) |
| `DS_BOT_UPDATE_URL` | Windows: a folder URL with `latest.yml` and its installer. macOS: a URL returning a JSON list like GitHub's `releases` API; a release counts only when this Mac's zip is attached. Prereleases count only for prerelease installs (see [Updates](#updates)). With `DS_BOT_HOME`, the app checks only when this is set | The newest GitHub release |

## First start and the data location

At its first start the app asks, in system dialogs, for the data location (`~/.moon-bot` by default) and the team workspace (`~/Moon Bot`), and keeps the answer in `locations.json` in its own data. Neither folder may be inside the other, inside another app's data (`DSH_HOME`, else `~/.dsh`), or — when packaged — inside the program folder.

Both change later in Settings > General > Locations. The plugin moves the team workspace and tells the app, which writes it into `locations.json`. The data location moves through the app (`src/move-data.ts`): the new folder must be empty or new and apart from the old data, the team workspace, another app's data and the program folder. The app stops the Host, copies the data into a staging folder beside the new one, renames it to the new folder once it is whole, writes `locations.json` and starts again. A failed or interrupted copy leaves the old location in use and removes the staging folder; the old folder always stays. A run on throwaway folders (`DS_BOT_HOME`) keeps its data location.

The runtime keeps its settings in `settings.json` and its API keys in `credentials.json` (mode 0600) under the data location; Settings in the window write both.

## Web mode

`npm run web` serves the same service and the built window (`ui/dist`) to a normal browser. It reads `MOON_BOT_DATA`, `MOON_BOT_PASSWORD`, `MOON_BOT_WEB_HOST`, `MOON_BOT_WEB_PORT` and `MOON_BOT_UI` (the `MOCHOU_*` and `DSH_BOT_*` names still work). It listens on `127.0.0.1:8290` by default. A password is required on any address but loopback; with one, the page asks for it, exchanges it for the service's signed session cookie, and serves the UI and the Bot channel behind it.

## Check a change

`npm test` checks the data move on throwaway folders, the updater, the window frame, and that the lockfile and package versions agree. `npm run typecheck` and `npm run build` (the window through Vite, the main process through esbuild) must pass too, as the `core/` gates must.

`scripts/shot.mjs` starts the app on throwaway folders, saves a screenshot of its window, prints the page text, closes the window the way a user does and waits until the app exits. It needs a model; point it at `core/dev/mock-llm.ts` and set the provider in the app's Settings, or configure a real provider first.

```sh
DS_BOT_HOME=<tmp>/home DS_BOT_SHELL_DATA=<tmp>/shell node scripts/shot.mjs <tmp>/shot.png 20
```

Never point `DS_BOT_HOME` at your own data, or at `~/.dsh`.

## Package

[electron-builder](https://www.electron.build/) packages the app with the settings in `electron-builder.yml`. Build on the platform and architecture that you package for: native modules (`better-sqlite3`) are taken from `node_modules` as npm installed them, not rebuilt.

```sh
npm run pack           # the app without an installer: dist-pack/win-unpacked/ (Windows), dist-pack/mac*/ (macOS), dist-pack/linux-unpacked/ (Linux)
npm run dist           # the installer: dist-pack/Moon-Bot-<version>-win-x64.exe (Windows), a .zip (macOS), an AppImage (Linux)
npm run check-packed   # starts the packaged app on throwaway folders, chats once, closes it
```

macOS produces one zip per architecture. Build arm64 on an Apple chip Mac and x64 on an Intel Mac, or under Rosetta with an x64 Node that also ran `npm ci`. Do not cross-build: it packages native modules from `node_modules`. `scripts/before-pack.mjs` stops a build whose architecture is not the one of the Node that runs it. The app is ad-hoc signed so downloaded copies are sealed. It ships as a zip, not a dmg: macOS 26 calls a downloaded unsigned dmg damaged and does not open it, and an ad-hoc signature on the dmg does not help (#351). Safari unzips the download; move Moon Bot to Applications. On first open, use System Settings → Privacy & Security → Open Anyway. Do not disable Gatekeeper.

`check-packed` takes another executable as its first argument, and a file for a screenshot of the window as its second. It runs an app that lies inside this checkout from a copy in its throwaway folder: from inside the checkout, Node would find a module that the package left out in the checkout's own `node_modules`.

The Windows installer installs for the current user only, without administrator rights, by default into `%LOCALAPPDATA%\Programs\Moon Bot` (`build/installer.nsh` skips the page that asks for all users or only for the current one). The uninstaller removes the program and keeps the data location and the app's own data. CI builds the Windows installer on every pull request, checks the packaged app, then installs it, checks the installed app and uninstalls it. For a change to `app/` or the workflows, it also updates the installed app before the uninstall (see [Updates](#updates)).

## Updates

The installed app on Windows and Linux updates itself with electron-updater (`src/updates.ts`). At its start and every 4 hours it reads `latest.yml` of the newest GitHub release, which names the installer and its sha512. It downloads that installer in the background and checks its sha512. When the download is done, a dialog on the window asks whether to restart now: then the app stops its Host and runs the installer, which opens the app again. Otherwise the installer runs when the app quits.

The checks start before the Host, so that a version whose Host does not start can still update. When the start fails, the app waits up to 15 seconds for the newest check. When it found a newer version, the error box says so; after the box the app waits for the download, then installs it and opens again.

On macOS, the app checks GitHub's releases at start and every 4 hours. It asks once per version, after that release's zip for this Mac is attached. Stable installs ignore prereleases; prerelease installs can see them. Download opens the release page; Later closes the dialog. The app does not install the update itself. `DS_BOT_UPDATE_URL` on macOS points to a JSON list like the `releases` API response. A release needs `tag_name`, an HTTPS `html_url`, and the matching architecture's zip in `assets`.

On Windows, `app-update.yml` tells the app where its releases are; `npm run dist` writes it from `publish` in `electron-builder.yml`, together with `latest.yml` beside the installer (`npm run pack` writes neither). Neither command publishes. The release workflow (`.github/workflows/release.yml`) builds the installer when a release is published and attaches the installer, its `.blockmap` and `latest.yml` to the release. The release tag is the version of `core/`, and `npm test` checks that the app has the same version. The macOS release job builds each zip on a matching-architecture runner and attaches only the zip.

On throwaway folders (`DS_BOT_HOME`) the app checks for updates only from `DS_BOT_UPDATE_URL`, and it never asks: the update waits until the app quits. `scripts/check-update.mjs` checks the update of a packaged app with such a feed:

```sh
npx electron-builder --publish never -c.extraMetadata.version=<next version> -c.directories.output=dist-next   # the feed
node scripts/check-update.mjs "dist-pack/win-unpacked/Moon Bot.exe" dist-next --kill
```

It serves the feed folder, starts the app on throwaway folders and waits until the app has downloaded the update and checked its sha512. Then it closes the app as a user does, so that the app installs the update as it quits; with `--kill` it ends the app, so that nothing is installed. On your own machine use `--kill`: the installer would install into `%LOCALAPPDATA%\Programs\Moon Bot`. The download stays in `%LOCALAPPDATA%\moon-bot-updater`. CI runs it without `--kill` on its installed app, then checks that the installed version is the new one and that the updated app passes `check-packed`.

On macOS, pass the app executable and a version to mock a newer release:

```sh
node scripts/check-update.mjs "<app executable>" 99.0.0
```

The script serves a releases list with one release of that version that has this Mac's zip, starts the app on throwaway folders with it, waits until the app logs the new version, and closes the window. It does not open a browser.

## Layout

| File | What it does |
|---|---|
| `src/main.ts` | Main process: one instance, the window, the update prompts, and the Host child's lifetime |
| `src/service-host.ts` | The Host: boots `moon-bot-core/service` on a loopback port and reports its URL over IPC, with the same ready/fatal/shutdown protocol as before |
| `src/host-process.ts` | Starts the Host in Electron's Node mode and owns its exit |
| `src/host-port.ts` | The Host's port, kept between starts, since the page keeps its storage per address |
| `src/first-run.ts` | The first start's dialogs (the two folders) and the texts of the data move |
| `src/move-data.ts` | The move of the data location: which folders can take it, and the copy through a staging folder |
| `src/copy-tree.ts` | Copies a folder with its links, for the data move |
| `src/preload.cjs` | Hands the page the data location and its move, and the updater. On Windows it marks the page for the frameless window and sends the caption buttons the colors of the surface under them |
| `src/window-frame.ts`, `src/mica.css` | The frameless Windows window: the caption band, when Mica is available (Windows 11 22H2 and later), and the stylesheet that lets Mica through the sidebar |
| `src/updates.ts` | The Windows and Linux installer updates and macOS release-page checks |
| `src/web.ts`, `src/web-login.ts` | Web mode: the password page and the proxy to the service |
| `src/sandbox.ts` | When Chromium's sandbox cannot start on this Linux host |
| `test/` | `npm test` |
| `ui/` | The app's own window. React, built with Vite (`vite.config.js`) into `ui/dist`. It draws the Bot views from `../core/src/client/` and uses the service's `api/bot` channel and its live `api/bot/feed` |
| `assets/` | The icon and its variants, written by `scripts/icon.py` |
| `electron-builder.yml`, `build/` | The package and the installer: app identity, files, icons, the Windows installer and the Linux and macOS targets |
| `scripts/check-packed.mjs` | `npm run check-packed`: the check of a packaged app |
| `scripts/check-update.mjs` | The check of a packaged app's update from a Windows feed folder or a macOS release |

Some files adapt code from DSH Desktop (MIT); see [NOTICE](../NOTICE).
