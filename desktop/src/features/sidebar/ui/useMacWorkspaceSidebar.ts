import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCommunities } from "@/features/communities/useCommunities";
import { useCosUserContextQuery } from "@/features/cos-user-context/hooks";
import { currentCosUserContext } from "@/features/cos-user-context/lib/cosUserContext";
import { useIdentityQuery } from "@/shared/api/hooks";

export function useMacWorkspaceSidebar() {
  const identity = useIdentityQuery();
  const { activeCommunity } = useCommunities();
  const context = useCosUserContextQuery(
    identity.data?.pubkey,
    activeCommunity?.id ?? "",
  );
  const currentContext = currentCosUserContext(context);
  const { goToday } = useAppNavigation();
  return {
    onSelectToday: () => void goToday(),
    workspaceModules: currentContext?.modules ?? [],
  };
}
