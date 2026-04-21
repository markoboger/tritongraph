# Triton VS Code / Cursor Plugin Roadmap

## Phase 1: Product Definition

### 1. User workflow

Triton remains a browser-first experience for the MVP.

- The diagram runs in a separate browser tab or window.
- If the IDE offers an embedded browser, such as Cursor's internal browser, we can use that.
- Otherwise, opening the system browser is fine.
- The IDE/plugin is responsible for giving the user a stable way to open Triton.
- Navigation back into code happens through links from the diagram directly into the IDE.

For the MVP, the plugin should expose Triton in three places:

- README usage instructions
- console output when the local Triton server starts
- extension/plugin description

The initial "open Triton" flow is:

1. User opens a Scala workspace in VS Code or Cursor.
2. User runs a command such as `Triton: Open Diagram`.
3. The extension ensures the local Triton service is running.
4. The extension opens the Triton URL in an embedded browser or external browser.
5. The user explores the graph in the browser.
6. Diagram clicks navigate back into source files in the IDE.

### 2. MVP scope

The MVP is intentionally Scala-first and sbt-first.

Primary target:

- multi-module Scala projects
- sbt builds
- generated code present in the workspace
- parser data
- sbt test data
- scoverage data

Explicitly out of MVP for now:

- Java-specific scanners or rules
- TypeScript/web project analysis
- cloud hosting
- GitHub/GitLab webhook-driven refresh
- CI/CD integration

Refresh behavior for the MVP:

- refresh on commit
- manual refresh command from the extension
- optional browser-side button that triggers scanner and/or `sbt test`

Later phases can extend refresh to push and webhook-driven cloud updates.

### 3. Browser/runtime model

For the MVP, Triton stays local.

- local Triton service
- local browser UI
- local IDE integration

Future model:

- Triton hosted in the cloud
- CI/CD hooks publish refreshed analysis
- GitHub/GitLab webhooks update the hosted view

That future should not leak into the MVP architecture in a way that makes the local plugin harder to ship.

## Phase 2: Core extraction

The current codebase already contains two strong seeds for extraction:

- `editor/src/...` contains the Scala/package/test/coverage analysis plus the Vue UI
- `tools/sbt-to-ilograph/...` already contains reusable sbt parsing logic

The extraction target should be:

- `triton-core`
  - Scala and sbt analysis
  - shared graph/data model
  - coverage parsing and rollups
  - test/spec extraction
  - refresh triggers and CLI-friendly orchestration
- `triton-ui`
  - browser app only
  - consumes a stable JSON payload from `triton-core`
  - owns rendering and IDE deep-link generation
- `triton-runtime`
  - local and future cloud service boundary
  - workspace action endpoints
  - scan/test/coverage orchestration
  - reusable localhost/CI/CD execution shape
- `triton-vscode-extension`
  - detects workspace roots
  - launches or connects to the local Triton service
  - opens Triton in browser/simple browser
  - provides commit/manual refresh commands

### Current code mapping

Likely `triton-core` candidates:

- `editor/src/sbt/parseBuildSbt.ts`
- `editor/src/sbt/parseSbtTestLog.ts`
- `editor/src/sbt/parseScoverageXml.ts`
- `editor/src/scala/parseScalaWithTreeSitter.ts`
- `editor/src/scala/scalaPackagesToIlograph.ts`
- `editor/src/store/overlayStore.ts` only if we later want non-UI persistence helpers
- `tools/sbt-to-ilograph/src/*`

Likely `triton-ui` candidates:

- `editor/src/App.vue`
- `editor/src/components/**`
- `editor/src/graph/**`
- `editor/src/highlight/**`
- `editor/src/openInEditor.ts` after it is generalized to editor-deep-link generation

Likely extension-only responsibilities:

- workspace detection
- commit hooks / refresh commands
- local process lifecycle
- browser launching
- IDE file-opening bridge

## Phase 3: VS Code / Cursor extension MVP

Recommended commands:

- `Triton: Open Diagram`
- `Triton: Refresh Diagram`
- `Triton: Show Server URL`

Recommended MVP behavior:

- find the active Scala/sbt workspace
- start or reuse a local Triton process
- print the Triton URL in the output channel and terminal
- open the URL in Cursor simple browser when available, else external browser
- support IDE deep links back into files and lines

The extension should treat Cursor as "VS Code-compatible first" unless a Cursor-specific integration is clearly needed.

## Phase 4: Refresh model

MVP refresh triggers:

- manual extension command
- commit-triggered refresh
- optional browser-side "rescan" or "run sbt test" button

Future refresh triggers:

- push-triggered refresh
- remote/cloud rescan
- webhook callbacks from GitHub/GitLab

## Phase 5: Runtime strategy

Chosen strategy for the MVP:

- embedded/local analysis, not cloud-first

Concretely, the extension should use local code and local processes and should not depend on hosted services.

The architecture should still leave room for later cloud execution by keeping the core analysis and the browser protocol cleanly separated.

## Immediate execution steps

1. Define the stable JSON contract emitted by the core analysis layer.
2. Extract non-UI Scala/sbt analysis into a reusable core package.
3. Make the existing browser UI consume that contract rather than Vite-only virtual modules.
4. Scaffold a VS Code extension that launches Triton and opens the URL.
5. Add IDE deep-link support and manual refresh.
6. Add commit-based refresh.

## Open risks

- The current editor app depends on Vite virtual modules for examples, test logs, and coverage reports.
- The current browser app assumes localhost development ergonomics.
- Generated code and multi-module workspaces may require explicit workspace-root selection rules.
- Commit-triggered refresh needs a practical implementation strategy inside VS Code or via git hooks.

## Current repo decision

The next implementation step after this Phase 1 write-up is to separate reusable analysis code from the browser app and introduce a package structure that supports:

- local browser-first runtime now
- VS Code/Cursor extension integration next
- cloud execution later

## Progress snapshot

Implemented so far:

- `triton-core` now owns shared sbt parsing, scoverage parsing, Scala package-graph building, and a stable Scala workspace payload
- the browser app consumes that shared payload when seeding docs, specs, test blocks, and coverage
- a browser-first VS Code/Cursor extension scaffold exists under `packages/triton-vscode-extension`
- a `triton-runtime` package now exists as the first service-shaped boundary for localhost and future cloud execution
- the extension can:
  - start and stop a local Triton dev server when configured with a repo path
  - start and stop a local `triton-runtime` process when configured with a repo path
  - open Triton in the browser
  - refresh the browser launch for the active workspace
  - run workspace `sbt test` and coverage commands
  - copy the Triton URL
  - reveal/copy the base Triton server URL
  - log the Triton URL and IDE callback URL
  - receive URI callbacks and open source files in the IDE
  - probe the current workspace for Scala/sbt markers
  - use the internal simple browser in `auto` / `simple-browser` mode when available
  - watch `.git/HEAD` and branch refs for opt-in commit-triggered refresh
  - send workspace actions to `triton-runtime`, with direct shell fallback while the runtime remains partial
- `triton-runtime` now exposes a workspace bundle endpoint that discovers:
  - `build.sbt`
  - Scala source files
  - `sbt-test.log`
  - the latest `target/scala-*/scoverage-report/scoverage.xml`
- the browser app can now boot a live runtime-backed workspace tab when launched from the extension with `workspaceFolder` + `runtimeUrl`
- runtime-backed sessions currently open the live sbt workspace first and can switch into the runtime-backed packages view inside the browser
- runtime-backed browser sessions now expose in-place actions for:
  - refresh
  - `sbt test`
  - coverage
  and then reload the active runtime tab without depending on an extension-level browser reopen
- the browser app now detects extension-provided `ideOpenUrl` callbacks and routes open-in-editor actions through the IDE
- a local `.vsix` packaging path exists for manual installation/testing

Most immediate next steps:

1. Validate the install/open/click-back loop in live VS Code and Cursor sessions.
2. Validate the new in-browser runtime refresh/test/coverage loop against a real Scala workspace in VS Code/Cursor.
3. Replace repo-layout-dependent dev-server/runtime startup with a packaged runtime/server strategy.
4. Validate whether `auto` should stay Cursor-first or become the default for all compatible IDE hosts.
