#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBuildSbt } from './parseBuildSbt.js'
import { sbtProjectsToIlograph } from './buildIlograph.js'
import { stringifyIlographYaml } from './yamlOut.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..')
  const examplesRoot = path.join(repoRoot, 'sbt-examples')
  const entries = await readdir(examplesRoot, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)

  if (!dirs.length) {
    console.error('No subfolders under sbt-examples')
    process.exit(1)
  }

  for (const dir of dirs.sort()) {
    const buildSbt = path.join(examplesRoot, dir, 'build.sbt')
    let text: string
    try {
      text = await readFile(buildSbt, 'utf8')
    } catch {
      console.warn(`skip ${dir}: no build.sbt`)
      continue
    }
    const projects = parseBuildSbt(text)
    const doc = sbtProjectsToIlograph(projects, {
      title: `sbt build: ${dir}`,
      sourcePath: `sbt-examples/${dir}/build.sbt`,
    })
    const outPath = path.join(examplesRoot, dir, 'diagram.ilograph.yaml')
    await writeFile(outPath, stringifyIlographYaml(doc), 'utf8')
    console.log(`wrote ${path.relative(repoRoot, outPath)} (${projects.length} projects)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
