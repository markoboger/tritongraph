import type { PromptContext } from './contextBuilder'

/**
 * Frozen canary input. Changing this changes user_prompt_render_sha256 and breaks comparability
 * with earlier measurement runs — do not touch after the protocol freeze.
 *
 * It is deliberately minimal but exercises every section buildUserPrompt emits: the file header,
 * one import, one signature (with an annotated parameter and a return type), one allowed edge and
 * one rule. Rendering it is a pure string operation — no model call, no file system.
 */
export const CANARY_CONTEXT: PromptContext = {
  component: 'canary_component',
  allowedEdges: [{ from: 'canary_component', to: 'canary_target' }],
  rules: [
    {
      id: 'canary-rule',
      category: 'canary-category',
      kind: 'semantic',
      scope: { components: ['canary_component'] },
      statement: 'Canary statement used only to pin the rendered prompt shape.',
      severity: 'error',
    },
  ],
  fact: {
    path: 'canary/module.py',
    module: 'canary.module',
    component: 'canary_component',
    diff_kind: 'modified',
    imports: [{ target: 'canary.target', target_component: 'canary_target' }],
    signatures: [
      {
        symbol: 'canary_function',
        kind: 'function',
        params: [{ name: 'value', annotation: 'int' }],
        returns: 'str',
      },
    ],
  },
}
