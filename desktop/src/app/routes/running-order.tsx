import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";
import { CosWorkspaceModuleGate } from "@/features/cos-user-context/ui/CosWorkspaceModuleGate";

const CosRunningOrderScreen = React.lazy(async () => {
  const module = await import(
    "@/features/cos-running-order/ui/CosRunningOrderScreen"
  );
  return { default: module.CosRunningOrderScreen };
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
        <CosRunningOrderScreen />
      </CosWorkspaceModuleGate>
    </React.Suspense>
  );
}
