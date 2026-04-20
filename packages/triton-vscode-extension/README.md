# triton-vscode-extension

Browser-first VS Code / Cursor extension scaffold for Triton.

Current MVP scaffold:

- `Triton: Open Diagram` builds a Triton browser URL for the current workspace and opens it externally
- `Triton: Copy Diagram URL` copies that URL for README/plugin-description/manual sharing
- `Triton: Show Output` opens an output channel that logs the Triton URL and IDE callback URL
- registers an IDE URI handler so the browser app can deep-link back into source files
- `npm run package:vsix` produces a local `.vsix` in `dist/`

Current assumptions:

- Triton is already running locally on `http://127.0.0.1:5173` unless overridden by `triton.serverUrl`
- the browser app remains the main UI for now
- Scala/sbt workspaces are the first-class target

Next implementation steps:

- teach the browser app to consume the generated `ideOpenUrl`
- add workspace scanning / refresh commands instead of only URL generation
- decide whether Cursor should open Triton in its internal browser when available
