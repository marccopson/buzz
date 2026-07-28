import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const CosFollowUpScreen = React.lazy(async () => {
  const module = await import("@/features/cos-follow-up/ui/CosFollowUpScreen");
  return { default: module.CosFollowUpScreen };
});

export const Route = createFileRoute("/my-actions")({
  component: MyActionsRouteComponent,
});

function MyActionsRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="projects" />}
    >
      <CosFollowUpScreen />
    </React.Suspense>
  );
}
