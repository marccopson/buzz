import type {
  CosDeliveryRoom,
  DeliveryRoomEvidence,
  DeliveryRoomEvidenceFreshness,
} from "./cosDeliveryRoomTypes.ts";
import { DELIVERY_ROOM_MAX_CLOCK_SKEW_MS } from "./cosDeliveryRoomTypes.ts";
import { strictDeliveryRoomDate } from "./cosDeliveryRoomTime.ts";

// These are the maximum lifetimes emitted by the independently reviewed
// COS-746 producer (MAX_SOURCE_AGE_SECONDS and DELIVERY_EVIDENCE_FRESH_MS).
export const DELIVERY_ROOM_MAX_SOURCE_AGE_SECONDS = 15 * 60;
export const DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export function boundedDeliveryRoomLifetime(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
    ? (value as number)
    : undefined;
}

export function deliveryRoomSourceLifetimeMs(
  maxAgeSeconds: number,
): number | undefined {
  if (
    !Number.isSafeInteger(maxAgeSeconds) ||
    maxAgeSeconds < 60 ||
    maxAgeSeconds > DELIVERY_ROOM_MAX_SOURCE_AGE_SECONDS
  ) {
    return undefined;
  }
  const lifetimeMs = maxAgeSeconds * 1_000;
  if (
    !Number.isSafeInteger(lifetimeMs) ||
    lifetimeMs > DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS ||
    lifetimeMs / 1_000 !== maxAgeSeconds
  ) {
    return undefined;
  }
  return lifetimeMs;
}

export function checkedDeliveryRoomExpiryMs(
  observedAtMs: number,
  lifetimeMs: number,
): number | undefined {
  if (
    !Number.isSafeInteger(observedAtMs) ||
    !Number.isSafeInteger(lifetimeMs) ||
    lifetimeMs <= 0 ||
    lifetimeMs > DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS
  ) {
    return undefined;
  }
  const expiry = observedAtMs + lifetimeMs;
  if (!Number.isSafeInteger(expiry) || expiry - observedAtMs !== lifetimeMs) {
    return undefined;
  }
  return expiry;
}

export function checkedDeliveryRoomExpiry(
  observedAt: string,
  lifetimeMs: number,
): number | undefined {
  const observed = strictDeliveryRoomDate(observedAt);
  return observed
    ? checkedDeliveryRoomExpiryMs(observed.getTime(), lifetimeMs)
    : undefined;
}

export function calculatedDeliveryRoomFreshness(
  observedAt: unknown,
  freshForMs: number,
  now: Date,
): DeliveryRoomEvidenceFreshness {
  if (typeof observedAt !== "string" || observedAt.length === 0)
    return "invalid";
  const observed = strictDeliveryRoomDate(observedAt);
  if (!observed) return "invalid";
  const nowMs = now.getTime();
  const observedMs = observed.getTime();
  const expiry = checkedDeliveryRoomExpiry(observedAt, freshForMs);
  if (!Number.isSafeInteger(nowMs) || expiry === undefined) return "invalid";
  const age = nowMs - observedMs;
  if (!Number.isSafeInteger(age)) return "invalid";
  if (age < -DELIVERY_ROOM_MAX_CLOCK_SKEW_MS) return "invalid";
  return nowMs <= expiry ? "current" : "stale";
}

function expiresAt(observedAt: string, lifetimeMs: number): number {
  const expiry = checkedDeliveryRoomExpiry(observedAt, lifetimeMs);
  if (expiry === undefined)
    throw new Error("Delivery Room evidence expiry is unverifiable");
  return expiry;
}

/**
 * Returns the first instant at which any signed source or presented evidence
 * claim ceases to be current. Parsed projections have already validated every
 * timestamp and freshness lifetime before reaching this boundary.
 */
export function cosDeliveryRoomExpiresAt(room: CosDeliveryRoom): number {
  const sourceLifetimeMs = deliveryRoomSourceLifetimeMs(
    room.source.maxAgeSeconds,
  );
  if (sourceLifetimeMs === undefined)
    throw new Error("Delivery Room source expiry is unverifiable");
  const deadlines = [
    expiresAt(room.generatedAt, sourceLifetimeMs),
    expiresAt(room.source.reconciliation.observedAt, sourceLifetimeMs),
    expiresAt(room.source.agentHealth.observedAt, sourceLifetimeMs),
  ];
  const addEvidence = (evidence: DeliveryRoomEvidence) => {
    // Invalid evidence is deliberately retained for honest unavailable/unknown
    // claims, but it has no verifiable timestamp and therefore cannot define a
    // semantic expiry deadline. The parser has already checked that the
    // declared freshness agrees with the missing or malformed timestamp.
    if (evidence.freshness === "invalid") return;
    deadlines.push(expiresAt(evidence.observedAt, evidence.freshForMs));
  };

  for (const item of room.deliveryRoom.workItems) {
    for (const evidence of item.evidence) addEvidence(evidence);
    for (const gate of item.objectiveGates) {
      if (gate.evidence) addEvidence(gate.evidence);
    }
  }

  for (const team of room.deliveryRoom.teams) {
    for (const participant of team.participants) {
      for (const evidence of participant.evidence) addEvidence(evidence);
    }
    for (const contribution of [...team.contributions, ...team.dissent]) {
      for (const evidence of contribution.evidence) addEvidence(evidence);
    }
    if (team.synthesis) {
      for (const evidence of team.synthesis.evidence) addEvidence(evidence);
    }
    if (team.signOff.status === "signed_off") {
      addEvidence(team.signOff.evidence);
    }
  }

  return Math.min(...deadlines);
}
