---
name: triton-cloud-starter
description: Minimal Cloud-agent setup, run, and test workflows for the Triton monorepo.
---

# Triton Cloud Starter Skill

Use this skill when you need to get productive in this repo quickly: bootstrap dependencies, run the right service/package, and execute high-signal tests by area.

## 1) Fast bootstrap (Cloud-agent first 5 minutes)

1. Verify toolchain:
   - `node -v`
   - `npm -v`
2. This repo is not a single root npm workspace. Install only in the area you are changing.
3. Default local endpoints:
   - Editor UI: `http://127.0.0.1:5173`
   - Runtime API: `http://127.0.0.1:4317`

## 2) Auth / login expectations

- Local run/test paths do not require app login.
- If you need GitHub read operations (release checks, PR context), verify auth with `gh auth status`.
- If you need extension publishing (rare for normal code changes), sign in to a Visual Studio Marketplace publisher account and use a PAT, then run `npm run publish:marketplace` from `packages/triton-vscode-extension`.

## 3) Area-specific run + test workflows

### A. `editor/` (Vite + Vue UI)

Purpose: main browser app and most UI behavior.

Setup and run:

1. `cd /workspace/editor`
2. `npm install`
3. `npm run dev`

High-signal test loops:

- Fast logic coverage: `npm run test:unit`
- Browser regression flow: `npm run test:e2e`
- First-time Playwright setup (if Chromium missing): `npm run test:e2e:install`
- Full editor gate: `npm run test`

Practical mock/flag equivalents:

- Use dojo fixtures when you do not need a live workspace/runtime:
  - `http://127.0.0.1:5173/?tab=dojo:folding&perspective=dependencies`
  - `http://127.0.0.1:5173/?tab=dojo:nesting&perspective=dependencies`
- Runtime-backed mode is driven by URL params (`runtimeUrl`, `workspaceFolder`) and enables in-app workspace actions.

### B. `packages/triton-runtime/` (workspace API + sbt action bridge)

Purpose: serves workspace bundle data and executes refresh/test/coverage actions.

Setup and run:

1. `cd /workspace/packages/triton-runtime`
2. `npm install`
3. `npm start`

Optional host/port override:

- `TRITON_RUNTIME_HOST=127.0.0.1 TRITON_RUNTIME_PORT=4317 npm start`

Concrete terminal-driven checks:

- Health: `curl -sS http://127.0.0.1:4317/health`
- Workspace bundle: `curl -sS "http://127.0.0.1:4317/api/workspace/bundle?workspacePath=/workspace"`
- Refresh action (safe no-op): `curl -sS -X POST http://127.0.0.1:4317/api/workspace/action -H "content-type: application/json" -d '{"action":"refresh","workspacePath":"/workspace"}'`

Notes:

- `sbt-test` and `sbt-coverage` actions shell out to `sbt`; use those only when the target workspace has sbt available.
- For quick API validation without sbt dependencies, prefer `health`, `bundle`, and `refresh`.

### C. `packages/triton-vscode-extension/` (IDE integration)

Purpose: command surface, runtime/server autostart, and IDE deep-linking.

Setup and package:

1. `cd /workspace/packages/triton-vscode-extension`
2. `npm install` (if needed for packaging dependencies)
3. `npm run package:vsix`

Configuration knobs (treat as feature flags):

- `triton.autoStartServer`
- `triton.autoStartRuntime`
- `triton.refreshAction` (`reopen` | `sbt-test` | `sbt-coverage`)
- `triton.openMode`
- `triton.runtimeUrl`
- `triton.serverUrl`

Practical smoke workflow:

1. Set `triton.localRepoPath` to `/workspace`.
2. Enable `triton.autoStartServer=true` and (optionally) `triton.autoStartRuntime=true`.
3. Run `Triton: Open Diagram`.
4. Run `Triton: Refresh Diagram`.
5. Run `Triton: Run sbt test` / `Triton: Run coverageReport` only in a Scala/sbt workspace.

### D. `tools/sbt-to-ilograph/` and `packages/triton-core/` (shared parsing/tooling)

Purpose: shared parsing/build logic and CLI conversion tooling.

Recommended checks:

- Tool compile check: `cd /workspace/tools/sbt-to-ilograph && npm install && npm run build`
- Example generation run (writes `diagram.ilograph.yaml` files under `sbt-examples/*`): `npm run generate`

Guidance:

- Prefer running `npm run build` for validation when you do not want generated file churn.
- Validate `triton-core` changes indirectly through editor unit/e2e tests that consume shared parsing behavior.

## 4) Common Cloud-agent execution patterns

- If working on UI behavior: run `editor` dev server and at least one unit + one e2e workflow.
- If working on runtime endpoints/actions: run runtime + curl checks, then validate editor/runtime integration path.
- If working on extension behavior: package VSIX and execute install/smoke path in IDE (or keep changes narrowly covered by focused logic checks when GUI validation is out-of-scope).
- Prefer incremental, area-scoped tests over broad full-repo runs.

## 5) Keep this skill current (lightweight runbook loop)

Whenever you discover a new high-signal command, workaround, or flaky-test fix:

1. Add it to the relevant area above (`editor`, `runtime`, `extension`, `tooling`).
2. Include:
   - the exact command(s),
   - when to use it,
   - known caveats (for example, requires sbt, writes generated files, needs Playwright install).
3. Remove obsolete steps immediately when scripts/endpoints/settings change.
4. Keep entries minimal and executable (Cloud-agent-ready, no long narrative).
