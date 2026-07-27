import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveShellRoute,
  shouldBounceForChannelNotification,
} from "./AppShell.helpers.ts";

test("shouldBounceForChannelNotification_allowsTopLevelChannelMessages", () => {
  assert.equal(shouldBounceForChannelNotification([["h", "channel"]]), true);
});

test("shouldBounceForChannelNotification_suppressesThreadReplies", () => {
  assert.equal(
    shouldBounceForChannelNotification([
      ["h", "channel"],
      ["e", "root", "", "reply"],
    ]),
    false,
  );
});

test("shouldBounceForChannelNotification_allowsBroadcastReplies", () => {
  assert.equal(
    shouldBounceForChannelNotification([
      ["h", "channel"],
      ["e", "root", "", "reply"],
      ["broadcast", "1"],
    ]),
    true,
  );
});

test("deriveShellRoute selects the COS running order", () => {
  assert.deepEqual(deriveShellRoute("/running-order"), {
    selectedChannelId: null,
    selectedView: "running-order",
  });
});
