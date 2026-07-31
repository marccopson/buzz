import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import {
  parseMacAssistantEnrolmentRequest,
  selectCurrentMacAssistantEnrolmentRequest,
} from "./macAssistantEnrolment.ts";

const bridgeSecret = new Uint8Array(32).fill(7);
const bridgePubkey = getPublicKey(bridgeSecret);
const identityPubkey = "a".repeat(64);
const channelId = "550e8400-e29b-41d4-a716-446655440000";
const now = 1_900_000_100;

function requestEvent(overrides = {}) {
  const request = {
    schema: "mac-workspace/mac-assistant-enrolment-request/v1",
    request_id: "11111111-1111-4111-8111-111111111111",
    challenge: "b".repeat(64),
    issued_at: now - 10,
    expires_at: now + 300,
    user_key: "staff-user",
    user_id: "42",
    user_name: "Staff User",
    identity_pubkey: identityPubkey,
    channel_id: channelId,
    assistant_instance: "mac-assistant-staff-user",
    assistant_name: "MAC Assistant",
    assistant_pubkey: "c".repeat(64),
    ...overrides,
  };
  return finalizeEvent(
    {
      created_at: request.issued_at,
      kind: 37013,
      tags: [
        ["d", request.request_id],
        ["h", request.channel_id],
        ["p", request.identity_pubkey],
        ["challenge", request.challenge],
        ["expiration", String(request.expires_at)],
        ["instance", request.assistant_instance],
      ],
      content: JSON.stringify(request),
    },
    bridgeSecret,
  );
}

const context = {
  bridgePubkey,
  identityPubkey,
  channelId,
  userId: "42",
  userName: "Staff User",
};

test("accepts one bridge-authored request for the signed identity", () => {
  const event = requestEvent();
  const request = parseMacAssistantEnrolmentRequest(event, context, now);
  assert.equal(request.assistant_instance, "mac-assistant-staff-user");
});

test("rejects stale, foreign and shared-instance requests", () => {
  assert.throws(() =>
    parseMacAssistantEnrolmentRequest(
      requestEvent({ expires_at: now }),
      context,
      now,
    ),
  );
  assert.throws(() =>
    parseMacAssistantEnrolmentRequest(
      requestEvent({ channel_id: "22222222-2222-4222-8222-222222222222" }),
      context,
      now,
    ),
  );
  assert.throws(() =>
    parseMacAssistantEnrolmentRequest(
      requestEvent({ assistant_instance: "mac-assistant" }),
      context,
      now,
    ),
  );
});

test("consumed request IDs are not rendered again", () => {
  const event = requestEvent();
  assert.equal(
    selectCurrentMacAssistantEnrolmentRequest(
      [event],
      context,
      new Set(["11111111-1111-4111-8111-111111111111"]),
      now,
    ),
    null,
  );
});
