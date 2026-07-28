import { useQuery } from "@tanstack/react-query";

import { selectLatestCosUserContext } from "@/features/cos-user-context/lib/cosUserContext";
import { relayClient } from "@/shared/api/relayClient";
import { getCosFollowUpBridgePubkey } from "@/shared/api/tauriIdentityArchive";
import { KIND_COS_USER_CONTEXT } from "@/shared/constants/kinds";

async function fetchAuthority() {
  try {
    return await getCosFollowUpBridgePubkey();
  } catch {
    return null;
  }
}

export function useCosUserContextQuery(pubkey?: string, communityScope = "") {
  const normalizedPubkey = pubkey?.trim().toLowerCase() ?? "";
  const authority = useQuery({
    queryKey: ["cos-follow-up-authority", communityScope],
    queryFn: fetchAuthority,
    staleTime: Number.POSITIVE_INFINITY,
  });

  return useQuery({
    queryKey: ["cos-user-context", communityScope, normalizedPubkey],
    queryFn: async () => {
      if (!authority.data) return null;
      const events = await relayClient.fetchEvents({
        kinds: [KIND_COS_USER_CONTEXT],
        authors: [authority.data],
        "#d": [`context:${normalizedPubkey}`],
        "#p": [normalizedPubkey],
        limit: 20,
      });
      return selectLatestCosUserContext(
        events,
        normalizedPubkey,
        authority.data,
      );
    },
    enabled: normalizedPubkey.length > 0 && authority.isSuccess,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}
