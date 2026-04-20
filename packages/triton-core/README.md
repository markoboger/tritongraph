# triton-core

Planned home for reusable, non-UI Triton analysis logic.

Expected responsibilities:

- Scala source parsing
- sbt build parsing
- test/spec extraction
- scoverage parsing and aggregation
- stable JSON contract emitted for browser and extension consumers

This package is scaffolded as the extraction target for code currently living under:

- `editor/src/sbt`
- `editor/src/scala`
- `tools/sbt-to-ilograph/src`
