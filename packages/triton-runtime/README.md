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
- GitHub registration at `POST /api/analysis/github` (shallow clone or **incremental fetch** if the repo already exists under `TRITON_GIT_CACHE_ROOT`)
- GitHub sync at `POST /api/workspace/github/sync` (same body as registration; updates an existing cached clone via `git fetch` / `git pull`)
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

**GitHub:** the host must have `git` on `PATH`. In Docker, the image installs **`ca-certificates`** so Git can verify `https://github.com` (without it you may see `CAfile: none` / certificate verification failed). Optional env:

- `TRITON_GIT_CACHE_ROOT` — where clones are stored (default: `<state-dir>/github-cache`).
- `TRITON_GIT_CLONE_TIMEOUT_MS` — clone timeout in ms (default `180000`).
- `TRITON_HTTP_PATH_PREFIX` — when the HTTP request path includes a gateway prefix (e.g. `/triton/api/...` instead of `/api/...`), set this to that prefix (e.g. `/triton`) so routing matches.
- `TRITON_GITHUB_TOKEN` — optional default **PAT** for private repos (server-wide). Per-request overrides: `Authorization: Bearer <token>`, header `x-github-token`, or JSON field `githubToken` (UI uses the latter for ad-hoc PATs).

`POST /api/analysis/github` and `POST /api/workspace/github/sync` JSON body: `{ "repositoryUrl": "https://github.com/org/repo", "ref": "main", "githubToken": "optional" }` — `ref` is optional. If the clone directory already exists, the runtime **updates** it (no full wipe).

If `POST /api/analysis/github` returns JSON `{ "error": "not_found", ... }`:

1. **Upgrade** so `/health` reports `"version": "0.3.0"` (or newer), `capabilities` includes `github-sync`, and `GET /api/analysis/github` returns JSON describing POST (not `not_found`). If GET also returns `not_found`, you are not hitting this codebase’s server on that port.
2. Read the **`pathnameRaw`** field on the 404 body (0.2.1+). If it looks like `/something/api/analysis/github` instead of `/api/analysis/github`, your reverse proxy forwards a **path prefix**. Set **`TRITON_HTTP_PATH_PREFIX`** to that prefix (e.g. `/something`) on the runtime process and restart, or reconfigure the proxy to strip the prefix before forwarding.
3. **`path` ends with `/api/analysis/github/`** — trailing slash was fixed by normalizing paths; upgrade if you still see this on an older build.

**Smoke test:** `curl -sS -X POST http://127.0.0.1:4317/api/analysis/github -H 'content-type: application/json' -d '{}'`

- **HTTP 400** with `missing_repository_url` → the GitHub route exists; your clone URL/body was wrong.
- **HTTP 404** with `not_found` → the running Node process does **not** include `POST /api/analysis/github` (wrong checkout, stale Docker image, or a second older binary bound to that port).

If `TRITON_ALLOWED_REPO_ROOTS` points at a workspace root, the landing page also lists discovered repositories under that root and remembers recently opened repositories.
When the browser UI is running against this runtime, source links from artefact panels can open a read-only source tab inside Triton instead of handing off to the IDE.

## Docker Compose

From the repo root:

```bash
cd /Users/markoboger/workspace/tritongraph
TRITON_LOCAL_REPOS=/Users/markoboger/workspace docker compose up --build
```

Inside the container, host repos are mounted at `/repos`, so the `chess` example becomes `/repos/chess`.

**Postgres (optional, for upcoming DB-backed courses/projects):**

```bash
docker compose --profile postgres up -d postgres
```

Runtime does not connect to it yet; `DATABASE_URL` wiring comes in a later change.

Near-term next steps:

- let runtime-backed refresh/rescan requests update the browser's live data path directly
- add workspace scan endpoints that return a fully built Triton payload, not just raw workspace inputs
- package the runtime independently from the editor dev server
