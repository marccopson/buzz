#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

(
    cd "$repo_root"
    # shellcheck disable=SC1091
    source scripts/instance-env.sh
    python3 - <<'PY'
import json
import os

config = json.loads(os.environ["BUZZ_TAURI_CONFIG"])
assert config["identifier"] == "com.macsurfacing.workspace.dev"
assert config["productName"] == "MAC Workspace Dev"
PY
)

echo "desktop instance environment contract passed"
