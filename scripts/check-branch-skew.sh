#!/usr/bin/env bash
# Pre-push guard: CI checks the PR merged with its permanent integration
# branch, so local runs on a skewed branch can pass while CI fails. MAC's fork
# targets `mac`; upstream clones target `main`.
set -euo pipefail

branch=$(git rev-parse --abbrev-ref HEAD)
base_branch="main"
if git rev-parse --verify --quiet origin/mac >/dev/null; then
  base_branch="mac"
fi

if [ "$branch" = "$base_branch" ] || [ "$branch" = "HEAD" ]; then
  exit 0
fi

git fetch --quiet origin "$base_branch" || true
git rev-parse --verify --quiet "origin/$base_branch" >/dev/null || exit 0

base=$(git merge-base HEAD "origin/$base_branch")
if [ "$base" = "$(git rev-parse "origin/$base_branch")" ]; then
  exit 0
fi

overlap=$(comm -12 \
  <(git diff --name-only "$base" "origin/$base_branch" -- | sort) \
  <(git diff --name-only "$base" HEAD -- | sort))

if [ -z "$overlap" ]; then
  exit 0
fi

{
  echo "Branch is behind origin/$base_branch, and $base_branch changed files this branch also touches:"
  echo "$overlap" | sed 's/^/  /'
  echo "Local checks ran on a tree CI will never test. Run 'git merge origin/$base_branch',"
  echo "resolve, re-run checks, then push."
} >&2
exit 1
