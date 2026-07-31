#!/usr/bin/env bash
set -euo pipefail

workflow="${1:-.github/workflows/docker.yml}"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$1"
}

[[ -f "$workflow" ]] || fail "Docker workflow not found: $workflow"

raw_sha_count="$(grep -Fc 'type=raw,value=sha-${{ github.sha }}' "$workflow" || true)"
[[ "$raw_sha_count" -eq 2 ]] \
  || fail "build and merge metadata must both use an unprefixed raw SHA tag"
pass "build and merge metadata use the same raw SHA tag"

prefix_count="$(grep -Fc 'prefix=${{ matrix.tag_prefix }},onlatest=true' "$workflow" || true)"
[[ "$prefix_count" -eq 1 ]] \
  || fail "manifest metadata must apply the variant prefix exactly once"
pass "manifest metadata applies the variant prefix exactly once"

if grep -Fq 'value=${{ matrix.tag_prefix }}sha-' "$workflow"; then
  fail "raw SHA tag must not include the matrix prefix before metadata-action"
fi
pass "raw SHA tag cannot receive a duplicate debug prefix"

apply_prefix() {
  local prefix="$1"
  local raw_tag="$2"
  printf '%s%s\n' "$prefix" "$raw_tag"
}

release_tag="$(apply_prefix "" "sha-test")"
debug_tag="$(apply_prefix "debug-" "sha-test")"

[[ "$release_tag" == "sha-test" ]] || fail "release SHA tag contract changed"
[[ "$debug_tag" == "debug-sha-test" ]] || fail "debug SHA tag contract changed"
[[ "$debug_tag" != debug-debug-* ]] || fail "debug prefix was applied twice"
pass "release and debug tag matrix resolves without duplicate prefixes"
