# Triton Architecture Explorer

Browser-first architecture analysis for Scala and sbt projects, with a local web UI, a VS Code-compatible extension, runtime-backed workspace loading, and deep links back into the IDE.

## Quick links

- [Open Triton in the browser](http://127.0.0.1:5173)
- [Start Triton Server from the extension](command:triton.startServer)
- [Start Triton Runtime from the extension](command:triton.startRuntime)
- [Open the diagram from the extension](command:triton.openDiagram)
- [Student plugin install guide](docs/student-plugin-install.md)

Command links work from a trusted README inside VS Code, Cursor, and similar editors after the Triton extension is installed. On GitHub or in a plain browser they show as normal links but will not launch local IDE commands.

## Start Triton locally

### Browser app only

```bash
cd /Users/markoboger/workspace/tritongraph/editor
npm install
npm run dev
```

This starts the local Triton web UI, usually at [http://127.0.0.1:5173](http://127.0.0.1:5173).

### Runtime service

```bash
cd /Users/markoboger/workspace/tritongraph/packages/triton-runtime
npm install
npm start
```

This starts the local Triton runtime, usually at `http://127.0.0.1:4317`.

### IDE-managed startup

If you have the Triton extension installed in VS Code, Cursor, or Windsurf, you can let the extension start both services for you:

1. Set `triton.localRepoPath` to `/Users/markoboger/workspace/tritongraph`.
2. Enable `triton.autoStartServer=true`.
3. Enable `triton.autoStartRuntime=true`.
4. Run `Triton: Open Diagram`, or use the command links above from this README.

## Current web UI behavior

Open the URL above in Cursor’s internal browser, VS Code Simple Browser, or your normal browser.

- **Load example** — loads `public/example.ilograph.yaml`.
- **Open YAML** — import any compatible file.
- **Download YAML** — export; includes optional `x-triton-editor` with node positions for round-trip in this editor (remove that key if a strict importer rejects unknown top-level fields).
- **Single-click** a container (group with submodules) to **zoom the viewport** onto that subtree and fade unrelated context (Ilograph-style drill). **Escape** or a click on the **empty canvas** zooms back out.
- **Double-click** a module or group to edit its name / subtitle.

Auto-layout uses **from** dependent **to** dependency in YAML. The canvas places **columns by dependency depth** (consumers on the **left**, classpath foundations on the **right**). Each column gets an **equal share of viewport width**; nodes in a column split **viewport height** (margins + stack gaps). Every box gets explicit **width/height** from that allocation so modules **scale with the pane**. Nested groups use the same rules inside the parent frame.

## Extension direction

The current direction is a browser-first Triton integration for VS Code and Cursor, with a local service now and cloud/webhook support later. The working product and architecture plan lives in [docs/vscode-plugin-roadmap.md](/Users/markoboger/workspace/tritongraph/docs/vscode-plugin-roadmap.md).

## Runtime direction

The repo now also contains a first `triton-runtime` scaffold under [packages/triton-runtime/README.md](/Users/markoboger/workspace/tritongraph/packages/triton-runtime/README.md). This is the intended bridge between:

- local IDE integrations today
- browser UI data loading
- future CI/CD and cloud-hosted Triton execution

## Ilograph compatibility

The YAML follows the Ilograph spec: top-level `resources` (tree via `children`) and `perspectives` with `relations` using `from` / `to` (dependent → depended-on), matching Ilograph relation semantics so you can open the same file in Ilograph as a backup viewer.
