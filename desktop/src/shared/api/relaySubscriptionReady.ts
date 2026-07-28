const COMPATIBILITY_FALLBACK_MS = 250;

export function createLiveSubscriptionReady(
  requireEose: boolean,
  strictTimeoutMs: number,
) {
  let timeout: number;
  let resolveReady = () => {};
  let rejectReady = (_error: Error) => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    rejectReady = (error) => {
      window.clearTimeout(timeout);
      reject(error);
    };
    timeout = window.setTimeout(
      () =>
        requireEose
          ? rejectReady(
              new Error(
                "Timed out waiting for relay subscription acknowledgement.",
              ),
            )
          : resolveReady(),
      requireEose ? strictTimeoutMs : COMPATIBILITY_FALLBACK_MS,
    );
  });
  return {
    cancelReady: () => window.clearTimeout(timeout),
    ready,
    rejectReady,
    resolveReady,
  };
}
