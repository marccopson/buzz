import type {
  CosDeliveryRoom,
  DeliveryRoomEvidence,
} from "./cosDeliveryRoomTypes.ts";
import { strictDeliveryRoomDate } from "./cosDeliveryRoomTime.ts";

function expiresAt(observedAt: string, lifetimeMs: number): number {
  const observed = strictDeliveryRoomDate(observedAt);
  if (!observed) {
    throw new Error("Delivery Room evidence expiry is unverifiable");
  }
  return observed.getTime() + lifetimeMs;
}

/**
 * Returns the first instant at which any signed source or presented evidence
 * claim ceases to be current. Parsed projections have already validated every
 * timestamp and freshness lifetime before reaching this boundary.
 */
export function cosDeliveryRoomExpiresAt(room: CosDeliveryRoom): number {
  const sourceLifetimeMs = room.source.maxAgeSeconds * 1000;
  const deadlines = [
    expiresAt(room.generatedAt, sourceLifetimeMs),
    expiresAt(room.source.reconciliation.observedAt, sourceLifetimeMs),
    expiresAt(room.source.agentHealth.observedAt, sourceLifetimeMs),
  ];
  const addEvidence = (evidence: DeliveryRoomEvidence) => {
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
