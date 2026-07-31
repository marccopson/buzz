const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const MAX_SOURCE_LENGTH = 2_048;
const MAX_SCOPE_LENGTH = 2_128;
const MAX_SERIALIZED_LENGTH = 64 * 1_024;
const STORAGE_VERSION = 1;

export const COS_DELIVERY_ROOM_EXPIRY_LATCH_STORAGE_KEY =
  "buzz:cos-delivery-room-expiry-latch.v1";
export const COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_SCOPES = 8;
export const COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_GENERATIONS = 64;

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;
export type CosDeliveryRoomExpiryLatchStatus =
  | "clear"
  | "latched"
  | "unavailable";

type PersistedScope = {
  blocked: boolean;
  generations: string[];
  scope: string;
};

type PersistedState = {
  blocked: boolean;
  scopes: PersistedScope[];
  version: 1;
};

const storageAvailability = new WeakMap<object, boolean>();
const STORAGE_PROBE_KEY = `${COS_DELIVERY_ROOM_EXPIRY_LATCH_STORAGE_KEY}.probe`;

function emptyState(): PersistedState {
  return { blocked: false, scopes: [], version: STORAGE_VERSION };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === keys.length &&
    actualKeys.every((key, index) => key === keys[index])
  );
}

function canonicalRelaySource(source: string): string | undefined {
  if (source.length === 0 || source.length > MAX_SOURCE_LENGTH)
    return undefined;
  try {
    const url = new URL(source);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return undefined;
    if (url.username || url.password || url.search || url.hash)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function cosDeliveryRoomExpiryLatchScope(
  source: string | undefined,
  userPubkey: string | undefined,
): string | undefined {
  if (!source || !userPubkey) return undefined;
  const canonicalSource = canonicalRelaySource(source);
  const canonicalPubkey = userPubkey.toLowerCase();
  if (!canonicalSource || !DIGEST_PATTERN.test(canonicalPubkey))
    return undefined;
  const scope = JSON.stringify([canonicalSource, canonicalPubkey]);
  return scope.length <= MAX_SCOPE_LENGTH ? scope : undefined;
}

function isCanonicalScope(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_SCOPE_LENGTH)
    return false;
  try {
    const decoded: unknown = JSON.parse(value);
    if (!Array.isArray(decoded) || decoded.length !== 2) return false;
    if (typeof decoded[0] !== "string" || typeof decoded[1] !== "string") {
      return false;
    }
    return cosDeliveryRoomExpiryLatchScope(decoded[0], decoded[1]) === value;
  } catch {
    return false;
  }
}

function isGenerationId(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function parseState(raw: string | null): PersistedState | undefined {
  if (raw === null) return emptyState();
  if (raw.length > MAX_SERIALIZED_LENGTH) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["blocked", "scopes", "version"]) ||
      value.version !== STORAGE_VERSION ||
      typeof value.blocked !== "boolean" ||
      !Array.isArray(value.scopes) ||
      value.scopes.length > COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_SCOPES
    ) {
      return undefined;
    }
    const scopes: PersistedScope[] = [];
    const seenScopes = new Set<string>();
    for (const candidate of value.scopes) {
      if (
        !isRecord(candidate) ||
        !hasExactKeys(candidate, ["blocked", "generations", "scope"]) ||
        typeof candidate.blocked !== "boolean" ||
        !isCanonicalScope(candidate.scope) ||
        !Array.isArray(candidate.generations) ||
        candidate.generations.length >
          COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_GENERATIONS ||
        seenScopes.has(candidate.scope)
      ) {
        return undefined;
      }
      const generations = candidate.generations;
      if (
        generations.some((generation) => !isGenerationId(generation)) ||
        new Set(generations).size !== generations.length
      ) {
        return undefined;
      }
      seenScopes.add(candidate.scope);
      scopes.push({
        blocked: candidate.blocked,
        generations: [...generations],
        scope: candidate.scope,
      });
    }
    return { blocked: value.blocked, scopes, version: STORAGE_VERSION };
  } catch {
    return undefined;
  }
}

function storageIsAvailable(storage: StorageLike): boolean {
  const key = storage as object;
  const known = storageAvailability.get(key);
  if (known !== undefined) return known;
  try {
    const previous = storage.getItem(STORAGE_PROBE_KEY);
    storage.setItem(STORAGE_PROBE_KEY, "1");
    if (previous === null) storage.removeItem(STORAGE_PROBE_KEY);
    else storage.setItem(STORAGE_PROBE_KEY, previous);
    storageAvailability.set(key, true);
    return true;
  } catch {
    storageAvailability.set(key, false);
    return false;
  }
}

function readState(
  storage: StorageLike | undefined,
): PersistedState | undefined {
  if (!storage || !storageIsAvailable(storage)) return undefined;
  try {
    return parseState(
      storage.getItem(COS_DELIVERY_ROOM_EXPIRY_LATCH_STORAGE_KEY),
    );
  } catch {
    storageAvailability.set(storage as object, false);
    return undefined;
  }
}

function persistState(storage: StorageLike, state: PersistedState): boolean {
  try {
    const serialized = JSON.stringify(state);
    if (serialized.length > MAX_SERIALIZED_LENGTH) {
      storageAvailability.set(storage as object, false);
      return false;
    }
    storage.setItem(COS_DELIVERY_ROOM_EXPIRY_LATCH_STORAGE_KEY, serialized);
    return true;
  } catch {
    storageAvailability.set(storage as object, false);
    return false;
  }
}

export function readCosDeliveryRoomGenerationExpiry(
  storage: StorageLike | undefined,
  scope: string | undefined,
  generationId: string | undefined,
): CosDeliveryRoomExpiryLatchStatus {
  if (!isCanonicalScope(scope) || !isGenerationId(generationId)) {
    return "unavailable";
  }
  const state = readState(storage);
  if (!state) return "unavailable";
  if (state.blocked) return "latched";
  const persistedScope = state.scopes.find(
    (candidate) => candidate.scope === scope,
  );
  if (!persistedScope) return "clear";
  return persistedScope.blocked ||
    persistedScope.generations.includes(generationId)
    ? "latched"
    : "clear";
}

export function latchCosDeliveryRoomGenerationExpiry(
  storage: StorageLike | undefined,
  scope: string | undefined,
  generationId: string | undefined,
): CosDeliveryRoomExpiryLatchStatus {
  if (!storage || !isCanonicalScope(scope) || !isGenerationId(generationId)) {
    return "unavailable";
  }
  const state = readState(storage);
  if (!state) return "unavailable";
  if (state.blocked) return "latched";

  const persistedScope = state.scopes.find(
    (candidate) => candidate.scope === scope,
  );
  if (!persistedScope) {
    if (state.scopes.length >= COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_SCOPES) {
      state.blocked = true;
    } else {
      state.scopes.push({
        blocked: false,
        generations: [generationId],
        scope,
      });
    }
  } else if (
    !persistedScope.blocked &&
    !persistedScope.generations.includes(generationId)
  ) {
    if (
      persistedScope.generations.length >=
      COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_GENERATIONS
    ) {
      persistedScope.blocked = true;
    } else {
      persistedScope.generations.push(generationId);
    }
  }

  return persistState(storage, state) ? "latched" : "unavailable";
}
