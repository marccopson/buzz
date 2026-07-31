import type { RelayEvent } from "@/shared/api/types";
import { KIND_MAC_ASSISTANT_ENROLMENT_REQUEST } from "@/shared/constants/kinds";
import { verifyEvent } from "nostr-tools/pure";

export const ENROLMENT_REQUEST_SCHEMA =
  "mac-workspace/mac-assistant-enrolment-request/v1";

export type MacAssistantEnrolmentRequest = {
  schema: typeof ENROLMENT_REQUEST_SCHEMA;
  request_id: string;
  challenge: string;
  issued_at: number;
  expires_at: number;
  user_key: string;
  user_id: string;
  user_name: string;
  identity_pubkey: string;
  channel_id: string;
  assistant_instance: string;
  assistant_name: "MAC Assistant";
  assistant_pubkey: string;
};

const HEX64 = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function oneTag(event: RelayEvent, name: string): string {
  const matches = event.tags.filter(
    (tag) => tag.length === 2 && tag[0] === name,
  );
  if (matches.length !== 1) throw new Error(`Invalid ${name} binding`);
  return matches[0][1];
}

export function parseMacAssistantEnrolmentRequest(
  event: RelayEvent,
  context: {
    bridgePubkey: string;
    identityPubkey: string;
    channelId: string;
    userId: string;
    userName: string;
  },
  now = Math.floor(Date.now() / 1000),
): MacAssistantEnrolmentRequest {
  if (
    !verifyEvent({ ...event, tags: event.tags.map((tag) => [...tag]) }) ||
    event.kind !== KIND_MAC_ASSISTANT_ENROLMENT_REQUEST ||
    event.pubkey.toLowerCase() !== context.bridgePubkey.toLowerCase()
  ) {
    throw new Error("Request is not signed by the COS bridge");
  }
  const value = JSON.parse(event.content) as MacAssistantEnrolmentRequest;
  const exactKeys = [
    "assistant_instance",
    "assistant_name",
    "assistant_pubkey",
    "challenge",
    "channel_id",
    "expires_at",
    "identity_pubkey",
    "issued_at",
    "request_id",
    "schema",
    "user_id",
    "user_key",
    "user_name",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !== exactKeys.join(",") ||
    value.schema !== ENROLMENT_REQUEST_SCHEMA ||
    value.assistant_name !== "MAC Assistant" ||
    !UUID.test(value.request_id) ||
    !UUID.test(value.channel_id) ||
    !HEX64.test(value.challenge) ||
    !HEX64.test(value.identity_pubkey) ||
    !HEX64.test(value.assistant_pubkey) ||
    value.identity_pubkey === value.assistant_pubkey ||
    !SLUG.test(value.user_key) ||
    value.assistant_instance !== `mac-assistant-${value.user_key}` ||
    !SLUG.test(value.assistant_instance) ||
    typeof value.user_id !== "string" ||
    !value.user_id ||
    value.user_id.trim() !== value.user_id ||
    typeof value.user_name !== "string" ||
    !value.user_name ||
    value.user_name.trim() !== value.user_name ||
    !Number.isSafeInteger(value.issued_at) ||
    !Number.isSafeInteger(value.expires_at) ||
    value.expires_at <= value.issued_at ||
    value.expires_at - value.issued_at > 600 ||
    now < value.issued_at ||
    now >= value.expires_at
  ) {
    throw new Error("Request is malformed or has expired");
  }
  if (
    value.identity_pubkey !== context.identityPubkey.toLowerCase() ||
    value.channel_id !== context.channelId ||
    value.user_id !== context.userId ||
    value.user_name !== context.userName
  ) {
    throw new Error("Request belongs to another Workspace identity");
  }
  const expected = new Map([
    ["d", value.request_id],
    ["h", value.channel_id],
    ["p", value.identity_pubkey],
    ["challenge", value.challenge],
    ["expiration", String(value.expires_at)],
    ["instance", value.assistant_instance],
  ]);
  if (
    event.tags.length !== expected.size ||
    [...expected].some(
      ([name, expectedValue]) => oneTag(event, name) !== expectedValue,
    ) ||
    event.created_at !== value.issued_at
  ) {
    throw new Error("Request bindings do not match its signed payload");
  }
  return value;
}

export function selectCurrentMacAssistantEnrolmentRequest(
  events: RelayEvent[],
  context: Parameters<typeof parseMacAssistantEnrolmentRequest>[1],
  consumedRequestIds: Set<string>,
  now = Math.floor(Date.now() / 1000),
) {
  return (
    events
      .map((event) => {
        try {
          const request = parseMacAssistantEnrolmentRequest(
            event,
            context,
            now,
          );
          return consumedRequestIds.has(request.request_id)
            ? null
            : { event, request };
        } catch {
          return null;
        }
      })
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .sort(
        (left, right) =>
          right.event.created_at - left.event.created_at ||
          left.event.id.localeCompare(right.event.id),
      )[0] ?? null
  );
}
