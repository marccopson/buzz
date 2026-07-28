import assert from "node:assert/strict";
import test from "node:test";

import {
  hasCosWorkspaceModule,
  parseCosUserContext,
  selectLatestCosUserContext,
} from "./cosUserContext.ts";

const assignee = "a".repeat(64);
const bridge = "b".repeat(64);
const channel = "550e8400-e29b-41d4-a716-446655440000";

function contextEvent({
  author = bridge,
  createdAt = 1,
  eventId = "1".repeat(64),
  modules = ["today", "my_actions", "messages", "assistant"],
} = {}) {
  return {
    id: eventId,
    pubkey: author,
    created_at: createdAt,
    kind: 37012,
    tags: [
      ["h", channel],
      ["d", `context:${assignee}`],
      ["p", assignee],
    ],
    content: JSON.stringify({
      schema: "mac-workspace/cos-user-context/v1",
      tenant_slug: "mac-surfacing",
      user: {
        id: 42,
        name: "Jake Wherton",
        role: "contractor_admin",
        role_label: "Leadership",
      },
      modules,
      assistant: modules.includes("assistant")
        ? {
            key: "mac-assistant",
            label: "MAC Assistant",
            execution: "brain-vps",
            memory_scope: "private-channel",
          }
        : null,
      generated_at: "2026-07-28T08:00:00Z",
    }),
    sig: "c".repeat(128),
  };
}

test("parses a private staff context and exposes only projected modules", () => {
  const context = parseCosUserContext(contextEvent(), assignee);
  assert.equal(context.user.name, "Jake Wherton");
  assert.equal(hasCosWorkspaceModule(context, "assistant"), true);
  assert.equal(hasCosWorkspaceModule(context, "agents"), false);
});

test("fails closed on privileged or malformed module projections", () => {
  assert.throws(() =>
    parseCosUserContext(
      contextEvent({ modules: ["today", "agents"] }),
      assignee,
    ),
  );
  assert.throws(() =>
    parseCosUserContext(
      {
        ...contextEvent(),
        tags: [
          ["h", channel],
          ["d", `context:${"d".repeat(64)}`],
          ["p", "d".repeat(64)],
        ],
      },
      assignee,
    ),
  );
});

test("selects the latest projection from only the trusted bridge", () => {
  const latest = selectLatestCosUserContext(
    [
      contextEvent(),
      contextEvent({
        eventId: "2".repeat(64),
        createdAt: 2,
        modules: [
          "today",
          "my_actions",
          "messages",
          "assistant",
          "running_order",
          "agents",
        ],
      }),
      contextEvent({
        author: "d".repeat(64),
        eventId: "3".repeat(64),
        createdAt: 3,
        modules: [
          "today",
          "my_actions",
          "messages",
          "assistant",
          "running_order",
          "agents",
        ],
      }),
    ],
    assignee,
    bridge,
  );
  assert.equal(latest?.eventId, "2".repeat(64));
});
