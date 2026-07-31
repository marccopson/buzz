import * as React from "react";

import { MacBridgeAuthorisationDialog } from "@/features/agents/ui/MacBridgeAuthorisationDialog";
import { Button } from "@/shared/ui/button";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

/**
 * The recovery path must be reachable before the community context grants the
 * main Agents module. Settings is deliberately available at that point.
 */
export function MacBridgeAuthorisationSettingsCard() {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <>
      <section
        className="min-w-0 space-y-4"
        data-testid="settings-mac-bridge-authorisation"
      >
        <SettingsSectionHeader
          title="MAC Workspace bridge"
          description="Authorise the secure MAC bridge from this owner device when restoring staff-assistant delivery."
        />
        <Button onClick={() => setIsOpen(true)} variant="outline">
          Authorise MAC bridge
        </Button>
      </section>
      <MacBridgeAuthorisationDialog onOpenChange={setIsOpen} open={isOpen} />
    </>
  );
}
