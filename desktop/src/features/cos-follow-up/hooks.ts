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
  resolveAcceptedCosFollowUpProjection,
  type SeenActionableItem,
  stateLabel,
} from "@/features/cos-follow-up/lib/cosFollowUp";
import { sendDesktopNotification } from "@/features/notifications/lib/desktop";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_COS_FOLLOW_UP_ITEM,
  KIND_COS_FOLLOW_UP_RECEIPT,
  KIND_DELETION,
} from "@/shared/constants/kinds";

export const cosFollowUpQueryKey = (pubkey: string, relayScope = "") =>
  ["cos-follow-up", relayScope, pubkey.toLowerCase()] as const;

const NOTIFICATION_STORAGE_PREFIX = "buzz.cos-follow-up.seen.v1";
const RECEIPT_WAIT_MS = 45_000;
const RECEIPT_POLL_MS = 750;

function notificationStorageKey(pubkey: string, relayScope: string) {
  return `${NOTIFICATION_STORAGE_PREFIX}:${relayScope}:${pubkey.toLowerCase()}`;
}

function loadSeen(
  pubkey: string,
  relayScope: string,
): Record<string, SeenActionableItem> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(notificationStorageKey(pubkey, relayScope)) ?? "{}",
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
  relayScope: string,
  seen: Record<string, SeenActionableItem>,
) {
  localStorage.setItem(
    notificationStorageKey(pubkey, relayScope),
    JSON.stringify(seen),
  );
}

async function fetchItems(pubkey: string) {
  const events = await relayClient.fetchEvents({
    kinds: [KIND_COS_FOLLOW_UP_ITEM],
    "#p": [pubkey.toLowerCase()],
    limit: 500,
  });
  return projectLatestCosFollowUpItems(events, pubkey);
}

export function useCosFollowUpQuery(pubkey?: string, relayScope = "") {
  const normalizedPubkey = pubkey?.trim().toLowerCase() ?? "";
  return useQuery({
    queryKey: cosFollowUpQueryKey(normalizedPubkey, relayScope),
    queryFn: () => fetchItems(normalizedPubkey),
    enabled: normalizedPubkey.length > 0,
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
export function useCosFollowUpSync(pubkey?: string, relayScope = "") {
  const normalizedPubkey = pubkey?.trim().toLowerCase() ?? "";
  const queryClient = useQueryClient();
  const query = useCosFollowUpQuery(normalizedPubkey, relayScope);
  const initializedRef = React.useRef(false);
  const seenRef = React.useRef<Record<string, SeenActionableItem>>({});
  const deletionChannelScope = React.useMemo(
    () => [...new Set((query.data ?? []).map((item) => item.channelId))].sort(),
    [query.data],
  );

  React.useEffect(() => {
    initializedRef.current = false;
    seenRef.current =
      normalizedPubkey.length > 0 ? loadSeen(normalizedPubkey, relayScope) : {};
  }, [normalizedPubkey, relayScope]);

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
    saveSeen(normalizedPubkey, relayScope, seenRef.current);
    initializedRef.current = true;
  }, [normalizedPubkey, query.data, relayScope]);

  const handleItem = React.useEffectEvent((event: RelayEvent) => {
    let item: CosFollowUpItem;
    try {
      item = parseCosFollowUpItem(event, normalizedPubkey);
    } catch {
      return;
    }
    queryClient.setQueryData<CosFollowUpItem[]>(
      cosFollowUpQueryKey(normalizedPubkey, relayScope),
      (current = []) =>
        [item, ...current.filter((value) => value.id !== item.id)].sort(
          (left, right) =>
            right.createdAt - left.createdAt || left.id.localeCompare(right.id),
        ),
    );

    const previous = seenRef.current[item.id];
    const shouldNotify = isNewlyActionableTransition(previous, item);
    seenRef.current[item.id] = {
      eventId: item.eventId,
      state: item.state,
    };
    saveSeen(normalizedPubkey, relayScope, seenRef.current);
    if (shouldNotify) {
      void sendDesktopNotification({
        title: stateLabel(item.state),
        body: item.title,
      });
    }
  });

  const handleRemoval = React.useEffectEvent((event: RelayEvent) => {
    let removal: ReturnType<typeof parseCosFollowUpRemoval>;
    try {
      removal = parseCosFollowUpRemoval(event);
    } catch {
      return;
    }
    queryClient.setQueryData<CosFollowUpItem[]>(
      cosFollowUpQueryKey(normalizedPubkey, relayScope),
      (current = []) =>
        current.filter(
          (item) =>
            item.channelId !== removal.channelId ||
            item.id !== removal.itemId ||
            item.eventId !== removal.targetEventId,
        ),
    );
    delete seenRef.current[removal.itemId];
    saveSeen(normalizedPubkey, relayScope, seenRef.current);
  });

  React.useEffect(() => {
    if (normalizedPubkey.length === 0) return;
    let disposed = false;
    const unsubscribers: Array<() => Promise<void>> = [];
    const subscriptions = [
      relayClient.subscribeLive(
        {
          kinds: [KIND_COS_FOLLOW_UP_ITEM],
          "#p": [normalizedPubkey],
          limit: 0,
        },
        handleItem,
      ),
      ...deletionChannelScope.map((channelId) =>
        relayClient.subscribeLive(
          {
            kinds: [KIND_DELETION],
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
        queryKey: cosFollowUpQueryKey(normalizedPubkey, relayScope),
      });
    });
    return () => {
      disposed = true;
      unsubscribeReconnect();
      for (const unsubscribe of unsubscribers) {
        void unsubscribe().catch(() => {});
      }
    };
  }, [deletionChannelScope, normalizedPubkey, queryClient, relayScope]);
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
    "#h": [item.channelId],
    "#e": [commandId],
    limit: 20,
  });
  return receipts
    .filter((event) => event.id !== ignoredReceiptId)
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
        items: await fetchItems(pubkey),
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
        items: await fetchItems(pubkey),
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

export function useSubmitCosFollowUpAction(pubkey?: string, relayScope = "") {
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
        cosFollowUpQueryKey(normalizedPubkey, relayScope),
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
