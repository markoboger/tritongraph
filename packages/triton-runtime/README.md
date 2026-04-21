# triton-runtime

Local and future cloud runtime for Triton.

Purpose:

- expose a stable HTTP API between IDE plugins and the Triton analysis/runtime layer
- run workspace actions such as refresh, `sbt test`, and coverage commands
- provide a service shape that works both on localhost today and in CI/CD or cloud later

Current MVP scaffold:

- Node HTTP server with a health endpoint
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

Near-term next steps:

- let runtime-backed refresh/rescan requests update the browser's live data path directly
- add workspace scan endpoints that return a fully built Triton payload, not just raw workspace inputs
- package the runtime independently from the editor dev server
