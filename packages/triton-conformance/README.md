# triton-conformance

Architecture conformance checker: compares a Python repository against a target topology
("Soll", Ilograph YAML) plus architecture rules. A deterministic rule-engine finds structural
violations (forbidden component edges, cycles); an optional LLM checks the semantic rules.

## Build and run

```bash
npm install && npm run build
node dist/cli.js --topology soll.ilograph.yaml --rules architecture-rules.yaml
```

The CLI is run from the repository root of the code under test.

## Flags

```
usage: triton-conformance --topology <ilograph.yaml> --rules <rules.yaml> [--base <ref>] [--src-root <dir>] [--rule-graph diff|full] [--run-log <file.jsonl>] [--runs <N>] [--timeout-ms <N>]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--topology` | — | Target topology as an Ilograph YAML document (required). |
| `--rules` | — | Architecture rules YAML (required). |
| `--base` | `HEAD` | Git ref to diff against; `HEAD` means the uncommitted working tree. |
| `--src-root` | repo root | Source root for module-path derivation. Repeatable. |
| `--rule-graph` | `diff` | Which import graph the rule-engine evaluates — see below. |
| `--run-log` | — | JSONL file the raw measurement records are appended to — see below. |
| `--runs` | `1` | How often the LLM path is repeated, integer >= 1 — see below. |
| `--timeout-ms` | `120000` | Budget of a **single model call**, integer >= 1000 — see below. |
| `--json-out` | — | JSON file the machine-readable findings are written to — see below. |

### `--rule-graph diff|full`

- `diff` (default): the rule-engine only sees imports of the changed files. Fast, but a cycle that
  closes through an unchanged file stays invisible.
- `full`: every `*.py` under the `--src-root`(s) — the whole repository when no source root is
  given — is parsed and the observed import graph is built from all of those facts, so forbidden
  edges and cycles running through unchanged files are found as well.

Either way the LLM checker still runs per changed file only; `--rule-graph` affects the
deterministic rule-engine exclusively. Exit codes are unaffected: 0 when no `error`-severity
violation was found, 1 when there was one, 2 on a usage or runtime error.

Files that cannot be read or parsed are skipped rather than aborting the run. Each is reported on
stderr as one line:

```
skipped app/infra/broken.py: SyntaxError: invalid syntax (<unknown>, line 1)
```

Hidden directories, `node_modules` and `__pycache__` are not scanned in `full` mode.

### `--run-log <file.jsonl>`

Without the flag nothing is written. With it, the run appends JSON Lines to the given file — one
object per line, the file is never rewritten, so a whole measurement campaign can share one log.
If the file cannot be written the run aborts before the first model call: a measurement run without
its log is worthless.

Missing values are written as `null`. They are never estimated, never derived from another field
and never omitted — a `null` is data, a missing key is a hole in the measurement. Fields named
`*_requested` say what was asked of the provider, not what it honoured: a provider may ignore a
seed, and the log must not claim otherwise.

Every line carries a `record_type` and a `run_id`. There are three record types. The current schema
is version **2** (`log_schema_version`).

**Invariant: a header is always followed by a footer.** The footer is written even when the run
throws. A header without a matching footer therefore means the process died hard (SIGKILL, power
loss) — that absence is how the analysis recognises an aborted run, so never repair it by hand.

#### `record_type: "run_header"` — exactly one per invocation, written before any model call

| Field | Type | Meaning |
| --- | --- | --- |
| `log_schema_version` | string | Schema version of this record set, currently `"2"`. |
| `run_id` | string | Identifies this invocation, e.g. `20260731T110810Z-a3f19c2b`; repeated on every `llm_call` line of the run. |
| `timestamp` | string | UTC ISO 8601 with milliseconds. |
| `cli_args` | string[] | argv without the process name. |
| `rule_graph_mode` | `"diff"` \| `"full"` | Value of `--rule-graph`. |
| `topology_path` | string | `--topology` as given. |
| `topology_sha256` | string \| null | sha256 of the topology file, null when unreadable. |
| `rules_path` | string | `--rules` as given. |
| `rules_sha256` | string \| null | sha256 of the rules file, null when unreadable. |
| `prompt_template_sha256` | string | Freeze proof, part 1: sha256 of the system-prompt template constant. Never null. |
| `user_prompt_render_sha256` | string | Freeze proof, part 2: sha256 of `buildUserPrompt(CANARY_CONTEXT)`. Never null. |
| `target_repo_git_head` | string \| null | git HEAD of the repository under test. |
| `checker_git_head` | string \| null | git HEAD of this checker, null outside a git checkout. |
| `base_ref` | string | Value of `--base`. |
| `src_roots` | string[] | Values of `--src-root`. |
| `model_requested` | string \| null | Effective `CONFORMANCE_MODEL`; null when no LLM was configured. |
| `endpoint` | string \| null | Effective base URL, scheme + host + path only — never keys, tokens, credentials or query parameters. Null when no LLM was configured. |
| `seed_requested` | number \| null | Seed sent to the provider; null when no LLM was configured. Requested, not confirmed. |
| `temperature_requested` | number \| null | Temperature sent to the provider; null when no LLM was configured. |
| `runs_requested` | number | Value of `--runs`; the repetitions share this `run_id` and differ by `run_index`. |
| `timeout_ms` | number | Value of `--timeout-ms`: the budget of one model call. |
| `transport_max_retries` | number | Transport retries allowed per call, on top of the first try. Currently 2. |
| `transport_abort_threshold` | number | Consecutive calls lost to transport before the run gives up. Currently 5. |
| `changed_files_count` | number | Python files in the diff. |
| `graph_files_count` | number | Files whose facts formed the rule-engine graph. |
| `skipped` | `{path, reason}[]` | Files that could not be read or parsed. |

#### `record_type: "llm_call"` — one per checked file and repetition

| Field | Type | Meaning |
| --- | --- | --- |
| `run_id` | string | Same value as the `run_header` of this invocation. |
| `timestamp` | string | UTC ISO 8601 with milliseconds. |
| `file`, `module` | string | The checked file and its Python module path. |
| `model_requested` | string | Model name asked for. |
| `model_version` | string \| null | Build the provider reported; null when it reported none — never backfilled from `model_requested`. |
| `attempts` | object[] | One entry per model call: `attempt_index` (0-based), `tokens_in`, `tokens_out`, `latency_ms`, `valid`, `raw_response` (the text of that attempt, kept even when discarded as invalid). |
| `attempts_used` | number | Length of `attempts`. |
| `valid_raw` | boolean \| null | Did the first attempt validate? Null when no answer was ever received. |
| `valid_final` | boolean \| null | Did the last attempt validate? Null — never `false` — when `outcome` is `transport_failed`. |
| `outcome` | `"measured"` \| `"transport_failed"` | Did this call get a model answer at all? |
| `transport_failures` | object[] | One entry per failed transport try: `kind` (`timeout`, `network`, `http_429`, `http_5xx`), `http_status` (null for timeout/network), `latency_ms`, `try_index` (0-based). Non-empty and `outcome: "measured"` means a retry worked — cost information, not a measurement error. |
| `tokens_in_total`, `tokens_out_total`, `latency_ms_total` | number | Sums over all attempts. |
| `temperature_requested`, `seed_requested` | number | Sampling parameters asked of the provider for this call. |
| `run_index` | number | 0-based repetition index within this `run_id`. |
| `tokens` | `{prompt, completion}` | Legacy aggregate, redundant with the `*_total` fields. |
| `latency_ms`, `retries` | number | Legacy aggregates, kept for backwards compatibility. |
| `prompt_hash` | string | FNV-1a hash of the initial prompt. |
| `raw_response` | string | Last raw model response, verbatim. |

#### `record_type: "run_footer"` — exactly one per invocation, always the last line

| Field | Type | Meaning |
| --- | --- | --- |
| `run_id` | string | Same value as the header of this invocation. |
| `timestamp` | string | UTC ISO 8601 with milliseconds, taken when the run ended. |
| `status` | `"completed"` \| `"aborted"` | `aborted` when fewer repetitions ran than were requested, i.e. something threw or the provider gave out. |
| `runs_requested` | number | Value of `--runs`. |
| `runs_completed` | number | Repetitions that finished. Less than `runs_requested` on an abort. |
| `calls_total` | number | Model calls made in this run (across all repetitions). |
| `calls_invalid` | number | Calls the model answered, but never validly. Transport losses are **not** counted here. |
| `invalid_calls` | `{file, run_index}[]` | Which calls those were — not just how many. |
| `calls_transport_failed` | number | Calls that never reached the model at all. Kept apart from `calls_invalid` on purpose. |
| `failed_calls` | `{file, run_index}[]` | Which calls those were. |
| `calls_with_transport_retry` | number | Calls that only completed because a transport retry worked — cost information, no effect on the exit code. |
| `skipped_count` | number | Files that could not be read or parsed. |
| `exit_code` | number | The code the process exits with; see the table below. |
| `invalid_reasons` | string[] | Empty, or a subset of `invalid_final_response`, `transport_failure`, `incomplete_runs`, `skipped_files`. |
| `wall_clock_ms` | number | Duration of the whole run. |

No field is ever null: the footer is written from values the run knows by then. Lists are empty
rather than absent.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No violations, measurement sound. |
| 1 | Violations found, measurement sound. |
| 2 | Program or configuration error: usage, log not writable, violated pairing invariant, unexpected exception. |
| 3 | The run is not a sound measurement — including a provider outage, where `status` is `aborted` but the code is still 3. |

**3 takes precedence over 0 and 1.** A run with violations *and* an invalid call exits 3, never 1 —
otherwise the finding would hide the fact that the measurement cannot be trusted. Each of these
alone is enough for 3:

- at least one call with `valid_final: false`
- at least one call with `outcome: "transport_failed"`
- `runs_completed < runs_requested`
- a non-empty skipped list

A dead provider is **not** a program error. It aborts the run (`status: "aborted"`) but exits 3, not
2; code 2 stays reserved for usage errors, an unwritable log, a violated pairing invariant and
unexpected exceptions.

Code 3 is an attention signal for unattended runs, **not** a verdict: whether a configuration stays
usable is decided by the eval harness in aggregate, not by a single CLI invocation. On exit 3 the
report prints one plain-text line per reason, with the numbers behind it.

Example:

```
{"record_type":"run_header","log_schema_version":"2","run_id":"20260731T110810Z-a3f19c2b", ...}
{"record_type":"llm_call","run_id":"20260731T110810Z-a3f19c2b","file":"app/domain/pricing.py","run_index":0, ...}
{"record_type":"run_footer","run_id":"20260731T110810Z-a3f19c2b","status":"completed","exit_code":0, ...}
```

#### Prompt freeze

Two hashes in the header together pin the prompt that was sent:

- `prompt_template_sha256` covers the **system prompt**, which is a single constant (`SYSTEM_PROMPT`
  in `contextBuilder.ts`) — hashing the string is enough.
- `user_prompt_render_sha256` covers the **user prompt**, which has no template: it is assembled
  line by line in `buildUserPrompt()`. It is pinned by rendering a frozen canary input
  (`CANARY_CONTEXT` in `promptCanary.ts`) and hashing the result, so any change to how the prompt is
  built moves the hash. The canary render is a pure string operation — no model call, no file
  access. Editing the canary invalidates comparability with earlier runs; it must not change after
  the protocol freeze.

Together the two cover the whole prompt. `checker_git_head` remains the coarse fallback for
everything else about the checker build.

### `--runs <N>`

Repeats the LLM path N times (default 1) so model variance can be measured. All repetitions belong
to the same `run_id` and are told apart by `run_index` (0-based); there is still exactly one
`run_header` per invocation. Nothing is aggregated — no median, no majority vote; the log keeps every
repetition verbatim and the eval harness decides what to do with them.

The deterministic rule-engine runs **once** regardless of N: its findings follow from the topology
and cannot vary between repetitions. Only the model is asked again. Consequently the printed report
and the exit code come from repetition 0; repetitions 1..N-1 exist only in the log, so `--runs` is
only useful together with `--run-log`.

### `--timeout-ms <N>`

Budget of a **single model call** — not of a file and not of the whole run. Default 120000, minimum
1000; anything else is a usage error. It is enforced with an `AbortController` on the request, and
the abort surfaces as an ordinary rejected promise, so the run still closes its log with a footer.

Two failure classes are kept strictly apart, and this is the whole point of the flag:

- **Validation failure** — the model answered, but the answer was unusable (not JSON, schema
  violation). Counted in `attempts[]`, in `valid_raw`/`valid_final`, against the validation retry
  budget. Unchanged behaviour.
- **Transport failure** — there was no usable HTTP response at all: timeout, network error, HTTP
  429, HTTP 5xx. These get their own retry budget, their own counters and their own reason, and they
  never touch `valid_raw`/`valid_final`. The validity rate is a measurement of what the model can
  do; folding transport trouble into it would silently turn it into a measurement of the
  infrastructure.

Other HTTP errors (401, 404, 400) are configuration mistakes, not transport: they are not retried
and end the run with code 2.

Each call gets up to **2 transport retries** with a fixed backoff of **1 s** and **4 s** — no jitter,
no exponential growth, so a log can be explained after the fact. A `Retry-After` header on a 429 is
respected instead of the backoff, capped at 60 s. Retries that end in a usable answer produce
`outcome: "measured"`, keep their `transport_failures[]` as cost information and do **not** make the
run unsound.

If **5 calls in a row** end in a final transport failure, the run gives up on the provider rather
than burning an unattended campaign against a dead endpoint. The log keeps all five `llm_call`
records, the footer says `status: "aborted"`, and the exit code is 3.

### `--json-out <file.json>`

Without the flag nothing is written. With it, the run writes **one JSON object per invocation** —
the source the eval harness computes precision and recall from. An unwritable path aborts the run
before the first model call, same rule as `--run-log`. The document is written from the same
`finally` block as the footer, so even an aborted run leaves the part of the measurement it managed.

**Division of labour between the two outputs**, so nothing is stored twice and nothing has to be
guessed:

| | `--json-out` (JSON) | `--run-log` (JSONL) |
| --- | --- | --- |
| Answers | *What was found?* | *What did it cost?* |
| Holds | findings, checks performed, provenance, validity | attempts, tokens, latency, raw responses, transport failures |
| Granularity | one object per invocation, `runs[]` per repetition | one line per invocation, per call, plus a footer |

They are joined on `(run_id, file, run_index)`. Cost and attempt details are deliberately **not** in
the JSON.

| Field | Type | Meaning |
| --- | --- | --- |
| `result_schema_version` | string | Schema version of this document, currently `"1"`. Never null. |
| `run_id` | string | Identical to the `run_header` of the same invocation — the join key. Never null. |
| `timestamp` | string | UTC ISO 8601 with milliseconds, taken when the document was written. Never null. |
| `provenance` | object | Everything needed to interpret the result without the run log: `topology_sha256`, `rules_sha256` (null when the file was unreadable), `prompt_template_sha256`, `user_prompt_render_sha256` (never null), `checker_git_head`, `target_repo_git_head` (null outside a git checkout), `base_ref`, `rule_graph_mode` (never null), `model_requested`, `endpoint`, `seed_requested`, `temperature_requested` (all null when no LLM was configured), `runs_requested`, `timeout_ms` (never null). |
| `runs` | object[] | One entry per repetition that ran: `run_index`, `findings`, `checks_performed`. Empty only when repetition 0 never finished. |
| `validity` | object | `status`, `runs_completed`, `calls_total`, `calls_invalid`, `calls_transport_failed`, `skipped_count`, `invalid_reasons`, `exit_code` — the same values as the footer, no field ever null. |
| `skipped` | `{path, reason}[]` | Files that could not be read or parsed. Empty list, never null. |

Each entry of `findings`:

| Field | Type | Meaning |
| --- | --- | --- |
| `match_key` | string | Exactly the string `matchKey.ts` builds, `category\|component\|module\|subject`. The join against the ground truth runs on it — never reformatted, normalised or shortened. Never null. |
| `source` | `"rule-engine"` \| `"llm"` | Which path found it. The comparison of the deterministic and the model path depends on this field. Never null. |
| `rule_id`, `category` | string | Rule that was violated; `DERIVED:forbidden-edge` / `DERIVED:cycle` for rule-engine findings. Never null. |
| `component` | string \| null | Owning component, null when the module is not mapped to one. |
| `module`, `file` | string | Where it was found. Never null. |
| `line` | number \| null | Line, null when the finding is not tied to one. |
| `severity` | `"error"` \| `"warning"` | From the rule. Never null. |
| `subject` | object | The key parts, verbatim from the `ViolationRecord`: `offending_type` + `via`, or `from`/`to`. |
| `reason` | string | Why it is a violation. Never null. |
| `suggestion` | string \| null | Proposed fix; null when the finding carries none. |
| `confidence` | number \| null | Model-asserted soft signal, null for rule-engine findings. **Not a metric** (guardrail C-9). |

Each entry of `checks_performed` carries `rule_id`, `scope`, `source` and the `file` it was
evaluated on. The analysis needs it to tell "rule checked, nothing found" from "rule was never in
scope" — a missed violation and a never-checked module are not the same result.

**No aggregation happens here.** No deduplication, no median over repetitions, no re-sorting. Two
findings on the same `match_key` stay two entries; whether they collapse into one hit is a
pre-registered decision of the analysis, and the CLI must not pre-empt it.

Note when reading `runs[]`: the deterministic rule-engine runs exactly once, so its findings appear
in `run_index: 0` only. Repetitions 1..N-1 contain the model's findings alone.

The printed report and the exit code are unaffected by this flag and still come from repetition 0.

## Requirements

`python3` (3.9+, for `ast.unparse`) on `PATH` and `git` for the diff.

## LLM (optional)

Set `CONFORMANCE_API_KEY` to enable the semantic checks; `CONFORMANCE_BASE_URL`
(default `https://openrouter.ai/api/v1`) and `CONFORMANCE_MODEL` (default `openai/gpt-4o-mini`)
select the endpoint. Without the key the run is rule-engine only.

See `examples/bookshop/run-demo.sh` for an end-to-end demo.
