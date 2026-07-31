import * as React from "react";
import { toast } from "sonner";

import type { CosUserContext } from "../lib/cosUserContext";
import type { MacAssistantEnrolmentRequest } from "../lib/macAssistantEnrolment";
import { markAssistantEnrolmentConsumed } from "../hooksMacAssistantEnrolment";
import { relayClient } from "@/shared/api/relayClient";
import { attestMacAssistantEnrolment } from "@/shared/api/tauriMacAssistantActivation";
import type { RelayEvent } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export function MacAssistantEnrolmentDialog({
  bridgePubkey,
  context,
  identityPubkey,
  onApproved,
  onOpenChange,
  open,
  request,
  requestEvent,
}: {
  bridgePubkey: string;
  context: CosUserContext;
  identityPubkey: string;
  onApproved: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  request: MacAssistantEnrolmentRequest;
  requestEvent: RelayEvent;
}) {
  const [state, setState] = React.useState<"ready" | "signing" | "done">(
    "ready",
  );
  const [error, setError] = React.useState("");

  const approve = async () => {
    setError("");
    setState("signing");
    try {
      const eventJson = await attestMacAssistantEnrolment(
        JSON.stringify(requestEvent),
        {
          bridgePubkey,
          projectedIdentityPubkey: context.assigneePubkey,
          channelId: context.channelId,
          userId: String(context.user.id),
          userName: context.user.name,
        },
      );
      const event = JSON.parse(eventJson) as RelayEvent;
      await relayClient.publishEvent(
        event,
        "Your approval timed out before it reached MAC Workspace",
        "Your approval could not be sent",
      );
      markAssistantEnrolmentConsumed(identityPubkey, request.request_id);
      setState("done");
      onApproved();
      toast.success("MAC Assistant approval sent");
    } catch (cause) {
      setState("ready");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="mac-assistant-enrolment-dialog">
        <DialogHeader>
          <DialogTitle>Enable my MAC Assistant</DialogTitle>
          <DialogDescription>
            This approves a separate assistant instance for {context.user.name}
            ’s private channel. It cannot read another employee’s private
            conversations. The service will remain off until an operator
            verifies this approval and runs the separate activation command.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {state === "done" ? (
          <p
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"
            data-testid="mac-assistant-enrolment-success"
          >
            Approval sent safely. You can close this window.
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {state === "done" ? "Close" : "Not now"}
          </Button>
          {state !== "done" ? (
            <Button
              data-testid="approve-mac-assistant-enrolment"
              disabled={state === "signing"}
              onClick={() => void approve()}
            >
              {state === "signing" ? "Sending approval…" : "Approve securely"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
