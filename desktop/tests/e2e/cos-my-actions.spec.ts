import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const ASSIGNEE = "deadbeef".repeat(8);
const ITEM_ID = "cos-follow-up-e2e";
const ITEM_EVENT_ID = "7".repeat(64);

test.describe("COS My Actions", () => {
  test.beforeEach(async ({ page }) => {
    await installMockBridge(page);
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
