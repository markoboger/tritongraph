import { DEFAULT_TIMEOUT_MS } from './llmClient'
import type { RuleGraphMode } from './runLog'

/**
 * Argument parsing for the CLI, kept apart from cli.ts so the rules for a valid invocation can be
 * tested without starting a process. Invalid values fail loudly with the usage line — a measurement
 * must never silently run with something other than what was typed.
 */
export interface CliArgs {
  topology: string
  rules: string
  base: string
  sourceRoots: string[]
  ruleGraph: RuleGraphMode
  runLog?: string
  /** Repetitions of the LLM path, >= 1. */
  runs: number
  /** Budget of a single model call in milliseconds, >= MIN_TIMEOUT_MS. */
  timeoutMs: number
}

/** Below this a timeout would only measure the network, never the model. */
export const MIN_TIMEOUT_MS = 1000

export const USAGE =
  'usage: triton-conformance --topology <ilograph.yaml> --rules <rules.yaml> [--base <ref>] [--src-root <dir>] [--rule-graph diff|full] [--run-log <file.jsonl>] [--runs <N>] [--timeout-ms <N>]'

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    topology: '',
    rules: '',
    base: 'HEAD',
    sourceRoots: [],
    ruleGraph: 'diff',
    runs: 1,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    if (argv[i] === '--topology') args.topology = next()
    else if (argv[i] === '--rules') args.rules = next()
    else if (argv[i] === '--base') args.base = next()
    else if (argv[i] === '--src-root') args.sourceRoots.push(next())
    else if (argv[i] === '--rule-graph') args.ruleGraph = parseRuleGraph(next())
    else if (argv[i] === '--run-log') args.runLog = next()
    else if (argv[i] === '--runs') args.runs = parseRuns(next())
    else if (argv[i] === '--timeout-ms') args.timeoutMs = parseTimeout(next())
  }
  if (!args.topology || !args.rules) throw new Error(USAGE)
  return args
}

function parseRuleGraph(value: string): RuleGraphMode {
  if (value !== 'diff' && value !== 'full') {
    throw new Error(`--rule-graph must be 'diff' or 'full', got '${value}'\n${USAGE}`)
  }
  return value
}

function parseRuns(value: string): number {
  const runs = Number(value)
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`--runs must be an integer >= 1, got '${value}'\n${USAGE}`)
  }
  return runs
}

function parseTimeout(value: string): number {
  const timeout = Number(value)
  if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MS) {
    throw new Error(`--timeout-ms must be an integer >= ${MIN_TIMEOUT_MS}, got '${value}'\n${USAGE}`)
  }
  return timeout
}
