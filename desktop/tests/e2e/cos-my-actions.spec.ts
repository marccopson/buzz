import { expect, type Page, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const ASSIGNEE = "deadbeef".repeat(8);
const ITEM_ID = "cos-follow-up-e2e";
const ITEM_EVENT_ID = "7".repeat(64);

async function waitForFollowUpItemSubscription(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ pubkey }) =>
          window.__BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?.({
            ownerPubkey: pubkey,
            kind: 37010,
          }) ?? false,
        { pubkey: ASSIGNEE },
      ),
    )
    .toBe(true);
}

async function emitFollowUpItem(
  page: Page,
  {
    eventId,
    state,
    title,
    version,
  }: {
    eventId: string;
    state: "needs-answer" | "ready-to-check";
    title: string;
    version: number;
  },
) {
  await page.evaluate(
    ({ assignee, eventId, itemId, state, title, version }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: JSON.stringify({
          schema: "mac-workspace/cos-follow-up/v1",
          id: itemId,
          jira_key: "COS-683",
          title,
          question_evidence: {
            question: "Did the reducer retain the authoritative version?",
            evidence: "Live relay delivery",
          },
          state,
          assigned_person: { id: 1, name: "Marc" },
          named_confirmer: null,
          version,
          permitted_actions:
            state === "needs-answer" ? ["answer"] : ["confirm", "reject"],
          timestamps: {
            created_at: "2026-07-28T06:00:00Z",
            updated_at: "2026-07-28T06:00:00Z",
            published_at: "2026-07-28T06:00:00Z",
            last_activity_at: "2026-07-28T06:00:00Z",
            answered_at: null,
            ready_to_check_at: null,
            confirmed_at: null,
            rejected_at: null,
          },
          deep_links: {
            meeting_follow_up:
              "https://workspace.example/ops/meeting-follow-up?item_id=live",
            jira: null,
            sources: [],
          },
        }),
        extraTags: [
          ["d", itemId],
          ["p", assignee],
        ],
        id: eventId,
        kind: 37010,
      });
    },
    { assignee: ASSIGNEE, eventId, itemId: ITEM_ID, state, title, version },
  );
}

async function notificationBodies(page: Page, prefix: string) {
  return page.evaluate((bodyPrefix) => {
    const testWindow = window as Window & {
      __BUZZ_E2E_NOTIFICATIONS__?: Array<{
        body: string | null;
        title: string;
      }>;
    };
    return (testWindow.__BUZZ_E2E_NOTIFICATIONS__ ?? [])
      .map((notification) => notification.body)
      .filter(
        (body): body is string =>
          typeof body === "string" && body.startsWith(bodyPrefix),
      );
  }, prefix);
}

test.describe("COS My Actions", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await installMockBridge(
      page,
      testInfo.title.includes("item-to-removal subscription handoff")
        ? { cosFollowUpRemovalSubscribeDelayMs: 500 }
        : undefined,
    );
  });

  test("an already-open queue applies live upserts and removals immediately", async ({
    page,
  }) => {
    await page.goto("/");
    await expect
      .poll(() =>
        page.evaluate(
          ({ pubkey }) =>
            window.__BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?.({
              ownerPubkey: pubkey,
              kind: 37010,
            }) ?? false,
          { pubkey: ASSIGNEE },
        ),
      )
      .toBe(true);

    await page.getByTestId("open-my-actions-view").click();
    await expect(page.getByText("Nothing needs you right now")).toBeVisible();

    await page.evaluate(
      ({ assignee, eventId, itemId }) => {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content: JSON.stringify({
            schema: "mac-workspace/cos-follow-up/v1",
            id: itemId,
            jira_key: "COS-683",
            title: "Live queue item",
            question_evidence: {
              question: "Did this arrive without polling?",
              evidence: "Live relay delivery",
            },
            state: "needs-answer",
            assigned_person: { id: 1, name: "Marc" },
            named_confirmer: null,
            version: 1,
            permitted_actions: ["answer"],
            timestamps: {
              created_at: "2026-07-28T06:00:00Z",
              updated_at: "2026-07-28T06:00:00Z",
              published_at: "2026-07-28T06:00:00Z",
              last_activity_at: "2026-07-28T06:00:00Z",
              answered_at: null,
              ready_to_check_at: null,
              confirmed_at: null,
              rejected_at: null,
            },
            deep_links: {
              meeting_follow_up:
                "https://workspace.example/ops/meeting-follow-up?item_id=live",
              jira: null,
              sources: [],
            },
          }),
          extraTags: [
            ["d", itemId],
            ["p", assignee],
          ],
          id: eventId,
          kind: 37010,
        });
      },
      { assignee: ASSIGNEE, eventId: ITEM_EVENT_ID, itemId: ITEM_ID },
    );

    const card = page.getByTestId(`my-actions-item-${ITEM_ID}`);
    await expect(card).toContainText("Live queue item");

    await page.evaluate(
      ({ itemEventId, itemId }) => {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content: "",
          extraTags: [
            ["item", itemId],
            ["e", itemEventId],
          ],
          id: "6".repeat(64),
          kind: 5,
        });
      },
      { itemEventId: ITEM_EVENT_ID, itemId: ITEM_ID },
    );

    await expect(card).toHaveCount(0);
  });

  test("does not miss a tombstone during the item-to-removal subscription handoff", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForFollowUpItemSubscription(page);
    await page.getByTestId("open-my-actions-view").click();

    await emitFollowUpItem(page, {
      eventId: ITEM_EVENT_ID,
      state: "needs-answer",
      title: "Must not survive its tombstone",
      version: 1,
    });
    const card = page.getByTestId(`my-actions-item-${ITEM_ID}`);
    await expect(card).toContainText("Must not survive its tombstone");

    await page.evaluate(
      ({ eventId, itemId }) => {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content: "",
          extraTags: [
            ["item", itemId],
            ["e", eventId],
          ],
          id: "5".repeat(64),
          kind: 5,
        });
      },
      { eventId: ITEM_EVENT_ID, itemId: ITEM_ID },
    );
    await page.waitForTimeout(750);

    await expect(card).toHaveCount(0);
  });

  test("a delayed lower-version live item neither regresses nor notifies", async ({
    page,
  }) => {
    const currentEventId = "a".repeat(64);
    const staleEventId = "b".repeat(64);
    await page.goto("/");
    await waitForFollowUpItemSubscription(page);
    await page.getByTestId("open-my-actions-view").click();

    await emitFollowUpItem(page, {
      eventId: currentEventId,
      state: "needs-answer",
      title: "Reducer current item",
      version: 2,
    });
    const card = page.getByTestId(`my-actions-item-${ITEM_ID}`);
    await expect(card).toContainText("Reducer current item");
    await expect
      .poll(() => notificationBodies(page, "Reducer "))
      .toEqual(["Reducer current item"]);

    await emitFollowUpItem(page, {
      eventId: staleEventId,
      state: "ready-to-check",
      title: "Reducer delayed item",
      version: 1,
    });
    await page.waitForTimeout(200);

    await expect(card).toContainText("Reducer current item");
    await expect(card).not.toContainText("Reducer delayed item");
    expect(await notificationBodies(page, "Reducer ")).toEqual([
      "Reducer current item",
    ]);
  });

  test("a stale tombstone does not make a current replay notify twice", async ({
    page,
  }) => {
    const currentEventId = "c".repeat(64);
    await page.goto("/");
    await waitForFollowUpItemSubscription(page);
    await page.getByTestId("open-my-actions-view").click();

    await emitFollowUpItem(page, {
      eventId: currentEventId,
      state: "needs-answer",
      title: "Tombstone current item",
      version: 2,
    });
    const card = page.getByTestId(`my-actions-item-${ITEM_ID}`);
    await expect(card).toContainText("Tombstone current item");
    await expect
      .poll(() => notificationBodies(page, "Tombstone "))
      .toEqual(["Tombstone current item"]);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "general",
              kind: 5,
            }) ?? false,
        ),
      )
      .toBe(true);

    await page.evaluate(
      ({ itemId }) => {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content: "",
          extraTags: [
            ["item", itemId],
            ["e", "d".repeat(64)],
          ],
          id: "e".repeat(64),
          kind: 5,
        });
      },
      { itemId: ITEM_ID },
    );
    await page.waitForTimeout(100);

    await emitFollowUpItem(page, {
      eventId: currentEventId,
      state: "needs-answer",
      title: "Tombstone current item",
      version: 2,
    });
    await page.waitForTimeout(200);

    await expect(card).toContainText("Tombstone current item");
    expect(await notificationBodies(page, "Tombstone ")).toEqual([
      "Tombstone current item",
    ]);
  });

  test("renders evidence and submits an answer against the authoritative version", async ({
    page,
  }) => {
    await page.goto("/");
    await expect
      .poll(() =>
        page.evaluate(
          ({ pubkey }) =>
            window.__BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?.({
              ownerPubkey: pubkey,
              kind: 37010,
            }) ?? false,
          { pubkey: ASSIGNEE },
        ),
      )
      .toBe(true);

    await page.evaluate(
      ({ assignee, eventId, itemId }) => {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content: JSON.stringify({
            schema: "mac-workspace/cos-follow-up/v1",
            id: itemId,
            jira_key: "COS-683",
            title: "Confirm the handover evidence",
            question_evidence: {
              question: "Is the handover wording accurate?",
              evidence: "Meeting transcript line 14",
            },
            state: "needs-answer",
            assigned_person: { id: 1, name: "Marc" },
            named_confirmer: null,
            version: 7,
            permitted_actions: ["answer"],
            timestamps: {
              created_at: "2026-07-27T20:00:00Z",
              updated_at: "2026-07-27T20:00:00Z",
              published_at: "2026-07-27T20:00:00Z",
              last_activity_at: "2026-07-27T20:00:00Z",
              answered_at: null,
              ready_to_check_at: null,
              confirmed_at: null,
              rejected_at: null,
            },
            deep_links: {
              meeting_follow_up:
                "https://workspace.example/ops/meeting-follow-up?item_id=e2e",
              jira: "https://jira.example/browse/COS-683",
              sources: [
                {
                  label: "Transcript",
                  url: "https://workspace.example/source/line-14",
                },
              ],
            },
          }),
          extraTags: [
            ["d", itemId],
            ["p", assignee],
          ],
          id: eventId,
          kind: 37010,
        });
      },
      { assignee: ASSIGNEE, eventId: ITEM_EVENT_ID, itemId: ITEM_ID },
    );

    await page.getByTestId("open-my-actions-view").click();
    const card = page.getByTestId(`my-actions-item-${ITEM_ID}`);
    await expect(card).toContainText("Confirm the handover evidence");
    await expect(card).toContainText("Meeting transcript line 14");
    await expect(
      card.getByRole("button", { name: "Transcript" }),
    ).toBeVisible();

    await page.getByTestId(`answer-${ITEM_ID}`).click();
    await page.getByLabel("Your answer").fill("Yes, that is accurate.");
    await page.getByTestId(`submit-answer-${ITEM_ID}`).click();

    await expect
      .poll(() =>
        page.evaluate(() => window.__BUZZ_E2E_LAST_COS_COMMAND__ ?? null),
      )
      .not.toBeNull();
    const command = await page.evaluate(
      () => window.__BUZZ_E2E_LAST_COS_COMMAND__ ?? null,
    );
    if (!command) throw new Error("COS follow-up command was not captured");
    expect(command.kind).toBe(47010);
    expect(command.tags).toEqual([
      ["h", "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50"],
      ["item", ITEM_ID],
      ["action", "answer"],
      ["expected-version", "7"],
      ["e", ITEM_EVENT_ID],
    ]);

    await page.evaluate(
      ({ commandId, itemEventId, itemId }) => {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content: JSON.stringify({
            schema: "mac-workspace/cos-follow-up/v1",
            retryable: false,
          }),
          extraTags: [
            ["e", commandId],
            ["item", itemId],
            ["outcome", "accepted"],
            ["version", "8"],
          ],
          id: "8".repeat(64),
          kind: 47011,
        });
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content: "",
          extraTags: [
            ["item", itemId],
            ["e", itemEventId],
          ],
          id: "9".repeat(64),
          kind: 5,
        });
      },
      {
        commandId: command.id,
        itemEventId: ITEM_EVENT_ID,
        itemId: ITEM_ID,
      },
    );

    await expect(card).toHaveCount(0);
  });
});
