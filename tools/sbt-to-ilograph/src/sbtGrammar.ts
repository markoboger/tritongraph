/**
 * sbt build files (`build.sbt`, `project/*.sbt`) are **Scala source** evaluated by the sbt
 * launcher with extra imports (see [Build definition basics](https://www.scala-sbt.org/1.x/docs/Basic-Def.html)).
 *
 * There is no separate “sbt grammar file”: formally it is the Scala grammar plus sbt’s
 * `build.sbt` dialect (top-level expressions, `.settings`, `/` scope operators, etc.).
 *
 * **Subset this tool extracts** (heuristic text pass, not a Scala compiler):
 *
 * - **Subprojects**: `lazy val <id> = … project …` where the RHS mentions `project` before the
 *   next top-level `lazy val` (same file, after comment stripping).
 * - **Base directory**: `in file("path")` or `project.in(file("path"))`.
 * - **Classpath deps**: `.dependsOn(a, b, c % "…")` — project refs are leading identifiers;
 *   `LocalProject("x")` is treated as project `x`.
 * - **Aggregation**: `.aggregate(a, b)` — emitted as relations with label `aggregates`.
 *
 * **Not modeled** (would need full Scala parsing or `sbt` introspection): conditional projects,
 * val-forwarding, `projectRefs`, plugin classloading, most of `.settings(...)`, `libraryDependencies`
 * except as future work.
 */
export const SBT_GRAMMAR_REFERENCE_URLS = [
  'https://www.scala-sbt.org/1.x/docs/Basic-Def.html',
  'https://www.scala-sbt.org/1.x/docs/Multi-Project.html',
] as const
