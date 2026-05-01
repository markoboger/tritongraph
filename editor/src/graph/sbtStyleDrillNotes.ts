/**
 * Placeholder “sbt build.sbt” style notes for layer drill (internal “Notes” compartment).
 * Deterministic per module id so reloads stay stable until we parse real build metadata.
 *
 * **Not** attached to YAML resources whose `x-triton-icon` is a Docker concept key (see
 * `ilographToFlow.ts` — those diagrams use real compartments instead).
 */

function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

function pick<T>(arr: readonly T[], seed: number, i: number): T {
  const idx = ((seed + i * 2654435761) >>> 0) % arr.length
  return arr[idx]!
}

const LIBS = [
  'cats-effect',
  'zio',
  'zio-json',
  'circe-core',
  'circe-generic',
  'http4s-dsl',
  'http4s-blaze-server',
  'akka-actor-typed',
  'pekko-stream',
  'sbt-native-packager',
  'sbt-revolver',
  'sbt-scalafmt',
  'kind-projector',
  'better-monadic-for',
  'scalatest',
  'scalacheck',
  'munit',
  'logback-classic',
  'slf4j-api',
  'scala-logging',
] as const

const SCALA_VER = ['2.12.18', '2.13.14', '3.3.3'] as const

const PLUGINS = [
  'addSbtPlugin("org.scalameta" % "sbt-scalafmt" % "2.5.2")',
  'addSbtPlugin("com.github.sbt" % "sbt-native-packager" % "1.9.16")',
  'addSbtPlugin("io.spray" % "sbt-revolver" % "0.9.1")',
  'addSbtPlugin("org.typelevel" % "sbt-tpolecat" % "0.5.0")',
] as const

const SNIPPETS = [
  'ThisBuild / organization := "com.example"',
  'ThisBuild / scalaVersion := "{{scala}}"',
  'ThisBuild / version := "{{ver}}"',
  'Compile / scalacOptions ++= Seq("-deprecation", "-feature", "-unchecked")',
  'Test / fork := true',
  'Test / parallelExecution := false',
  'libraryDependencies += "{{lib}}" %% "{{art}}" % "{{scope}}"',
  'libraryDependencies += "{{lib}}" %% "{{art}}" % "{{ver}}" % "test"',
  'excludeDependencies += "org.slf4j" % "slf4j-simple"',
  'Compile / console / scalacOptions -= "-Wunused:imports"',
  'run / mainClass := Some("{{main}}")',
  'assembly / assemblyMergeStrategy := { case PathList("META-INF", xs @ _*) => MergeStrategy.discard; case x => MergeStrategy.defaultMergeStrategy(x) }',
] as const

export function drillNoteForModuleId(id: string): string {
  const seed = hashString(id)
  const scala = pick(SCALA_VER, seed, 0)
  const ver = `${1 + (seed % 9)}.${seed % 20}.${seed % 40}`
  const lib = pick(LIBS, seed, 1)
  const art = id.replace(/[^a-zA-Z0-9-]/g, '-') || 'root'
  const scope = pick(['compile', 'provided', 'test'] as const, seed, 2)
  const main = `${art.replace(/-/g, '.')}.Main`

  const nLines = 5 + (seed % 5)
  const lines: string[] = []
  lines.push(`// Drill view — synthetic notes for \`${id}\` (replace with parsed build.sbt later)`)
  lines.push('')
  for (let i = 0; i < nLines; i++) {
    const raw = pick(SNIPPETS, seed, 3 + i)
    const plug = i === nLines - 1 ? pick(PLUGINS, seed, 7) : null
    const line = plug
      ? plug
      : raw
          .replace('{{scala}}', scala)
          .replace(/\{\{ver\}\}/g, ver)
          .replace('{{lib}}', lib)
          .replace('{{art}}', art)
          .replace('{{scope}}', scope)
          .replace('{{main}}', main)
    lines.push(line)
  }
  lines.push('')
  lines.push(
    `// Typical resolver (random): resolvers += "Sonatype OSS" at "https://oss.sonatype.org/content/repositories/${pick(['public', 'snapshots', 'releases'] as const, seed, 9)}"`,
  )
  return lines.join('\n')
}
