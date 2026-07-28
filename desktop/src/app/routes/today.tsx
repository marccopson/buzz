import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const CosTodayScreen = React.lazy(async () => {
  const module = await import("@/features/cos-user-context/ui/CosTodayScreen");
  return { default: module.CosTodayScreen };
});

export const Route = createFileRoute("/today")({
  component: TodayRouteComponent,
});

function TodayRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="projects" />}
    >
      <CosTodayScreen />
    </React.Suspense>
  );
}
