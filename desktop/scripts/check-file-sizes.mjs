import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFileSizeCheck } from "../../scripts/check-file-sizes-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const MAX_LINES = 1000;

const rules = [
  { root: "src-tauri/src", extensions: new Set([".rs"]), maxLines: MAX_LINES },
  {
    root: "src/app",
    extensions: new Set([".ts", ".tsx"]),
    maxLines: MAX_LINES,
  },
  {
    root: "src/features",
    extensions: new Set([".ts", ".tsx"]),
    maxLines: MAX_LINES,
  },
  {
    root: "src/shared/api",
    extensions: new Set([".ts", ".tsx"]),
    maxLines: MAX_LINES,
  },
  {
    root: "src/shared/context",
    extensions: new Set([".ts", ".tsx"]),
    maxLines: MAX_LINES,
  },
  {
    root: "src/shared/lib",
    extensions: new Set([".ts", ".tsx"]),
    maxLines: MAX_LINES,
  },
  {
    root: "src/shared/ui",
    extensions: new Set([".ts", ".tsx"]),
    maxLines: MAX_LINES,
  },
  {
    root: "src/shared/styles",
    extensions: new Set([".css"]),
    maxLines: MAX_LINES,
  },
];

// The v0.5.2 sync folds 53 already-reviewed upstream commits into one MAC PR.
// Pin only their exact release sizes so the dynamic ratchet absorbs that
// cumulative delta once; any further growth still fails.
const syncedBaselines = new Map([
  ["src-tauri/src/commands/agent_config.rs", 1112],
  ["src-tauri/src/commands/agent_discovery.rs", 1835],
  ["src-tauri/src/managed_agents/discovery.rs", 1860],
  ["src-tauri/src/managed_agents/discovery/tests.rs", 1924],
  ["src-tauri/src/managed_agents/readiness.rs", 1863],
  ["src-tauri/src/managed_agents/runtime/tests.rs", 1318],
  ["src/app/AppShell.tsx", 1004],
  ["src/features/agents/ui/AgentDefinitionDialog.tsx", 1048],
  ["src/features/agents/ui/AgentInstanceEditDialog.tsx", 1229],
  ["src/shared/api/types.ts", 1062],
]);

await runFileSizeCheck({
  projectRoot,
  rules,
  label: "Desktop",
  syncedBaselines,
});
