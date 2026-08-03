# Provider smoke test

Checks that a real provider accepts what `llmClient.ts` sends — `response_format: json_schema` with
`strict: true`, plus `seed` and `temperature` — before a measurement campaign is started against it.
Everything so far was measured against local stubs, so this is the first contact with a real endpoint.

Not part of the checker. Nothing here is imported by `packages/triton-conformance/src/**`.

## Environment variables the CLI actually reads

All three are read in one place, `llmFromEnv()`:

| Variable               | Where                                                     | Default                        |
| ---------------------- | --------------------------------------------------------- | ------------------------------ |
| `CONFORMANCE_API_KEY`  | [cli.ts:38](../../packages/triton-conformance/src/cli.ts#L38) | none — **unset means no LLM runs at all** |
| `CONFORMANCE_MODEL`    | [cli.ts:40](../../packages/triton-conformance/src/cli.ts#L40) | `openai/gpt-4o-mini`           |
| `CONFORMANCE_BASE_URL` | [cli.ts:41](../../packages/triton-conformance/src/cli.ts#L41) | `https://openrouter.ai/api/v1` |

Verbatim:

```ts
  const apiKey = process.env.CONFORMANCE_API_KEY          // cli.ts:38
  if (!apiKey) return undefined                           // cli.ts:39
  const model = process.env.CONFORMANCE_MODEL ?? 'openai/gpt-4o-mini'                  // cli.ts:40
  const baseUrl = process.env.CONFORMANCE_BASE_URL ?? 'https://openrouter.ai/api/v1'   // cli.ts:41
```

`llmClient.ts:78` appends `/chat/completions` to the base URL, so `CONFORMANCE_BASE_URL` must be the
`/v1` root, not the full endpoint. `temperature` (0) and `seed` (42) are constants in
[cli.ts:33-34](../../packages/triton-conformance/src/cli.ts#L33-L34) and cannot be set from the
environment.

## The CLI

```
/home/timohaas/Schreibtisch/tritongraph/packages/triton-conformance/dist/cli.js
```

`dist/` is gitignored, so it may be missing or stale. Build it:

```bash
cd /home/timohaas/Schreibtisch/tritongraph/packages/triton-conformance
npm install && npm run build
```

The CLI takes the repository under test from `process.cwd()` ([cli.ts:61](../../packages/triton-conformance/src/cli.ts#L61)) —
always run it from inside the smoke repo, with the two YAML paths relative to that directory.

## 1. Create the throwaway repo

```bash
/home/timohaas/Schreibtisch/tritongraph/tools/provider-smoke/setup.sh /tmp/smoke-repo
```

One modified Python file (`shop/domain/pricing.py`, component `domain`) with a `flask.Request` in a
domain signature, a topology with the components `domain` and `api`, and a semantic rule scoped to
`domain`. Expected `changed_files_count`: **1**, so exactly one model call per `--runs` repetition.

Rerunning the script wipes the target only if it still carries the `.provider-smoke` marker it
writes; any other existing path is refused.

## 2. Run against a provider

### Ollama (local)

Ollama ignores the key but the CLI needs a non-empty one (`cli.ts:39`), hence the placeholder.

```bash
cd /tmp/smoke-repo
CONFORMANCE_API_KEY=ollama \
CONFORMANCE_BASE_URL=http://localhost:11434/v1 \
CONFORMANCE_MODEL=<OLLAMA_MODEL_TAG> \
node /home/timohaas/Schreibtisch/tritongraph/packages/triton-conformance/dist/cli.js \
  --topology soll.ilograph.yaml \
  --rules architecture-rules.yaml \
  --run-log ollama.jsonl \
  --json-out ollama.json \
  --timeout-ms 120000
```

### OpenRouter

```bash
cd /tmp/smoke-repo
CONFORMANCE_API_KEY=<OPENROUTER_API_KEY> \
CONFORMANCE_BASE_URL=https://openrouter.ai/api/v1 \
CONFORMANCE_MODEL=<OPENROUTER_MODEL_SLUG> \
node /home/timohaas/Schreibtisch/tritongraph/packages/triton-conformance/dist/cli.js \
  --topology soll.ilograph.yaml \
  --rules architecture-rules.yaml \
  --run-log openrouter.jsonl \
  --json-out openrouter.json \
  --timeout-ms 120000
```

Exit codes: 0 clean, 1 violations found, 2 program/configuration error, 3 the run is not a sound
measurement. For this repo a working provider that answers validly gives **1** — the planted
violation is meant to be found — but only if the model reports it, so a valid, empty answer gives 0.
A 3 with `transport_failure` means the endpoint never answered; a 3 with `invalid_final_response`
means it answered but never within the schema, which is exactly the finding this smoke test exists to
produce.

## 3. Read the log

```bash
node /home/timohaas/Schreibtisch/tritongraph/tools/provider-smoke/check-log.mjs /tmp/smoke-repo/ollama.jsonl
```

One line per `llm_call` (outcome, valid_raw, valid_final, model_version, attempts_used,
latency_ms_total, transport_failures), then the footer (exit_code, calls_total, calls_invalid,
calls_transport_failed, invalid_reasons). Read-only, `node:fs` only.

## Verifying the rule is in scope without spending a model call

A rule whose scope misses the changed file's component makes the checker skip the call entirely
([llmChecker.ts:96](../../packages/triton-conformance/src/llmChecker.ts#L96)) — the run then looks
green while measuring nothing. To prove a call was really attempted, point the CLI at a dead local
port instead of a provider:

```bash
cd /tmp/smoke-repo
CONFORMANCE_API_KEY=not-a-real-key \
CONFORMANCE_BASE_URL=http://127.0.0.1:9/v1 \
node /home/timohaas/Schreibtisch/tritongraph/packages/triton-conformance/dist/cli.js \
  --topology soll.ilograph.yaml --rules architecture-rules.yaml \
  --run-log probe.jsonl --timeout-ms 2000
```

`calls_total=1` with `outcome=transport_failed` means the prompt was built and the call was made —
the rule was in scope. `calls_total=0` means it was not, and a real run would have measured nothing.
