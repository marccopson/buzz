import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  GitPullRequest,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import {
  type CosRunningOrderFilter,
  type CosRunningOrderItem,
  loadCosRunningOrder,
  selectCosRunningOrderItems,
} from "@/features/cos-running-order/lib/cosRunningOrder";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

const JIRA_BASE_URL = "https://macsurfacing.atlassian.net/browse";

const STATE_PRESENTATION = {
  blocked: { label: "Blocked", variant: "destructive" },
  "human-test": { label: "Human test", variant: "warning" },
  running: { label: "Agent running", variant: "info" },
  active: { label: "Jira active", variant: "secondary" },
  ready: { label: "Ready", variant: "success" },
  queued: { label: "Queued", variant: "secondary" },
  completed: { label: "Completed", variant: "success" },
} as const;

const FILTERS: Array<{ value: CosRunningOrderFilter; label: string }> = [
  { value: "focus", label: "Focus" },
  { value: "blocked", label: "Blocked" },
  { value: "running", label: "Agent running" },
  { value: "active", label: "Jira active" },
  { value: "ready", label: "Ready" },
  { value: "human-test", label: "Human test" },
  { value: "queued", label: "Queue" },
  { value: "all", label: "All" },
];

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={cn("rounded-lg p-1.5", tone)}>{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function RunningOrderCard({ item }: { item: CosRunningOrderItem }) {
  const presentation = STATE_PRESENTATION[item.state];
  return (
    <article
      className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-xs"
      data-testid={`running-order-item-${item.key}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="font-mono text-sm font-semibold text-primary hover:underline"
              onClick={() => void openUrl(`${JIRA_BASE_URL}/${item.key}`)}
              type="button"
            >
              {item.key}
            </button>
            <Badge variant={presentation.variant}>{presentation.label}</Badge>
            {item.stagingEvidenced ? (
              <Badge variant="success">On staging</Badge>
            ) : null}
          </div>
          <h2 className="mt-2 text-base font-semibold leading-snug">
            {item.summary}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.jiraStatus || "Unknown Jira state"}
            {item.priority ? ` · ${item.priority}` : ""}
          </p>
        </div>
      </div>

      {item.activeRun ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
          <span className="flex items-center gap-1.5 font-medium">
            <CircleDot className="h-3.5 w-3.5" />
            {item.activeRun.state || "Active run"}
          </span>
          {item.activeRun.branch ? (
            <span className="font-mono">{item.activeRun.branch}</span>
          ) : null}
          {item.activeRun.id ? <span>{item.activeRun.id}</span> : null}
        </div>
      ) : null}

      {item.blockers.length > 0 ? (
        <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
          {item.blockers.map((blocker) => (
            <p
              className="flex items-start gap-2 text-xs text-destructive"
              key={blocker}
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {blocker}
            </p>
          ))}
        </div>
      ) : null}

      {item.pullRequests.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <GitPullRequest className="h-3.5 w-3.5" />
          {item.pullRequests.map((pullRequest) => (
            <span key={pullRequest.number}>
              PR #{pullRequest.number} ·{" "}
              {pullRequest.draft ? "Draft" : pullRequest.state || "Unknown"}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function CosRunningOrderScreen() {
  const { activeCommunity } = useCommunities();
  const [filter, setFilter] = React.useState<CosRunningOrderFilter>("focus");
  const runningOrderQuery = useQuery({
    queryKey: ["cos-running-order", activeCommunity?.relayUrl],
    queryFn: ({ signal }) =>
      loadCosRunningOrder({
        relayUrl: activeCommunity?.relayUrl ?? "",
        signal,
      }),
    enabled: Boolean(activeCommunity?.relayUrl),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const runningOrder = runningOrderQuery.data;
  const visibleItems = React.useMemo(
    () =>
      runningOrder
        ? selectCosRunningOrderItems(runningOrder.items, filter)
        : [],
    [filter, runningOrder],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border/60 bg-background/95 px-6 py-5">
        <div className="mx-auto flex max-w-6xl items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold">COS Running Order</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Evidence-backed delivery state from Contractor OS.
            </p>
          </div>
          <Button
            disabled={runningOrderQuery.isFetching}
            onClick={() => void runningOrderQuery.refetch()}
            size="sm"
            variant="outline"
          >
            <RefreshCw
              className={cn(runningOrderQuery.isFetching && "animate-spin")}
            />
            Refresh
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-6xl">
          {runningOrderQuery.isPending ? (
            <div className="rounded-xl border border-border/60 bg-card/70 p-8 text-center text-sm text-muted-foreground">
              Loading the COS running order…
            </div>
          ) : null}

          {runningOrderQuery.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
                <div>
                  <h2 className="text-sm font-semibold">
                    Running order unavailable
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {runningOrderQuery.error instanceof Error
                      ? runningOrderQuery.error.message
                      : "MAC Workspace could not read the Forge adapter."}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {runningOrder ? (
            <>
              <section className="mb-5 grid gap-3 lg:grid-cols-[1fr_auto]">
                <div
                  className={cn(
                    "rounded-xl border p-4",
                    runningOrder.operationalStatus === "ok"
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-destructive/30 bg-destructive/5",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-sm font-semibold">
                      Collector{" "}
                      {runningOrder.operationalStatus === "ok"
                        ? "healthy"
                        : "needs attention"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Delivery state: {runningOrder.overallStatus || "unknown"} ·
                    Updated {formatTimestamp(runningOrder.generatedAtUtc)}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-card/70 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    Staging revision
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold">
                    {runningOrder.stagingRevision?.slice(0, 12) ?? "Unknown"}
                  </p>
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <StatCard
                  icon={<AlertTriangle className="h-4 w-4" />}
                  label="Blocked"
                  tone="bg-destructive/10 text-destructive"
                  value={runningOrder.counts.blocked}
                />
                <StatCard
                  icon={<CircleDot className="h-4 w-4" />}
                  label="Agent running"
                  tone="bg-blue-500/10 text-blue-600 dark:text-blue-400"
                  value={runningOrder.counts.running}
                />
                <StatCard
                  icon={<ListChecks className="h-4 w-4" />}
                  label="Jira active"
                  tone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
                  value={runningOrder.counts.active}
                />
                <StatCard
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label="Ready"
                  tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  value={runningOrder.counts.ready}
                />
                <StatCard
                  icon={<UserRoundCheck className="h-4 w-4" />}
                  label="Human test"
                  tone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  value={runningOrder.counts.humanTest}
                />
                <StatCard
                  icon={<Clock3 className="h-4 w-4" />}
                  label="Queued"
                  tone="bg-muted text-muted-foreground"
                  value={runningOrder.counts.queued}
                />
              </section>

              <section className="mt-6">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {FILTERS.map((option) => (
                    <Button
                      key={option.value}
                      onClick={() => setFilter(option.value)}
                      size="xs"
                      variant={filter === option.value ? "default" : "outline"}
                    >
                      {option.label}
                    </Button>
                  ))}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {visibleItems.length} shown
                  </span>
                </div>

                {visibleItems.length > 0 ? (
                  <div className="space-y-3">
                    {visibleItems.map((item) => (
                      <RunningOrderCard item={item} key={item.key} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center">
                    <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" />
                    <h2 className="mt-3 text-sm font-semibold">
                      Nothing in this view
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Try the queue or all items to see the wider COS backlog.
                    </p>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
