import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { cosDeliveryRoomGenerationId } from "../../src/features/cos-running-order/lib/cosDeliveryRoom";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const REVIEWED_FIXTURE = JSON.parse(
  readFileSync(
    new URL("../fixtures/mac-delivery-room-v1.json", import.meta.url),
    "utf8",
  ),
);

async function currentFixture() {
  const fixture = structuredClone(REVIEWED_FIXTURE);
  const now = new Date().toISOString();
  const refreshTimes = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) refreshTimes(item);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (
        key === "generatedAt" ||
        key === "sourceGeneratedAt" ||
        key === "observedAt"
      ) {
        (value as Record<string, unknown>)[key] = now;
      } else {
        refreshTimes(item);
      }
    }
  };
  refreshTimes(fixture);
  fixture.generationId = await cosDeliveryRoomGenerationId(fixture);
  return fixture;
}

async function installDeliveryRoomRoute(page: Page) {
  await page.route("**/api/mac-delivery-room/v1", async (route) => {
    await route.fulfill({
      body: JSON.stringify(await currentFixture()),
      contentType: "application/json",
      status: 200,
    });
  });
}

test.describe("MAC Workspace Delivery Room", () => {
  test.beforeEach(async ({ page }) => {
    await installMockBridge(page, { cosUserContext: "admin" });
    await installDeliveryRoomRoute(page);
  });

  test("renders manager attention, evidenced rooms and the fixed delivery flow on desktop", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await page.getByTestId("open-running-order-view").click();

    await expect(
      page.getByRole("heading", { name: "Delivery Room", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Signed source verified")).toBeVisible();

    const attention = page.getByTestId("delivery-room-attention-strip");
    await expect(attention).toContainText("Needs Marc");
    await expect(attention).toContainText("Blocked or stalled");
    const attentionText = await attention.innerText();
    expect(attentionText.indexOf("Needs Marc")).toBeLessThan(
      attentionText.indexOf("Blocked or stalled"),
    );

    const stages = page.locator("[data-testid^='delivery-stage-']");
    await expect(stages).toHaveCount(5);
    await expect(stages.nth(0)).toContainText("Ready");
    await expect(stages.nth(1)).toContainText("Building");
    await expect(stages.nth(2)).toContainText("Independent review");
    await expect(stages.nth(3)).toContainText("Staging verification");
    await expect(stages.nth(4)).toContainText("Complete");

    const buildingCard = page.getByTestId("delivery-room-item-COS-901");
    await expect(buildingCard).toContainText(
      "Build the signed Delivery Room projection",
    );
    const buildingText = await buildingCard.innerText();
    expect(
      buildingText.indexOf("Build the signed Delivery Room projection"),
    ).toBeLessThan(buildingText.indexOf("COS-901"));
    await expect(buildingCard).toContainText("Current activity");
    await expect(buildingCard).toContainText("Next action");
    await expect(buildingCard).toContainText("Owner: Builder");
    await expect(buildingCard).toContainText("Evidence observed");

    await expect(
      page.getByTestId("team-room-senior-development-team"),
    ).toContainText(/Builder\s*Working/);
    await expect(page.getByTestId("team-room-planning-council")).toContainText(
      "No evidenced room activity",
    );
    await expect(page.getByTestId("team-room-board-of-advisors")).toContainText(
      "No evidenced room activity",
    );
    await expect(
      page.getByTestId("team-room-senior-development-team"),
    ).not.toContainText("3/3");

    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath("cos-delivery-room-desktop.png"),
    });

    await buildingCard.click();
    await expect(page.getByTestId("objective-gates")).toBeVisible();
    const threads = page.getByTestId("card-team-threads");
    await expect(threads).toContainText("Senior Development Team");
    await expect(threads).toContainText("Planning Council");
    await expect(threads).toContainText("Board of Advisors");
    await expect(threads).toContainText(
      "No evidenced discussion is linked to this card.",
    );

    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath("cos-delivery-room-desktop-card.png"),
    });
  });

  test("keeps attention, flow and card details phone-visible", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/#/running-order");

    await expect(
      page.getByRole("heading", { name: "Delivery Room", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId("delivery-room-attention-strip"),
    ).toBeVisible();
    await expect(page.locator("[data-testid^='delivery-stage-']")).toHaveCount(
      5,
    );

    const pageWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(pageWidth).toBeLessThanOrEqual(390);

    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath("cos-delivery-room-phone.png"),
    });

    const card = page.getByTestId("delivery-room-item-COS-903");
    await card.scrollIntoViewIfNeeded();
    await card.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Why it matters");
    await expect(dialog).toContainText("Current activity");
    await expect(dialog).toContainText("Next action");
    await expect(dialog).toContainText("Objective gates");
    const box = await dialog.boundingBox();
    expect(box?.width ?? 999).toBeLessThanOrEqual(390);

    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath("cos-delivery-room-phone-card.png"),
    });
  });
});

test("direct Delivery Room access fails closed without trusted role context", async ({
  page,
}) => {
  await installMockBridge(page, { cosUserContext: null });
  await installDeliveryRoomRoute(page);

  await page.goto("/#/running-order");
  await expect(page.getByText("Access not available")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Delivery Room", exact: true }),
  ).toHaveCount(0);
});

test("stale signed source hides all delivery claims", async ({ page }) => {
  await installMockBridge(page, { cosUserContext: "admin" });
  await page.route("**/api/mac-delivery-room/v1", async (route) => {
    const fixture = await currentFixture();
    fixture.source.status = "stale";
    fixture.generationId = await cosDeliveryRoomGenerationId(fixture);
    await route.fulfill({
      body: JSON.stringify(fixture),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/#/running-order");
  await expect(page.getByTestId("delivery-room-fail-closed")).toBeVisible();
  await expect(page.getByTestId("delivery-room-fail-closed")).toContainText(
    "signed source is stale or invalid",
  );
  await expect(
    page.locator("[data-testid^='delivery-room-item-']"),
  ).toHaveCount(0);
});

test("expired claims stay latched across clock rollback and a new generation replaces them", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const systemNow = Date.now.bind(Date);
    let offsetMs = 0;
    Date.now = () => systemNow() + offsetMs;
    (
      window as typeof window & {
        __SET_DELIVERY_ROOM_CLOCK_OFFSET__: (value: number) => void;
      }
    ).__SET_DELIVERY_ROOM_CLOCK_OFFSET__ = (value) => {
      offsetMs = value;
    };
  });
  const expiredGeneration = await currentFixture();
  expiredGeneration.deliveryRoom.workItems.find(
    (item: { id: string }) => item.id === "COS-901",
  ).evidence[0].freshForMs = 3_000;
  expiredGeneration.generationId =
    await cosDeliveryRoomGenerationId(expiredGeneration);
  let serveReplacement = false;
  await installMockBridge(page, { cosUserContext: "admin" });
  await page.route("**/api/mac-delivery-room/v1", async (route) => {
    const fixture = serveReplacement
      ? await currentFixture()
      : structuredClone(expiredGeneration);
    if (serveReplacement) {
      fixture.deliveryRoom.workItems.find(
        (item: { id: string }) => item.id === "COS-901",
      ).title = "Build the replacement signed Delivery Room projection";
      fixture.generationId = await cosDeliveryRoomGenerationId(fixture);
    }
    await route.fulfill({
      body: JSON.stringify(fixture),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/#/running-order");
  await expect(page.getByTestId("delivery-room-item-COS-901")).toBeVisible();
  await expect(page.getByTestId("delivery-room-fail-closed")).toBeVisible({
    timeout: 6_000,
  });
  await expect(page.getByTestId("delivery-room-fail-closed")).toContainText(
    "Delivery Room evidence expired",
  );
  await expect(
    page.locator("[data-testid^='delivery-room-item-']"),
  ).toHaveCount(0);
  await expect(page.getByText("Signed source verified")).toHaveCount(0);

  await page.evaluate(() => {
    (
      window as typeof window & {
        __SET_DELIVERY_ROOM_CLOCK_OFFSET__: (value: number) => void;
      }
    ).__SET_DELIVERY_ROOM_CLOCK_OFFSET__(-60 * 60 * 1_000);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.setViewportSize({ height: 719, width: 1_279 });
  await expect(page.getByTestId("delivery-room-fail-closed")).toBeVisible();
  await expect(
    page.locator("[data-testid^='delivery-room-item-']"),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Refresh Delivery Room" }).click();
  await expect(page.getByTestId("delivery-room-fail-closed")).toBeVisible();
  await expect(
    page.locator("[data-testid^='delivery-room-item-']"),
  ).toHaveCount(0);

  serveReplacement = true;
  await page.getByRole("button", { name: "Refresh Delivery Room" }).click();
  await expect(
    page.getByText("Build the replacement signed Delivery Room projection"),
  ).toBeVisible();
  await expect(page.getByTestId("delivery-room-fail-closed")).toHaveCount(0);
});

test("a stale refetch clears previously verified delivery claims", async ({
  page,
}) => {
  let stale = false;
  let requestCount = 0;
  let acknowledgeRejectedResponse: (() => void) | undefined;
  const rejectedResponseDelivered = new Promise<void>((resolve) => {
    acknowledgeRejectedResponse = resolve;
  });
  await installMockBridge(page, { cosUserContext: "admin" });
  await page.route("**/api/mac-delivery-room/v1", async (route) => {
    requestCount += 1;
    const fixture = await currentFixture();
    if (stale) fixture.source.status = "stale";
    fixture.generationId = await cosDeliveryRoomGenerationId(fixture);
    await route.fulfill({
      body: JSON.stringify(fixture),
      contentType: "application/json",
      status: 200,
    });
    if (stale) acknowledgeRejectedResponse?.();
  });

  await page.goto("/#/running-order");
  await expect(page.getByTestId("delivery-room-item-COS-901")).toBeVisible();
  stale = true;
  await page.getByRole("button", { name: "Refresh Delivery Room" }).click();

  await rejectedResponseDelivered;
  await expect(
    page.locator("[data-testid^='delivery-room-item-']"),
  ).toHaveCount(0, { timeout: 500 });
  await expect(page.getByTestId("delivery-room-fail-closed")).toBeVisible();
  await page.waitForTimeout(1_100);
  expect(requestCount).toBe(2);
  await expect(
    page.locator("[data-testid^='delivery-room-item-']"),
  ).toHaveCount(0);
  await expect(page.getByText("Signed source verified")).toHaveCount(0);
});

test("an open card resolves against the latest signed generation", async ({
  page,
}) => {
  let revised = false;
  await installMockBridge(page, { cosUserContext: "admin" });
  await page.route("**/api/mac-delivery-room/v1", async (route) => {
    const fixture = await currentFixture();
    if (revised) {
      fixture.deliveryRoom.workItems.find(
        (item: { id: string }) => item.id === "COS-901",
      ).title = "Build the revised signed Delivery Room projection";
    }
    fixture.generationId = await cosDeliveryRoomGenerationId(fixture);
    await route.fulfill({
      body: JSON.stringify(fixture),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/#/running-order");
  await page.getByTestId("delivery-room-item-COS-901").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Build the signed Delivery Room projection",
  );

  revised = true;
  await page
    .locator('button[aria-label="Refresh Delivery Room"]')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(dialog).toContainText(
    "Build the revised signed Delivery Room projection",
  );
  await expect(dialog).not.toContainText(
    "Build the signed Delivery Room projection",
  );
});
