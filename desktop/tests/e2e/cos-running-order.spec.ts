import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const RUNNING_ORDER = {
  schema: "mac-workspace/cos-running-order/v1",
  generated_at_utc: "2026-07-27T16:08:14Z",
  generation_id: "cos-running-order-e2e",
  operational_status: "ok",
  overall_status: "degraded",
  staging_revision: "a1b2c3d4e5f678901234567890abcdef12345678",
  source_errors: [],
  counts: {
    blocked: 22,
    completed: 0,
    human_test: 1,
    queued: 96,
    ready: 0,
    running: 6,
  },
  items: [
    {
      key: "COS-469",
      summary: "Complete the finance workflow",
      jira_status: "In Progress",
      priority: "High",
      state: "blocked",
      blockers: ["Draft pull request has merge conflicts"],
      admission_signals: [],
      pull_requests: [{ number: 469, state: "OPEN", draft: true }],
      active_run: null,
      staging_evidenced: false,
    },
    {
      key: "COS-540",
      summary: "Validate the new reporting surface",
      jira_status: "In Progress",
      priority: "Medium",
      state: "running",
      blockers: [],
      admission_signals: [],
      pull_requests: [],
      active_run: {
        id: "run-540",
        state: "building",
        branch: "card/COS-540-reporting",
        pull_request_number: null,
        updated_at_utc: "2026-07-27T16:07:00Z",
      },
      staging_evidenced: false,
    },
  ],
};

test.describe("COS running order", () => {
  test.beforeEach(async ({ page }) => {
    await installMockBridge(page);
    await page.route("**/api/cos-running-order/v1", async (route) => {
      await route.fulfill({
        body: JSON.stringify(RUNNING_ORDER),
        contentType: "application/json",
        status: 200,
      });
    });
  });

  test("shows collector health, delivery state and prioritised work", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await page.getByTestId("open-running-order-view").click();

    await expect(
      page.getByRole("heading", { name: "COS Running Order" }),
    ).toBeVisible();
    await expect(page.getByText("Collector healthy")).toBeVisible();
    await expect(page.getByText(/Delivery state: degraded/)).toBeVisible();
    await expect(page.getByText("22", { exact: true })).toBeVisible();
    await expect(page.getByText("6", { exact: true })).toBeVisible();
    await expect(page.getByTestId("running-order-item-COS-469")).toContainText(
      "Draft pull request has merge conflicts",
    );
    await expect(page.getByTestId("running-order-item-COS-540")).toContainText(
      "card/COS-540-reporting",
    );

    await waitForAnimations(page);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("cos-running-order.png"),
    });
  });
});
