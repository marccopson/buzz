import { LockKeyhole } from "lucide-react";
import type * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import { cosFollowUpCommunityScope } from "@/features/cos-follow-up/hooks";
import { useCosUserContextQuery } from "@/features/cos-user-context/hooks";
import {
  type CosWorkspaceModule,
  hasCosWorkspaceModule,
} from "@/features/cos-user-context/lib/cosUserContext";
import { useIdentityQuery } from "@/shared/api/hooks";

export function CosWorkspaceModuleGate({
  children,
  module,
  modules,
}: {
  children: React.ReactNode;
  module?: CosWorkspaceModule;
  modules?: readonly CosWorkspaceModule[];
}) {
  const identity = useIdentityQuery();
  const { activeCommunity } = useCommunities();
  const context = useCosUserContextQuery(
    identity.data?.pubkey,
    cosFollowUpCommunityScope(activeCommunity),
  );

  if (context.isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
        Checking your Contractor OS access…
      </div>
    );
  }
  const requiredModules = modules ?? (module ? [module] : []);
  if (
    requiredModules.length === 0 ||
    !requiredModules.every((requiredModule) =>
      hasCosWorkspaceModule(context.data, requiredModule),
    )
  ) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background px-6">
        <div className="max-w-md rounded-xl border border-border/60 bg-card/70 p-8 text-center">
          <LockKeyhole className="mx-auto h-6 w-6 text-muted-foreground" />
          <h1 className="mt-3 text-base font-semibold">Access not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Contractor OS has not enabled this tool for your role.
          </p>
        </div>
      </div>
    );
  }
  return children;
}
