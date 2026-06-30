export * from './types'
export { buildMatchKey, matchKeyOf } from './matchKey'
export { validateViolationRecord } from './validate'
export type { ValidationResult } from './validate'
export { resolveTopology, componentOf } from './topology'
export { parseArchitectureRules, defaultRules } from './rules'
export { deriveTopologyFromCodeModel } from './deriveTopology'
export type { DeriveTopologyOptions } from './deriveTopology'
export {
  runRuleEngine,
  observedImportsFromCodeModel,
  observedImportsFromFacts,
} from './ruleEngine'
export type { ObservedImport } from './ruleEngine'
export { summaryToChangedFact, parsePythonSignature } from './astExtractor'
// NB: gitDiff.ts is Node-only (child_process) and intentionally not re-exported here.
export { buildPromptContext, buildMessages } from './contextBuilder'
export type { PromptContext, ChatMessage } from './contextBuilder'
export { createOpenAiClient, VIOLATIONS_SCHEMA, promptHash } from './llmClient'
export type { LlmClient, LlmRequest, LlmResponse, OpenAiClientOptions } from './llmClient'
export { checkFactWithLlm } from './llmChecker'
export type { LlmCheckOptions, LlmCheckOutput } from './llmChecker'
export { check } from './check'
export type { CheckInput } from './check'
export { formatReport, exitCode, allViolations } from './reporter'
export { filePathToModulePath } from './modulePath'
// NB: cli.ts and cliExtractor.ts are Node-only (child_process/fs) — not re-exported here.
