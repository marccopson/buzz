import type {
  DeliveryRoomContribution,
  DeliveryRoomEvidence,
  DeliveryRoomTeam,
  DeliveryRoomWorkItem,
} from "./cosDeliveryRoomTypes.ts";

export function teamThreadForWork(
  team: DeliveryRoomTeam | undefined,
  item: DeliveryRoomWorkItem,
): {
  contributions: DeliveryRoomContribution[];
  dissent: DeliveryRoomContribution[];
  synthesis?: DeliveryRoomTeam["synthesis"];
  signOff?: Extract<DeliveryRoomTeam["signOff"], { status: "signed_off" }>;
} {
  if (!team) return { contributions: [], dissent: [] };
  const references = new Set(
    [item.id, item.externalReference?.key].filter(Boolean),
  );
  const matches = (evidence: DeliveryRoomEvidence[]) =>
    evidence.some(
      (entry) =>
        entry.freshness === "current" &&
        Boolean(entry.source.reference) &&
        references.has(entry.source.reference),
    );
  return {
    contributions: team.contributions.filter((entry) =>
      matches(entry.evidence),
    ),
    dissent: team.dissent.filter((entry) => matches(entry.evidence)),
    synthesis:
      team.synthesis && matches(team.synthesis.evidence)
        ? team.synthesis
        : undefined,
    signOff:
      team.signOff.status === "signed_off" && matches([team.signOff.evidence])
        ? team.signOff
        : undefined,
  };
}
