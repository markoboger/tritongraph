export * from './types'
export { buildMatchKey, matchKeyOf } from './matchKey'
export { validateViolationRecord } from './validate'
export type { ValidationResult } from './validate'
export { resolveTopology, componentOf } from './topology'
export { parseArchitectureRules } from './rules'
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
