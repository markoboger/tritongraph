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
- local repo validation via `TRITON_ALLOWED_REPO_ROOTS` (hosted Git clones are stored under `TRITON_GIT_CACHE_ROOT` and are allowed when roots are configured; otherwise the same “no root list” rules apply as for local paths)
- home data endpoint at `GET /api/home`
- local analysis launch endpoint at `POST /api/analysis/local`
- Hosted Git registration at `POST /api/analysis/github` (**GitHub** or **GitLab** HTTPS URLs — shallow clone or **incremental fetch** if the repo already exists under `TRITON_GIT_CACHE_ROOT`; route name unchanged for compatibility)
- Sync at `POST /api/workspace/github/sync` (same body as registration; updates an existing cached clone via `git fetch` / `git pull`)
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

**Hosted Git (GitHub + GitLab):** the host must have `git` on `PATH`. In Docker, the image installs **`ca-certificates`** so Git can verify HTTPS remotes (without it you may see `CAfile: none` / certificate verification failed). Supported repository URLs:

- `https://github.com/<owner>/<repo>` (exactly two path segments).
- `https://gitlab.com/<namespace>/<project>` or nested groups (`…/group/subgroup/project`).
- Self-hosted GitLab: set **`TRITON_EXTRA_GIT_HOSTS`** to a comma-separated list of hostnames (e.g. `git.my-university.edu`). Those hosts use the same GitLab-style **`oauth2:<token>`** HTTP Basic auth as `gitlab.com`.

Optional env:

- `TRITON_GIT_CACHE_ROOT` — where clones are stored (default: `<state-dir>/github-cache`).
- `TRITON_GIT_CLONE_TIMEOUT_MS` — clone timeout in ms (default `180000`).
- `TRITON_HTTP_PATH_PREFIX` — when the HTTP request path includes a gateway prefix (e.g. `/triton/api/...` instead of `/api/...`), set this to that prefix (e.g. `/triton`) so routing matches.
- `TRITON_EXTRA_GIT_HOSTS` — optional extra HTTPS hostnames allowed for clone/sync (self-hosted GitLab).
- `TRITON_GITHUB_TOKEN` / `TRITON_GITLAB_TOKEN` — optional default tokens (server-wide). Per-request: `Authorization: Bearer`, headers `x-github-token` / `x-gitlab-token`, or JSON `gitToken`, `githubToken`, `gitlabToken`.

`POST /api/analysis/github` and `POST /api/workspace/github/sync` JSON body example:

`{ "repositoryUrl": "https://gitlab.com/gitlab-org/gitlab", "ref": "master", "gitToken": "optional" }` — `ref` is optional. If the clone directory already exists, the runtime **updates** it (no full wipe). Recent-repo persistence stores `source` as `github` or `gitlab`.

If `POST /api/analysis/github` returns JSON `{ "error": "not_found", ... }`:

1. **Upgrade** so `/health` reports a current **`version`** (e.g. `0.6.0`), `capabilities` includes `github-sync`, and `GET /api/analysis/github` returns JSON describing POST (not `not_found`). If GET also returns `not_found`, you are not hitting this codebase’s server on that port.
2. Read the **`pathnameRaw`** field on the 404 body (0.2.1+). If it looks like `/something/api/analysis/github` instead of `/api/analysis/github`, your reverse proxy forwards a **path prefix**. Set **`TRITON_HTTP_PATH_PREFIX`** to that prefix (e.g. `/something`) on the runtime process and restart, or reconfigure the proxy to strip the prefix before forwarding.
3. **`path` ends with `/api/analysis/github/`** — trailing slash was fixed by normalizing paths; upgrade if you still see this on an older build.

**Smoke test:** `curl -sS -X POST http://127.0.0.1:4317/api/analysis/github -H 'content-type: application/json' -d '{}'`

- **HTTP 400** with `missing_repository_url` → the hosted-Git route exists; your clone URL/body was wrong. **`unsupported_git_host`** means the hostname is not `github.com`, `gitlab.com`, or listed in `TRITON_EXTRA_GIT_HOSTS`.
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

Root **`docker-compose.yml`** starts **Postgres** with **`triton-runtime`** using **`TRITON_PERSISTENCE_BACKEND=postgres`** by default. Use **`docker compose up`** from the repo root (see snippet above).

### Persistence (recent repositories): file vs Postgres

Goal: **courses / projects / webhooks** need durable storage on the server without forcing **Postgres** onto every **VS Code plugin + local `npm start`** workflow.

**Approach**

1. **Define a small storage interface** (e.g. `TritonPersistence` / `ProjectDirectory`) in `triton-runtime`: operations needed by HTTP handlers—recent repos, future course/project rows, webhook secrets, job pointers—not SQL-shaped leaks into routes.
2. **Two implementations behind that interface**
   - **File-backed (default, plugin-friendly)** — evolve today’s JSON state (`recent-repos.json` under `TRITON_RUNTIME_STATE_DIR`) into the canonical implementation for local/extension use. Same process model as now: no extra daemon, easy backup, works offline. *(If you prefer an embedded key-value layer later—e.g. lowdb-style—it still sits behind this interface.)*
   - **Postgres (server / Docker)** — used when explicitly configured (e.g. `TRITON_PERSISTENCE_BACKEND=postgres` + `DATABASE_URL`), with migrations owned by the runtime package.
3. **Startup wiring (dependency injection)** — `runtimeConfig` (or a factory `createPersistence(config)`) chooses the implementation once at boot from env; the HTTP server receives a **single `persistence` instance** (constructor / factory injection), and modules stop calling free functions that hard-code `readJsonFile(recentReposFilePath(...))`.
4. **VS Code plugin** — keep pointing `triton.localRepoPath` at `packages/triton-runtime`; **no Postgres requirement** unless the operator opts in via env. CI and student laptops stay file-backed.
5. **Docker / university server** — compose brings up Postgres; runtime container gets `DATABASE_URL` + backend flag; same HTTP API and UI.

**Configuration sketch**

| Env | Behaviour |
|-----|-----------|
| *(unset)* / `TRITON_PERSISTENCE_BACKEND=file` | File-backed store only |
| `TRITON_PERSISTENCE_BACKEND=postgres` + `DATABASE_URL` | Postgres implementation |

**Implemented today:** `createPersistence(config)` selects **`file`** (default: `recent-repos.json` plus optional **`directory.json`** under `TRITON_RUNTIME_STATE_DIR`) or **`postgres`** (`TRITON_PERSISTENCE_BACKEND=postgres` + `DATABASE_URL`). The HTTP server uses `config.persistence` for recent repos, courses, and course–workspace links. `/health` and `/api/home` expose `persistence` / `persistenceBackend`. When the persistence layer implements courses, `/health` and `GET /api/home` include **`courses-api`** in `capabilities`, and home JSON includes a **`courses`** array (each course lists enriched **`workspaces`**). **`recentRepos`** on home omits paths that appear under any course so the UI can show course groups plus an “other” list without duplicates.

**Courses HTTP API** (same path-prefix rules as other `/api/*` routes):

| Method | Path | Body / notes |
|--------|------|----------------|
| `GET` | `/api/courses` | `{ "ok": true, "courses": [...] }` — lightweight list (no workspaces). |
| `POST` | `/api/courses` | JSON `{ "slug", "title", "term?" }` → `{ "ok": true, "course": { id, slug, title, ... } }`. Errors: `course_slug_required`, `course_title_required`, `course_slug_exists`. |
| `DELETE` | `/api/courses/:id` | Removes the course and its workspace links (not the repo folders). |

Optional JSON field **`courseId`** on **`POST /api/analysis/local`** and **`POST /api/analysis/github`** (and accepted on **`POST /api/workspace/github/sync`** before clone/sync): must reference an existing course or the handler returns **`course_not_found`**. After a successful registration, the workspace is linked to that course.

**File persistence:** `directory.json` holds `{ "courses": [...], "courseWorkspaces": [...] }` alongside `recent-repos.json`.

**Docker (repo root):** root `docker-compose.yml` starts Postgres and sets `TRITON_PERSISTENCE_BACKEND=postgres` plus `DATABASE_URL` on `triton-runtime`, with `depends_on` waiting for a healthy DB. Schema (`triton_courses`, `triton_course_workspaces`, `triton_recent_repos`) is applied on startup.

To use **file** persistence in Compose instead, comment those env lines and uncomment the file option in the same file (see comments there). For `npm start` without Docker, pass the same env vars manually if you want Postgres locally.

Near-term next steps:

- projects / webhooks on the same persistence interface
- let runtime-backed refresh/rescan requests update the browser's live data path directly
- add workspace scan endpoints that return a fully built Triton payload, not just raw workspace inputs
- package the runtime independently from the editor dev server
