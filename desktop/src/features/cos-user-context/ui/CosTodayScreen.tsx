import {
  Bot,
  CheckCircle2,
  Inbox,
  ListChecks,
  ListTodo,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  cosFollowUpCommunityScope,
  useCosFollowUpQuery,
} from "@/features/cos-follow-up/hooks";
import { useCosUserContextQuery } from "@/features/cos-user-context/hooks";
import {
  currentCosUserContext,
  hasCosWorkspaceModule,
} from "@/features/cos-user-context/lib/cosUserContext";
import { useIdentityQuery } from "@/shared/api/hooks";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

function TodayCard({
  children,
  description,
  icon,
  onClick,
  testId,
  title,
}: {
  children?: React.ReactNode;
  description: string;
  icon: React.ReactNode;
  onClick?: () => void;
  testId: string;
  title: string;
}) {
  return (
    <article
      className="rounded-xl border border-border/60 bg-card/70 p-5 shadow-xs"
      data-testid={testId}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
          {children}
          {onClick ? (
            <Button className="mt-4" onClick={onClick} size="sm">
              Open
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function CosTodayScreen() {
  const identity = useIdentityQuery();
  const { activeCommunity } = useCommunities();
  const navigation = useAppNavigation();
  const pubkey = identity.data?.pubkey ?? "";
  const communityScope = cosFollowUpCommunityScope(activeCommunity);
  const contextQuery = useCosUserContextQuery(pubkey, communityScope);
  const context = currentCosUserContext(contextQuery);
  const canUseMyActions = hasCosWorkspaceModule(context, "my_actions");
  const actionsQuery = useCosFollowUpQuery(
    canUseMyActions ? pubkey : undefined,
    communityScope,
  );
  const openActions = (actionsQuery.data ?? []).filter(
    (item) => item.state !== "confirmed",
  );
  const needsAnswer = openActions.filter(
    (item) => item.state === "needs-answer",
  ).length;
  const needsCheck = openActions.filter(
    (item) => item.state === "ready-to-check",
  ).length;

  const refresh = () => {
    void contextQuery.refetch();
    if (canUseMyActions) void actionsQuery.refetch();
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border/60 bg-background/95 px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">
                {context
                  ? `Today, ${context.user.name.split(" ")[0]}`
                  : "Today"}
              </h1>
              {context ? (
                <Badge variant="info">{context.user.roleLabel}</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Your MAC work, questions and confirmations in one place.
            </p>
          </div>
          <Button
            disabled={contextQuery.isFetching || actionsQuery.isFetching}
            onClick={refresh}
            size="sm"
            variant="outline"
          >
            <RefreshCw
              className={cn(
                (contextQuery.isFetching || actionsQuery.isFetching) &&
                  "animate-spin",
              )}
            />
            Refresh
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {contextQuery.isPending ? (
            <div className="rounded-xl border border-border/60 bg-card/70 p-8 text-center text-sm text-muted-foreground">
              Loading your MAC Workspace…
            </div>
          ) : null}

          {!contextQuery.isPending && !context ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-600" />
                <div>
                  <h2 className="text-sm font-semibold">
                    Your Workspace setup is syncing
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Existing messages remain available. Role-specific tools
                    appear only after Contractor OS confirms your identity.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            {canUseMyActions ? (
              <TodayCard
                description={
                  openActions.length === 0
                    ? "Nothing needs you right now."
                    : `${openActions.length} open: ${needsAnswer} question${needsAnswer === 1 ? "" : "s"} and ${needsCheck} confirmation${needsCheck === 1 ? "" : "s"}.`
                }
                icon={
                  openActions.length === 0 ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <ListTodo className="h-5 w-5" />
                  )
                }
                onClick={() => void navigation.goMyActions()}
                testId="today-my-actions"
                title="My Actions"
              />
            ) : null}

            <TodayCard
              description="Your private messages and conversations with the MAC team."
              icon={<Inbox className="h-5 w-5" />}
              onClick={() => void navigation.goHome()}
              testId="today-messages"
              title="Messages"
            />

            {hasCosWorkspaceModule(context, "assistant") &&
            context?.assistant ? (
              <TodayCard
                description="Ask for help in your private Workspace channel. The assistant runs centrally on brain-vps and cannot see another employee's conversation."
                icon={<Bot className="h-5 w-5" />}
                onClick={() => void navigation.goChannel(context.channelId)}
                testId="today-assistant"
                title={context.assistant.label}
              >
                <Badge className="mt-3" variant="outline">
                  Centrally provided
                </Badge>
              </TodayCard>
            ) : null}

            {hasCosWorkspaceModule(context, "running_order") ? (
              <TodayCard
                description="Current Contractor OS delivery state, evidence and blockers."
                icon={<ListChecks className="h-5 w-5" />}
                onClick={() => void navigation.goRunningOrder()}
                testId="today-running-order"
                title="COS Running Order"
              />
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
