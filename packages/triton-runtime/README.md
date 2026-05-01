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
- local repo validation via `TRITON_ALLOWED_REPO_ROOTS`
- home data endpoint at `GET /api/home`
- local analysis launch endpoint at `POST /api/analysis/local`
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
