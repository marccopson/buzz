import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

test("technical controls stay hidden until trusted admin context resolves", async ({
  page,
}) => {
  await installMockBridge(page, {
    cosUserContext: "admin",
    cosUserContextDelayMs: 750,
  });

  await page.goto("/");
  await expect(page.getByTestId("open-today-view")).toBeVisible();
  await expect(page.getByTestId("open-agents-view")).toHaveCount(0);
  await expect(page.getByTestId("open-running-order-view")).toHaveCount(0);
  await expect(page.getByTestId("open-control-room-view")).toHaveCount(0);
  await expect(page.getByTestId("open-workflows-view")).toHaveCount(0);

  await expect(page.getByTestId("open-agents-view")).toBeVisible();
  await expect(page.getByTestId("open-running-order-view")).toBeVisible();
  await expect(page.getByTestId("open-control-room-view")).toBeVisible();
  await expect(page.getByTestId("open-workflows-view")).toBeVisible();
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
