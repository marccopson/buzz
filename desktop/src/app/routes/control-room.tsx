import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { CosWorkspaceModuleGate } from "@/features/cos-user-context/ui/CosWorkspaceModuleGate";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const ControlRoomScreen = React.lazy(async () => {
  const module = await import("@/features/control-room/ui/ControlRoomScreen");
  return { default: module.ControlRoomScreen };
});

export const Route = createFileRoute("/control-room")({
  component: ControlRoomRouteComponent,
});

function ControlRoomRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="projects" />}
    >
      <CosWorkspaceModuleGate modules={["agents", "running_order"]}>
        <ControlRoomScreen />
      </CosWorkspaceModuleGate>
    </React.Suspense>
  );
}
