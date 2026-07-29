import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import {
  currentCosUserContext,
  cosUserContextChannelCandidates,
  hasCosWorkspaceModule,
  parseCosUserContext,
  resolveAuthoritativeCosUserContextChannel,
  selectLatestCosUserContext,
} from "./cosUserContext.ts";

const assignee = "a".repeat(64);
const bridgeSecret = new Uint8Array(32).fill(1);
const attackerSecret = new Uint8Array(32).fill(2);
const relaySecret = new Uint8Array(32).fill(3);
const bridge = getPublicKey(bridgeSecret);
const relay = getPublicKey(relaySecret);
const channel = "550e8400-e29b-41d4-a716-446655440000";

function contextEvent({
  secretKey = bridgeSecret,
  createdAt = 1,
  modules = ["today", "my_actions", "messages", "assistant"],
  channelId = channel,
} = {}) {
  return finalizeEvent(
    {
      created_at: createdAt,
      kind: 37012,
      tags: [
        ["h", channelId],
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

function channelMetadata(channelId, { isPrivate = true, createdAt = 1 } = {}) {
  return finalizeEvent(
    {
      created_at: createdAt,
      kind: 39000,
      tags: [["d", channelId], ...(isPrivate ? [["private"]] : [["public"]])],
      content: "",
    },
    relaySecret,
  );
}

function channelMembership(
  channelId,
  {
    assigneePubkey = assignee,
    ownerPubkey = bridge,
    extraPubkey,
    createdAt = 1,
  } = {},
) {
  return finalizeEvent(
    {
      created_at: createdAt,
      kind: 39002,
      tags: [
        ["d", channelId],
        ["p", ownerPubkey, "", "owner"],
        ["p", assigneePubkey, "", "member"],
        ...(extraPubkey ? [["p", extraPubkey, "", "member"]] : []),
      ],
      content: "",
    },
    relaySecret,
  );
}

test("parses a private staff context and exposes only projected modules", () => {
  const context = parseCosUserContext(contextEvent(), assignee);
  assert.equal(context.user.name, "Jake Wherton");
  assert.equal(hasCosWorkspaceModule(context, "assistant"), true);
  assert.equal(hasCosWorkspaceModule(context, "agents"), false);
});

test("accepts least-privilege module subsets and rejects malformed modules", () => {
  const restricted = parseCosUserContext(
    contextEvent({ modules: ["today", "messages"] }),
    assignee,
  );
  assert.equal(hasCosWorkspaceModule(restricted, "my_actions"), false);
  assert.throws(() =>
    parseCosUserContext(
      contextEvent({ modules: ["today", "secrets"] }),
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

test("a newer trusted module revocation replaces the older projection", () => {
  const older = contextEvent({ createdAt: 1 });
  const restricted = contextEvent({
    createdAt: 2,
    modules: ["today", "messages"],
  });
  const latest = selectLatestCosUserContext(
    [older, restricted],
    assignee,
    bridge,
  );
  assert.equal(latest?.eventId, restricted.id);
  assert.equal(hasCosWorkspaceModule(latest, "my_actions"), false);
});

test("binds role projection to the unique current private identity channel", () => {
  const otherChannel = "550e8400-e29b-41d4-a716-446655440001";
  const events = [
    contextEvent({ channelId: channel }),
    contextEvent({ channelId: otherChannel, createdAt: 2 }),
  ];
  const candidates = cosUserContextChannelCandidates(events, assignee, bridge);
  assert.deepEqual(candidates, [channel, otherChannel]);
  const resolved = resolveAuthoritativeCosUserContextChannel({
    candidateChannelIds: candidates,
    metadataEvents: [channelMetadata(channel), channelMetadata(otherChannel)],
    membershipEvents: [
      channelMembership(channel),
      channelMembership(otherChannel, { extraPubkey: "c".repeat(64) }),
    ],
    assigneePubkey: assignee,
    trustedBridgePubkey: bridge,
    trustedRelayPubkey: relay,
  });
  assert.equal(resolved, channel);
  assert.equal(
    selectLatestCosUserContext(events, assignee, bridge, resolved)?.channelId,
    channel,
  );
});

test("fails closed when two channels claim the same active identity", () => {
  const otherChannel = "550e8400-e29b-41d4-a716-446655440001";
  const candidates = [channel, otherChannel];
  assert.equal(
    resolveAuthoritativeCosUserContextChannel({
      candidateChannelIds: candidates,
      metadataEvents: [channelMetadata(channel), channelMetadata(otherChannel)],
      membershipEvents: [
        channelMembership(channel),
        channelMembership(otherChannel),
      ],
      assigneePubkey: assignee,
      trustedBridgePubkey: bridge,
      trustedRelayPubkey: relay,
    }),
    null,
  );
  assert.throws(
    () =>
      parseCosUserContext(
        contextEvent({ channelId: otherChannel }),
        assignee,
        channel,
      ),
    /different channel/,
  );
});

test("rejects channel authority not signed by the active relay", () => {
  const forgedMetadata = finalizeEvent(
    {
      created_at: 2,
      kind: 39000,
      tags: [["d", channel], ["private"]],
      content: "",
    },
    attackerSecret,
  );
  assert.equal(
    resolveAuthoritativeCosUserContextChannel({
      candidateChannelIds: [channel],
      metadataEvents: [forgedMetadata],
      membershipEvents: [channelMembership(channel)],
      assigneePubkey: assignee,
      trustedBridgePubkey: bridge,
      trustedRelayPubkey: relay,
    }),
    null,
  );
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
