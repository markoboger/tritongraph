#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import type { IlographDocument } from '../../triton-core/src/ilographTypes'
import type { SollModel } from './types'
import { resolveTopology } from './topology'
import { parseArchitectureRules } from './rules'
import { changedPythonFiles } from './gitDiff'
import { extractChangedFacts } from './cliExtractor'
import { observedImportsFromFacts } from './ruleEngine'
import { check } from './check'
import { createOpenAiClient } from './llmClient'
import { formatReport, exitCode } from './reporter'

/**
 * The measurement core CLI (C-8). Runs the full check locally: git diff → Python ast → changed_facts
 * → rule-engine + (optional) LLM → report + exit code. This is where measurements are taken; the CI
 * and editor shapes call the same core but do not measure.
 *
 * ponytail: the observed graph here is diff-only, so cycle detection only sees the changed files.
 * For full-graph cycles (plan Correction 1) feed observedImportsFromCodeModel of the whole repo.
 *
 * Run after `npm install && npm run build`: `triton-conformance --topology soll.ilograph.yaml --rules architecture-rules.yaml`
 */
interface CliArgs {
  topology: string
  rules: string
  base: string
  sourceRoots: string[]
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { topology: '', rules: '', base: 'HEAD', sourceRoots: [] }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    if (argv[i] === '--topology') args.topology = next()
    else if (argv[i] === '--rules') args.rules = next()
    else if (argv[i] === '--base') args.base = next()
    else if (argv[i] === '--src-root') args.sourceRoots.push(next())
  }
  if (!args.topology || !args.rules) {
    throw new Error('usage: triton-conformance --topology <ilograph.yaml> --rules <rules.yaml> [--base <ref>] [--src-root <dir>]')
  }
  return args
}

function loadSoll(topologyPath: string, rulesPath: string): SollModel {
  const topologyDoc = yaml.load(readFileSync(topologyPath, 'utf8')) as IlographDocument
  const rulesRaw = yaml.load(readFileSync(rulesPath, 'utf8'))
  return { topology: resolveTopology(topologyDoc), rules: parseArchitectureRules(rulesRaw) }
}

/** Optional LLM from env (key only ever supplied here, server-side — never in the browser). */
function llmFromEnv() {
  const apiKey = process.env.CONFORMANCE_API_KEY
  if (!apiKey) return undefined
  const client = createOpenAiClient({
    apiKey,
    baseUrl: process.env.CONFORMANCE_BASE_URL ?? 'https://openrouter.ai/api/v1',
    model: process.env.CONFORMANCE_MODEL ?? 'openai/gpt-4o-mini',
  })
  return { client, options: { modelRequested: process.env.CONFORMANCE_MODEL ?? 'openai/gpt-4o-mini' } }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const repoRoot = process.cwd()
  const soll = loadSoll(args.topology, args.rules)

  const changed = changedPythonFiles({ repoRoot, base: args.base })
  const changedFacts = extractChangedFacts(repoRoot, changed, soll.topology, args.sourceRoots)

  const results = await check({
    soll,
    changedFacts,
    observedImports: observedImportsFromFacts(changedFacts),
    llm: llmFromEnv(),
  })

  console.log(formatReport(results))
  process.exit(exitCode(results))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(2)
})
