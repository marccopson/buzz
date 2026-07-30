import { useQuery } from "@tanstack/react-query";

import type { CosUserContext } from "./lib/cosUserContext";
import { selectCurrentMacAssistantEnrolmentRequest } from "./lib/macAssistantEnrolment";
import { relayClient } from "@/shared/api/relayClient";
import { KIND_MAC_ASSISTANT_ENROLMENT_REQUEST } from "@/shared/constants/kinds";

const CONSUMED_PREFIX = "mac-workspace.assistant-enrolment.consumed.v1";

export function markAssistantEnrolmentConsumed(
  identity: string,
  requestId: string,
) {
  localStorage.setItem(`${CONSUMED_PREFIX}:${identity}:${requestId}`, "1");
}

export function useMacAssistantEnrolmentRequest(
  context: CosUserContext | null,
  identityPubkey: string,
  bridgePubkey: string | null,
) {
  return useQuery({
    queryKey: [
      "mac-assistant-enrolment",
      context?.channelId,
      identityPubkey,
      bridgePubkey,
    ],
    enabled: Boolean(context && identityPubkey && bridgePubkey),
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!context || !bridgePubkey) return null;
      const events = await relayClient.fetchEvents({
        kinds: [KIND_MAC_ASSISTANT_ENROLMENT_REQUEST],
        authors: [bridgePubkey],
        "#h": [context.channelId],
        "#p": [identityPubkey],
        limit: 20,
      });
      const consumed = new Set(
        events
          .map((event) => {
            try {
              const content = JSON.parse(event.content) as {
                request_id?: unknown;
              };
              return typeof content.request_id === "string" &&
                localStorage.getItem(
                  `${CONSUMED_PREFIX}:${identityPubkey}:${content.request_id}`,
                )
                ? content.request_id
                : null;
            } catch {
              return null;
            }
          })
          .filter((value): value is string => value !== null),
      );
      return selectCurrentMacAssistantEnrolmentRequest(
        events,
        {
          bridgePubkey,
          identityPubkey,
          channelId: context.channelId,
          userId: String(context.user.id),
          userName: context.user.name,
        },
        consumed,
      );
    },
  });
}
