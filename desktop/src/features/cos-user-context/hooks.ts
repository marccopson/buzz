import { useQuery } from "@tanstack/react-query";

import {
  cosUserContextChannelCandidates,
  resolveAuthoritativeCosUserContextChannel,
  selectLatestCosUserContext,
} from "@/features/cos-user-context/lib/cosUserContext";
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
      const candidateEvents = await relayClient.fetchEvents({
        kinds: [KIND_COS_USER_CONTEXT],
        authors: [authority.data],
        "#d": [`context:${normalizedPubkey}`],
        "#p": [normalizedPubkey],
        limit: 20,
      });
      const candidateChannelIds = cosUserContextChannelCandidates(
        candidateEvents,
        normalizedPubkey,
        authority.data,
      );
      if (candidateChannelIds.length === 0) return null;
      const [metadataEvents, membershipEvents] = await Promise.all([
        relayClient.fetchEvents({
          kinds: [39000],
          "#d": candidateChannelIds,
          limit: candidateChannelIds.length,
        }),
        relayClient.fetchEvents({
          kinds: [39002],
          "#d": candidateChannelIds,
          "#p": [normalizedPubkey],
          limit: candidateChannelIds.length,
        }),
      ]);
      const channelId = resolveAuthoritativeCosUserContextChannel({
        candidateChannelIds,
        metadataEvents,
        membershipEvents,
        assigneePubkey: normalizedPubkey,
        trustedBridgePubkey: authority.data,
      });
      if (!channelId) return null;
      const events = await relayClient.fetchEvents({
        kinds: [KIND_COS_USER_CONTEXT],
        authors: [authority.data],
        "#h": [channelId],
        "#d": [`context:${normalizedPubkey}`],
        "#p": [normalizedPubkey],
        limit: 20,
      });
      return selectLatestCosUserContext(
        events,
        normalizedPubkey,
        authority.data,
        channelId,
      );
    },
    enabled: normalizedPubkey.length > 0 && authority.isSuccess,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}
