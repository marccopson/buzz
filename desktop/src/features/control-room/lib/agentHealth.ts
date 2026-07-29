export type HealthStatus = "green" | "amber" | "red";
export type AssuranceStatus = "complete" | "partial" | "insufficient";
export type DimensionState = "pass" | "fail" | "unknown";

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
  operationalStatus: HealthStatus;
  assuranceStatus: AssuranceStatus;
  assuranceGaps: string[];
  source: {
    status: "fresh" | "stale" | "invalid";
    estate?: { observedAt: string; ageSeconds: number };
    agents?: { observedAt: string; ageSeconds: number };
  };
  nodes: HealthRecord[];
  agents: AgentHealthRecord[];
  components: HealthRecord[];
  issues: string[];
};

const STATUS = new Set<HealthStatus>(["green", "amber", "red"]);
const ASSURANCE = new Set<AssuranceStatus>([
  "complete",
  "partial",
  "insufficient",
]);
const DIMENSION_STATE = new Set<DimensionState>(["pass", "fail", "unknown"]);

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
  const parseObservation = (name: "estate" | "agents") => {
    if (!source[name]) return undefined;
    const evidence = object(source[name], `source.${name}`);
    return {
      observedAt: string(evidence.observedAt, `source.${name}.observedAt`),
      ageSeconds:
        typeof evidence.ageSeconds === "number" ? evidence.ageSeconds : 0,
    };
  };
  return {
    schemaVersion: "mac-agent-health/v1",
    generatedAt: string(raw.generatedAt, "generatedAt"),
    operationalStatus: status(raw.operationalStatus),
    assuranceStatus: assurance(raw.assuranceStatus),
    assuranceGaps: strings(raw.assuranceGaps, "assuranceGaps"),
    source: {
      status: sourceStatus as "fresh" | "stale" | "invalid",
      estate: parseObservation("estate"),
      agents: parseObservation("agents"),
    },
    nodes: records(raw.nodes, "nodes"),
    agents: agents(raw.agents),
    components: records(raw.components, "components"),
    issues: strings(raw.issues, "issues"),
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
