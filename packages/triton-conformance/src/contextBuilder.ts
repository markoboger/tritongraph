import type { AllowedEdge, ArchitectureRule, ChangedFact, SollModel } from './types'

/**
 * Context-builder [2] (spec §4): slice the Soll to only what the changed file needs — its
 * component's allowed edges and the rules in scope — and pair it with the changed_facts. Keeps the
 * prompt compact; the per-check input stays small regardless of repo size.
 */
export interface PromptContext {
  component: string | null
  /** Allowed edges touching the fact's component (context for the model). */
  allowedEdges: AllowedEdge[]
  /** Rules whose scope includes the fact's component — what the LLM is asked to judge. */
  rules: ArchitectureRule[]
  fact: ChangedFact
}

export function buildPromptContext(soll: SollModel, fact: ChangedFact): PromptContext {
  const component = fact.component
  const rules = soll.rules.filter((r) => component != null && r.scope.components.includes(component))
  const allowedEdges = soll.topology.allowedEdges.filter((e) => e.from === component || e.to === component)
  return { component, allowedEdges, rules, fact }
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

/**
 * Build the chat messages. Prompt discipline (spec §4): the checker is allowed to infer
 * semantically (C-3) and does NOT inherit the extraction's suppression — a reported semantic
 * violation that is not a literal import is the value, not a hallucination. Each violation must
 * carry both a reason and a suggestion.
 */
export function buildMessages(context: PromptContext): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(context) },
  ]
}

/** The prompt template; hashed into the run log (prompt_template_sha256) as the freeze proof. */
export const SYSTEM_PROMPT = `You are an architecture conformance checker. You are given a target
architecture (components and the rules that govern them) and the imports + signatures of a single
changed source file. Report every rule violation you find.

You MAY and SHOULD reason semantically: a violation can follow from a type annotation, a name, or a
signature even when it is not a literal forbidden import — that semantic inference is exactly what is
wanted, not a hallucination. Only report violations of the rules given to you; do not invent rules.

For structural rules, check edges and import boundaries directly. For semantic rules, infer from
names, signatures, and type annotations.

Return JSON only, matching the provided schema. Every violation MUST include a concrete reason and a
concrete suggestion for how to fix it. Reference a rule by its exact id.`

/**
 * Pure render: the output depends on nothing but `context` — no env, no clock, no file system — so
 * hashing it over a frozen canary input pins the prompt construction (user_prompt_render_sha256).
 */
export function buildUserPrompt(context: PromptContext): string {
  const { component, allowedEdges, rules, fact } = context
  const lines: string[] = []
  lines.push(`# Changed file`)
  lines.push(`path: ${fact.path}`)
  lines.push(`module: ${fact.module}`)
  lines.push(`component: ${component ?? '(unmapped)'}`)
  lines.push(``)
  lines.push(`## Imports`)
  for (const imp of fact.imports) {
    lines.push(`- ${imp.target} (component: ${imp.target_component ?? 'external/unmapped'})`)
  }
  lines.push(``)
  lines.push(`## Signatures`)
  for (const sig of fact.signatures) {
    const params = sig.params.map((p) => `${p.name}: ${p.annotation ?? 'Any'}`).join(', ')
    lines.push(`- ${sig.kind} ${sig.symbol}(${params}) -> ${sig.returns ?? 'None'}`)
  }
  lines.push(``)
  lines.push(`## Allowed dependency edges touching this component`)
  for (const edge of allowedEdges) lines.push(`- ${edge.from} -> ${edge.to}`)
  lines.push(``)
  lines.push(`## Rules to check (scope includes this component)`)
  for (const rule of rules) {
    lines.push(`- id: ${rule.id} [${rule.kind}, ${rule.severity}] (${rule.category})`)
    lines.push(`  ${rule.statement}`)
  }
  return lines.join('\n')
}
