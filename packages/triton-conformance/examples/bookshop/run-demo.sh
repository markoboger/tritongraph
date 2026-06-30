#!/usr/bin/env bash
# One-command CLI demo against the rich_repo bookshop.
#
# Copies rich_repo into a throwaway git sandbox, commits a clean (conformant) baseline, injects one
# structural + one semantic violation in the working tree, then runs the conformance CLI on the diff.
#
# Prereqs: (cd packages/triton-conformance && npm install && npm run build), python3, git.
# LLM (optional): export CONFORMANCE_API_KEY (and optionally CONFORMANCE_BASE_URL/CONFORMANCE_MODEL).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="$HERE/../../dist/cli.js"
RICH_REPO="${RICH_REPO:-/home/timohaas/Schreibtisch/ma-llm-arch-extractor/fixtures/rich_repo}"
SANDBOX="$(mktemp -d)/bookshop"

[ -f "$CLI" ] || { echo "build first: (cd packages/triton-conformance && npm install && npm run build)"; exit 1; }
[ -d "$RICH_REPO" ] || { echo "rich_repo not found at $RICH_REPO — set RICH_REPO=/path/to/rich_repo"; exit 1; }

mkdir -p "$SANDBOX"
cp -r "$RICH_REPO"/. "$SANDBOX"/
cp "$HERE/soll.ilograph.yaml" "$HERE/architecture-rules.yaml" "$SANDBOX"/
cd "$SANDBOX"
git init -q
git add -A
git -c user.email=demo@example.com -c user.name=demo commit -qm "clean baseline"

echo ">> injecting STRUCTURAL violation: domain importing infrastructure (forbidden edge)"
printf '\nfrom bookshop.infrastructure.order_repository import InMemoryOrderRepository  # architecture violation\n' \
  >> bookshop/domain/order.py

echo ">> injecting SEMANTIC violation: a web-framework type in a domain signature"
cat >> bookshop/domain/pricing.py <<'PY'


def quote_for_request(req: "flask.Request") -> float:
    """Leaks a web-framework type into the domain layer."""
    return 0.0
PY

echo
if [ -n "${CONFORMANCE_API_KEY:-}" ]; then
  echo "=== running conformance check (rule-engine + LLM) ==="
else
  echo "=== running conformance check (rule-engine only; set CONFORMANCE_API_KEY for the semantic rule) ==="
fi
echo
node "$CLI" --topology soll.ilograph.yaml --rules architecture-rules.yaml --base HEAD && rc=0 || rc=$?
echo
echo "exit code: $rc   (0 = no error violations, 1 = violations found)"
echo "sandbox kept at: $SANDBOX"
