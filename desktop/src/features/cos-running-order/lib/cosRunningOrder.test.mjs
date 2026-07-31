import assert from "node:assert/strict";
import test from "node:test";

import {
  cosRunningOrderEndpoint,
  loadCosRunningOrder,
  projectCosRunningOrder,
  selectCosRunningOrderItems,
} from "./cosRunningOrder.ts";

test("projectCosRunningOrder accepts the stable workspace adapter contract", () => {
  const snapshot = projectCosRunningOrder({
    schema: "mac-workspace/cos-running-order/v1",
    generated_at_utc: "2026-07-27T15:57:47Z",
    generation_id: "generation-1",
    operational_status: "ok",
    overall_status: "degraded",
    staging_revision: "9c351c0ce66071cf2380edcc31e413d176f0b3d2",
    source_errors: [],
    counts: {
      active: 1,
      agent_running: 1,
      blocked: 1,
      completed: 0,
      human_test: 0,
      queued: 1,
      ready: 0,
      running: 2,
    },
    items: [
      {
        key: "COS-102",
        summary: "Blocked work",
        jira_status: "In Progress",
        priority: "High",
        state: "blocked",
        admission_signals: ["forge-ready"],
        blockers: ["PR #22 has failed checks"],
        pull_requests: [{ number: 22, state: "OPEN", draft: false }],
        active_run: null,
        staging_evidenced: false,
      },
      {
        key: "COS-103",
        summary: "Active build",
        jira_status: "In Progress",
        priority: "Highest",
        state: "running",
        admission_signals: ["forge-ready"],
        blockers: [],
        pull_requests: [{ number: 23, state: "OPEN", draft: false }],
        active_run: {
          id: "COS-103-run",
          state: "building",
          branch: "card/COS-103",
          pull_request_number: 23,
          updated_at_utc: "2026-07-27T15:55:00Z",
        },
        staging_evidenced: false,
      },
      {
        key: "COS-104",
        summary: "Active in Jira",
        jira_status: "In Progress",
        priority: "Medium",
        state: "running",
        execution_state: "active",
        admission_signals: [],
        blockers: [],
        pull_requests: [],
        active_run: null,
        staging_evidenced: false,
      },
      {
        key: "COS-101",
        summary: "Queued work",
        jira_status: "Backlog",
        priority: "Medium",
        state: "queued",
        admission_signals: [],
        blockers: [],
        pull_requests: [],
        active_run: null,
        staging_evidenced: false,
      },
    ],
  });

  assert.deepEqual(snapshot.counts, {
    active: 1,
    blocked: 1,
    completed: 0,
    humanTest: 0,
    queued: 1,
    ready: 0,
    running: 1,
  });
  assert.equal(snapshot.items[0]?.key, "COS-102");
  assert.equal(snapshot.items[0]?.state, "blocked");
  assert.equal(snapshot.items[0]?.blockers[0], "PR #22 has failed checks");
  assert.equal(snapshot.items[1]?.key, "COS-103");
  assert.equal(snapshot.items[1]?.state, "running");
  assert.equal(snapshot.items[2]?.key, "COS-104");
  assert.equal(snapshot.items[2]?.state, "active");
  assert.equal(
    snapshot.stagingRevision,
    "9c351c0ce66071cf2380edcc31e413d176f0b3d2",
  );
  assert.deepEqual(
    selectCosRunningOrderItems(snapshot.items, "focus").map((item) => item.key),
    ["COS-102", "COS-103", "COS-104"],
  );
  assert.deepEqual(
    selectCosRunningOrderItems(snapshot.items, "queued").map(
      (item) => item.key,
    ),
    ["COS-101"],
  );
});

test("loadCosRunningOrder reads the adapter beside the active community relay", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ init, url });
    return {
      ok: true,
      json: async () => ({
        schema: "mac-workspace/cos-running-order/v1",
        generated_at_utc: "2026-07-27T15:57:47Z",
        generation_id: "generation-2",
        operational_status: "ok",
        overall_status: "complete",
        staging_revision: "abc123",
        source_errors: [],
        counts: {
          active: 0,
          blocked: 0,
          completed: 0,
          human_test: 0,
          queued: 0,
          ready: 0,
          running: 0,
        },
        items: [],
      }),
    };
  };

  assert.equal(
    cosRunningOrderEndpoint("wss://forge-do.tailfe35cd.ts.net/"),
    "https://forge-do.tailfe35cd.ts.net/api/cos-running-order/v1",
  );

  const result = await loadCosRunningOrder({
    relayUrl: "wss://forge-do.tailfe35cd.ts.net/",
    fetcher,
  });

  assert.equal(result.generationId, "generation-2");
  assert.deepEqual(calls, [
    {
      url: "https://forge-do.tailfe35cd.ts.net/api/cos-running-order/v1",
      init: { cache: "no-store", signal: undefined },
    },
  ]);
});
