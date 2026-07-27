import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ListTodo,
  RefreshCw,
} from "lucide-react";
import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import {
  CosFollowUpSubmissionError,
  useCosFollowUpQuery,
  useSubmitCosFollowUpAction,
} from "@/features/cos-follow-up/hooks";
import {
  type CosFollowUpHumanAction,
  type CosFollowUpItem,
  isCosFollowUpActionPermitted,
  stateLabel,
} from "@/features/cos-follow-up/lib/cosFollowUp";
import { useIdentityQuery } from "@/shared/api/hooks";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import type { RelayEvent } from "@/shared/api/types";

function FollowUpCard({
  item,
  pubkey,
  relayScope,
}: {
  item: CosFollowUpItem;
  pubkey: string;
  relayScope: string;
}) {
  const submit = useSubmitCosFollowUpAction(pubkey, relayScope);
  const [draftAction, setDraftAction] =
    React.useState<CosFollowUpHumanAction | null>(null);
  const [draft, setDraft] = React.useState("");
  const error = submit.error instanceof Error ? submit.error : null;

  const run = (
    action: CosFollowUpHumanAction,
    text?: string,
    signedEvent?: RelayEvent,
  ) => {
    submit.mutate({
      item,
      action,
      ...(action === "answer" ? { answer: text } : { comment: text }),
      ...(signedEvent ? { signedEvent } : {}),
    });
  };

  return (
    <article
      className="rounded-xl border border-border/60 bg-card/70 p-5 shadow-xs"
      data-testid={`my-actions-item-${item.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                item.state === "confirmed"
                  ? "success"
                  : item.state === "ready-to-check"
                    ? "warning"
                    : "info"
              }
            >
              {stateLabel(item.state)}
            </Badge>
            {item.jiraKey ? (
              <span className="font-mono text-xs text-muted-foreground">
                {item.jiraKey}
              </span>
            ) : null}
          </div>
          <h2 className="mt-2 text-base font-semibold leading-snug">
            {item.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed">{item.question}</p>
        </div>
      </div>

      {item.evidence ? (
        <div className="mt-3 rounded-lg border border-border/50 bg-muted/40 px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">Evidence</p>
          <p className="mt-1 text-sm">{item.evidence}</p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {item.deepLinks.jira ? (
          <Button
            onClick={() => void openUrl(item.deepLinks.jira ?? "")}
            size="xs"
            variant="ghost"
          >
            <ExternalLink />
            Jira
          </Button>
        ) : null}
        <Button
          onClick={() => void openUrl(item.deepLinks.meetingFollowUp)}
          size="xs"
          variant="ghost"
        >
          <ExternalLink />
          Contractor OS
        </Button>
        {item.deepLinks.sources.map((source) => (
          <Button
            key={`${source.label}:${source.url}`}
            onClick={() => void openUrl(source.url)}
            size="xs"
            variant="ghost"
          >
            <ExternalLink />
            {source.label}
          </Button>
        ))}
      </div>

      {draftAction ? (
        <div className="mt-4 space-y-2">
          <Textarea
            aria-label={
              draftAction === "answer" ? "Your answer" : "What is not right?"
            }
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              draftAction === "answer"
                ? "Type your answer…"
                : "Tell us what needs changing…"
            }
            value={draft}
          />
          <div className="flex gap-2">
            <Button
              data-testid={`submit-${draftAction}-${item.id}`}
              disabled={
                submit.isPending ||
                (draftAction === "answer" && draft.trim().length === 0)
              }
              onClick={() => run(draftAction, draft)}
              size="sm"
            >
              {submit.isPending ? "Waiting for confirmation…" : "Send"}
            </Button>
            <Button
              disabled={submit.isPending}
              onClick={() => {
                setDraftAction(null);
                setDraft("");
                submit.reset();
              }}
              size="sm"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {isCosFollowUpActionPermitted(item, "answer") ? (
            <Button
              data-testid={`answer-${item.id}`}
              disabled={submit.isPending}
              onClick={() => setDraftAction("answer")}
              size="sm"
            >
              Answer
            </Button>
          ) : null}
          {isCosFollowUpActionPermitted(item, "confirm") ? (
            <Button
              data-testid={`confirm-${item.id}`}
              disabled={submit.isPending}
              onClick={() => run("confirm")}
              size="sm"
            >
              That’s right
            </Button>
          ) : null}
          {isCosFollowUpActionPermitted(item, "reject") ? (
            <Button
              data-testid={`reject-${item.id}`}
              disabled={submit.isPending}
              onClick={() => setDraftAction("reject")}
              size="sm"
              variant="outline"
            >
              That’s not right
            </Button>
          ) : null}
          {submit.isPending ? (
            <span className="self-center text-xs text-muted-foreground">
              Waiting for authoritative confirmation…
            </span>
          ) : null}
        </div>
      )}

      {error ? (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs text-destructive">{error.message}</p>
          {error instanceof CosFollowUpSubmissionError && error.retryable ? (
            <Button
              onClick={() => {
                const retryAction = submit.variables?.action;
                submit.reset();
                if (retryAction) {
                  run(retryAction, draft, error.signedEvent ?? undefined);
                }
              }}
              size="xs"
              variant="outline"
            >
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function CosFollowUpScreen() {
  const identity = useIdentityQuery();
  const { activeCommunity } = useCommunities();
  const pubkey = identity.data?.pubkey ?? "";
  const relayScope = activeCommunity?.relayUrl ?? "";
  const query = useCosFollowUpQuery(pubkey, relayScope);
  const openItems = (query.data ?? []).filter(
    (item) => item.state !== "confirmed",
  );
  const confirmedItems = (query.data ?? [])
    .filter((item) => item.state === "confirmed")
    .slice(0, 20);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border/60 bg-background/95 px-6 py-5">
        <div className="mx-auto flex max-w-4xl items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ListTodo className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold">My Actions</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Questions and checks that need you. Contractor OS stays
              authoritative.
            </p>
          </div>
          <Button
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={cn(query.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-8">
          {query.isPending ? (
            <div className="rounded-xl border border-border/60 bg-card/70 p-8 text-center text-sm text-muted-foreground">
              Loading your actions…
            </div>
          ) : null}
          {query.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
                <div>
                  <h2 className="text-sm font-semibold">Actions unavailable</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {query.error instanceof Error
                      ? query.error.message
                      : "MAC Workspace could not load your actions."}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {!query.isPending && !query.isError ? (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Open</h2>
                <span className="text-xs text-muted-foreground">
                  {openItems.length}
                </span>
              </div>
              {openItems.length > 0 ? (
                <div className="space-y-3">
                  {openItems.map((item) => (
                    <FollowUpCard
                      item={item}
                      key={item.id}
                      pubkey={pubkey}
                      relayScope={relayScope}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 bg-card/70 p-8 text-center">
                  <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-500" />
                  <p className="mt-2 text-sm font-medium">
                    Nothing needs you right now
                  </p>
                </div>
              )}
            </section>
          ) : null}

          {confirmedItems.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold">Recently confirmed</h2>
              <div className="space-y-3 opacity-80">
                {confirmedItems.map((item) => (
                  <FollowUpCard
                    item={item}
                    key={item.id}
                    pubkey={pubkey}
                    relayScope={relayScope}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
