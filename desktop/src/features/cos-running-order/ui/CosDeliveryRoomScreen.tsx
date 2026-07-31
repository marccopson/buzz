import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  ExternalLink,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import {
  type CosDeliveryRoom,
  type DeliveryRoomEvidence,
  type DeliveryRoomParticipantState,
  type DeliveryRoomTeam,
  type DeliveryRoomTeamTemplate,
  type DeliveryRoomWorkHealth,
  type DeliveryRoomWorkItem,
  cosDeliveryRoomExpiresAt,
  deliveryRoomTeamTemplateId,
  loadCosDeliveryRoom,
  teamThreadForWork,
} from "@/features/cos-running-order/lib/cosDeliveryRoom";
import {
  formatDeliveryRoomTimestamp,
  latestCurrentEvidence,
} from "@/features/cos-running-order/lib/cosDeliveryRoomPresentation";
import {
  HEALTH_PRESENTATION,
  PARTICIPANT_PRESENTATION,
} from "@/features/cos-running-order/lib/cosDeliveryRoomUiPresentation";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

type DetailSelection =
  | { kind: "work"; item: DeliveryRoomWorkItem }
  | {
      kind: "team";
      template: DeliveryRoomTeamTemplate;
      team?: DeliveryRoomTeam;
    };

type DetailSelectionKey =
  | { kind: "work"; itemId: string }
  | { kind: "team"; templateId: DeliveryRoomTeamTemplate["id"] };

function ParticipantBadge({ state }: { state: DeliveryRoomParticipantState }) {
  const presentation = PARTICIPANT_PRESENTATION[state];
  return (
    <Badge className={presentation.className} variant="outline">
      {presentation.label}
    </Badge>
  );
}

function HealthBadge({ health }: { health: DeliveryRoomWorkHealth }) {
  const presentation = HEALTH_PRESENTATION[health];
  return (
    <Badge className={presentation.className} variant="outline">
      {presentation.label}
    </Badge>
  );
}

function AttentionPanel({
  label,
  items,
  tone,
  onSelect,
}: {
  label: string;
  items: DeliveryRoomWorkItem[];
  tone: "orange" | "red";
  onSelect: (item: DeliveryRoomWorkItem) => void;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border px-3 py-2.5",
        tone === "orange"
          ? "border-orange-500/25 bg-orange-500/8"
          : "border-destructive/25 bg-destructive/8",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        <Badge variant={tone === "orange" ? "warning" : "destructive"}>
          {items.length}
        </Badge>
      </div>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing currently evidenced.
        </p>
      ) : (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5">
          {items.map((item) => (
            <button
              className="min-w-48 flex-1 rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-left hover:bg-accent"
              data-testid={`attention-item-${item.id}`}
              key={item.id}
              onClick={() => onSelect(item)}
              type="button"
            >
              <span className="block truncate text-sm font-medium">
                {item.title}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {item.nextAction}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamRoomCard({
  template,
  team,
  onSelect,
}: {
  template: DeliveryRoomTeamTemplate;
  team?: DeliveryRoomTeam;
  onSelect: () => void;
}) {
  const hasDiscussion = Boolean(
    team &&
      (team.contributions.length > 0 ||
        team.dissent.length > 0 ||
        team.synthesis ||
        team.signOff.status === "signed_off"),
  );
  return (
    <button
      className="min-w-64 flex-1 rounded-xl border border-border/60 bg-card/70 p-3 text-left shadow-xs hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`team-room-${template.id}`}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{template.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {team
              ? `${team.contributingParticipantIds.length} evidenced contributor${team.contributingParticipantIds.length === 1 ? "" : "s"}`
              : "No evidenced room activity"}
          </p>
        </div>
        <Badge
          variant={
            team?.signOff.status === "signed_off" ? "success" : "secondary"
          }
        >
          {team?.signOff.status === "signed_off" ? "Signed off" : "No sign-off"}
        </Badge>
      </div>
      {team && team.participants.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {team.participants.map((participant) => (
            <span
              className="inline-flex items-center gap-1"
              key={participant.id}
            >
              <span className="max-w-24 truncate text-xs text-muted-foreground">
                {participant.name}
              </span>
              <ParticipantBadge state={participant.state} />
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          This room stays quiet until signed evidence arrives.
        </p>
      )}
      {hasDiscussion ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-primary">
          <MessageSquareText className="h-3.5 w-3.5" />
          Open evidenced discussion
        </p>
      ) : null}
    </button>
  );
}

function WorkCard({
  item,
  onSelect,
}: {
  item: DeliveryRoomWorkItem;
  onSelect: () => void;
}) {
  const passedGates = item.objectiveGates.filter(
    (gate) => gate.status === "passed",
  ).length;
  const latestEvidence = latestCurrentEvidence(item);
  return (
    <button
      className="w-full rounded-lg border border-border/60 bg-card p-3 text-left shadow-xs hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`delivery-room-item-${item.id}`}
      onClick={onSelect}
      type="button"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug">
          {item.title}
        </h3>
        <HealthBadge health={item.health} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {item.whyItMatters}
      </p>
      <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Current activity
          </p>
          <p className="mt-0.5 text-xs leading-relaxed">
            {item.currentActivity}
          </p>
        </div>
        <div>
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Next action
          </p>
          <p className="mt-0.5 flex items-start gap-1.5 text-xs font-medium">
            <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
            {item.nextAction}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Owner: {item.owner.label}</span>
        <span>
          Gates: {passedGates}/{item.objectiveGates.length} passed
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span>
          {latestEvidence
            ? `Evidence observed ${formatDeliveryRoomTimestamp(latestEvidence.observedAt)}`
            : "No current evidence"}
        </span>
        {item.externalReference ? (
          <span className="shrink-0 font-mono">
            {item.externalReference.key}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function EvidenceList({ evidence }: { evidence: DeliveryRoomEvidence[] }) {
  return (
    <section>
      <h3 className="text-sm font-semibold">Evidence</h3>
      {evidence.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No evidence supplied.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {evidence.map((item) => (
            <div
              className="rounded-lg border border-border/60 p-3"
              key={item.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{item.source.label}</p>
                <Badge
                  variant={
                    item.freshness === "current"
                      ? "success"
                      : item.freshness === "stale"
                        ? "warning"
                        : "destructive"
                  }
                >
                  {item.freshness === "current"
                    ? "Current"
                    : item.freshness === "stale"
                      ? "Stale"
                      : "Invalid"}
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-relaxed">{item.detail}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.observedAt
                  ? `Observed ${formatDeliveryRoomTimestamp(item.observedAt)}`
                  : "Observation time is invalid"}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CardTeamThreads({
  item,
  templates,
  teams,
}: {
  item: DeliveryRoomWorkItem;
  templates: DeliveryRoomTeamTemplate[];
  teams: DeliveryRoomTeam[];
}) {
  return (
    <section data-testid="card-team-threads">
      <h3 className="text-sm font-semibold">Detailed team threads</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Only discussion whose evidence explicitly references this card is shown.
      </p>
      <div className="mt-2 space-y-2">
        {templates.map((template) => {
          const team = teams.find(
            (candidate) =>
              deliveryRoomTeamTemplateId(candidate) === template.id,
          );
          const thread = teamThreadForWork(team, item);
          const entries = [...thread.contributions, ...thread.dissent];
          const hasThread = Boolean(
            entries.length > 0 || thread.synthesis || thread.signOff,
          );
          return (
            <div
              className="rounded-lg border border-border/60 p-3"
              key={template.id}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{template.name}</p>
                <Badge variant={thread.signOff ? "success" : "secondary"}>
                  {thread.signOff ? "Signed off" : "No card sign-off"}
                </Badge>
              </div>
              {!hasThread ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  No evidenced discussion is linked to this card.
                </p>
              ) : (
                <div className="mt-2 space-y-2 text-sm">
                  {thread.contributions.map((entry) => (
                    <p key={`contribution-${entry.id}`}>
                      <span className="font-medium">Contribution:</span>{" "}
                      {entry.summary}
                    </p>
                  ))}
                  {thread.dissent.map((entry) => (
                    <p
                      className="text-amber-700 dark:text-amber-300"
                      key={`dissent-${entry.id}`}
                    >
                      <span className="font-medium">Dissent:</span>{" "}
                      {entry.summary}
                    </p>
                  ))}
                  {thread.synthesis ? (
                    <p>
                      <span className="font-medium">Synthesis:</span>{" "}
                      {thread.synthesis.summary}
                    </p>
                  ) : null}
                  {thread.signOff ? (
                    <p className="text-emerald-700 dark:text-emerald-300">
                      <span className="font-medium">Evidenced sign-off:</span>{" "}
                      {thread.signOff.summary || "Signed off."}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WorkDetail({
  item,
  room,
}: {
  item: DeliveryRoomWorkItem;
  room: CosDeliveryRoom["deliveryRoom"];
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <HealthBadge health={item.health} />
        <span className="text-xs text-muted-foreground">
          Owner: {item.owner.label}
        </span>
        {item.externalReference ? (
          <span className="font-mono text-xs text-muted-foreground">
            {item.externalReference.key}
          </span>
        ) : null}
      </div>
      <section>
        <h3 className="text-sm font-semibold">Why it matters</h3>
        <p className="mt-1 text-sm leading-relaxed">{item.whyItMatters}</p>
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-lg bg-muted/50 p-3">
          <h3 className="text-xs font-semibold text-muted-foreground">
            Current activity
          </h3>
          <p className="mt-1 text-sm leading-relaxed">{item.currentActivity}</p>
        </section>
        <section className="rounded-lg bg-muted/50 p-3">
          <h3 className="text-xs font-semibold text-muted-foreground">
            Next action
          </h3>
          <p className="mt-1 text-sm font-medium leading-relaxed">
            {item.nextAction}
          </p>
        </section>
      </div>
      <section data-testid="objective-gates">
        <h3 className="text-sm font-semibold">Objective gates</h3>
        {item.objectiveGates.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No objective gates are configured. Completion cannot be established.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {item.objectiveGates.map((gate) => (
              <div
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
                key={gate.id}
              >
                <span className="text-sm">{gate.label}</span>
                <Badge
                  variant={
                    gate.status === "passed"
                      ? "success"
                      : gate.status === "pending"
                        ? "secondary"
                        : "destructive"
                  }
                >
                  {gate.status[0]?.toUpperCase() + gate.status.slice(1)}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>
      <CardTeamThreads
        item={item}
        teams={room.teams}
        templates={room.teamTemplates}
      />
      <EvidenceList evidence={item.evidence} />
      {item.externalReference?.href ? (
        <Button
          onClick={() => void openUrl(item.externalReference?.href ?? "")}
          size="sm"
          variant="outline"
        >
          <ExternalLink />
          Open {item.externalReference.key} in Jira
        </Button>
      ) : null}
    </div>
  );
}

function participantName(
  team: DeliveryRoomTeam,
  participantId: string,
): string {
  return (
    team.participants.find((participant) => participant.id === participantId)
      ?.name ?? participantId
  );
}

function TeamDetail({
  template,
  team,
}: {
  template: DeliveryRoomTeamTemplate;
  team?: DeliveryRoomTeam;
}) {
  if (!team) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed border-border p-4">
          <p className="text-sm text-muted-foreground">
            No evidenced activity is available for this room. Invitations,
            participation and sign-off are not assumed.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Decision authority remains {template.decisionAuthority}. The room is
          read-only.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">Invited</p>
          <p className="mt-1 text-lg font-semibold">
            {team.invitedParticipantIds.length}
          </p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            Evidenced contributors
          </p>
          <p className="mt-1 text-lg font-semibold">
            {team.contributingParticipantIds.length}
          </p>
        </div>
      </div>
      <section>
        <h3 className="text-sm font-semibold">Participants</h3>
        <div className="mt-2 space-y-2">
          {team.participants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No evidenced participants.
            </p>
          ) : (
            team.participants.map((participant) => (
              <div
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
                key={participant.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {participant.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {participant.role}
                  </p>
                </div>
                <ParticipantBadge state={participant.state} />
              </div>
            ))
          )}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-semibold">Contributions</h3>
        {team.contributions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No evidenced contributions.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {team.contributions.map((contribution) => (
              <p
                className="rounded-lg border border-border/60 p-3 text-sm"
                key={contribution.id}
              >
                <span className="font-medium">
                  {participantName(team, contribution.participantId)}:
                </span>{" "}
                {contribution.summary}
              </p>
            ))}
          </div>
        )}
      </section>
      <section>
        <h3 className="text-sm font-semibold">Dissent and challenge</h3>
        {team.dissent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No evidenced dissent or challenge.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {team.dissent.map((dissent) => (
              <p
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
                key={dissent.id}
              >
                <span className="font-medium">
                  {participantName(team, dissent.participantId)}:
                </span>{" "}
                {dissent.summary}
              </p>
            ))}
          </div>
        )}
      </section>
      <section>
        <h3 className="text-sm font-semibold">Synthesis</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {team.synthesis?.summary ?? "No evidenced synthesis."}
        </p>
      </section>
      <div
        className={cn(
          "rounded-lg border p-3",
          team.signOff.status === "signed_off"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-border bg-muted/40",
        )}
      >
        <div className="flex items-center gap-2">
          {team.signOff.status === "signed_off" ? (
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
          ) : (
            <CircleDashed className="h-4 w-4 text-muted-foreground" />
          )}
          <p className="text-sm font-semibold">
            {team.signOff.status === "signed_off"
              ? "Evidenced sign-off"
              : "Not signed off"}
          </p>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {team.signOff.status === "signed_off"
            ? team.signOff.summary ||
              `Signed by ${participantName(team, team.signOff.participantId)}.`
            : team.signOff.reason}
        </p>
      </div>
      {team.absentOrUnavailable.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold">Absent or unavailable</h3>
          <div className="mt-2 space-y-1">
            {team.absentOrUnavailable.map((item) => (
              <p
                className="text-sm text-muted-foreground"
                key={item.participantId}
              >
                {participantName(team, item.participantId)} · {item.reason}
              </p>
            ))}
          </div>
        </section>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Decision authority remains {template.decisionAuthority}. This room is
        read-only.
      </p>
    </div>
  );
}

function DetailDialog({
  selection,
  room,
  onClose,
}: {
  selection: DetailSelection | null;
  room: CosDeliveryRoom["deliveryRoom"];
  onClose: () => void;
}) {
  return (
    <Dialog
      onOpenChange={(open) => !open && onClose()}
      open={selection !== null}
    >
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pr-7">
          <DialogTitle>
            {selection?.kind === "work"
              ? selection.item.title
              : selection?.template.name}
          </DialogTitle>
          <DialogDescription>
            {selection?.kind === "work"
              ? "Read-only card evidence and explicitly linked team discussion."
              : "Read-only participation, challenge and sign-off evidence."}
          </DialogDescription>
        </DialogHeader>
        {selection?.kind === "work" ? (
          <WorkDetail item={selection.item} room={room} />
        ) : null}
        {selection?.kind === "team" ? (
          <TeamDetail team={selection.team} template={selection.template} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeliveryRoomView({ room }: { room: CosDeliveryRoom }) {
  const [selection, setSelection] = React.useState<DetailSelectionKey | null>(
    null,
  );
  const projection = room.deliveryRoom;
  const workById = React.useMemo(
    () => new Map(projection.workItems.map((item) => [item.id, item])),
    [projection.workItems],
  );
  const currentSelection = React.useMemo<DetailSelection | null>(() => {
    if (selection?.kind === "work") {
      const item = workById.get(selection.itemId);
      return item ? { kind: "work", item } : null;
    }
    if (selection?.kind === "team") {
      const template = projection.teamTemplates.find(
        (candidate) => candidate.id === selection.templateId,
      );
      if (!template) return null;
      const team = projection.teams.find(
        (candidate) => deliveryRoomTeamTemplateId(candidate) === template.id,
      );
      return { kind: "team", template, team };
    }
    return null;
  }, [projection.teamTemplates, projection.teams, selection, workById]);
  const attentionItems = (ids: string[]) =>
    ids
      .map((id) => workById.get(id))
      .filter((item): item is DeliveryRoomWorkItem => Boolean(item));

  return (
    <>
      <section
        aria-label="Manager attention"
        className="sticky top-0 z-20 -mx-4 border-b border-border/60 bg-background/95 px-4 pb-4 backdrop-blur sm:-mx-6 sm:px-6"
        data-testid="delivery-room-attention-strip"
      >
        <div className="mx-auto grid max-w-[96rem] gap-2 pt-1 sm:grid-cols-2">
          <AttentionPanel
            items={attentionItems(
              projection.attention.needsManager.workItemIds,
            )}
            label="Needs Marc"
            onSelect={(item) => setSelection({ kind: "work", itemId: item.id })}
            tone="orange"
          />
          <AttentionPanel
            items={attentionItems(
              projection.attention.blockedOrStalled.workItemIds,
            )}
            label="Blocked or stalled"
            onSelect={(item) => setSelection({ kind: "work", itemId: item.id })}
            tone="red"
          />
        </div>
      </section>

      <section
        className="mx-auto mt-5 max-w-[96rem]"
        aria-labelledby="team-rooms-heading"
      >
        <div>
          <h2 className="text-base font-semibold" id="team-rooms-heading">
            Team rooms
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Quiet by default. Invitations never count as participation.
          </p>
        </div>
        <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
          {projection.teamTemplates.map((template) => {
            const team = projection.teams.find(
              (candidate) =>
                deliveryRoomTeamTemplateId(candidate) === template.id,
            );
            return (
              <TeamRoomCard
                key={template.id}
                onSelect={() =>
                  setSelection({ kind: "team", templateId: template.id })
                }
                team={team}
                template={template}
              />
            );
          })}
        </div>
      </section>

      <section
        className="mx-auto mt-6 max-w-[96rem]"
        aria-labelledby="delivery-flow-heading"
      >
        <div>
          <h2 className="text-base font-semibold" id="delivery-flow-heading">
            Delivery flow
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Plain-English progress with narrative updates kept separate from
            objective gates.
          </p>
        </div>
        <div
          className="mt-3 grid gap-3 xl:grid-cols-5"
          data-testid="delivery-flow"
        >
          {projection.stages.map((stage) => {
            const items = stage.workItemIds
              .map((id) => workById.get(id))
              .filter((item): item is DeliveryRoomWorkItem => Boolean(item));
            return (
              <div
                className="min-w-0 rounded-xl border border-border/60 bg-muted/20 p-3"
                data-testid={`delivery-stage-${stage.stage}`}
                key={stage.stage}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{stage.label}</h3>
                  <Badge variant="secondary">{items.length}</Badge>
                </div>
                <div className="mt-3 space-y-3">
                  {items.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                      Nothing evidenced here.
                    </p>
                  ) : (
                    items.map((item) => (
                      <WorkCard
                        item={item}
                        key={item.id}
                        onSelect={() =>
                          setSelection({ kind: "work", itemId: item.id })
                        }
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <DetailDialog
        onClose={() => setSelection(null)}
        room={projection}
        selection={currentSelection}
      />
    </>
  );
}

export function CosDeliveryRoomScreen() {
  const { activeCommunity } = useCommunities();
  const [freshnessNow, setFreshnessNow] = React.useState(() => Date.now());
  const deliveryRoomQuery = useQuery({
    queryKey: ["cos-delivery-room", activeCommunity?.relayUrl],
    queryFn: ({ signal }) =>
      loadCosDeliveryRoom({
        relayUrl: activeCommunity?.relayUrl ?? "",
        signal,
      }),
    enabled: Boolean(activeCommunity?.relayUrl),
    refetchInterval: 60_000,
    // A rejected signed projection is a trust-boundary failure. Retrying would
    // leave the previously verified claims visible until the retry settles.
    retry: false,
    staleTime: 30_000,
  });
  const semanticExpiry = deliveryRoomQuery.data
    ? cosDeliveryRoomExpiresAt(deliveryRoomQuery.data)
    : undefined;
  const evidenceExpired =
    semanticExpiry !== undefined && freshnessNow >= semanticExpiry;
  const failClosed = deliveryRoomQuery.isError || evidenceExpired;

  React.useEffect(() => {
    if (semanticExpiry === undefined) return;

    const checkFreshness = () => setFreshnessNow(Date.now());
    let timer: number | undefined;
    const scheduleCheck = () => {
      const remainingMs = Math.max(semanticExpiry - Date.now(), 0);
      timer = window.setTimeout(
        () => {
          checkFreshness();
          if (Date.now() < semanticExpiry) scheduleCheck();
        },
        Math.min(remainingMs, 2_147_483_647),
      );
    };
    scheduleCheck();
    window.addEventListener("focus", checkFreshness);
    document.addEventListener("visibilitychange", checkFreshness);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", checkFreshness);
      document.removeEventListener("visibilitychange", checkFreshness);
    };
  }, [semanticExpiry]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border/60 bg-background/95 px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto flex max-w-[96rem] items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 shrink-0 text-primary" />
              <h1 className="truncate text-xl font-semibold">Delivery Room</h1>
              <Badge className="hidden sm:inline-flex" variant="secondary">
                Read-only
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              What needs you, what the team is doing and what happens next.
            </p>
          </div>
          <Button
            aria-label="Refresh Delivery Room"
            disabled={deliveryRoomQuery.isFetching}
            onClick={() => void deliveryRoomQuery.refetch()}
            size="sm"
            variant="outline"
          >
            <RefreshCw
              className={cn(deliveryRoomQuery.isFetching && "animate-spin")}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
        {deliveryRoomQuery.isPending ? (
          <div className="mx-auto max-w-[96rem] rounded-xl border border-border/60 bg-card/70 p-8 text-center text-sm text-muted-foreground">
            Loading signed delivery evidence…
          </div>
        ) : null}

        {failClosed ? (
          <div
            className="mx-auto max-w-[96rem] rounded-xl border border-destructive/30 bg-destructive/5 p-5"
            data-testid="delivery-room-fail-closed"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <h2 className="text-sm font-semibold">
                  Delivery evidence unavailable
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {evidenceExpired
                    ? "Delivery Room evidence expired before a new signed projection was available."
                    : deliveryRoomQuery.error instanceof Error
                      ? deliveryRoomQuery.error.message
                      : "The signed Delivery Room projection could not be verified."}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  No progress, activity, participation or completion state is
                  shown until current, consistent evidence is available.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {deliveryRoomQuery.data && !failClosed ? (
          <>
            <div className="mx-auto mb-4 flex max-w-[96rem] flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Signed source verified
              </span>
              <span className="flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" />
                Updated{" "}
                {formatDeliveryRoomTimestamp(
                  deliveryRoomQuery.data.generatedAt,
                )}
              </span>
              <span>Human authority · read-only</span>
            </div>
            <DeliveryRoomView room={deliveryRoomQuery.data} />
          </>
        ) : null}
      </main>
    </div>
  );
}
