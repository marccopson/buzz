import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { CosWorkspaceModuleGate } from "@/features/cos-user-context/ui/CosWorkspaceModuleGate";
import { usePreviewFeatureWarning } from "@/shared/features";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

export const Route = createFileRoute("/workflows")({
  component: WorkflowsRouteComponent,
});

const WorkflowsRouteScreen = React.lazy(async () => {
  const module = await import("./WorkflowsRouteScreen");
  return { default: module.WorkflowsRouteScreen };
});

function WorkflowsRouteComponent() {
  usePreviewFeatureWarning("workflows");
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="workflows" />}>
      <CosWorkspaceModuleGate module="agents">
        <WorkflowsRouteScreen selectedWorkflowId={null} />
      </CosWorkspaceModuleGate>
    </React.Suspense>
  );
}
