import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCosFollowUpCommandInput,
  isCosFollowUpActionPermitted,
  isNewlyActionableTransition,
  parseCosFollowUpItem,
  parseCosFollowUpReceipt,
  projectLatestCosFollowUpItems,
  resolveAcceptedCosFollowUpProjection,
} from "./cosFollowUp.ts";

const pubkey = "a".repeat(64);
const channel = "550e8400-e29b-41d4-a716-446655440000";

function itemEvent({
  eventId = "1".repeat(64),
  author = "b".repeat(64),
  state = "needs-answer",
  version = 1,
  actions = ["answer"],
} = {}) {
  return {
    id: eventId,
    pubkey: author,
    created_at: version,
    kind: 37010,
    tags: [
      ["h", channel],
      ["d", "item-42"],
      ["p", pubkey],
    ],
    content: JSON.stringify({
      schema: "mac-workspace/cos-follow-up/v1",
      id: "item-42",
      jira_key: "COS-683",
      title: "Confirm the wording",
      question_evidence: {
        question: "Is this right?",
        evidence: "Transcript line 19",
      },
      state,
      assigned_person: { id: 7, name: "Marc" },
      named_confirmer: { id: 7, name: "Marc" },
      version,
      permitted_actions: actions,
      timestamps: { updated_at: "2026-07-27T08:00:00Z" },
      deep_links: {
        meeting_follow_up:
          "https://workspace.example/ops/meeting-follow-up?item_id=item-42",
        jira: "https://jira.example/browse/COS-683",
        sources: [
          { label: "Transcript", url: "https://example.test/transcript#L19" },
        ],
      },
    }),
    sig: "c".repeat(128),
  };
}

test("parser pins p, d, machine state and evidence sources", () => {
  const item = parseCosFollowUpItem(itemEvent(), pubkey);
  assert.equal(item.id, "item-42");
  assert.equal(item.state, "needs-answer");
  assert.equal(item.deepLinks.sources[0].label, "Transcript");
  assert.throws(() =>
    parseCosFollowUpItem(
      {
        ...itemEvent(),
        tags: [
          ["h", channel],
          ["d", "wrong"],
          ["p", pubkey],
        ],
      },
      pubkey,
    ),
  );
});

test("projection keeps the highest authoritative version", () => {
  const latest = projectLatestCosFollowUpItems(
    [
      itemEvent(),
      itemEvent({
        eventId: "2".repeat(64),
        state: "ready-to-check",
        version: 2,
        actions: ["confirm", "reject"],
      }),
    ],
    pubkey,
    "b".repeat(64),
  );
  assert.equal(latest.length, 1);
  assert.equal(latest[0].version, 2);
  assert.equal(latest[0].state, "ready-to-check");
});

test("projection ignores a higher version outside the trusted bridge mapping", () => {
  const trustedBridge = "b".repeat(64);
  const latest = projectLatestCosFollowUpItems(
    [
      itemEvent({ author: trustedBridge, version: 2 }),
      itemEvent({
        author: "d".repeat(64),
        eventId: "9".repeat(64),
        state: "ready-to-check",
        version: 99,
        actions: ["confirm", "reject"],
      }),
    ],
    pubkey,
    trustedBridge,
  );
  assert.equal(latest.length, 1);
  assert.equal(latest[0].authorPubkey, trustedBridge);
  assert.equal(latest[0].version, 2);
});

test("permissions and command tags bind the exact item version", () => {
  const item = parseCosFollowUpItem(itemEvent(), pubkey);
  assert.equal(isCosFollowUpActionPermitted(item, "answer"), true);
  assert.equal(isCosFollowUpActionPermitted(item, "confirm"), false);
  const command = buildCosFollowUpCommandInput({
    item,
    action: "answer",
    answer: "Yes",
  });
  assert.deepEqual(command.tags, [
    ["h", channel],
    ["item", "item-42"],
    ["action", "answer"],
    ["expected-version", "1"],
    ["e", "1".repeat(64)],
  ]);
});

test("notifications dedupe duplicate delivery and same-state refresh", () => {
  const first = parseCosFollowUpItem(itemEvent(), pubkey);
  assert.equal(isNewlyActionableTransition(undefined, first), true);
  assert.equal(
    isNewlyActionableTransition(
      { eventId: first.eventId, state: first.state },
      first,
    ),
    false,
  );
  const sameStateRefresh = parseCosFollowUpItem(
    itemEvent({ eventId: "2".repeat(64), version: 2 }),
    pubkey,
  );
  assert.equal(
    isNewlyActionableTransition(
      { eventId: first.eventId, state: first.state },
      sameStateRefresh,
    ),
    false,
  );
  const ready = parseCosFollowUpItem(
    itemEvent({
      eventId: "3".repeat(64),
      state: "ready-to-check",
      version: 3,
      actions: ["confirm", "reject"],
    }),
    pubkey,
  );
  assert.equal(
    isNewlyActionableTransition(
      { eventId: sameStateRefresh.eventId, state: sameStateRefresh.state },
      ready,
    ),
    true,
  );
});

test("failed retryable receipt is parsed without implying an item advance", () => {
  const receipt = parseCosFollowUpReceipt({
    id: "4".repeat(64),
    pubkey: "b".repeat(64),
    created_at: 4,
    kind: 47011,
    tags: [
      ["h", channel],
      ["e", "3".repeat(64)],
      ["item", "item-42"],
      ["outcome", "failed"],
      ["version", "1"],
    ],
    content: JSON.stringify({
      schema: "mac-workspace/cos-follow-up/v1",
      message: "Try again",
      code: "cos_unavailable",
      retryable: true,
    }),
    sig: "c".repeat(128),
  });
  assert.equal(receipt.outcome, "failed");
  assert.equal(receipt.retryable, true);
  assert.equal(receipt.authoritativeVersion, 1);
});

test("rejects unsafe projected deep links", () => {
  const event = itemEvent();
  const content = JSON.parse(event.content);
  content.deep_links.meeting_follow_up = "javascript:alert(1)";
  assert.throws(
    () =>
      parseCosFollowUpItem(
        { ...event, content: JSON.stringify(content) },
        pubkey,
      ),
    /HTTPS/,
  );
});

test("accepted answer may resolve through authoritative removal", () => {
  const item = parseCosFollowUpItem(itemEvent(), pubkey);
  const receipt = parseCosFollowUpReceipt({
    id: "4".repeat(64),
    pubkey: "b".repeat(64),
    created_at: 4,
    kind: 47011,
    tags: [
      ["h", channel],
      ["e", "3".repeat(64)],
      ["item", item.id],
      ["outcome", "accepted"],
      ["version", "2"],
    ],
    content: JSON.stringify({
      schema: "mac-workspace/cos-follow-up/v1",
      retryable: false,
    }),
    sig: "c".repeat(128),
  });
  assert.deepEqual(
    resolveAcceptedCosFollowUpProjection({
      receipt,
      action: "answer",
      itemId: item.id,
      items: [],
    }),
    { status: "removed" },
  );
});
