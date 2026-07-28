import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  buildCosFollowUpCommandInput,
  type CosFollowUpHumanAction,
  type CosFollowUpItem,
  isNewlyActionableTransition,
  parseCosFollowUpItem,
  parseCosFollowUpReceipt,
  parseCosFollowUpRemoval,
  projectLatestCosFollowUpItems,
  retainLatestCosFollowUpItem,
  resolveAcceptedCosFollowUpProjection,
  type SeenActionableItem,
  stateLabel,
} from "@/features/cos-follow-up/lib/cosFollowUp";
import type { Community } from "@/features/communities/types";
import { sendDesktopNotification } from "@/features/notifications/lib/desktop";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { getCosFollowUpBridgePubkey } from "@/shared/api/tauriIdentityArchive";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_COS_FOLLOW_UP_ITEM,
  KIND_COS_FOLLOW_UP_RECEIPT,
  KIND_DELETION,
} from "@/shared/constants/kinds";

export const cosFollowUpCommunityScope = (
  community: Pick<Community, "id"> | null | undefined,
) => community?.id ?? "";

export const cosFollowUpQueryKey = (pubkey: string, communityScope = "") =>
  ["cos-follow-up", communityScope, pubkey.toLowerCase()] as const;

const NOTIFICATION_STORAGE_PREFIX = "buzz.cos-follow-up.seen.v1";
const RECEIPT_WAIT_MS = 45_000;
const RECEIPT_POLL_MS = 750;

async function fetchCosFollowUpAuthority() {
  try {
    return await getCosFollowUpBridgePubkey();
  } catch {
    return null;
  }
}

function notificationStorageKey(pubkey: string, communityScope: string) {
  return `${NOTIFICATION_STORAGE_PREFIX}:${communityScope}:${pubkey.toLowerCase()}`;
}

function loadSeen(
  pubkey: string,
  communityScope: string,
): Record<string, SeenActionableItem> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(notificationStorageKey(pubkey, communityScope)) ??
        "{}",
    ) as unknown;
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, SeenActionableItem>)
      : {};
  } catch {
    return {};
  }
}

function saveSeen(
  pubkey: string,
  communityScope: string,
  seen: Record<string, SeenActionableItem>,
) {
  localStorage.setItem(
    notificationStorageKey(pubkey, communityScope),
    JSON.stringify(seen),
  );
}

async function fetchItems(pubkey: string, trustedBridgePubkey: string) {
  const events = await relayClient.fetchEvents({
    kinds: [KIND_COS_FOLLOW_UP_ITEM],
    authors: [trustedBridgePubkey],
    "#p": [pubkey.toLowerCase()],
    limit: 500,
  });
  return projectLatestCosFollowUpItems(events, pubkey, trustedBridgePubkey);
}

export function useCosFollowUpQuery(pubkey?: string, communityScope = "") {
  const normalizedPubkey = pubkey?.trim().toLowerCase() ?? "";
  const authority = useQuery({
    queryKey: ["cos-follow-up-authority", communityScope],
    queryFn: fetchCosFollowUpAuthority,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return useQuery({
    queryKey: cosFollowUpQueryKey(normalizedPubkey, communityScope),
    queryFn: () =>
      authority.data
        ? fetchItems(normalizedPubkey, authority.data)
        : Promise.resolve([]),
    enabled: normalizedPubkey.length > 0 && authority.isSuccess,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

/**
 * App-root catch-up/live coordinator.
 *
 * Initial history seeds notification state without replaying a backlog. Live
 * item state transitions notify once; duplicate delivery and same-state
 * version refreshes update the cache without another notification.
 */
export function useCosFollowUpSync(pubkey?: string, communityScope = "") {
  const normalizedPubkey = pubkey?.trim().toLowerCase() ?? "";
  const queryClient = useQueryClient();
  const authority = useQuery({
    queryKey: ["cos-follow-up-authority", communityScope],
    queryFn: fetchCosFollowUpAuthority,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const trustedBridgePubkey = authority.data ?? "";
  const query = useCosFollowUpQuery(normalizedPubkey, communityScope);
  const initializedRef = React.useRef(false);
  const seenRef = React.useRef<Record<string, SeenActionableItem>>({});
  const deletionChannelScope = React.useMemo(
    () => [...new Set((query.data ?? []).map((item) => item.channelId))].sort(),
    [query.data],
  );

  React.useEffect(() => {
    initializedRef.current = false;
    seenRef.current =
      normalizedPubkey.length > 0
        ? loadSeen(normalizedPubkey, communityScope)
        : {};
  }, [communityScope, normalizedPubkey]);

  React.useEffect(() => {
    if (
      normalizedPubkey.length === 0 ||
      initializedRef.current ||
      !query.data
    ) {
      return;
    }
    for (const item of query.data) {
      seenRef.current[item.id] = {
        eventId: item.eventId,
        state: item.state,
      };
    }
    saveSeen(normalizedPubkey, communityScope, seenRef.current);
    initializedRef.current = true;
  }, [communityScope, normalizedPubkey, query.data]);

  const handleItem = React.useEffectEvent((event: RelayEvent) => {
    if (event.pubkey.toLowerCase() !== trustedBridgePubkey) return;
    let item: CosFollowUpItem;
    try {
      item = parseCosFollowUpItem(event, normalizedPubkey);
    } catch {
      return;
    }
    let retainedItem: CosFollowUpItem | undefined;
    queryClient.setQueryData<CosFollowUpItem[]>(
      cosFollowUpQueryKey(normalizedPubkey, communityScope),
      (current = []) => {
        const previousProjection = current.find(
          (value) => value.id === item.id,
        );
        retainedItem = retainLatestCosFollowUpItem(previousProjection, item);
        if (retainedItem === previousProjection) return current;
        return [
          retainedItem,
          ...current.filter((value) => value.id !== item.id),
        ].sort(
          (left, right) =>
            right.createdAt - left.createdAt || left.id.localeCompare(right.id),
        );
      },
    );
    if (!retainedItem || retainedItem.eventId !== item.eventId) return;

    const previous = seenRef.current[retainedItem.id];
    const shouldNotify = isNewlyActionableTransition(previous, retainedItem);
    seenRef.current[retainedItem.id] = {
      eventId: retainedItem.eventId,
      state: retainedItem.state,
    };
    saveSeen(normalizedPubkey, communityScope, seenRef.current);
    if (shouldNotify) {
      void sendDesktopNotification({
        title: stateLabel(retainedItem.state),
        body: retainedItem.title,
      });
    }
  });

  const handleRemoval = React.useEffectEvent((event: RelayEvent) => {
    if (event.pubkey.toLowerCase() !== trustedBridgePubkey) return;
    let removal: ReturnType<typeof parseCosFollowUpRemoval>;
    try {
      removal = parseCosFollowUpRemoval(event);
    } catch {
      return;
    }
    let removedCurrentProjection = false;
    queryClient.setQueryData<CosFollowUpItem[]>(
      cosFollowUpQueryKey(normalizedPubkey, communityScope),
      (current = []) =>
        current.filter((item) => {
          const matchesCurrentProjection =
            item.channelId === removal.channelId &&
            item.id === removal.itemId &&
            item.eventId === removal.targetEventId;
          removedCurrentProjection ||= matchesCurrentProjection;
          return !matchesCurrentProjection;
        }),
    );
    if (!removedCurrentProjection) return;
    delete seenRef.current[removal.itemId];
    saveSeen(normalizedPubkey, communityScope, seenRef.current);
  });

  React.useEffect(() => {
    if (normalizedPubkey.length === 0 || trustedBridgePubkey.length === 0) {
      return;
    }
    let disposed = false;
    const unsubscribers: Array<() => Promise<void>> = [];
    const subscriptions = [
      relayClient.subscribeLive(
        {
          kinds: [KIND_COS_FOLLOW_UP_ITEM],
          authors: [trustedBridgePubkey],
          "#p": [normalizedPubkey],
          limit: 0,
        },
        handleItem,
      ),
      ...deletionChannelScope.map((channelId) =>
        relayClient.subscribeLive(
          {
            kinds: [KIND_DELETION],
            authors: [trustedBridgePubkey],
            "#h": [channelId],
            limit: 0,
          },
          handleRemoval,
        ),
      ),
    ];
    void Promise.all(subscriptions)
      .then((next) => {
        if (disposed) {
          for (const unsubscribe of next) void unsubscribe().catch(() => {});
        } else {
          unsubscribers.push(...next);
        }
      })
      .catch((error) => {
        console.error("Failed to subscribe to COS follow-up events", error);
      });
    const unsubscribeReconnect = relayClient.subscribeToReconnects(() => {
      void queryClient.invalidateQueries({
        queryKey: cosFollowUpQueryKey(normalizedPubkey, communityScope),
      });
    });
    return () => {
      disposed = true;
      unsubscribeReconnect();
      for (const unsubscribe of unsubscribers) {
        void unsubscribe().catch(() => {});
      }
    };
  }, [
    communityScope,
    deletionChannelScope,
    normalizedPubkey,
    queryClient,
    trustedBridgePubkey,
  ]);
}

export function useCosFollowUpCommunitySync(
  pubkey: string | undefined,
  community: Pick<Community, "id"> | null | undefined,
) {
  useCosFollowUpSync(pubkey, cosFollowUpCommunityScope(community));
}

export class CosFollowUpSubmissionError extends Error {
  retryable: boolean;
  code: string | null;
  signedEvent: RelayEvent | null;

  constructor(
    message: string,
    retryable: boolean,
    code: string | null,
    signedEvent: RelayEvent | null = null,
  ) {
    super(message);
    this.name = "CosFollowUpSubmissionError";
    this.retryable = retryable;
    this.code = code;
    this.signedEvent = signedEvent;
  }
}

async function fetchCommandReceipt(
  commandId: string,
  item: CosFollowUpItem,
  ignoredReceiptId?: string,
) {
  const receipts = await relayClient.fetchEvents({
    kinds: [KIND_COS_FOLLOW_UP_RECEIPT],
    authors: [item.authorPubkey],
    "#h": [item.channelId],
    "#e": [commandId],
    limit: 20,
  });
  return receipts
    .filter(
      (event) =>
        event.id !== ignoredReceiptId &&
        event.pubkey.toLowerCase() === item.authorPubkey.toLowerCase(),
    )
    .sort(
      (left, right) =>
        right.created_at - left.created_at || left.id.localeCompare(right.id),
    )
    .map((event) => {
      try {
        return parseCosFollowUpReceipt(event);
      } catch {
        return null;
      }
    })
    .find((value) => value?.commandEventId === commandId);
}

async function waitForAuthoritativeItem({
  signedEvent,
  item,
  action,
  pubkey,
  ignoredReceiptId,
}: {
  signedEvent: RelayEvent;
  item: CosFollowUpItem;
  action: CosFollowUpHumanAction;
  pubkey: string;
  ignoredReceiptId?: string;
}): Promise<CosFollowUpItem | null> {
  const deadline = Date.now() + RECEIPT_WAIT_MS;
  while (Date.now() < deadline) {
    const receipt = await fetchCommandReceipt(
      signedEvent.id,
      item,
      ignoredReceiptId,
    );
    if (receipt) {
      if (receipt.outcome !== "accepted") {
        throw new CosFollowUpSubmissionError(
          receipt.message ?? "The action could not be applied",
          receipt.outcome === "failed" && receipt.retryable,
          receipt.code,
          signedEvent,
        );
      }
      const projection = resolveAcceptedCosFollowUpProjection({
        receipt,
        action,
        itemId: item.id,
        items: await fetchItems(pubkey, item.authorPubkey),
      });
      if (projection.status === "updated") return projection.item;
      if (projection.status === "removed") return null;
    }
    await new Promise((resolve) => window.setTimeout(resolve, RECEIPT_POLL_MS));
  }
  throw new CosFollowUpSubmissionError(
    "The action was sent but confirmation has not arrived. Try again.",
    true,
    "receipt_timeout",
    signedEvent,
  );
}

export async function submitCosFollowUpAction({
  item,
  action,
  answer,
  comment,
  pubkey,
  signedEvent: existingSignedEvent,
}: {
  item: CosFollowUpItem;
  action: CosFollowUpHumanAction;
  answer?: string;
  comment?: string;
  pubkey: string;
  signedEvent?: RelayEvent;
}) {
  const event =
    existingSignedEvent ??
    (await signRelayEvent(
      buildCosFollowUpCommandInput({
        item,
        action,
        answer,
        comment,
      }),
    ));
  let ignoredReceiptId: string | undefined;
  if (existingSignedEvent) {
    const reconciled = await fetchCommandReceipt(event.id, item);
    if (reconciled?.outcome === "accepted") {
      const projection = resolveAcceptedCosFollowUpProjection({
        receipt: reconciled,
        action,
        itemId: item.id,
        items: await fetchItems(pubkey, item.authorPubkey),
      });
      if (projection.status === "updated") return projection.item;
      if (projection.status === "removed") return null;
    } else if (
      reconciled &&
      !(reconciled.outcome === "failed" && reconciled.retryable)
    ) {
      throw new CosFollowUpSubmissionError(
        reconciled.message ?? "The action could not be applied",
        false,
        reconciled.code,
        event,
      );
    } else if (reconciled) {
      ignoredReceiptId = reconciled.eventId;
    }
  }
  await relayClient.publishEvent(
    event,
    "The action timed out before it reached MAC Workspace",
    "The action could not be sent",
  );
  return waitForAuthoritativeItem({
    signedEvent: event,
    item,
    action,
    pubkey,
    ignoredReceiptId,
  });
}

export function useSubmitCosFollowUpAction(
  pubkey?: string,
  communityScope = "",
) {
  const queryClient = useQueryClient();
  const normalizedPubkey = pubkey?.trim().toLowerCase() ?? "";
  return useMutation({
    mutationFn: (input: {
      item: CosFollowUpItem;
      action: CosFollowUpHumanAction;
      answer?: string;
      comment?: string;
      signedEvent?: RelayEvent;
    }) =>
      submitCosFollowUpAction({
        ...input,
        pubkey: normalizedPubkey,
      }),
    onSuccess: (authoritative, variables) => {
      queryClient.setQueryData<CosFollowUpItem[]>(
        cosFollowUpQueryKey(normalizedPubkey, communityScope),
        (current = []) =>
          authoritative
            ? [
                authoritative,
                ...current.filter((item) => item.id !== authoritative.id),
              ]
            : current.filter((item) => item.id !== variables.item.id),
      );
    },
  });
}
