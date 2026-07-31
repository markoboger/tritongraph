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
usage: triton-conformance --topology <ilograph.yaml> --rules <rules.yaml> [--base <ref>] [--src-root <dir>] [--rule-graph diff|full]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--topology` | — | Target topology as an Ilograph YAML document (required). |
| `--rules` | — | Architecture rules YAML (required). |
| `--base` | `HEAD` | Git ref to diff against; `HEAD` means the uncommitted working tree. |
| `--src-root` | repo root | Source root for module-path derivation. Repeatable. |
| `--rule-graph` | `diff` | Which import graph the rule-engine evaluates — see below. |
| `--run-log` | — | JSONL file the raw measurement records are appended to — see below. |

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
and never omitted — a `null` is data, a missing key is a hole in the measurement.

Every line carries a `record_type`. There are two.

#### `record_type: "run_header"` — exactly one per invocation, written before any model call

| Field | Type | Meaning |
| --- | --- | --- |
| `log_schema_version` | string | Schema version of this record set, currently `"1"`. |
| `timestamp` | string | UTC ISO 8601 with milliseconds. |
| `cli_args` | string[] | argv without the process name. |
| `rule_graph_mode` | `"diff"` \| `"full"` | Value of `--rule-graph`. |
| `topology_path` | string | `--topology` as given. |
| `topology_sha256` | string \| null | sha256 of the topology file, null when unreadable. |
| `rules_path` | string | `--rules` as given. |
| `rules_sha256` | string \| null | sha256 of the rules file, null when unreadable. |
| `target_repo_git_head` | string \| null | git HEAD of the repository under test. |
| `checker_git_head` | string \| null | git HEAD of this checker, null outside a git checkout. |
| `base_ref` | string | Value of `--base`. |
| `src_roots` | string[] | Values of `--src-root`. |
| `model_requested` | string \| null | Effective `CONFORMANCE_MODEL`; null when no LLM was configured. |
| `endpoint` | string \| null | Effective base URL, scheme + host + path only — never keys, tokens, credentials or query parameters. Null when no LLM was configured. |
| `seed` | number \| null | Seed actually sent to the provider; null when no LLM was configured. |
| `temperature` | number \| null | Temperature actually sent; null when no LLM was configured. |
| `changed_files_count` | number | Python files in the diff. |
| `graph_files_count` | number | Files whose facts formed the rule-engine graph. |
| `skipped` | `{path, reason}[]` | Files that could not be read or parsed. |

#### `record_type: "llm_call"` — one per checked file

| Field | Type | Meaning |
| --- | --- | --- |
| `timestamp` | string | UTC ISO 8601 with milliseconds. |
| `file`, `module` | string | The checked file and its Python module path. |
| `model_requested` | string | Model name asked for. |
| `model_version` | string \| null | Build the provider reported; null when it reported none — never backfilled from `model_requested`. |
| `attempts` | object[] | One entry per model call: `attempt_index` (0-based), `tokens_in`, `tokens_out`, `latency_ms`, `valid`. |
| `attempts_used` | number | Length of `attempts`. |
| `valid_raw` | boolean | Did the first attempt validate? |
| `valid_final` | boolean | Did the last attempt validate? |
| `tokens_in_total`, `tokens_out_total`, `latency_ms_total` | number | Sums over all attempts. |
| `temperature`, `seed`, `run_index` | number | Sampling parameters of this call. |
| `tokens` | `{prompt, completion}` | Legacy aggregate, redundant with the `*_total` fields. |
| `latency_ms`, `retries` | number | Legacy aggregates, kept for backwards compatibility. |
| `prompt_hash` | string | FNV-1a hash of the initial prompt. |
| `raw_response` | string | Last raw model response, verbatim. |

Example:

```
{"record_type":"run_header","log_schema_version":"1","timestamp":"2026-07-31T11:08:10.252Z", ...}
{"record_type":"llm_call","timestamp":"2026-07-31T11:08:10.289Z","file":"app/domain/pricing.py", ...}
```

## Requirements

`python3` (3.9+, for `ast.unparse`) on `PATH` and `git` for the diff.

## LLM (optional)

Set `CONFORMANCE_API_KEY` to enable the semantic checks; `CONFORMANCE_BASE_URL`
(default `https://openrouter.ai/api/v1`) and `CONFORMANCE_MODEL` (default `openai/gpt-4o-mini`)
select the endpoint. Without the key the run is rule-engine only.

See `examples/bookshop/run-demo.sh` for an end-to-end demo.
