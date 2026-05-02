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

### Standalone runtime + browser UI

The runtime can now be used independently from the IDE plugin:

1. Start the browser UI:

```bash
cd /Users/markoboger/workspace/tritongraph/editor
npm install
npm run dev
```

2. Start the runtime:

```bash
cd /Users/markoboger/workspace/tritongraph/packages/triton-runtime
npm install
TRITON_ALLOWED_REPO_ROOTS=/Users/markoboger/workspace \
TRITON_EDITOR_URL=http://127.0.0.1:5173 \
npm start
```

3. Open [http://127.0.0.1:4317](http://127.0.0.1:4317), enter an absolute repo path such as `/Users/markoboger/workspace/chess`, and open either:
- `sbt` diagram
- package diagram

The runtime validates that the repo path is inside `TRITON_ALLOWED_REPO_ROOTS`, then launches the existing runtime-backed editor flow against that local repository. The landing page also shows discovered repositories under the configured roots plus a clickable list of recently opened repositories.

### Docker Compose deployment

You can also run a first standalone deployment with Docker Compose:

```bash
cd /Users/markoboger/workspace/tritongraph
TRITON_LOCAL_REPOS=/Users/markoboger/workspace docker compose up --build
```

Then:

- open [http://127.0.0.1:4317](http://127.0.0.1:4317)
- select a discovered mounted repo such as `/repos/chess`, or enter it directly
- open the generated diagram link in the Triton UI

Compose services:

- `postgres` on `5432` (persistence for the runtime)
- `triton-runtime` on `4317` (`TRITON_PERSISTENCE_BACKEND=postgres` by default in `docker-compose.yml`)
- `triton-ui` on `8080`

To use **file** persistence instead (JSON under the runtime state dir), edit `docker-compose.yml` on `triton-runtime`: comment `TRITON_PERSISTENCE_BACKEND: postgres` / `DATABASE_URL: …`, uncomment the file lines, and remove `depends_on: postgres` (and optionally drop the `postgres` service).

### IDE-managed startup

If you have the Triton extension installed in VS Code, Cursor, or Windsurf, you can let the extension start both services for you:

1. Set `triton.localRepoPath` to `/Users/markoboger/workspace/tritongraph`.
2. Enable `triton.autoStartServer=true`.
3. Enable `triton.autoStartRuntime=true`.
4. Run `Triton: Open Diagram`, or use the command links above from this README.

## Testing

The editor now has a two-layer test setup:

- `Vitest` for fast unit tests around graph conversion, routing, layering, and relation visibility.
- `Playwright` for browser-level dojo scenarios that lock down diagram behavior such as nesting, focus, and relation toggles.

### Run tests

```bash
cd /Users/markoboger/workspace/tritongraph/editor
npm run test
```

For faster iteration, run either layer on its own:

```bash
cd /Users/markoboger/workspace/tritongraph/editor
npm run test:unit
npm run test:e2e
```

If Playwright has not downloaded Chromium yet:

```bash
cd /Users/markoboger/workspace/tritongraph/editor
npm run test:e2e:install
```

### Coverage report

Unit tests write an inspectable HTML coverage report to:

- [editor/coverage/index.html](/Users/markoboger/workspace/tritongraph/editor/coverage/index.html)

That report lets you drill into file-level details such as:

- [editor/coverage/ilographToFlow.ts.html](/Users/markoboger/workspace/tritongraph/editor/coverage/ilographToFlow.ts.html)
- [editor/coverage/anchoredSmoothStepRelations.ts.html](/Users/markoboger/workspace/tritongraph/editor/coverage/anchoredSmoothStepRelations.ts.html)
- [editor/coverage/innerArtefactLayerLayout.ts.html](/Users/markoboger/workspace/tritongraph/editor/coverage/innerArtefactLayerLayout.ts.html)
- [editor/coverage/relationVisibility.ts.html](/Users/markoboger/workspace/tritongraph/editor/coverage/relationVisibility.ts.html)

### Dojo fixtures

Browser regression scenarios live under:

- [editor/src/dojo/fixtures](/Users/markoboger/workspace/tritongraph/editor/src/dojo/fixtures)

You can open them directly in the browser UI with URLs like:

- [http://127.0.0.1:5173/?tab=dojo:folding&perspective=dependencies](http://127.0.0.1:5173/?tab=dojo:folding&perspective=dependencies)
- [http://127.0.0.1:5173/?tab=dojo:nesting&perspective=dependencies](http://127.0.0.1:5173/?tab=dojo:nesting&perspective=dependencies)
- [http://127.0.0.1:5173/?tab=dojo:relations&perspective=dependencies](http://127.0.0.1:5173/?tab=dojo:relations&perspective=dependencies)

The active diagram and perspective are now mirrored into the URL, so a reload keeps you on the same view.

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
