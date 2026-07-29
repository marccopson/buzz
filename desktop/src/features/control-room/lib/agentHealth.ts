export type HealthStatus = "green" | "amber" | "red";
export type AssuranceStatus = "complete" | "partial" | "insufficient";
export type DimensionState = "pass" | "warn" | "fail" | "unknown";
export type SourceStatus = "fresh" | "stale" | "invalid";

export type HealthDimension = {
  state: DimensionState;
  evidence: string[];
};

export type AgentHealthRecord = {
  id: string;
  name: string;
  operationalStatus: HealthStatus;
  assuranceStatus: AssuranceStatus;
  dimensions: Record<string, HealthDimension>;
};

export type HealthRecord = {
  id: string;
  name: string;
  status: HealthStatus;
  detail: string;
};

export type AgentHealthSnapshot = {
  schemaVersion: "mac-agent-health/v1";
  generatedAt: string;
  authority: {
    id: "brain-vps-health-check";
    role: "authoritative-estate-observer";
  };
  operationalStatus: HealthStatus;
  assuranceStatus: AssuranceStatus;
  assuranceGaps: string[];
  source: {
    status: SourceStatus;
    maxAgeSeconds?: number;
    estate?: SourceEvidence;
    agents?: SourceEvidence;
  };
  nodes: HealthRecord[];
  agents: AgentHealthRecord[];
  components: HealthRecord[];
  issues: string[];
};

export type SourceEvidence = {
  path: string;
  observedAt: string;
  ageSeconds: number;
  sha256: string;
};

export type AgentHealthPresentation = {
  current: boolean;
  status: HealthStatus;
  label: string;
  notice?: string;
};

const DIMENSION_NAMES = [
  "alive",
  "connected",
  "authenticated",
  "capable",
  "working",
  "fresh",
  "safe",
  "recoverable",
] as const;
const STATUS = new Set<HealthStatus>(["green", "amber", "red"]);
const ASSURANCE = new Set<AssuranceStatus>([
  "complete",
  "partial",
  "insufficient",
]);
const DIMENSION_STATE = new Set<DimensionState>([
  "pass",
  "warn",
  "fail",
  "unknown",
]);
const SHA256 = /^[0-9a-f]{64}$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = string(value, label);
  if (Number.isNaN(Date.parse(result))) {
    throw new Error(`${label} must be a timestamp`);
  }
  return result;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return value as number;
}

function strings(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function status(value: unknown): HealthStatus {
  if (!STATUS.has(value as HealthStatus)) {
    throw new Error("Unsupported health status");
  }
  return value as HealthStatus;
}

function assurance(value: unknown): AssuranceStatus {
  if (!ASSURANCE.has(value as AssuranceStatus)) {
    throw new Error("Unsupported assurance status");
  }
  return value as AssuranceStatus;
}

function records(value: unknown, label: string): HealthRecord[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item) => {
    const raw = object(item, label);
    return {
      id: string(raw.id, `${label}.id`),
      name: string(raw.name, `${label}.name`),
      status: status(raw.status),
      detail: string(raw.detail, `${label}.detail`),
    };
  });
}

function agents(value: unknown): AgentHealthRecord[] {
  if (!Array.isArray(value)) throw new Error("agents must be an array");
  return value.map((item) => {
    const raw = object(item, "agent");
    const rawDimensions = object(raw.dimensions, "agent.dimensions");
    if (
      Object.keys(rawDimensions).length !== DIMENSION_NAMES.length ||
      !DIMENSION_NAMES.every((name) => name in rawDimensions)
    ) {
      throw new Error("agent.dimensions must contain all health dimensions");
    }
    const dimensions = Object.fromEntries(
      Object.entries(rawDimensions).map(([name, value]) => {
        const dimension = object(value, `agent.dimensions.${name}`);
        if (!DIMENSION_STATE.has(dimension.state as DimensionState)) {
          throw new Error("Unsupported health dimension state");
        }
        return [
          name,
          {
            state: dimension.state as DimensionState,
            evidence: strings(
              dimension.evidence,
              `agent.dimensions.${name}.evidence`,
            ),
          },
        ];
      }),
    );
    return {
      id: string(raw.id, "agent.id"),
      name: string(raw.name, "agent.name"),
      operationalStatus: status(raw.operationalStatus),
      assuranceStatus: assurance(raw.assuranceStatus),
      dimensions,
    };
  });
}

function sourceEvidence(value: unknown, label: string): SourceEvidence {
  const evidence = object(value, label);
  const digest = string(evidence.sha256, `${label}.sha256`);
  if (!SHA256.test(digest)) {
    throw new Error(`${label}.sha256 must be a SHA-256 digest`);
  }
  return {
    path: string(evidence.path, `${label}.path`),
    observedAt: timestamp(evidence.observedAt, `${label}.observedAt`),
    ageSeconds: integer(evidence.ageSeconds, `${label}.ageSeconds`),
    sha256: digest,
  };
}

export function parseAgentHealthSnapshot(value: unknown): AgentHealthSnapshot {
  const raw = object(value, "agent health");
  if (raw.schemaVersion !== "mac-agent-health/v1") {
    throw new Error("Unsupported MAC agent-health snapshot");
  }
  const source = object(raw.source, "source");
  const sourceStatus = string(source.status, "source.status");
  if (!["fresh", "stale", "invalid"].includes(sourceStatus)) {
    throw new Error("Unsupported source status");
  }
  const authority = object(raw.authority, "authority");
  if (
    authority.id !== "brain-vps-health-check" ||
    authority.role !== "authoritative-estate-observer"
  ) {
    throw new Error("Unsupported agent-health authority");
  }
  const maxAgeSeconds =
    source.maxAgeSeconds === undefined
      ? undefined
      : integer(source.maxAgeSeconds, "source.maxAgeSeconds");
  if (maxAgeSeconds !== undefined && maxAgeSeconds < 60) {
    throw new Error("source.maxAgeSeconds must be at least 60");
  }
  const estate =
    source.estate === undefined
      ? undefined
      : sourceEvidence(source.estate, "source.estate");
  const agentEvidence =
    source.agents === undefined
      ? undefined
      : sourceEvidence(source.agents, "source.agents");
  if (
    sourceStatus !== "invalid" &&
    (!maxAgeSeconds || !estate || !agentEvidence)
  ) {
    throw new Error("Fresh or stale source evidence is incomplete");
  }
  return {
    schemaVersion: "mac-agent-health/v1",
    generatedAt: timestamp(raw.generatedAt, "generatedAt"),
    authority: {
      id: "brain-vps-health-check",
      role: "authoritative-estate-observer",
    },
    operationalStatus: status(raw.operationalStatus),
    assuranceStatus: assurance(raw.assuranceStatus),
    assuranceGaps: strings(raw.assuranceGaps, "assuranceGaps"),
    source: {
      status: sourceStatus as SourceStatus,
      maxAgeSeconds,
      estate,
      agents: agentEvidence,
    },
    nodes: records(raw.nodes, "nodes"),
    agents: agents(raw.agents),
    components: records(raw.components, "components"),
    issues: strings(raw.issues, "issues"),
  };
}

export function presentAgentHealth(
  snapshot: AgentHealthSnapshot,
  { refreshFailed = false }: { refreshFailed?: boolean } = {},
): AgentHealthPresentation {
  if (refreshFailed) {
    return {
      current: false,
      status: "red",
      label: "Last known — refresh failed",
      notice:
        "The latest refresh failed. Values below are last-known evidence and are not current health.",
    };
  }
  if (snapshot.source.status === "stale") {
    return {
      current: false,
      status: "red",
      label: "Evidence stale",
      notice:
        "The authoritative evidence is stale. Values below are last-known and must not be treated as current health.",
    };
  }
  if (snapshot.source.status === "invalid") {
    return {
      current: false,
      status: "red",
      label: "Evidence invalid",
      notice:
        "The authoritative evidence is invalid. Values below are diagnostic only and must not be treated as current health.",
    };
  }
  return {
    current: true,
    status: snapshot.operationalStatus,
    label:
      snapshot.operationalStatus === "green"
        ? "Healthy"
        : snapshot.operationalStatus === "amber"
          ? "Attention"
          : "Unavailable",
  };
}

export function agentHealthEndpoint(relayUrl: string): URL {
  const endpoint = new URL(relayUrl);
  if (endpoint.protocol === "wss:") endpoint.protocol = "https:";
  else if (endpoint.protocol === "ws:") endpoint.protocol = "http:";
  else if (!["https:", "http:"].includes(endpoint.protocol)) {
    throw new Error("Unsupported relay protocol");
  }
  endpoint.pathname = "/api/mac-agent-health/v1";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

export async function loadAgentHealth({
  relayUrl,
  signal,
}: {
  relayUrl: string;
  signal?: AbortSignal;
}): Promise<AgentHealthSnapshot> {
  const response = await fetch(agentHealthEndpoint(relayUrl), {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Agent health is unavailable (${response.status})`);
  }
  return parseAgentHealthSnapshot(await response.json());
}
