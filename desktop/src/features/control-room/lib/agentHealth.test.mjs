import assert from "node:assert/strict";
import test from "node:test";

import {
  agentHealthEndpoint,
  parseAgentHealthSnapshot,
} from "./agentHealth.ts";

function snapshot() {
  const dimensions = Object.fromEntries(
    [
      "alive",
      "connected",
      "authenticated",
      "capable",
      "working",
      "fresh",
      "safe",
      "recoverable",
    ].map((name) => [
      name,
      { state: name === "working" ? "unknown" : "pass", evidence: [name] },
    ]),
  );
  return {
    schemaVersion: "mac-agent-health/v1",
    generatedAt: "2026-07-29T06:00:00Z",
    operationalStatus: "green",
    assuranceStatus: "partial",
    assuranceGaps: ["current-run evidence"],
    source: {
      status: "fresh",
      estate: { observedAt: "2026-07-29T06:00:00Z", ageSeconds: 10 },
      agents: { observedAt: "2026-07-29T06:00:00Z", ageSeconds: 10 },
    },
    nodes: [{ id: "brain", name: "Brain", status: "green", detail: "OK" }],
    agents: [
      {
        id: "sammi",
        name: "Sammi",
        operationalStatus: "green",
        assuranceStatus: "partial",
        dimensions,
      },
    ],
    components: [
      {
        id: "buzz-runtime",
        name: "Buzz runtime",
        status: "green",
        detail: "OK",
      },
    ],
    issues: [],
  };
}

test("parses operational and assurance state separately", () => {
  const parsed = parseAgentHealthSnapshot(snapshot());
  assert.equal(parsed.operationalStatus, "green");
  assert.equal(parsed.assuranceStatus, "partial");
  assert.equal(parsed.agents[0].dimensions.working.state, "unknown");
});

test("rejects an unknown contract", () => {
  assert.throws(
    () => parseAgentHealthSnapshot({ ...snapshot(), schemaVersion: "other" }),
    /Unsupported/,
  );
});

test("derives the tailnet health endpoint from relay configuration", () => {
  assert.equal(
    agentHealthEndpoint("wss://forge-do.tailfe35cd.ts.net/").toString(),
    "https://forge-do.tailfe35cd.ts.net/api/mac-agent-health/v1",
  );
});
