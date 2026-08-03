#!/usr/bin/env bash
# Build a throwaway git repo for a provider smoke test: one changed Python file with one clear
# M1-style violation (a web-framework type in a domain signature), a two-component topology, and a
# semantic rule whose scope covers that file's component — without that rule no model call happens
# and the smoke test would measure nothing.
#
# Usage: ./setup.sh [target-dir]   (default /tmp/smoke-repo)
# Prereqs: git. The check itself additionally needs python3 and the built CLI (see README.md).
set -euo pipefail

TARGET="${1:-/tmp/smoke-repo}"
MARKER=".provider-smoke"

# Only ever wipe a directory this script created before: the target is an argument, and a stray
# path must not be deleted because someone reran the script.
if [ -e "$TARGET" ]; then
  [ -f "$TARGET/$MARKER" ] || { echo "refusing to touch existing $TARGET (no $MARKER marker)" >&2; exit 1; }
  rm -rf "$TARGET"
fi

mkdir -p "$TARGET/shop/domain" "$TARGET/shop/api"
cd "$TARGET"
touch "$MARKER"

# --- clean baseline -------------------------------------------------------------------------
cat > shop/domain/pricing.py <<'PY'
"""Pricing rules of the shop domain. Inner layer: stays framework-agnostic."""

from decimal import Decimal


def discounted_price(net: Decimal, discount_percent: Decimal) -> Decimal:
    return net - (net * discount_percent / Decimal(100))
PY

# Second component, committed clean and never touched again: it gives the topology a real relation
# and keeps changed_files_count at 1.
cat > shop/api/routes.py <<'PY'
"""HTTP layer. May depend on the domain."""

from decimal import Decimal

from flask import Blueprint

from shop.domain.pricing import discounted_price

blueprint = Blueprint("shop", __name__)


def quote(net: str) -> str:
    return str(discounted_price(Decimal(net), Decimal(10)))
PY

# Components are the resources used as relation endpoints; every resource nested under one is a
# module of that component. Module ids must equal the module path the checker derives from the file
# path: shop/domain/pricing.py -> shop.domain.pricing.
cat > soll.ilograph.yaml <<'YAML'
# Target architecture ("Soll") for the smoke repo: api may depend on domain, never the reverse.
resources:
  - id: domain
    name: Domain
    children:
      - { id: shop.domain }
      - { id: shop.domain.pricing }
  - id: api
    name: API
    children:
      - { id: shop.api }
      - { id: shop.api.routes }

perspectives:
  - name: dependencies
    relations:
      - { from: api, to: domain }
YAML

# scope.components MUST contain `domain` — the component of shop/domain/pricing.py. With any other
# scope the checker finds no in-scope rule, skips the call, and the provider is never contacted.
cat > architecture-rules.yaml <<'YAML'
rules:
  - id: no-domain-framework-coupling
    category: semantic-framework-leak
    kind: semantic
    scope: { components: [domain] }
    statement: >
      Domain logic must not depend on or reference framework or infrastructure concepts (web
      request/response types, ORM session objects, HTTP clients, DI containers), neither via import
      nor via function signatures. The domain is the inner layer and must stay framework-agnostic.
    severity: error
YAML

git init -q
git add -A
git -c user.email=smoke@example.com -c user.name=smoke commit -qm "clean baseline"

# --- the violation, working tree only, so `git diff --name-status HEAD` shows it -------------
cat > shop/domain/pricing.py <<'PY'
"""Pricing rules of the shop domain. Inner layer: stays framework-agnostic."""

from decimal import Decimal

from flask import Request


def discounted_price(net: Decimal, discount_percent: Decimal) -> Decimal:
    return net - (net * discount_percent / Decimal(100))


def price_for_request(request: Request) -> Decimal:
    """M1 violation: a web-framework type reaches into a domain signature."""
    return discounted_price(Decimal(request.args["net"]), Decimal(10))
PY

echo "created $TARGET"
echo "  shop/domain/pricing.py   component 'domain' — modified, imports flask.Request and takes it in a signature"
echo "  shop/api/routes.py       component 'api' — committed clean, unchanged"
echo "  soll.ilograph.yaml       components: domain, api (relation api -> domain)"
echo "  architecture-rules.yaml  semantic rule 'no-domain-framework-coupling', scope: [domain]"
echo
echo "expected changed_files_count: 1"
git -C "$TARGET" diff --name-status HEAD
