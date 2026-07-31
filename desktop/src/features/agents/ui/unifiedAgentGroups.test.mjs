import assert from "node:assert/strict";
import test from "node:test";

import { pickProfileAgent } from "./unifiedAgentGroups.ts";

function agent(name, status = "stopped") {
  return {
    name,
    status,
    pid: status === "running" ? 123 : null,
  };
}

test("pickProfileAgent prefers a configured identity over the persona placeholder", () => {
  const selected = pickProfileAgent(
    [agent("Bumble"), agent("Maria")],
    "Bumble",
  );

  assert.equal(selected.name, "Maria");
});

test("pickProfileAgent still prefers the active runtime", () => {
  const selected = pickProfileAgent(
    [agent("Bumble", "running"), agent("Maria")],
    "Bumble",
  );

  assert.equal(selected.name, "Bumble");
});
