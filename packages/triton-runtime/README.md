# triton-runtime

Local and future cloud runtime for Triton.

Purpose:

- expose a stable HTTP API between IDE plugins and the Triton analysis/runtime layer
- run workspace actions such as refresh, `sbt test`, and coverage commands
- provide a service shape that works both on localhost today and in CI/CD or cloud later

Current MVP scaffold:

- Node HTTP server with a health endpoint
- standalone launcher page at `/` with:
  - direct path entry
  - discovered repositories under configured workspace roots
  - recent repositories that can be reopened with one click
- local repo validation via `TRITON_ALLOWED_REPO_ROOTS` (GitHub clones are stored under `TRITON_GIT_CACHE_ROOT` and are allowed when roots are configured; otherwise the same “no root list” rules apply as for local paths)
- home data endpoint at `GET /api/home`
- local analysis launch endpoint at `POST /api/analysis/local`
- GitHub analysis endpoint at `POST /api/analysis/github` (shallow-clones `https://github.com/{owner}/{repo}` into `TRITON_GIT_CACHE_ROOT`, then registers like a local workspace)
- source-file endpoint at `GET /api/workspace/source`
- workspace bundle endpoint that discovers live local inputs:
  - `build.sbt`
  - Scala source files
  - `sbt-test.log`
  - the newest `target/scala-*/scoverage-report/scoverage.xml`
- workspace action endpoint for:
  - `refresh`
  - `sbt-test`
  - `sbt-coverage`
- CLI entrypoint to run the server locally

## Standalone local usage

Run the runtime:

```bash
cd /Users/markoboger/workspace/tritongraph/packages/triton-runtime
npm install
TRITON_ALLOWED_REPO_ROOTS=/Users/markoboger/workspace \
TRITON_EDITOR_URL=http://127.0.0.1:5173 \
npm start
```

Then open `http://127.0.0.1:4317`, enter a repo path like `/Users/markoboger/workspace/chess`, and use the generated links to open the Triton browser UI against that workspace.

**GitHub:** the host must have `git` on `PATH`. Optional env:

- `TRITON_GIT_CACHE_ROOT` — where clones are stored (default: `<state-dir>/github-cache`).
- `TRITON_GIT_CLONE_TIMEOUT_MS` — clone timeout in ms (default `180000`).

`POST /api/analysis/github` JSON body: `{ "repositoryUrl": "https://github.com/org/repo", "ref": "main" }` — `ref` is optional (default branch). Re-adding the same repo removes the previous clone directory and clones again (prototype behaviour).

Requires **public** repositories over HTTPS until auth is added.

If `POST /api/analysis/github` returns JSON `{ "error": "not_found", ... }`:

- **`path` ends with `/api/analysis/github/`** — you used a **trailing slash** on the URL; older servers treated that as unknown (fixed in current `github-link` by normalizing paths). Drop the slash or upgrade runtime.
- **`path` is `/api/analysis/github`** but still `not_found` — the process is an **older triton-runtime** without the route. Check `GET /health` for `"capabilities": ["analysis-local", "analysis-github"]` and `"version": "0.2.0"`.

If `TRITON_ALLOWED_REPO_ROOTS` points at a workspace root, the landing page also lists discovered repositories under that root and remembers recently opened repositories.
When the browser UI is running against this runtime, source links from artefact panels can open a read-only source tab inside Triton instead of handing off to the IDE.

## Docker Compose

From the repo root:

```bash
cd /Users/markoboger/workspace/tritongraph
TRITON_LOCAL_REPOS=/Users/markoboger/workspace docker compose up --build
```

Inside the container, host repos are mounted at `/repos`, so the `chess` example becomes `/repos/chess`.

Near-term next steps:

- let runtime-backed refresh/rescan requests update the browser's live data path directly
- add workspace scan endpoints that return a fully built Triton payload, not just raw workspace inputs
- package the runtime independently from the editor dev server
