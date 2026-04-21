# Triton Extension Install And Test

## Build the `.vsix`

From this package:

```bash
npm run package:vsix
```

That writes:

- `dist/triton-vscode-extension-0.1.0.vsix`

## Install in VS Code

1. Open Extensions.
2. Open the `...` menu.
3. Choose `Install from VSIX...`.
4. Pick `dist/triton-vscode-extension-0.1.0.vsix`.

## Install in Cursor

1. Open Extensions.
2. Open the extension actions menu.
3. Choose the VSIX install action.
4. Pick `dist/triton-vscode-extension-0.1.0.vsix`.

## Configure

Optional settings:

- `triton.serverUrl`
  Default: `http://127.0.0.1:5173`
- `triton.localRepoPath`
  Optional path to a local Triton repo checkout so the extension can start `<repo>/editor`
- `triton.runtimeUrl`
  Default: `http://127.0.0.1:4317`
- `triton.autoStartServer`
  Auto-start Triton when the server URL is not reachable
- `triton.autoStartRuntime`
  Auto-start `triton-runtime` when the runtime URL is not reachable
- `triton.openMode`
  `auto`, `external`, `simple-browser`, or `copy`
- `triton.logLinksInOutput`
  Logs the Triton URL and IDE callback URL
- `triton.refreshOnCommit`
  Auto-refresh Triton when the workspace Git HEAD changes
- `triton.refreshAction`
  `reopen`, `sbt-test`, or `sbt-coverage`
- `triton.sbtExecutable`
  Default: `sbt`
- `triton.sbtTestCommand`
  Default: `test`
- `triton.sbtCoverageCommand`
  Default: `coverage; test; coverageReport`

## Smoke test

1. Start Triton locally, or set `triton.localRepoPath` plus `triton.autoStartServer=true`.
2. Optionally start `triton-runtime`, or set `triton.localRepoPath` plus `triton.autoStartRuntime=true`.
3. Open a Scala/sbt workspace in VS Code or Cursor.
4. Run `Triton: Open Diagram`.
5. Confirm the browser opens Triton with a `Connected to VS Code` or `Connected to Cursor` indicator.
6. Click a class, method, or artefact link in the diagram.
7. Confirm the editor jumps to the requested file and line.
8. Run `Triton: Refresh Diagram` and confirm Triton reopens with a fresh URL.
9. Run `Triton: Show Server URL` and confirm the base server URL is copied and logged.
10. If using managed startup, run `Triton: Stop Local Server` and confirm the dev server stops.
11. Run `Triton: Run sbt test` and `Triton: Run coverageReport` in an sbt workspace and confirm the runtime or fallback task completes.

## Current MVP limitations

- It assumes Triton is already running.
- Auto-start currently depends on a local Triton repo checkout and launches the editor dev server, not a packaged production runtime.
- Runtime startup currently depends on a local Triton repo checkout and launches the scaffold runtime from source.
- The browser app still needs a live runtime-backed ingestion path to consume scan/test/coverage outputs directly.
