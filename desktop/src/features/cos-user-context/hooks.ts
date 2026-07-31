import { useQuery } from "@tanstack/react-query";

import {
  cosUserContextChannelCandidates,
  resolveAuthoritativeCosUserContextChannel,
  selectLatestCosUserContext,
} from "@/features/cos-user-context/lib/cosUserContext";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { relayClient } from "@/shared/api/relayClient";
import { getCosFollowUpBridgePubkey } from "@/shared/api/tauriIdentityArchive";
import { KIND_COS_USER_CONTEXT } from "@/shared/constants/kinds";

async function fetchAuthority() {
  try {
    const [bridgePubkey, relaySelfPubkey] = await Promise.all([
      getCosFollowUpBridgePubkey(),
      getRelaySelf(),
    ]);
    return bridgePubkey && relaySelfPubkey
      ? { bridgePubkey, relaySelfPubkey }
      : null;
  } catch {
    return null;
  }
}

export function useCosUserContextQuery(pubkey?: string, communityScope = "") {
  const normalizedPubkey = pubkey?.trim().toLowerCase() ?? "";
  const authority = useQuery({
    queryKey: ["cos-user-context-authority", communityScope],
    queryFn: fetchAuthority,
    staleTime: Number.POSITIVE_INFINITY,
  });

  return useQuery({
    queryKey: ["cos-user-context", communityScope, normalizedPubkey],
    queryFn: async () => {
      if (!authority.data) return null;
      const { bridgePubkey, relaySelfPubkey } = authority.data;
      const candidateEvents = await relayClient.fetchEvents({
        kinds: [KIND_COS_USER_CONTEXT],
        authors: [bridgePubkey],
        "#d": [`context:${normalizedPubkey}`],
        "#p": [normalizedPubkey],
        limit: 20,
      });
      const candidateChannelIds = cosUserContextChannelCandidates(
        candidateEvents,
        normalizedPubkey,
        bridgePubkey,
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
          limit: candidateChannelIds.length,
        }),
      ]);
      const channelId = resolveAuthoritativeCosUserContextChannel({
        candidateChannelIds,
        metadataEvents,
        membershipEvents,
        assigneePubkey: normalizedPubkey,
        trustedBridgePubkey: bridgePubkey,
        trustedRelayPubkey: relaySelfPubkey,
      });
      if (!channelId) return null;
      const events = await relayClient.fetchEvents({
        kinds: [KIND_COS_USER_CONTEXT],
        authors: [bridgePubkey],
        "#h": [channelId],
        "#d": [`context:${normalizedPubkey}`],
        "#p": [normalizedPubkey],
        limit: 20,
      });
      return selectLatestCosUserContext(
        events,
        normalizedPubkey,
        bridgePubkey,
        channelId,
      );
    },
    enabled: normalizedPubkey.length > 0 && authority.isSuccess,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}
