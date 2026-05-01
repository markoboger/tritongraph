# Docker examples

Runnable `docker-compose.yml` snippets plus **Ilograph** diagrams (`diagram.ilograph.yaml`) that map Docker / Compose concepts to the graph model used in the Triton tab (**Docker Examples** section).

| Folder | Diagram focus |
|--------|----------------|
| `01-single-service` | Registry **Image**, Compose **Service**, runtime **Container** |
| `02-build-context` | **Project** context → **Build** (Dockerfile) → **Image** → service → container |
| `03-network-dependencies` | **Network**, `depends_on`, two services |
| `04-stack-db-volumes` | **Database** service, named **Volume**, **Port** mapping, bind-style host path |

From repo root, e.g. `docker compose -f docker-examples/01-single-service/docker-compose.yml up` (adjust ports if busy).
