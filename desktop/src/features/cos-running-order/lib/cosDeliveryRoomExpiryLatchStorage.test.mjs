import assert from "node:assert/strict";
import test from "node:test";

import {
  COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_GENERATIONS,
  COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_SCOPES,
  COS_DELIVERY_ROOM_EXPIRY_LATCH_STORAGE_KEY,
  cosDeliveryRoomExpiryLatchScope,
  latchCosDeliveryRoomGenerationExpiry,
  readCosDeliveryRoomGenerationExpiry,
} from "./cosDeliveryRoomExpiryLatchStorage.ts";

const USER_A = "a".repeat(64);
const USER_B = "b".repeat(64);
const SOURCE_A = "wss://delivery-a.example.test/relay";
const SOURCE_B = "wss://delivery-b.example.test/relay";

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  removeItem(key) {
    this.#values.delete(key);
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  raw(key) {
    return this.#values.get(key);
  }
}

function generation(index) {
  return index.toString(16).padStart(64, "0");
}

test("expired generations are isolated by canonical source and user", () => {
  const storage = new MemoryStorage();
  const scopeA = cosDeliveryRoomExpiryLatchScope(SOURCE_A, USER_A);
  const otherUser = cosDeliveryRoomExpiryLatchScope(SOURCE_A, USER_B);
  const otherSource = cosDeliveryRoomExpiryLatchScope(SOURCE_B, USER_A);
  assert.ok(scopeA);
  assert.ok(otherUser);
  assert.ok(otherSource);
  assert.notEqual(scopeA, otherUser);
  assert.notEqual(scopeA, otherSource);

  assert.equal(
    latchCosDeliveryRoomGenerationExpiry(storage, scopeA, generation(1)),
    "latched",
  );
  assert.equal(
    readCosDeliveryRoomGenerationExpiry(storage, scopeA, generation(1)),
    "latched",
  );
  assert.equal(
    readCosDeliveryRoomGenerationExpiry(storage, otherUser, generation(1)),
    "clear",
  );
  assert.equal(
    readCosDeliveryRoomGenerationExpiry(storage, otherSource, generation(1)),
    "clear",
  );
});

test("malformed or unavailable persistence fails closed without throwing", () => {
  const scope = cosDeliveryRoomExpiryLatchScope(SOURCE_A, USER_A);
  assert.ok(scope);
  const malformed = new MemoryStorage();
  malformed.setItem(COS_DELIVERY_ROOM_EXPIRY_LATCH_STORAGE_KEY, "{not-json");
  assert.equal(
    readCosDeliveryRoomGenerationExpiry(malformed, scope, generation(1)),
    "unavailable",
  );
  assert.equal(
    latchCosDeliveryRoomGenerationExpiry(malformed, scope, generation(1)),
    "unavailable",
  );

  const unavailable = {
    getItem() {
      throw new Error("session storage denied");
    },
    setItem() {
      throw new Error("session storage denied");
    },
  };
  assert.equal(
    readCosDeliveryRoomGenerationExpiry(unavailable, scope, generation(1)),
    "unavailable",
  );
  assert.equal(
    latchCosDeliveryRoomGenerationExpiry(unavailable, scope, generation(1)),
    "unavailable",
  );
});

test("generation capacity is bounded and overflow blocks the scope", () => {
  const storage = new MemoryStorage();
  const scope = cosDeliveryRoomExpiryLatchScope(SOURCE_A, USER_A);
  assert.ok(scope);
  for (
    let index = 0;
    index < COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_GENERATIONS;
    index += 1
  ) {
    assert.equal(
      latchCosDeliveryRoomGenerationExpiry(storage, scope, generation(index)),
      "latched",
    );
  }
  assert.equal(
    latchCosDeliveryRoomGenerationExpiry(
      storage,
      scope,
      generation(COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_GENERATIONS),
    ),
    "latched",
  );
  const persisted = JSON.parse(
    storage.raw(COS_DELIVERY_ROOM_EXPIRY_LATCH_STORAGE_KEY),
  );
  assert.equal(persisted.scopes.length, 1);
  assert.equal(
    persisted.scopes[0].generations.length,
    COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_GENERATIONS,
  );
  assert.equal(persisted.scopes[0].blocked, true);
  assert.equal(
    readCosDeliveryRoomGenerationExpiry(storage, scope, generation(999)),
    "latched",
  );
});

test("scope capacity is bounded and overflow fails closed globally", () => {
  const storage = new MemoryStorage();
  for (
    let index = 0;
    index < COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_SCOPES;
    index += 1
  ) {
    const scope = cosDeliveryRoomExpiryLatchScope(
      `wss://delivery-${index}.example.test/relay`,
      USER_A,
    );
    assert.ok(scope);
    assert.equal(
      latchCosDeliveryRoomGenerationExpiry(storage, scope, generation(index)),
      "latched",
    );
  }
  const overflowScope = cosDeliveryRoomExpiryLatchScope(
    "wss://delivery-overflow.example.test/relay",
    USER_A,
  );
  assert.ok(overflowScope);
  assert.equal(
    latchCosDeliveryRoomGenerationExpiry(
      storage,
      overflowScope,
      generation(999),
    ),
    "latched",
  );
  const persisted = JSON.parse(
    storage.raw(COS_DELIVERY_ROOM_EXPIRY_LATCH_STORAGE_KEY),
  );
  assert.equal(
    persisted.scopes.length,
    COS_DELIVERY_ROOM_EXPIRY_LATCH_MAX_SCOPES,
  );
  assert.equal(persisted.blocked, true);

  const firstScope = cosDeliveryRoomExpiryLatchScope(SOURCE_A, USER_A);
  assert.ok(firstScope);
  assert.equal(
    readCosDeliveryRoomGenerationExpiry(storage, firstScope, generation(1000)),
    "latched",
  );
});

test("invalid scope and generation identifiers fail closed", () => {
  const storage = new MemoryStorage();
  assert.equal(
    cosDeliveryRoomExpiryLatchScope("not-a-relay", USER_A),
    undefined,
  );
  assert.equal(
    cosDeliveryRoomExpiryLatchScope(SOURCE_A, "short-pubkey"),
    undefined,
  );
  assert.equal(
    readCosDeliveryRoomGenerationExpiry(storage, "", generation(1)),
    "unavailable",
  );
  assert.equal(
    readCosDeliveryRoomGenerationExpiry(storage, "[]", "not-a-digest"),
    "unavailable",
  );
});
