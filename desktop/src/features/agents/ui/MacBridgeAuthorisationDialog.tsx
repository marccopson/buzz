import * as React from "react";
import { toast } from "sonner";

import { attestMacAssistantBridgeAuthorisation } from "@/shared/api/tauriMacAssistantActivation";
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

/**
 * This recovery control intentionally accepts only a signed, short-lived
 * bridge request. The native command independently validates it before the
 * current Desktop identity creates a NIP-OA tag.
 */
export function MacBridgeAuthorisationDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const [requestEventJson, setRequestEventJson] = React.useState("");
  const [authorisation, setAuthorisation] = React.useState("");
  const [error, setError] = React.useState("");
  const [isSigning, setIsSigning] = React.useState(false);

  const reset = React.useCallback(() => {
    setRequestEventJson("");
    setAuthorisation("");
    setError("");
    setIsSigning(false);
  }, []);

  const sign = React.useCallback(async () => {
    setError("");
    setIsSigning(true);
    try {
      setAuthorisation(
        await attestMacAssistantBridgeAuthorisation(requestEventJson),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSigning(false);
    }
  }, [requestEventJson]);

  const copy = React.useCallback(async () => {
    try {
      await writeTextToClipboard(authorisation);
      toast.success("Bridge authorisation copied");
    } catch {
      toast.error("MAC Workspace could not access the clipboard.");
    }
  }, [authorisation]);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent data-testid="mac-bridge-authorisation-dialog">
        <DialogHeader>
          <DialogTitle>Authorise MAC Workspace bridge</DialogTitle>
          <DialogDescription>
            Paste the short-lived recovery request prepared by the MAC bridge.
            Desktop will verify its signature and authorise only that bridge;
            your private Workspace identity never leaves this device.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Bridge recovery request"
          className="min-h-40 font-mono text-xs"
          disabled={isSigning || Boolean(authorisation)}
          onChange={(event) => setRequestEventJson(event.target.value)}
          placeholder="Paste the bridge recovery request JSON"
          value={requestEventJson}
        />
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {authorisation ? (
          <p
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"
            data-testid="mac-bridge-authorisation-ready"
          >
            Bridge authorisation ready. Copy it to the authorised operator so
            the bridge can be started.
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Close
          </Button>
          {authorisation ? (
            <Button
              data-testid="copy-mac-bridge-authorisation"
              onClick={() => void copy()}
            >
              Copy authorisation
            </Button>
          ) : (
            <Button
              data-testid="authorise-mac-bridge"
              disabled={isSigning || requestEventJson.trim().length === 0}
              onClick={() => void sign()}
            >
              {isSigning ? "Authorising…" : "Authorise securely"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
