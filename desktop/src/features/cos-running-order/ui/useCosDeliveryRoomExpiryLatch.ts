import * as React from "react";

export function useCosDeliveryRoomExpiryLatch(
  generationId: string | undefined,
  semanticExpiry: number | undefined,
): boolean {
  const [expiredGenerationIds, setExpiredGenerationIds] = React.useState<
    ReadonlySet<string>
  >(() => new Set());

  React.useEffect(() => {
    if (semanticExpiry === undefined || generationId === undefined) return;

    const checkFreshness = () => {
      if (Date.now() < semanticExpiry) return false;
      setExpiredGenerationIds((current) => {
        if (current.has(generationId)) return current;
        const next = new Set(current);
        next.add(generationId);
        return next;
      });
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
  }, [generationId, semanticExpiry]);

  return generationId ? expiredGenerationIds.has(generationId) : false;
}
