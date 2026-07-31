import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { CosWorkspaceModuleGate } from "@/features/cos-user-context/ui/CosWorkspaceModuleGate";
import { usePreviewFeatureWarning } from "@/shared/features";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const ProjectsScreen = React.lazy(async () => {
  const module = await import("@/features/projects/ui/ProjectsScreen");
  return { default: module.ProjectsScreen };
});

export const Route = createFileRoute("/projects")({
  component: ProjectsRouteComponent,
});

function ProjectsRouteComponent() {
  usePreviewFeatureWarning("projects");
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
      <CosWorkspaceModuleGate module="agents">
        <ProjectsScreen />
      </CosWorkspaceModuleGate>
    </React.Suspense>
  );
}
