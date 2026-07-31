import type {
  DeliveryRoomEvidence,
  DeliveryRoomWorkItem,
} from "./cosDeliveryRoomTypes.ts";

export function formatDeliveryRoomTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid time";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function latestCurrentEvidence(
  item: DeliveryRoomWorkItem,
): DeliveryRoomEvidence | undefined {
  return item.evidence
    .filter((evidence) => evidence.freshness === "current")
    .sort(
      (left, right) =>
        new Date(right.observedAt).getTime() -
        new Date(left.observedAt).getTime(),
    )[0];
}
