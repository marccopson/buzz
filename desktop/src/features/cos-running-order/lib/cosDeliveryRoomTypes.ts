export const COS_DELIVERY_ROOM_SCHEMA = "mac-workspace/delivery-room/v1";
export const DELIVERY_ROOM_PROJECTION_SCHEMA = "delivery-room-projection/v1";
export const DELIVERY_ROOM_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type DeliveryRoomStage =
  | "ready"
  | "building"
  | "independent_review"
  | "staging_verification"
  | "complete";
export type DeliveryRoomParticipantState =
  | "working"
  | "reviewing"
  | "waiting"
  | "available"
  | "needs_you"
  | "stalled"
  | "unavailable";
export type DeliveryRoomEvidenceFreshness = "current" | "stale" | "invalid";
export type DeliveryRoomWorkHealth =
  | "on_track"
  | "needs_manager"
  | "stalled"
  | "unavailable";
export type DeliveryRoomGateStatus =
  | "pending"
  | "passed"
  | "failed"
  | "blocked";
export type DeliveryRoomEvidenceKind =
  | "task"
  | "status"
  | "run"
  | "review"
  | "verification"
  | "external"
  | "human"
  | "unknown";

export type DeliveryRoomEvidence = {
  id: string;
  source: {
    kind: DeliveryRoomEvidenceKind;
    label: string;
    actorId?: string;
    reference?: string;
    href?: string;
  };
  detail: string;
  gateOutcome?: "passed" | "failed" | "blocked" | "unknown";
  observedAt: string;
  freshness: DeliveryRoomEvidenceFreshness;
  freshForMs: number;
};

export type DeliveryRoomGate = {
  id: string;
  label: string;
  status: DeliveryRoomGateStatus;
  requiredEvidenceKind?: "review" | "verification";
  evidence?: DeliveryRoomEvidence;
};

export type DeliveryRoomWorkItem = {
  id: string;
  title: string;
  whyItMatters: string;
  currentActivity: string;
  nextAction: string;
  owner: {
    id: string;
    label: string;
    teamId?: string;
    teamLabel?: string;
  };
  externalReference?: {
    key: string;
    label?: string;
    href?: string;
  };
  stage: DeliveryRoomStage;
  health: DeliveryRoomWorkHealth;
  objectiveGates: DeliveryRoomGate[];
  evidence: DeliveryRoomEvidence[];
};

export type DeliveryRoomContribution = {
  id: string;
  participantId: string;
  summary: string;
  evidence: DeliveryRoomEvidence[];
};

export type DeliveryRoomTeam = {
  id: string;
  name: string;
  templateId?: DeliveryRoomTemplateId;
  chairOrLead?: { participantId: string; role: string };
  invitedParticipantIds: string[];
  actualParticipantIds: string[];
  contributingParticipantIds: string[];
  participants: Array<{
    id: string;
    name: string;
    role: string;
    state: DeliveryRoomParticipantState;
    evidence: DeliveryRoomEvidence[];
  }>;
  contributions: DeliveryRoomContribution[];
  dissent: DeliveryRoomContribution[];
  synthesis?: Omit<DeliveryRoomContribution, "id">;
  signOff:
    | {
        status: "signed_off";
        participantId: string;
        summary?: string;
        evidence: DeliveryRoomEvidence;
      }
    | { status: "not_signed_off"; reason: string };
  absentOrUnavailable: Array<{
    participantId: string;
    reason: string;
    state: "unavailable";
  }>;
};

export type DeliveryRoomTemplateId =
  | "senior-development-team"
  | "planning-council"
  | "board-of-advisors";

export type DeliveryRoomTeamTemplate = {
  id: DeliveryRoomTemplateId;
  name: string;
  decisionAuthority: "human";
  roles: Array<{
    key: string;
    label: string;
    purpose: string;
    required: boolean;
    independent?: boolean;
  }>;
};

export type SourceEvidence = {
  observedAt: string;
  freshness: "current";
  sha256: string;
};

export type AttentionView = {
  kind: "needs_manager" | "blocked_or_stalled";
  label: string;
  workItemIds: string[];
};

export type CosDeliveryRoom = {
  schemaVersion: typeof COS_DELIVERY_ROOM_SCHEMA;
  generatedAt: string;
  generationId: string;
  readOnly: true;
  source: {
    status: "fresh";
    maxAgeSeconds: number;
    issues: string[];
    reconciliation: SourceEvidence;
    agentHealth: SourceEvidence;
  };
  deliveryRoom: {
    schemaVersion: typeof DELIVERY_ROOM_PROJECTION_SCHEMA;
    generatedAt: string;
    sourceGeneratedAt?: string;
    attention: {
      needsManager: AttentionView;
      blockedOrStalled: AttentionView;
    };
    stages: Array<{
      stage: DeliveryRoomStage;
      label: string;
      workItemIds: string[];
    }>;
    workItems: DeliveryRoomWorkItem[];
    teams: DeliveryRoomTeam[];
    teamTemplates: DeliveryRoomTeamTemplate[];
  };
};
