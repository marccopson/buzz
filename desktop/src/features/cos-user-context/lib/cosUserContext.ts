import type { RelayEvent } from "@/shared/api/types";
import { KIND_COS_USER_CONTEXT } from "@/shared/constants/kinds";
import { verifyEvent } from "nostr-tools/pure";

export const COS_USER_CONTEXT_SCHEMA = "mac-workspace/cos-user-context/v1";

export type CosWorkspaceModule =
  | "today"
  | "my_actions"
  | "messages"
  | "assistant"
  | "running_order"
  | "agents";

export type CosUserContext = {
  eventId: string;
  authorPubkey: string;
  channelId: string;
  assigneePubkey: string;
  tenantSlug: string;
  user: {
    id: string | number | boolean;
    name: string;
    role: string;
    roleLabel: string;
  };
  modules: CosWorkspaceModule[];
  assistant: {
    key: "mac-assistant";
    label: string;
    execution: "brain-vps";
    memoryScope: "private-channel";
  } | null;
  generatedAt: string;
  createdAt: number;
};

type JsonRecord = Record<string, unknown>;

const VALID_MODULES = new Set<CosWorkspaceModule>([
  "today",
  "my_actions",
  "messages",
  "assistant",
  "running_order",
  "agents",
]);
const REQUIRED_MODULES = ["today", "my_actions", "messages"] as const;
const TENANT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

function exactlyOneTag(event: RelayEvent, name: string): string {
  const values = event.tags
    .filter((tag) => tag[0] === name && typeof tag[1] === "string")
    .map((tag) => tag[1]);
  if (values.length !== 1) {
    throw new Error(`COS user context must contain exactly one ${name} tag`);
  }
  return values[0];
}

function parseModules(value: unknown): CosWorkspaceModule[] {
  if (!Array.isArray(value)) {
    throw new Error("modules must be an array");
  }
  const modules = value.map((module) => {
    if (
      typeof module !== "string" ||
      !VALID_MODULES.has(module as CosWorkspaceModule)
    ) {
      throw new Error("Unsupported Workspace module");
    }
    return module as CosWorkspaceModule;
  });
  if (new Set(modules).size !== modules.length) {
    throw new Error("modules contains duplicates");
  }
  for (const required of REQUIRED_MODULES) {
    if (!modules.includes(required)) {
      throw new Error(`modules must include ${required}`);
    }
  }
  return modules;
}

export function parseCosUserContext(
  event: RelayEvent,
  expectedAssignee?: string,
): CosUserContext {
  try {
    // Verify a fresh structural copy so nostr-tools cannot reuse a cached
    // verifiedSymbol from a previously verified, subsequently mutated object.
    if (
      !verifyEvent({
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags.map((tag) => [...tag]),
        content: event.content,
        sig: event.sig,
      })
    ) {
      throw new Error("invalid signature");
    }
  } catch {
    throw new Error("COS user context signature is invalid");
  }
  if (event.kind !== KIND_COS_USER_CONTEXT) {
    throw new Error("Expected a COS user context event");
  }
  const channelId = exactlyOneTag(event, "h");
  const assigneePubkey = exactlyOneTag(event, "p").toLowerCase();
  if (exactlyOneTag(event, "d") !== `context:${assigneePubkey}`) {
    throw new Error("COS user context coordinate must bind the identity");
  }
  if (expectedAssignee && assigneePubkey !== expectedAssignee.toLowerCase()) {
    throw new Error("COS user context belongs to a different identity");
  }

  const raw = record(JSON.parse(event.content) as unknown);
  if (raw.schema !== COS_USER_CONTEXT_SCHEMA) {
    throw new Error("Unsupported COS user context schema");
  }
  const tenantSlug = string(raw.tenant_slug, "tenant_slug");
  if (tenantSlug.length > 63 || !TENANT_SLUG.test(tenantSlug)) {
    throw new Error("tenant_slug must be a canonical lower-case slug");
  }
  const user = record(raw.user);
  if (
    user.id === null ||
    !["string", "number", "boolean"].includes(typeof user.id)
  ) {
    throw new Error("user.id must be a JSON scalar");
  }
  const modules = parseModules(raw.modules);
  const hasAssistant = modules.includes("assistant");
  let assistant: CosUserContext["assistant"] = null;
  if (raw.assistant !== null && raw.assistant !== undefined) {
    const value = record(raw.assistant);
    if (
      value.key !== "mac-assistant" ||
      value.execution !== "brain-vps" ||
      value.memory_scope !== "private-channel"
    ) {
      throw new Error(
        "Assistant context violates the staff isolation boundary",
      );
    }
    assistant = {
      key: "mac-assistant",
      label: string(value.label, "assistant.label"),
      execution: "brain-vps",
      memoryScope: "private-channel",
    };
  }
  if (hasAssistant !== Boolean(assistant)) {
    throw new Error(
      "assistant must be present exactly when the module is enabled",
    );
  }

  return {
    eventId: event.id,
    authorPubkey: event.pubkey.toLowerCase(),
    channelId,
    assigneePubkey,
    tenantSlug,
    user: {
      id: user.id as string | number | boolean,
      name: string(user.name, "user.name"),
      role: string(user.role, "user.role"),
      roleLabel: string(user.role_label, "user.role_label"),
    },
    modules,
    assistant,
    generatedAt: string(raw.generated_at, "generated_at"),
    createdAt: event.created_at,
  };
}

export function selectLatestCosUserContext(
  events: RelayEvent[],
  assigneePubkey: string,
  trustedBridgePubkey: string,
): CosUserContext | null {
  const trustedAuthor = trustedBridgePubkey.toLowerCase();
  let latest: CosUserContext | null = null;
  for (const event of events) {
    if (event.pubkey.toLowerCase() !== trustedAuthor) continue;
    try {
      const candidate = parseCosUserContext(event, assigneePubkey);
      if (
        !latest ||
        candidate.createdAt > latest.createdAt ||
        (candidate.createdAt === latest.createdAt &&
          candidate.eventId.localeCompare(latest.eventId) < 0)
      ) {
        latest = candidate;
      }
    } catch {
      // Ignore malformed or incorrectly scoped projections.
    }
  }
  return latest;
}

export function hasCosWorkspaceModule(
  context: CosUserContext | null | undefined,
  module: CosWorkspaceModule,
): boolean {
  return context?.modules.includes(module) ?? false;
}

export function currentCosUserContext({
  data,
  isError,
  isPending,
}: {
  data: CosUserContext | null | undefined;
  isError: boolean;
  isPending: boolean;
}): CosUserContext | null {
  if (isError || isPending) return null;
  return data ?? null;
}
