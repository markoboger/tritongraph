# Triton Architecture Explorer

Browser-first VS Code-compatible extension for Triton.

`Triton Architecture Explorer` opens Triton's browser-based architecture views for Scala and sbt projects, lets students and developers inspect project/package structure, and follows links back into code inside VS Code, Cursor, and similar editors.

## Quick actions

- [Start Triton Server](command:triton.startServer)
- [Start Triton Runtime](command:triton.startRuntime)
- [Open Diagram](command:triton.openDiagram)
- [Open local browser UI](http://127.0.0.1:5173)

The `command:` links work from a trusted README inside VS Code-compatible editors after the extension is installed. The localhost link works whenever the local server is already running.

Current MVP scaffold:

- `Triton: Open Diagram` builds a Triton browser URL for the current workspace and opens it externally
- `Triton: Start Local Server` starts the local Vite-based Triton editor when `triton.localRepoPath` is configured
- `Triton: Stop Local Server` stops the extension-managed local Triton process
- `Triton: Start Runtime` starts `triton-runtime` when `triton.localRepoPath` is configured
- `Triton: Stop Runtime` stops the extension-managed runtime process
- `Triton: Refresh Diagram` reopens Triton with a fresh refresh token for the current workspace
- `Triton: Run sbt test` executes the configured sbt test command in the active workspace
- `Triton: Run coverageReport` executes the configured sbt coverage command in the active workspace
- `Triton: Copy Diagram URL` copies that URL for README/plugin-description/manual sharing
- `Triton: Show Server URL` copies the base Triton server URL and reveals it in the output channel
- `Triton: Show Output` opens an output channel that logs the Triton URL and IDE callback URL
- `Triton: Check For Updates` checks the configured GitHub release feed for a newer beta `.vsix`
- registers an IDE URI handler so the browser app can deep-link back into source files
- `npm run package:vsix` produces a local `.vsix` in `dist/`
- `npm run package:marketplace` builds a pre-release Marketplace package with `vsce`
- `npm run publish:marketplace` publishes the Marketplace pre-release once publisher credentials are configured
- [`INSTALL.md`](./INSTALL.md) documents install and smoke-test steps for VS Code and Cursor

Current assumptions:

- Triton is already running locally on `http://127.0.0.1:5173` unless overridden by `triton.serverUrl`
- the browser app remains the main UI for now
- Scala/sbt workspaces are the first-class target
- the extension currently uses lightweight workspace probing (`build.sbt`, `project/`, `src/main|test/scala`) rather than full project import
- `triton.openMode` supports `auto`, `external`, `simple-browser`, and `copy`
- `triton.refreshOnCommit` can auto-refresh when `.git/HEAD` changes inside the workspace
- `triton.autoStartServer` + `triton.localRepoPath` let the extension start the current repo's Vite app if Triton is offline
- `triton.runtimeUrl` + `triton.autoStartRuntime` let the extension call and optionally start `triton-runtime`
- `triton.refreshAction` lets refresh either reopen Triton, run `sbt test`, or run the configured coverage command before reopening
- `triton.autoCheckUpdates` periodically checks GitHub Releases for newer beta builds
- `triton.updateFeedUrl` can override the default GitHub Releases API endpoint if you move updates elsewhere

Current status:

- the browser app now consumes the generated `ideOpenUrl`
- Triton shows a visible IDE-connected state when opened from the extension
- the local `.vsix` packaging path exists and can be installed manually
- workspace actions now prefer `triton-runtime` and fall back to direct shell tasks only when the runtime is unavailable
- `Triton: Open Diagram` now passes `runtimeUrl` and `workspaceFolder` so the browser can load live workspace data from `triton-runtime`
- when `triton.autoStartRuntime` is enabled, opening the diagram will also try to bring up `triton-runtime` before launching the browser
- runtime-backed browser sessions now offer in-place `Refresh`, `Run sbt test`, and `Run coverage` actions that reload the active workspace tab after the runtime action completes

Next implementation steps:

- validate the full install/open/click-back loop and the in-browser runtime action loop in live VS Code and Cursor sessions
- decide whether `auto` should prefer internal browser mode outside Cursor as well
- replace dev-server launching with a packaged/runtime server strategy once Triton stops depending on the editor repo layout
