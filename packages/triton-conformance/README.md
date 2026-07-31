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

## Requirements

`python3` (3.9+, for `ast.unparse`) on `PATH` and `git` for the diff.

## LLM (optional)

Set `CONFORMANCE_API_KEY` to enable the semantic checks; `CONFORMANCE_BASE_URL`
(default `https://openrouter.ai/api/v1`) and `CONFORMANCE_MODEL` (default `openai/gpt-4o-mini`)
select the endpoint. Without the key the run is rule-engine only.

See `examples/bookshop/run-demo.sh` for an end-to-end demo.
