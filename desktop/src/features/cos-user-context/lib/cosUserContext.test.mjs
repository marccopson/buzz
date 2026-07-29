import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import {
  currentCosUserContext,
  hasCosWorkspaceModule,
  parseCosUserContext,
  selectLatestCosUserContext,
} from "./cosUserContext.ts";

const assignee = "a".repeat(64);
const bridgeSecret = new Uint8Array(32).fill(1);
const attackerSecret = new Uint8Array(32).fill(2);
const bridge = getPublicKey(bridgeSecret);
const channel = "550e8400-e29b-41d4-a716-446655440000";

function contextEvent({
  secretKey = bridgeSecret,
  createdAt = 1,
  modules = ["today", "my_actions", "messages", "assistant"],
} = {}) {
  return finalizeEvent(
    {
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
    },
    secretKey,
  );
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
  assert.throws(
    () =>
      parseCosUserContext(
        { ...contextEvent(), content: '{"schema":"tampered"}' },
        assignee,
      ),
    /signature is invalid/,
  );
});

test("selects the latest projection from only the trusted bridge", () => {
  const first = contextEvent();
  const second = contextEvent({
    createdAt: 2,
    modules: [
      "today",
      "my_actions",
      "messages",
      "assistant",
      "running_order",
      "agents",
    ],
  });
  const latest = selectLatestCosUserContext(
    [
      first,
      second,
      contextEvent({
        secretKey: attackerSecret,
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
  assert.equal(latest?.eventId, second.id);
});

test("does not authorise cached context after a refresh failure", () => {
  const cached = parseCosUserContext(contextEvent(), assignee);
  assert.equal(
    currentCosUserContext({
      data: cached,
      isError: false,
      isFetching: false,
      isPending: false,
    }),
    cached,
  );
  assert.equal(
    currentCosUserContext({
      data: cached,
      isError: true,
      isFetching: false,
      isPending: false,
    }),
    null,
  );
  assert.equal(
    currentCosUserContext({
      data: cached,
      isError: false,
      isFetching: false,
      isPending: true,
    }),
    null,
  );
  assert.equal(
    currentCosUserContext({
      data: cached,
      isError: false,
      isFetching: true,
      isPending: false,
    }),
    null,
  );
});
