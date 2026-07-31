import * as React from "react";
import { toast } from "sonner";

import type { CosUserContext } from "@/features/cos-user-context/lib/cosUserContext";
import { attestMacAssistantActivation } from "@/shared/api/tauriMacAssistantActivation";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function JakeAssistantActivationDialog({
  context,
  onOpenChange,
  open,
}: {
  context: CosUserContext;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [requestJson, setRequestJson] = React.useState("");
  const [attestation, setAttestation] = React.useState("");
  const [error, setError] = React.useState("");
  const [isSigning, setIsSigning] = React.useState(false);

  const resetAndClose = React.useCallback(() => {
    setRequestJson("");
    setAttestation("");
    setError("");
    setIsSigning(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const sign = React.useCallback(async () => {
    setError("");
    setAttestation("");
    setIsSigning(true);
    try {
      const result = await attestMacAssistantActivation(requestJson, {
        projectedIdentityPubkey: context.assigneePubkey,
        channelId: context.channelId,
        userName: context.user.name,
        assistantKey: "mac-assistant",
      });
      setAttestation(result);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setIsSigning(false);
    }
  }, [context, requestJson]);

  const copy = React.useCallback(async () => {
    try {
      await writeTextToClipboard(attestation);
      toast.success("Owner attestation copied");
    } catch {
      toast.error("MAC Workspace could not access the clipboard.");
    }
  }, [attestation]);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) resetAndClose();
      }}
      open={open}
    >
      <DialogContent
        aria-describedby="jake-assistant-activation-description"
        className="sm:max-w-xl"
        data-testid="jake-assistant-activation-dialog"
      >
        <DialogHeader>
          <DialogTitle>Authorise Jake’s MAC Assistant</DialogTitle>
          <DialogDescription id="jake-assistant-activation-description">
            Paste the short-lived request prepared on brain-vps. Your current
            Workspace identity signs the owner attestation in memory. This does
            not create, import or run an agent on this Mac.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            aria-label="Activation request"
            className="min-h-40 font-mono text-xs"
            disabled={isSigning || Boolean(attestation)}
            onChange={(event) => setRequestJson(event.target.value)}
            placeholder="Paste the MAC Assistant activation request JSON"
            value={requestJson}
          />
          {error ? (
            <p
              className="text-sm text-destructive"
              data-testid="jake-assistant-activation-error"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {attestation ? (
            <div
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3"
              data-testid="jake-assistant-attestation-ready"
            >
              <p className="text-sm font-medium">Owner attestation ready</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Copy it back to the estate provisioner before the request
                expires. The bundle contains public identity evidence only.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button onClick={resetAndClose} variant="outline">
            Cancel
          </Button>
          {attestation ? (
            <Button
              data-testid="copy-jake-assistant-attestation"
              onClick={copy}
            >
              Copy attestation
            </Button>
          ) : (
            <Button
              data-testid="attest-jake-assistant"
              disabled={isSigning || requestJson.trim().length === 0}
              onClick={() => void sign()}
            >
              {isSigning ? "Authorising…" : "Create owner attestation"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
