export type CosRunningOrderState =
  | "blocked"
  | "human-test"
  | "running"
  | "ready"
  | "queued"
  | "completed";

export type CosRunningOrderFilter = "focus" | CosRunningOrderState | "all";

export type CosRunningOrderItem = {
  key: string;
  summary: string;
  jiraStatus: string;
  priority: string;
  state: CosRunningOrderState;
  blockers: string[];
  admissionSignals: string[];
  pullRequests: Array<{
    number: number;
    state: string;
    draft: boolean;
  }>;
  activeRun: {
    id: string;
    state: string;
    branch: string | null;
    pullRequestNumber: number | null;
    updatedAtUtc: string | null;
  } | null;
  stagingEvidenced: boolean;
};

export type CosRunningOrder = {
  schema: "mac-workspace/cos-running-order/v1";
  generatedAtUtc: string;
  generationId: string;
  operationalStatus: string;
  overallStatus: string;
  stagingRevision: string | null;
  sourceErrors: string[];
  counts: {
    blocked: number;
    completed: number;
    humanTest: number;
    queued: number;
    ready: number;
    running: number;
  };
  items: CosRunningOrderItem[];
};

type RawRecord = Record<string, unknown>;

const VALID_STATES = new Set<CosRunningOrderState>([
  "blocked",
  "human-test",
  "running",
  "ready",
  "queued",
  "completed",
]);

function record(value: unknown): RawRecord {
  return value !== null && typeof value === "object"
    ? (value as RawRecord)
    : {};
}

function records(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function state(value: unknown): CosRunningOrderState {
  if (
    typeof value === "string" &&
    VALID_STATES.has(value as CosRunningOrderState)
  ) {
    return value as CosRunningOrderState;
  }
  throw new Error("The COS running order contains an unsupported item state");
}

function projectItem(raw: RawRecord): CosRunningOrderItem {
  const activeRun = raw.active_run ? record(raw.active_run) : null;
  return {
    key: text(raw.key),
    summary: text(raw.summary),
    jiraStatus: text(raw.jira_status),
    priority: text(raw.priority),
    state: state(raw.state),
    blockers: strings(raw.blockers),
    admissionSignals: strings(raw.admission_signals),
    pullRequests: records(raw.pull_requests)
      .map((pullRequest) => ({
        number: numberOrZero(pullRequest.number),
        state: text(pullRequest.state),
        draft: pullRequest.draft === true,
      }))
      .filter((pullRequest) => pullRequest.number > 0),
    activeRun: activeRun
      ? {
          id: text(activeRun.id),
          state: text(activeRun.state),
          branch: text(activeRun.branch) || null,
          pullRequestNumber:
            numberOrZero(activeRun.pull_request_number) || null,
          updatedAtUtc: text(activeRun.updated_at_utc) || null,
        }
      : null,
    stagingEvidenced: raw.staging_evidenced === true,
  };
}

export function cosRunningOrderEndpoint(relayUrl: string): string {
  const endpoint = new URL(relayUrl);
  if (endpoint.protocol === "wss:") endpoint.protocol = "https:";
  else if (endpoint.protocol === "ws:") endpoint.protocol = "http:";
  else throw new Error("The active community relay URL is invalid");
  endpoint.pathname = "/api/cos-running-order/v1";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString();
}

export async function loadCosRunningOrder({
  relayUrl,
  signal,
  fetcher = fetch,
}: {
  relayUrl: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<CosRunningOrder> {
  const response = await fetcher(cosRunningOrderEndpoint(relayUrl), {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `COS running order is unavailable (${response.status || "network error"})`,
    );
  }
  return projectCosRunningOrder(await response.json());
}

export function selectCosRunningOrderItems(
  items: CosRunningOrderItem[],
  filter: CosRunningOrderFilter,
): CosRunningOrderItem[] {
  if (filter === "all") return items;
  if (filter === "focus") {
    return items.filter(
      (item) => item.state !== "queued" && item.state !== "completed",
    );
  }
  return items.filter((item) => item.state === filter);
}

export function projectCosRunningOrder(input: unknown): CosRunningOrder {
  const raw = record(input);
  if (raw.schema !== "mac-workspace/cos-running-order/v1") {
    throw new Error("Unsupported MAC Workspace running-order snapshot");
  }
  const rawCounts = record(raw.counts);
  return {
    schema: "mac-workspace/cos-running-order/v1",
    generatedAtUtc: text(raw.generated_at_utc),
    generationId: text(raw.generation_id),
    operationalStatus: text(raw.operational_status),
    overallStatus: text(raw.overall_status),
    stagingRevision: text(raw.staging_revision) || null,
    sourceErrors: strings(raw.source_errors),
    counts: {
      blocked: numberOrZero(rawCounts.blocked),
      completed: numberOrZero(rawCounts.completed),
      humanTest: numberOrZero(rawCounts.human_test),
      queued: numberOrZero(rawCounts.queued),
      ready: numberOrZero(rawCounts.ready),
      running: numberOrZero(rawCounts.running),
    },
    items: records(raw.items)
      .map(projectItem)
      .filter((item) => item.key.length > 0),
  };
}
