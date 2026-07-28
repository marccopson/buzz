import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_COS_FOLLOW_UP_COMMAND,
  KIND_COS_FOLLOW_UP_ITEM,
  KIND_COS_FOLLOW_UP_RECEIPT,
  KIND_DELETION,
} from "@/shared/constants/kinds";

export const COS_FOLLOW_UP_SCHEMA = "mac-workspace/cos-follow-up/v1";

export type CosFollowUpState = "needs-answer" | "ready-to-check" | "confirmed";

export type CosFollowUpAction =
  | "answer"
  | "confirm"
  | "reject"
  | "ready_to_check"
  | "reassign_confirmer";

export type CosFollowUpHumanAction = "answer" | "confirm" | "reject";

export type CosFollowUpPerson = {
  id: string | number | boolean;
  name: string;
};

export type CosFollowUpSource = {
  label: string;
  url: string;
};

export type CosFollowUpItem = {
  eventId: string;
  authorPubkey: string;
  channelId: string;
  assigneePubkey: string;
  id: string;
  jiraKey: string | null;
  title: string;
  question: string;
  evidence: string | null;
  state: CosFollowUpState;
  assignedPerson: CosFollowUpPerson;
  namedConfirmer: CosFollowUpPerson | null;
  version: number;
  permittedActions: CosFollowUpAction[];
  timestamps: Record<string, string | null>;
  deepLinks: {
    meetingFollowUp: string;
    jira: string | null;
    sources: CosFollowUpSource[];
  };
  createdAt: number;
};

export type CosFollowUpReceipt = {
  eventId: string;
  channelId: string;
  commandEventId: string;
  itemId: string;
  outcome: "accepted" | "rejected" | "conflict" | "failed";
  authoritativeVersion: number;
  message: string | null;
  code: string | null;
  retryable: boolean;
};

export type SeenActionableItem = {
  eventId: string;
  state: CosFollowUpState;
};

type JsonRecord = Record<string, unknown>;

const VALID_STATES = new Set<CosFollowUpState>([
  "needs-answer",
  "ready-to-check",
  "confirmed",
]);
const VALID_ACTIONS = new Set<CosFollowUpAction>([
  "answer",
  "confirm",
  "reject",
  "ready_to_check",
  "reassign_confirmer",
]);
const VALID_OUTCOMES = new Set<CosFollowUpReceipt["outcome"]>([
  "accepted",
  "rejected",
  "conflict",
  "failed",
]);

function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object");
  }
  return value as JsonRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safeAbsoluteUrl(value: unknown, label: string): string {
  const raw = string(value, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  const localHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error(`${label} must use HTTPS`);
  }
  return url.toString();
}

function nullableSafeAbsoluteUrl(value: unknown, label: string): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : safeAbsoluteUrl(value, label);
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function person(value: unknown, label: string): CosFollowUpPerson {
  const raw = record(value);
  if (
    !["string", "number", "boolean"].includes(typeof raw.id) ||
    raw.id === null
  ) {
    throw new Error(`${label}.id must be a JSON scalar`);
  }
  return {
    id: raw.id as string | number | boolean,
    name: string(raw.name, `${label}.name`),
  };
}

function exactlyOneTag(event: RelayEvent, name: string): string {
  const values = event.tags
    .filter((tag) => tag[0] === name && typeof tag[1] === "string")
    .map((tag) => tag[1]);
  if (values.length !== 1) {
    throw new Error(`Follow-up event must contain exactly one ${name} tag`);
  }
  return values[0];
}

function parseContent(event: RelayEvent): JsonRecord {
  const raw = record(JSON.parse(event.content) as unknown);
  if (raw.schema !== COS_FOLLOW_UP_SCHEMA) {
    throw new Error("Unsupported COS follow-up schema");
  }
  return raw;
}

function parseActions(value: unknown): CosFollowUpAction[] {
  if (!Array.isArray(value)) {
    throw new Error("permitted_actions must be an array");
  }
  const actions = value.map((action) => {
    if (
      typeof action !== "string" ||
      !VALID_ACTIONS.has(action as CosFollowUpAction)
    ) {
      throw new Error("Unsupported COS follow-up action");
    }
    return action as CosFollowUpAction;
  });
  if (new Set(actions).size !== actions.length) {
    throw new Error("permitted_actions contains duplicates");
  }
  return actions;
}

function parseSources(value: unknown): CosFollowUpSource[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("sources must be an array");
  return value.map((source, index) => {
    const raw = record(source);
    return {
      label: string(raw.label, `sources[${index}].label`),
      url: safeAbsoluteUrl(raw.url, `sources[${index}].url`),
    };
  });
}

export function parseCosFollowUpItem(
  event: RelayEvent,
  expectedAssignee?: string,
): CosFollowUpItem {
  if (event.kind !== KIND_COS_FOLLOW_UP_ITEM) {
    throw new Error("Expected a COS follow-up item event");
  }
  const channelId = exactlyOneTag(event, "h");
  const itemId = exactlyOneTag(event, "d");
  const assigneePubkey = exactlyOneTag(event, "p").toLowerCase();
  if (expectedAssignee && assigneePubkey !== expectedAssignee.toLowerCase()) {
    throw new Error("COS follow-up item is assigned to a different identity");
  }
  const raw = parseContent(event);
  if (raw.id !== itemId) {
    throw new Error("COS follow-up item content id does not match d tag");
  }
  if (
    typeof raw.state !== "string" ||
    !VALID_STATES.has(raw.state as CosFollowUpState)
  ) {
    throw new Error("Unsupported COS follow-up state");
  }
  const prompt = record(raw.question_evidence);
  const links = record(raw.deep_links);
  const timestamps = record(raw.timestamps);

  return {
    eventId: event.id,
    authorPubkey: event.pubkey,
    channelId,
    assigneePubkey,
    id: itemId,
    jiraKey: nullableString(raw.jira_key),
    title: string(raw.title, "title"),
    question: string(prompt.question, "question_evidence.question"),
    evidence: nullableString(prompt.evidence),
    state: raw.state as CosFollowUpState,
    assignedPerson: person(raw.assigned_person, "assigned_person"),
    namedConfirmer:
      raw.named_confirmer === null || raw.named_confirmer === undefined
        ? null
        : person(raw.named_confirmer, "named_confirmer"),
    version: integer(raw.version, "version"),
    permittedActions: parseActions(raw.permitted_actions),
    timestamps: Object.fromEntries(
      Object.entries(timestamps).map(([key, value]) => [
        key,
        nullableString(value),
      ]),
    ),
    deepLinks: {
      meetingFollowUp: safeAbsoluteUrl(
        links.meeting_follow_up,
        "deep_links.meeting_follow_up",
      ),
      jira: nullableSafeAbsoluteUrl(links.jira, "deep_links.jira"),
      sources: parseSources(links.sources),
    },
    createdAt: event.created_at,
  };
}

export function projectLatestCosFollowUpItems(
  events: RelayEvent[],
  assigneePubkey: string,
  trustedBridgePubkey: string,
): CosFollowUpItem[] {
  const trustedAuthor = trustedBridgePubkey.toLowerCase();
  const latest = new Map<string, CosFollowUpItem>();
  for (const event of events) {
    if (event.pubkey.toLowerCase() !== trustedAuthor) continue;
    let item: CosFollowUpItem;
    try {
      item = parseCosFollowUpItem(event, assigneePubkey);
    } catch {
      continue;
    }
    latest.set(item.id, retainLatestCosFollowUpItem(latest.get(item.id), item));
  }
  return [...latest.values()].sort(
    (left, right) =>
      right.createdAt - left.createdAt || left.id.localeCompare(right.id),
  );
}

export function retainLatestCosFollowUpItem(
  current: CosFollowUpItem | undefined,
  candidate: CosFollowUpItem,
): CosFollowUpItem {
  if (
    !current ||
    candidate.version > current.version ||
    (candidate.version === current.version &&
      (candidate.createdAt > current.createdAt ||
        (candidate.createdAt === current.createdAt &&
          candidate.eventId.localeCompare(current.eventId) < 0)))
  ) {
    return candidate;
  }
  return current;
}

export function isCosFollowUpActionPermitted(
  item: CosFollowUpItem,
  action: CosFollowUpHumanAction,
): boolean {
  if (!item.permittedActions.includes(action)) return false;
  if (action === "answer") return item.state === "needs-answer";
  return item.state === "ready-to-check";
}

export function stateLabel(state: CosFollowUpState): string {
  if (state === "needs-answer") return "We need you";
  if (state === "ready-to-check") return "Does this look right?";
  return "Confirmed";
}

export function isNewlyActionableTransition(
  previous: SeenActionableItem | undefined,
  next: CosFollowUpItem,
): boolean {
  if (next.state === "confirmed") return false;
  if (previous?.eventId === next.eventId) return false;
  return previous?.state !== next.state;
}

export function parseCosFollowUpRemoval(event: RelayEvent): {
  channelId: string;
  itemId: string;
  targetEventId: string;
} {
  if (event.kind !== KIND_DELETION) {
    throw new Error("Expected a follow-up removal event");
  }
  return {
    channelId: exactlyOneTag(event, "h"),
    itemId: exactlyOneTag(event, "item"),
    targetEventId: exactlyOneTag(event, "e"),
  };
}

export function parseCosFollowUpReceipt(event: RelayEvent): CosFollowUpReceipt {
  if (event.kind !== KIND_COS_FOLLOW_UP_RECEIPT) {
    throw new Error("Expected a COS follow-up receipt");
  }
  const raw = parseContent(event);
  const outcome = exactlyOneTag(event, "outcome");
  if (!VALID_OUTCOMES.has(outcome as CosFollowUpReceipt["outcome"])) {
    throw new Error("Unsupported COS follow-up receipt outcome");
  }
  const retryable = raw.retryable === true;
  if (retryable && outcome !== "failed") {
    throw new Error("Only failed receipts can be retryable");
  }
  return {
    eventId: event.id,
    channelId: exactlyOneTag(event, "h"),
    commandEventId: exactlyOneTag(event, "e"),
    itemId: exactlyOneTag(event, "item"),
    outcome: outcome as CosFollowUpReceipt["outcome"],
    authoritativeVersion: integer(
      Number(exactlyOneTag(event, "version")),
      "version",
    ),
    message: nullableString(raw.message),
    code: nullableString(raw.code),
    retryable,
  };
}

export function buildCosFollowUpCommandInput({
  item,
  action,
  answer,
  comment,
}: {
  item: CosFollowUpItem;
  action: CosFollowUpHumanAction;
  answer?: string;
  comment?: string;
}): { kind: number; content: string; tags: string[][] } {
  if (!isCosFollowUpActionPermitted(item, action)) {
    throw new Error("That action is not permitted for the current item state");
  }
  if (action === "answer" && !answer?.trim()) {
    throw new Error("Please enter an answer");
  }
  return {
    kind: KIND_COS_FOLLOW_UP_COMMAND,
    tags: [
      ["h", item.channelId],
      ["item", item.id],
      ["action", action],
      ["expected-version", String(item.version)],
      ["e", item.eventId],
    ],
    content: JSON.stringify({
      schema: COS_FOLLOW_UP_SCHEMA,
      ...(answer?.trim() ? { answer: answer.trim() } : {}),
      ...(comment?.trim() ? { comment: comment.trim() } : {}),
    }),
  };
}

export function resolveAcceptedCosFollowUpProjection({
  receipt,
  action,
  itemId,
  items,
}: {
  receipt: CosFollowUpReceipt;
  action: CosFollowUpHumanAction;
  itemId: string;
  items: CosFollowUpItem[];
}):
  | { status: "pending" }
  | { status: "removed" }
  | { status: "updated"; item: CosFollowUpItem } {
  const current = items.find((item) => item.id === itemId);
  if (current && current.version >= receipt.authoritativeVersion) {
    return { status: "updated", item: current };
  }
  if (!current && (action === "answer" || action === "reject")) {
    return { status: "removed" };
  }
  return { status: "pending" };
}
