import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  ListChecks,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";

import { useCommunities } from "@/features/communities/useCommunities";
import {
  type AgentHealthRecord,
  type HealthStatus,
  loadAgentHealth,
} from "@/features/control-room/lib/agentHealth";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

const STATUS_LABEL: Record<HealthStatus, string> = {
  green: "Healthy",
  amber: "Attention",
  red: "Unavailable",
};

const STATUS_CLASS: Record<HealthStatus, string> = {
  green: "border-emerald-500/25 bg-emerald-500/5",
  amber: "border-amber-500/25 bg-amber-500/5",
  red: "border-destructive/30 bg-destructive/5",
};

function formatTimestamp(value?: string): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function StatusIcon({ status }: { status: HealthStatus }) {
  if (status === "green") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  }
  if (status === "amber") {
    return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  }
  return <AlertTriangle className="h-4 w-4 text-destructive" />;
}

function AgentCard({ agent }: { agent: AgentHealthRecord }) {
  return (
    <article
      className={cn(
        "rounded-xl border p-4 shadow-xs",
        STATUS_CLASS[agent.operationalStatus],
      )}
      data-testid={`control-room-agent-${agent.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{agent.name}</h2>
          <p className="text-xs text-muted-foreground">
            Operational {STATUS_LABEL[agent.operationalStatus]} · Assurance{" "}
            {agent.assuranceStatus}
          </p>
        </div>
        <StatusIcon status={agent.operationalStatus} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {Object.entries(agent.dimensions).map(([name, dimension]) => (
          <div
            className="rounded-lg border border-border/50 bg-background/60 px-2.5 py-2"
            key={name}
            title={dimension.evidence.join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs capitalize">{name}</span>
              {dimension.state === "pass" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : dimension.state === "fail" ? (
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              ) : (
                <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

export function ControlRoomScreen() {
  const { activeCommunity } = useCommunities();
  const healthQuery = useQuery({
    queryKey: ["mac-agent-health", activeCommunity?.relayUrl],
    queryFn: ({ signal }) =>
      loadAgentHealth({
        relayUrl: activeCommunity?.relayUrl ?? "",
        signal,
      }),
    enabled: Boolean(activeCommunity?.relayUrl),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const health = healthQuery.data;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border/60 bg-background/95 px-6 py-5">
        <div className="mx-auto flex max-w-6xl items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold">Control Room</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Trustworthy estate and agent health, with gaps shown honestly.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/running-order">
                <ListChecks />
                Delivery
              </Link>
            </Button>
            <Button
              disabled={healthQuery.isFetching}
              onClick={() => void healthQuery.refetch()}
              size="sm"
              variant="outline"
            >
              <RefreshCw
                className={cn(healthQuery.isFetching && "animate-spin")}
              />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-5">
          {healthQuery.isPending ? (
            <div className="rounded-xl border border-border/60 bg-card/70 p-8 text-center text-sm text-muted-foreground">
              Loading authoritative agent health…
            </div>
          ) : null}
          {healthQuery.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
              <h2 className="text-sm font-semibold">
                Control Room unavailable
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {healthQuery.error instanceof Error
                  ? healthQuery.error.message
                  : "Workspace could not read the Forge health adapter."}
              </p>
            </div>
          ) : null}
          {health ? (
            <>
              <section className="grid gap-3 md:grid-cols-2">
                <div
                  className={cn(
                    "rounded-xl border p-4",
                    STATUS_CLASS[health.operationalStatus],
                  )}
                  data-testid="control-room-operational"
                >
                  <div className="flex items-center gap-2">
                    <StatusIcon status={health.operationalStatus} />
                    <h2 className="font-semibold">
                      Operational: {STATUS_LABEL[health.operationalStatus]}
                    </h2>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Generated {formatTimestamp(health.generatedAt)} · Estate
                    observed {formatTimestamp(health.source.estate?.observedAt)}
                  </p>
                </div>
                <div
                  className="rounded-xl border border-border/60 bg-card/70 p-4"
                  data-testid="control-room-assurance"
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <h2 className="font-semibold capitalize">
                      Assurance: {health.assuranceStatus}
                    </h2>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {health.assuranceGaps.length > 0
                      ? `Still missing: ${health.assuranceGaps.join("; ")}.`
                      : "All required assurance evidence is present."}
                  </p>
                </div>
              </section>

              {health.issues.length > 0 ? (
                <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                  <h2 className="text-sm font-semibold">Needs attention</h2>
                  {health.issues.map((issue) => (
                    <p
                      className="mt-1 text-sm text-muted-foreground"
                      key={issue}
                    >
                      {issue}
                    </p>
                  ))}
                </section>
              ) : null}

              <section>
                <h2 className="mb-3 text-sm font-semibold">Estate nodes</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {health.nodes.map((node) => (
                    <article
                      className={cn(
                        "rounded-xl border p-4",
                        STATUS_CLASS[node.status],
                      )}
                      key={node.id}
                    >
                      <div className="flex items-center justify-between">
                        <Server className="h-4 w-4 text-muted-foreground" />
                        <Badge variant="secondary">
                          {STATUS_LABEL[node.status]}
                        </Badge>
                      </div>
                      <h3 className="mt-3 font-semibold">{node.name}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {node.detail}
                      </p>
                    </article>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="mb-3 text-sm font-semibold">Brain agents</h2>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {health.agents.map((agent) => (
                    <AgentCard agent={agent} key={agent.id} />
                  ))}
                </div>
              </section>

              <section>
                <h2 className="mb-3 text-sm font-semibold">Core components</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {health.components.map((component) => (
                    <article
                      className={cn(
                        "rounded-xl border p-4",
                        STATUS_CLASS[component.status],
                      )}
                      key={component.id}
                    >
                      <div className="flex items-center gap-2">
                        <StatusIcon status={component.status} />
                        <h3 className="font-semibold">{component.name}</h3>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {component.detail}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
