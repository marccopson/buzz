import assert from "node:assert/strict";
import test from "node:test";

import {
  agentHealthEndpoint,
  parseAgentHealthSnapshot,
  presentAgentHealth,
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
    authority: {
      id: "brain-vps-health-check",
      role: "authoritative-estate-observer",
    },
    operationalStatus: "green",
    assuranceStatus: "partial",
    assuranceGaps: ["current-run evidence"],
    source: {
      status: "fresh",
      maxAgeSeconds: 93600,
      estate: {
        path: "/root/MAC-Local/reports/infra-check-latest.md",
        observedAt: "2026-07-29T06:00:00Z",
        ageSeconds: 10,
        sha256: "a".repeat(64),
      },
      agents: {
        path: "/root/MAC-Local/reports/mac-workspace-hermes-latest.md",
        observedAt: "2026-07-29T06:00:00Z",
        ageSeconds: 10,
        sha256: "b".repeat(64),
      },
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

test("rejects incomplete source evidence", () => {
  const value = snapshot();
  delete value.source.agents;
  assert.throws(() => parseAgentHealthSnapshot(value), /incomplete/);
});

test("presents stale and invalid evidence as unavailable", () => {
  for (const sourceStatus of ["stale", "invalid"]) {
    const value = snapshot();
    value.source.status = sourceStatus;
    const presentation = presentAgentHealth(parseAgentHealthSnapshot(value));
    assert.equal(presentation.current, false);
    assert.equal(presentation.status, "red");
    assert.match(presentation.label, /stale|invalid/i);
  }
});

test("labels cached data after a failed refresh as last known", () => {
  const presentation = presentAgentHealth(
    parseAgentHealthSnapshot(snapshot()),
    {
      refreshFailed: true,
    },
  );
  assert.equal(presentation.current, false);
  assert.equal(presentation.status, "red");
  assert.match(presentation.label, /last known/i);
});

test("derives the tailnet health endpoint from relay configuration", () => {
  assert.equal(
    agentHealthEndpoint("wss://forge-do.tailfe35cd.ts.net/").toString(),
    "https://forge-do.tailfe35cd.ts.net/api/mac-agent-health/v1",
  );
});
