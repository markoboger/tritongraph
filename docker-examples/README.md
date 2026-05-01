# Docker examples

Each folder is a runnable **`docker-compose.yml`** plus a matching **`diagram.ilograph.yaml`**. Dockerfiles live **only where Compose references them** (`build:` / `dockerfile:`).

| # | Folder | Compose highlights |
|---|--------|----------------------|
| 01 | `01-single-service` | `web` built from `./Dockerfile`, tagged `docker-examples-01-web:local` |
| 02 | `02-build-context` | `api` — `build.context` `.`, `Dockerfile`, image `docker-examples-02-api:local` |
| 03 | `03-network-dependencies` | `api` / `worker` each have `api/Dockerfile`, `worker/Dockerfile`; `internal` network |
| 04 | `04-stack-db-volumes` | `app/Dockerfile`, `db/Dockerfile`, volumes, `app-net`, port on `app` |
| 05 | `05-healthcheck` | Like 01 plus **`healthcheck`** on `web`, port **18083** |
| 06 | `06-scala-services` | `api` / `worker` with per-service Dockerfiles, root **`build.sbt`** (Scala under `api/`, `worker/`) |

From repo root, e.g. `docker compose -f docker-examples/01-single-service/docker-compose.yml build` then `up` (change host ports if busy).

Diagram icons: `x-triton-icon` keys match `editor/src/triton/dockerConceptIcons.ts`.
