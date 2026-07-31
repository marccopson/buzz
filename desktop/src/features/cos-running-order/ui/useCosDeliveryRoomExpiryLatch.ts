import * as React from "react";

import {
  latchCosDeliveryRoomGenerationExpiry,
  readCosDeliveryRoomGenerationExpiry,
} from "@/features/cos-running-order/lib/cosDeliveryRoomExpiryLatchStorage";

function deliveryRoomSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function useCosDeliveryRoomExpiryLatch(
  scope: string | undefined,
  generationId: string | undefined,
  semanticExpiry: number | undefined,
): boolean {
  const [, forcePersistenceRead] = React.useReducer(
    (revision) => revision + 1,
    0,
  );
  const storage = deliveryRoomSessionStorage();
  const persistedStatus = generationId
    ? readCosDeliveryRoomGenerationExpiry(storage, scope, generationId)
    : "clear";
  const evidenceExpired = Boolean(
    generationId &&
      (semanticExpiry === undefined ||
        persistedStatus !== "clear" ||
        Date.now() >= semanticExpiry),
  );

  React.useEffect(() => {
    if (
      semanticExpiry === undefined ||
      generationId === undefined ||
      persistedStatus !== "clear"
    ) {
      return;
    }

    const checkFreshness = () => {
      if (Date.now() < semanticExpiry) return false;
      latchCosDeliveryRoomGenerationExpiry(storage, scope, generationId);
      forcePersistenceRead();
      return true;
    };
    let timer: number | undefined;
    const scheduleCheck = () => {
      const remainingMs = Math.max(semanticExpiry - Date.now(), 0);
      timer = window.setTimeout(
        () => {
          if (!checkFreshness()) scheduleCheck();
        },
        Math.min(remainingMs, 2_147_483_647),
      );
    };
    scheduleCheck();
    window.addEventListener("focus", checkFreshness);
    document.addEventListener("visibilitychange", checkFreshness);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", checkFreshness);
      document.removeEventListener("visibilitychange", checkFreshness);
    };
  }, [generationId, persistedStatus, scope, semanticExpiry, storage]);

  return evidenceExpired;
}
