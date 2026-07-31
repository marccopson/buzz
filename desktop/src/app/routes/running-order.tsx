import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";
import { CosWorkspaceModuleGate } from "@/features/cos-user-context/ui/CosWorkspaceModuleGate";

const CosDeliveryRoomScreen = React.lazy(async () => {
  const module = await import(
    "@/features/cos-running-order/ui/CosDeliveryRoomScreen"
  );
  return { default: module.CosDeliveryRoomScreen };
});

export const Route = createFileRoute("/running-order")({
  component: RunningOrderRouteComponent,
});

function RunningOrderRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="projects" />}
    >
      <CosWorkspaceModuleGate module="running_order">
        <CosDeliveryRoomScreen />
      </CosWorkspaceModuleGate>
    </React.Suspense>
  );
}
