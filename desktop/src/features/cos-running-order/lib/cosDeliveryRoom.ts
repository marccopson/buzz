import {
  COS_DELIVERY_ROOM_SCHEMA,
  type CosDeliveryRoom,
  DELIVERY_ROOM_MAX_CLOCK_SKEW_MS,
  DELIVERY_ROOM_PROJECTION_SCHEMA,
  type AttentionView,
  type DeliveryRoomContribution,
  type DeliveryRoomEvidence,
  type DeliveryRoomEvidenceFreshness,
  type DeliveryRoomEvidenceKind,
  type DeliveryRoomGate,
  type DeliveryRoomGateStatus,
  type DeliveryRoomParticipantState,
  type DeliveryRoomStage,
  type DeliveryRoomTeam,
  type DeliveryRoomTeamTemplate,
  type DeliveryRoomTemplateId,
  type DeliveryRoomWorkHealth,
  type DeliveryRoomWorkItem,
  type SourceEvidence,
} from "./cosDeliveryRoomTypes.ts";
import { verifyCosDeliveryRoomGeneration } from "./cosDeliveryRoomDigest.ts";
import { REVIEWED_TEAM_TEMPLATES } from "./cosDeliveryRoomTemplates.ts";
import { strictDeliveryRoomDate } from "./cosDeliveryRoomTime.ts";

export * from "./cosDeliveryRoomDigest.ts";
export * from "./cosDeliveryRoomThreads.ts";
export * from "./cosDeliveryRoomTypes.ts";

type JsonRecord = Record<string, unknown>;

const STAGES: readonly DeliveryRoomStage[] = [
  "ready",
  "building",
  "independent_review",
  "staging_verification",
  "complete",
];
const PARTICIPANT_STATES = new Set<DeliveryRoomParticipantState>([
  "working",
  "reviewing",
  "waiting",
  "available",
  "needs_you",
  "stalled",
  "unavailable",
]);
const WORK_HEALTH = new Set<DeliveryRoomWorkHealth>([
  "on_track",
  "needs_manager",
  "stalled",
  "unavailable",
]);
const EVIDENCE_KINDS = new Set<DeliveryRoomEvidenceKind>([
  "task",
  "status",
  "run",
  "review",
  "verification",
  "external",
  "human",
  "unknown",
]);
const GATE_STATUSES = new Set<DeliveryRoomGateStatus>([
  "pending",
  "passed",
  "failed",
  "blocked",
]);
const GATE_OUTCOMES = new Set(["passed", "failed", "blocked", "unknown"]);
const TEMPLATE_IDS = new Set<DeliveryRoomTemplateId>([
  "senior-development-team",
  "planning-council",
  "board-of-advisors",
]);
const SHA256 = /^[0-9a-f]{64}$/;

export function deliveryRoomTeamTemplateId(
  team: Pick<DeliveryRoomTeam, "id" | "templateId">,
): DeliveryRoomTemplateId | undefined {
  if (team.templateId) return team.templateId;
  const id = team.id as DeliveryRoomTemplateId;
  return TEMPLATE_IDS.has(id) ? id : undefined;
}

function fail(message: string): never {
  throw new Error(`Delivery Room evidence is unverifiable: ${message}`);
}

function object(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) return fail(`${label} must be an array`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : string(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") return fail(`${label} must be a boolean`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    return fail(`${label} must be a positive integer`);
  }
  return value as number;
}

function exactKeys(value: JsonRecord, allowed: string[], label: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) fail(`${label} contains unsupported fields`);
}

function uniqueStrings(value: unknown, label: string): string[] {
  const result = array(value, label).map((item, index) =>
    string(item, `${label}[${index}]`),
  );
  if (new Set(result).size !== result.length)
    fail(`${label} contains duplicates`);
  return result;
}

function enumValue<T extends string>(
  value: unknown,
  values: ReadonlySet<T>,
  label: string,
): T {
  if (typeof value !== "string" || !values.has(value as T)) {
    return fail(`${label} is unsupported`);
  }
  return value as T;
}

function parseDate(value: unknown, label: string): Date {
  const date = strictDeliveryRoomDate(value);
  if (!date) return fail(`${label} is invalid`);
  return date;
}

function calculatedFreshness(
  observedAt: unknown,
  freshForMs: number,
  now: Date,
): DeliveryRoomEvidenceFreshness {
  if (typeof observedAt !== "string" || observedAt.length === 0)
    return "invalid";
  const observed = strictDeliveryRoomDate(observedAt);
  if (!observed) return "invalid";
  const age = now.getTime() - observed.getTime();
  if (age < -DELIVERY_ROOM_MAX_CLOCK_SKEW_MS) return "invalid";
  return age <= freshForMs ? "current" : "stale";
}

function assertCurrent(
  observedAt: unknown,
  freshForMs: number,
  now: Date,
  label: string,
): string {
  if (calculatedFreshness(observedAt, freshForMs, now) !== "current") {
    return fail(`${label} is stale or invalid`);
  }
  return string(observedAt, label);
}

function safeHref(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const href = string(value, label);
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return fail(`${label} is invalid`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return fail(`${label} is not a safe web link`);
  }
  return href;
}

function parseEvidence(
  value: unknown,
  now: Date,
  label: string,
): DeliveryRoomEvidence {
  const raw = object(value, label);
  exactKeys(
    raw,
    [
      "id",
      "source",
      "detail",
      "gateOutcome",
      "observedAt",
      "freshness",
      "freshForMs",
    ],
    label,
  );
  const source = object(raw.source, `${label}.source`);
  exactKeys(
    source,
    ["kind", "label", "actorId", "reference", "href"],
    `${label}.source`,
  );
  const freshForMs = integer(raw.freshForMs, `${label}.freshForMs`);
  const declaredFreshness = enumValue(
    raw.freshness,
    new Set<DeliveryRoomEvidenceFreshness>(["current", "stale", "invalid"]),
    `${label}.freshness`,
  );
  const actualFreshness = calculatedFreshness(raw.observedAt, freshForMs, now);
  if (declaredFreshness !== actualFreshness)
    fail(`${label} freshness contradicts its timestamp`);
  const gateOutcome =
    raw.gateOutcome === undefined
      ? undefined
      : enumValue(raw.gateOutcome, GATE_OUTCOMES, `${label}.gateOutcome`);
  return {
    id: string(raw.id, `${label}.id`),
    source: {
      kind: enumValue(source.kind, EVIDENCE_KINDS, `${label}.source.kind`),
      label: string(source.label, `${label}.source.label`),
      actorId: optionalString(source.actorId, `${label}.source.actorId`),
      reference: optionalString(source.reference, `${label}.source.reference`),
      href: safeHref(source.href, `${label}.source.href`),
    },
    detail: string(raw.detail, `${label}.detail`),
    gateOutcome: gateOutcome as DeliveryRoomEvidence["gateOutcome"],
    observedAt: typeof raw.observedAt === "string" ? raw.observedAt : "",
    freshness: declaredFreshness,
    freshForMs,
  };
}

function parseEvidenceList(
  value: unknown,
  now: Date,
  label: string,
): DeliveryRoomEvidence[] {
  const result = array(value, label).map((item, index) =>
    parseEvidence(item, now, `${label}[${index}]`),
  );
  const ids = result.map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    fail(`${label} contains duplicate evidence IDs`);
  return result;
}

function isCurrentEvidence(value: DeliveryRoomEvidence): boolean {
  return value.freshness === "current" && value.source.kind !== "unknown";
}

function parseGate(value: unknown, now: Date, label: string): DeliveryRoomGate {
  const raw = object(value, label);
  exactKeys(
    raw,
    ["id", "label", "status", "requiredEvidenceKind", "evidence"],
    label,
  );
  const status = enumValue(raw.status, GATE_STATUSES, `${label}.status`);
  const requiredEvidenceKind =
    raw.requiredEvidenceKind === undefined
      ? undefined
      : enumValue(
          raw.requiredEvidenceKind,
          new Set<"review" | "verification">(["review", "verification"]),
          `${label}.requiredEvidenceKind`,
        );
  const evidence =
    raw.evidence === undefined
      ? undefined
      : parseEvidence(raw.evidence, now, `${label}.evidence`);
  if (status !== "pending") {
    if (
      !requiredEvidenceKind ||
      !evidence ||
      !isCurrentEvidence(evidence) ||
      evidence.source.kind !== requiredEvidenceKind ||
      evidence.gateOutcome !== status
    ) {
      fail(`${label} status lacks matching current gate evidence`);
    }
  }
  return {
    id: string(raw.id, `${label}.id`),
    label: string(raw.label, `${label}.label`),
    status,
    requiredEvidenceKind,
    evidence,
  };
}

function parseWorkItem(
  value: unknown,
  now: Date,
  label: string,
): DeliveryRoomWorkItem {
  const raw = object(value, label);
  exactKeys(
    raw,
    [
      "id",
      "title",
      "whyItMatters",
      "currentActivity",
      "nextAction",
      "owner",
      "externalReference",
      "stage",
      "health",
      "objectiveGates",
      "evidence",
    ],
    label,
  );
  const owner = object(raw.owner, `${label}.owner`);
  exactKeys(owner, ["id", "label", "teamId", "teamLabel"], `${label}.owner`);
  const evidence = parseEvidenceList(raw.evidence, now, `${label}.evidence`);
  const gates = array(raw.objectiveGates, `${label}.objectiveGates`).map(
    (gate, index) => parseGate(gate, now, `${label}.objectiveGates[${index}]`),
  );
  if (new Set(gates.map((gate) => gate.id)).size !== gates.length) {
    fail(`${label} contains duplicate gate IDs`);
  }
  const stage = enumValue(raw.stage, new Set(STAGES), `${label}.stage`);
  const health = enumValue(raw.health, WORK_HEALTH, `${label}.health`);
  const currentKinds = new Set(
    evidence.filter(isCurrentEvidence).map((item) => item.source.kind),
  );
  if (
    stage === "building" &&
    !currentKinds.has("run") &&
    !currentKinds.has("status")
  ) {
    fail(`${label} claims building without current run or status evidence`);
  }
  if (stage === "independent_review" && !currentKinds.has("review")) {
    fail(`${label} claims independent review without current review evidence`);
  }
  if (stage === "staging_verification" && !currentKinds.has("verification")) {
    fail(
      `${label} claims staging verification without current verification evidence`,
    );
  }
  if (
    stage === "complete" &&
    (gates.length === 0 ||
      gates.some((gate) => gate.status !== "passed") ||
      (!currentKinds.has("verification") && !currentKinds.has("status")))
  ) {
    fail(
      `${label} claims completion without passed gates and current evidence`,
    );
  }
  if (
    (health === "on_track" || health === "needs_manager") &&
    currentKinds.size === 0
  ) {
    fail(`${label} health lacks current evidence`);
  }
  let externalReference: DeliveryRoomWorkItem["externalReference"];
  if (raw.externalReference !== undefined) {
    const reference = object(
      raw.externalReference,
      `${label}.externalReference`,
    );
    exactKeys(
      reference,
      ["key", "label", "href"],
      `${label}.externalReference`,
    );
    externalReference = {
      key: string(reference.key, `${label}.externalReference.key`),
      label: optionalString(
        reference.label,
        `${label}.externalReference.label`,
      ),
      href: safeHref(reference.href, `${label}.externalReference.href`),
    };
  }
  return {
    id: string(raw.id, `${label}.id`),
    title: string(raw.title, `${label}.title`),
    whyItMatters: string(raw.whyItMatters, `${label}.whyItMatters`),
    currentActivity: string(raw.currentActivity, `${label}.currentActivity`),
    nextAction: string(raw.nextAction, `${label}.nextAction`),
    owner: {
      id: string(owner.id, `${label}.owner.id`),
      label: string(owner.label, `${label}.owner.label`),
      teamId: optionalString(owner.teamId, `${label}.owner.teamId`),
      teamLabel: optionalString(owner.teamLabel, `${label}.owner.teamLabel`),
    },
    externalReference,
    stage,
    health,
    objectiveGates: gates,
    evidence,
  };
}

function parseContribution(
  value: unknown,
  participants: Set<string>,
  now: Date,
  label: string,
  includeId = true,
): DeliveryRoomContribution {
  const raw = object(value, label);
  exactKeys(
    raw,
    includeId
      ? ["id", "participantId", "summary", "evidence"]
      : ["participantId", "summary", "evidence"],
    label,
  );
  const participantId = string(raw.participantId, `${label}.participantId`);
  if (!participants.has(participantId))
    fail(`${label} references an unknown participant`);
  const evidence = parseEvidenceList(raw.evidence, now, `${label}.evidence`);
  if (
    evidence.length === 0 ||
    evidence.some(
      (item) =>
        !isCurrentEvidence(item) ||
        item.source.kind !== "human" ||
        item.source.actorId !== participantId,
    )
  ) {
    fail(`${label} lacks current actor-attributed human evidence`);
  }
  return {
    id: includeId ? string(raw.id, `${label}.id`) : "synthesis",
    participantId,
    summary: string(raw.summary, `${label}.summary`),
    evidence,
  };
}

function parseTeam(value: unknown, now: Date, label: string): DeliveryRoomTeam {
  const raw = object(value, label);
  exactKeys(
    raw,
    [
      "id",
      "name",
      "templateId",
      "chairOrLead",
      "invitedParticipantIds",
      "actualParticipantIds",
      "contributingParticipantIds",
      "participants",
      "contributions",
      "dissent",
      "synthesis",
      "signOff",
      "absentOrUnavailable",
    ],
    label,
  );
  const participants = array(raw.participants, `${label}.participants`).map(
    (value, index) => {
      const participant = object(value, `${label}.participants[${index}]`);
      exactKeys(
        participant,
        ["id", "name", "role", "state", "evidence"],
        `${label}.participants[${index}]`,
      );
      const state = enumValue(
        participant.state,
        PARTICIPANT_STATES,
        `${label}.participants[${index}].state`,
      );
      const evidence = parseEvidenceList(
        participant.evidence,
        now,
        `${label}.participants[${index}].evidence`,
      );
      if (
        state !== "stalled" &&
        state !== "unavailable" &&
        !evidence.some(isCurrentEvidence)
      ) {
        fail(`${label} active participant lacks current evidence`);
      }
      return {
        id: string(participant.id, `${label}.participants[${index}].id`),
        name: string(participant.name, `${label}.participants[${index}].name`),
        role: string(participant.role, `${label}.participants[${index}].role`),
        state,
        evidence,
      };
    },
  );
  const participantIds = new Set(participants.map((item) => item.id));
  if (participantIds.size !== participants.length)
    fail(`${label} contains duplicate participants`);
  const contributions = array(raw.contributions, `${label}.contributions`).map(
    (item, index) =>
      parseContribution(
        item,
        participantIds,
        now,
        `${label}.contributions[${index}]`,
      ),
  );
  const dissent = array(raw.dissent, `${label}.dissent`).map((item, index) =>
    parseContribution(item, participantIds, now, `${label}.dissent[${index}]`),
  );
  const synthesisValue =
    raw.synthesis === undefined
      ? undefined
      : parseContribution(
          raw.synthesis,
          participantIds,
          now,
          `${label}.synthesis`,
          false,
        );
  const synthesis = synthesisValue
    ? {
        participantId: synthesisValue.participantId,
        summary: synthesisValue.summary,
        evidence: synthesisValue.evidence,
      }
    : undefined;
  const signOffRaw = object(raw.signOff, `${label}.signOff`);
  let signOff: DeliveryRoomTeam["signOff"];
  const signedOff = signOffRaw.status === "signed_off";
  exactKeys(
    signOffRaw,
    signedOff
      ? ["status", "participantId", "summary", "evidence"]
      : ["status", "reason"],
    `${label}.signOff`,
  );
  if (signedOff) {
    const participantId = string(
      signOffRaw.participantId,
      `${label}.signOff.participantId`,
    );
    if (!participantIds.has(participantId))
      fail(`${label} sign-off references an unknown participant`);
    const evidence = parseEvidence(
      signOffRaw.evidence,
      now,
      `${label}.signOff.evidence`,
    );
    if (
      !isCurrentEvidence(evidence) ||
      evidence.source.kind !== "human" ||
      evidence.source.actorId !== participantId
    ) {
      fail(`${label} sign-off lacks current actor-attributed human evidence`);
    }
    signOff = {
      status: "signed_off",
      participantId,
      summary: optionalString(signOffRaw.summary, `${label}.signOff.summary`),
      evidence,
    };
  } else {
    if (signOffRaw.status !== "not_signed_off")
      fail(`${label} sign-off status is unsupported`);
    signOff = {
      status: "not_signed_off",
      reason: string(signOffRaw.reason, `${label}.signOff.reason`),
    };
  }
  const actual = uniqueStrings(
    raw.actualParticipantIds,
    `${label}.actualParticipantIds`,
  );
  const contributing = uniqueStrings(
    raw.contributingParticipantIds,
    `${label}.contributingParticipantIds`,
  );
  const evidencedContributors = new Set([
    ...contributions.map((item) => item.participantId),
    ...dissent.map((item) => item.participantId),
    ...(synthesis ? [synthesis.participantId] : []),
  ]);
  const evidencedActual = new Set([
    ...evidencedContributors,
    ...(signOff.status === "signed_off" ? [signOff.participantId] : []),
  ]);
  if (
    !sameSet(contributing, evidencedContributors) ||
    !sameSet(actual, evidencedActual)
  ) {
    fail(`${label} participation counts contradict attributed evidence`);
  }
  let chairOrLead: DeliveryRoomTeam["chairOrLead"];
  if (raw.chairOrLead !== undefined) {
    const chair = object(raw.chairOrLead, `${label}.chairOrLead`);
    exactKeys(chair, ["participantId", "role"], `${label}.chairOrLead`);
    chairOrLead = {
      participantId: string(
        chair.participantId,
        `${label}.chairOrLead.participantId`,
      ),
      role: string(chair.role, `${label}.chairOrLead.role`),
    };
  }
  const absentOrUnavailable = array(
    raw.absentOrUnavailable,
    `${label}.absentOrUnavailable`,
  ).map((value, index) => {
    const absent = object(value, `${label}.absentOrUnavailable[${index}]`);
    exactKeys(
      absent,
      ["participantId", "reason", "state"],
      `${label}.absentOrUnavailable[${index}]`,
    );
    if (absent.state !== "unavailable")
      fail(`${label} unavailable state is invalid`);
    return {
      participantId: string(
        absent.participantId,
        `${label}.absentOrUnavailable[${index}].participantId`,
      ),
      reason: string(
        absent.reason,
        `${label}.absentOrUnavailable[${index}].reason`,
      ),
      state: "unavailable" as const,
    };
  });
  return {
    id: string(raw.id, `${label}.id`),
    name: string(raw.name, `${label}.name`),
    templateId:
      raw.templateId === undefined
        ? undefined
        : enumValue(raw.templateId, TEMPLATE_IDS, `${label}.templateId`),
    chairOrLead,
    invitedParticipantIds: uniqueStrings(
      raw.invitedParticipantIds,
      `${label}.invitedParticipantIds`,
    ),
    actualParticipantIds: actual,
    contributingParticipantIds: contributing,
    participants,
    contributions,
    dissent,
    synthesis,
    signOff,
    absentOrUnavailable,
  };
}

function parseTemplate(
  value: unknown,
  label: string,
): DeliveryRoomTeamTemplate {
  const raw = object(value, label);
  exactKeys(raw, ["id", "name", "decisionAuthority", "roles"], label);
  if (raw.decisionAuthority !== "human")
    fail(`${label} grants non-human authority`);
  const roles = array(raw.roles, `${label}.roles`).map((value, index) => {
    const role = object(value, `${label}.roles[${index}]`);
    exactKeys(
      role,
      ["key", "label", "purpose", "required", "independent"],
      `${label}.roles[${index}]`,
    );
    return {
      key: string(role.key, `${label}.roles[${index}].key`),
      label: string(role.label, `${label}.roles[${index}].label`),
      purpose: string(role.purpose, `${label}.roles[${index}].purpose`),
      required: boolean(role.required, `${label}.roles[${index}].required`),
      independent:
        role.independent === undefined
          ? undefined
          : boolean(role.independent, `${label}.roles[${index}].independent`),
    };
  });
  return {
    id: enumValue(raw.id, TEMPLATE_IDS, `${label}.id`),
    name: string(raw.name, `${label}.name`),
    decisionAuthority: "human",
    roles,
  };
}

function parseSourceEvidence(
  value: unknown,
  maxAgeSeconds: number,
  now: Date,
  label: string,
): SourceEvidence {
  const raw = object(value, label);
  exactKeys(raw, ["observedAt", "freshness", "sha256"], label);
  if (raw.freshness !== "current") fail(`${label} is not current`);
  const observedAt = assertCurrent(
    raw.observedAt,
    maxAgeSeconds * 1000,
    now,
    `${label}.observedAt`,
  );
  const sha256 = string(raw.sha256, `${label}.sha256`);
  if (!SHA256.test(sha256)) fail(`${label}.sha256 is invalid`);
  return { observedAt, freshness: "current", sha256 };
}

function sameSet(values: Iterable<string>, expected: Set<string>): boolean {
  const actual = new Set(values);
  return (
    actual.size === expected.size &&
    [...actual].every((value) => expected.has(value))
  );
}

function exactReferencedIds(
  rawIds: unknown,
  expected: Set<string>,
  known: Set<string>,
  label: string,
): string[] {
  const ids = uniqueStrings(rawIds, label);
  if (ids.some((id) => !known.has(id)))
    fail(`${label} references unknown work`);
  if (!sameSet(ids, expected)) fail(`${label} contradicts work state`);
  return ids;
}

export function cosDeliveryRoomEndpoint(relayUrl: string): string {
  const endpoint = new URL(relayUrl);
  if (endpoint.protocol === "wss:") endpoint.protocol = "https:";
  else if (endpoint.protocol === "ws:") endpoint.protocol = "http:";
  else throw new Error("The active community relay URL is invalid");
  endpoint.pathname = "/api/mac-delivery-room/v1";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString();
}

export function projectCosDeliveryRoom(
  input: unknown,
  { now = new Date() }: { now?: Date } = {},
): CosDeliveryRoom {
  const raw = object(input, "envelope");
  exactKeys(
    raw,
    [
      "schemaVersion",
      "generatedAt",
      "generationId",
      "readOnly",
      "source",
      "deliveryRoom",
    ],
    "envelope",
  );
  if (raw.schemaVersion !== COS_DELIVERY_ROOM_SCHEMA)
    fail("the envelope schema is unsupported");
  if (raw.readOnly !== true) fail("the projection is not read-only");
  const generationId = string(raw.generationId, "generationId");
  if (!SHA256.test(generationId)) fail("generationId is invalid");
  const source = object(raw.source, "source");
  exactKeys(
    source,
    ["status", "maxAgeSeconds", "issues", "reconciliation", "agentHealth"],
    "source",
  );
  if (source.status !== "fresh") fail("the signed source is stale or invalid");
  const maxAgeSeconds = integer(source.maxAgeSeconds, "source.maxAgeSeconds");
  const issues = uniqueStrings(source.issues, "source.issues");
  if (issues.length > 0)
    fail("the signed source reports reconciliation issues");
  const generatedAt = assertCurrent(
    raw.generatedAt,
    maxAgeSeconds * 1000,
    now,
    "generatedAt",
  );
  const reconciliation = parseSourceEvidence(
    source.reconciliation,
    maxAgeSeconds,
    now,
    "source.reconciliation",
  );
  const agentHealth = parseSourceEvidence(
    source.agentHealth,
    maxAgeSeconds,
    now,
    "source.agentHealth",
  );

  const projection = object(raw.deliveryRoom, "deliveryRoom");
  exactKeys(
    projection,
    [
      "schemaVersion",
      "generatedAt",
      "sourceGeneratedAt",
      "attention",
      "stages",
      "workItems",
      "teams",
      "teamTemplates",
    ],
    "deliveryRoom",
  );
  if (projection.schemaVersion !== DELIVERY_ROOM_PROJECTION_SCHEMA)
    fail("the projection schema is unsupported");
  const projectionGeneratedAt = string(
    projection.generatedAt,
    "deliveryRoom.generatedAt",
  );
  if (projectionGeneratedAt !== generatedAt)
    fail("envelope and projection timestamps contradict each other");
  let sourceGeneratedAt: string | undefined;
  if (projection.sourceGeneratedAt !== undefined) {
    sourceGeneratedAt = string(
      projection.sourceGeneratedAt,
      "deliveryRoom.sourceGeneratedAt",
    );
    parseDate(sourceGeneratedAt, "deliveryRoom.sourceGeneratedAt");
  }

  const workItems = array(projection.workItems, "deliveryRoom.workItems").map(
    (item, index) =>
      parseWorkItem(item, now, `deliveryRoom.workItems[${index}]`),
  );
  const workIds = new Set(workItems.map((item) => item.id));
  if (workIds.size !== workItems.length) fail("work item IDs are duplicated");
  const attentionRaw = object(projection.attention, "deliveryRoom.attention");
  exactKeys(
    attentionRaw,
    ["needsManager", "blockedOrStalled"],
    "deliveryRoom.attention",
  );
  function attention(
    value: unknown,
    kind: AttentionView["kind"],
    expected: Set<string>,
    label: string,
  ): AttentionView {
    const view = object(value, label);
    exactKeys(view, ["kind", "label", "workItemIds"], label);
    if (view.kind !== kind) fail(`${label}.kind is invalid`);
    return {
      kind,
      label: string(view.label, `${label}.label`),
      workItemIds: exactReferencedIds(
        view.workItemIds,
        expected,
        workIds,
        `${label}.workItemIds`,
      ),
    };
  }
  const needsManager = attention(
    attentionRaw.needsManager,
    "needs_manager",
    new Set(
      workItems
        .filter((item) => item.health === "needs_manager")
        .map((item) => item.id),
    ),
    "deliveryRoom.attention.needsManager",
  );
  const blockedOrStalled = attention(
    attentionRaw.blockedOrStalled,
    "blocked_or_stalled",
    new Set(
      workItems
        .filter(
          (item) => item.health === "stalled" || item.health === "unavailable",
        )
        .map((item) => item.id),
    ),
    "deliveryRoom.attention.blockedOrStalled",
  );

  const stageValues = array(projection.stages, "deliveryRoom.stages");
  if (stageValues.length !== STAGES.length)
    fail("the delivery flow is incomplete");
  const stages = stageValues.map((value, index) => {
    const stage = object(value, `deliveryRoom.stages[${index}]`);
    exactKeys(
      stage,
      ["stage", "label", "workItemIds"],
      `deliveryRoom.stages[${index}]`,
    );
    if (stage.stage !== STAGES[index])
      fail("the delivery flow order is invalid");
    const stageName = STAGES[index] as DeliveryRoomStage;
    return {
      stage: stageName,
      label: string(stage.label, `deliveryRoom.stages[${index}].label`),
      workItemIds: exactReferencedIds(
        stage.workItemIds,
        new Set(
          workItems
            .filter((item) => item.stage === stageName)
            .map((item) => item.id),
        ),
        workIds,
        `deliveryRoom.stages[${index}].workItemIds`,
      ),
    };
  });
  const teams = array(projection.teams, "deliveryRoom.teams").map(
    (team, index) => parseTeam(team, now, `deliveryRoom.teams[${index}]`),
  );
  if (new Set(teams.map((team) => team.id)).size !== teams.length)
    fail("team IDs are duplicated");
  const mappedTeamTemplates = teams
    .map(deliveryRoomTeamTemplateId)
    .filter((templateId): templateId is DeliveryRoomTemplateId =>
      Boolean(templateId),
    );
  if (new Set(mappedTeamTemplates).size !== mappedTeamTemplates.length)
    fail("team-room template mappings are duplicated");
  const teamTemplates = array(
    projection.teamTemplates,
    "deliveryRoom.teamTemplates",
  ).map((template, index) =>
    parseTemplate(template, `deliveryRoom.teamTemplates[${index}]`),
  );
  if (
    JSON.stringify(teamTemplates) !== JSON.stringify(REVIEWED_TEAM_TEMPLATES)
  ) {
    fail("the reviewed team-room templates were changed");
  }

  return {
    schemaVersion: COS_DELIVERY_ROOM_SCHEMA,
    generatedAt,
    generationId,
    readOnly: true,
    source: {
      status: "fresh",
      maxAgeSeconds,
      issues,
      reconciliation,
      agentHealth,
    },
    deliveryRoom: {
      schemaVersion: DELIVERY_ROOM_PROJECTION_SCHEMA,
      generatedAt: projectionGeneratedAt,
      sourceGeneratedAt,
      attention: { needsManager, blockedOrStalled },
      stages,
      workItems,
      teams,
      teamTemplates,
    },
  };
}

export async function loadCosDeliveryRoom({
  relayUrl,
  signal,
  fetcher = fetch,
  now,
  clock = () => new Date(),
}: {
  relayUrl: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  now?: Date;
  clock?: () => Date;
}): Promise<CosDeliveryRoom> {
  const response = await fetcher(cosDeliveryRoomEndpoint(relayUrl), {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `Delivery Room evidence is unavailable (${response.status || "network error"})`,
    );
  }
  const input = await response.json();
  await verifyCosDeliveryRoomGeneration(input);
  return projectCosDeliveryRoom(input, { now: now ?? clock() });
}
