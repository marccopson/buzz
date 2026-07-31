import type {
  DeliveryRoomParticipantState,
  DeliveryRoomWorkHealth,
} from "./cosDeliveryRoomTypes.ts";

export const PARTICIPANT_PRESENTATION: Record<
  DeliveryRoomParticipantState,
  { label: string; className: string }
> = {
  working: {
    label: "Working",
    className:
      "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  reviewing: {
    label: "Reviewing",
    className:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  waiting: {
    label: "Waiting",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  available: {
    label: "Available",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  needs_you: {
    label: "Needs you",
    className:
      "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  stalled: {
    label: "Stalled",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  unavailable: {
    label: "Unavailable",
    className: "border-border bg-muted text-muted-foreground",
  },
};

export const HEALTH_PRESENTATION: Record<
  DeliveryRoomWorkHealth,
  { label: string; className: string }
> = {
  on_track: {
    label: "On track",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  needs_manager: {
    label: "Needs Marc",
    className:
      "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  stalled: {
    label: "Stalled",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  unavailable: {
    label: "Evidence unavailable",
    className: "border-border bg-muted text-muted-foreground",
  },
};
