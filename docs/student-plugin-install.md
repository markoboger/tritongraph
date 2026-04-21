# Triton Student Install Guide

This guide is for installing the current Triton beta plugin in VS Code, Cursor, or Windsurf from a local `.vsix` file.

## Plugin file

Current beta build:

- [triton-architecture-explorer-0.3.0.vsix](/Users/markoboger/workspace/tritongraph/packages/triton-vscode-extension/dist/triton-architecture-explorer-0.3.0.vsix)

If you distribute Triton to students, give them this `.vsix` file directly, for example via:

- your course LMS
- a shared drive
- a GitHub release attachment
- email or chat upload

## Install in VS Code

1. Download the `.vsix` file.
2. Open VS Code.
3. Open the Extensions view.
4. Click the `...` menu in the Extensions panel.
5. Choose `Install from VSIX...`.
6. Select `triton-architecture-explorer-0.3.0.vsix`.

## Install in Cursor

1. Download the `.vsix` file.
2. Open Cursor.
3. Open the Extensions view.
4. Open the extension actions menu.
5. Choose the VSIX install action.
6. Select `triton-architecture-explorer-0.3.0.vsix`.

## Install in Windsurf

1. Download the `.vsix` file.
2. Open Windsurf.
3. Open the Extensions view.
4. Open the extension actions menu.
5. Choose `Install from VSIX...` if available.
6. Select `triton-architecture-explorer-0.3.0.vsix`.

If Windsurf prefers Open VSX later, that can be added as a second distribution channel. For this beta, the `.vsix` route is the simplest.

## First use

After installation:

1. Open a Scala / sbt project.
2. Open the command palette.
3. Run `Triton: Open Diagram`.

If Triton is already running locally, the browser UI should open immediately.

## How updates work

Students can update Triton in two ways:

1. Manual reinstall:
   Download the newest `.vsix` and install it again with `Install from VSIX...`.
2. In-plugin update check:
   Run `Triton: Check For Updates`.

When a newer beta is published as a GitHub release with a `.vsix` asset, Triton can notify the student and open the download link directly.

## Current beta expectations

This beta currently works best when:

- the project is Scala and sbt based
- Triton is running locally
- the browser UI is opened externally or in an IDE browser

## Local Triton server

If students also need to run Triton locally from source, the current manual startup commands are:

Browser app:

```bash
cd /Users/markoboger/workspace/tritongraph/editor
npm install
npm run dev
```

Runtime:

```bash
cd /Users/markoboger/workspace/tritongraph/packages/triton-runtime
npm install
npm start
```

Default local URLs:

- browser UI: `http://127.0.0.1:5173`
- runtime: `http://127.0.0.1:4317`

## Recommended course distribution

For a class rollout, the easiest setup is:

1. Upload the `.vsix` to your course platform.
2. Share this install guide.
3. Share one example Scala / sbt project.
4. Ask students to install the plugin and run `Triton: Open Diagram`.
