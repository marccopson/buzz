import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

test("technical controls stay hidden until trusted admin context resolves", async ({
  page,
}) => {
  await installMockBridge(page, {
    cosUserContext: "admin",
    cosUserContextDelayMs: 750,
  });

  await page.goto("/");
  await expect(page.getByTestId("open-today-view")).toBeVisible();
  await expect(page.getByTestId("open-my-actions-view")).toHaveCount(0);
  await expect(page.getByTestId("open-agents-view")).toHaveCount(0);
  await expect(page.getByTestId("open-running-order-view")).toHaveCount(0);
  await expect(page.getByTestId("open-control-room-view")).toHaveCount(0);
  await expect(page.getByTestId("open-workflows-view")).toHaveCount(0);

  await expect(page.getByTestId("open-agents-view")).toBeVisible();
  await expect(page.getByTestId("open-my-actions-view")).toBeVisible();
  await expect(page.getByTestId("open-running-order-view")).toBeVisible();
  await expect(page.getByTestId("open-control-room-view")).toBeVisible();
  await expect(page.getByTestId("open-workflows-view")).toBeVisible();
});

test("trusted admin context follows a configured relay identity", async ({
  page,
}) => {
  await installMockBridge(page, {
    cosUserContext: "admin",
    relaySelf: TEST_IDENTITIES.bob.pubkey,
    relayPrivateKey: TEST_IDENTITIES.bob.privateKey,
  });

  await page.goto("/");
  await expect(page.getByTestId("open-agents-view")).toBeVisible();
  await expect(page.getByTestId("open-running-order-view")).toBeVisible();
  await expect(page.getByTestId("open-control-room-view")).toBeVisible();
});

test("staff context never exposes privileged technical controls", async ({
  page,
}) => {
  await installMockBridge(page, { cosUserContext: "staff" });

  await page.goto("/");
  await expect(page.getByTestId("open-today-view")).toBeVisible();
  await expect(page.getByTestId("open-my-actions-view")).toBeVisible();
  await expect(page.getByTestId("open-agents-view")).toHaveCount(0);
  await expect(page.getByTestId("open-running-order-view")).toHaveCount(0);
  await expect(page.getByTestId("open-control-room-view")).toHaveCount(0);
  await expect(page.getByTestId("open-workflows-view")).toHaveCount(0);
});

test("Today hides retained privileged shortcuts while context refreshes", async ({
  page,
}) => {
  await installMockBridge(page, {
    cosUserContext: "admin",
    cosUserContextDelayMs: 750,
  });

  await page.goto("/");
  await page.getByTestId("open-today-view").click();
  await expect(page.getByTestId("today-assistant")).toBeVisible();
  await expect(page.getByTestId("today-running-order")).toBeVisible();

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("open-my-actions-view")).toHaveCount(0);
  await expect(page.getByTestId("today-my-actions")).toHaveCount(0);
  await expect(page.getByTestId("today-assistant")).toHaveCount(0);
  await expect(page.getByTestId("today-running-order")).toHaveCount(0);

  await expect(page.getByTestId("open-my-actions-view")).toBeVisible();
  await expect(page.getByTestId("today-my-actions")).toBeVisible();
  await expect(page.getByTestId("today-assistant")).toBeVisible();
  await expect(page.getByTestId("today-running-order")).toBeVisible();
});

test("My Actions direct route fails closed without trusted role context", async ({
  page,
}) => {
  await installMockBridge(page, { cosUserContext: null });

  await page.goto("/#/my-actions");
  await expect(page.getByTestId("open-my-actions-view")).toHaveCount(0);
  await expect(page.getByText("Access not available")).toBeVisible();
  await expect(page.getByTestId("cos-my-actions")).toHaveCount(0);
});
