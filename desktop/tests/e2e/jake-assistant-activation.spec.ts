import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const CHANNEL_ID = "4fe3a809-b4fd-4b67-a5ca-550a3e425bd4";

test("Jake-only central assistant action stays separate from New agent", async ({
  page,
}) => {
  await installMockBridge(page, { cosUserContext: "jake" });
  const now = Math.floor(Date.now() / 1000);
  const defaultRequest = {
    schema: "mac-workspace/mac-assistant-activation-request/v1",
    request_id: crypto.randomUUID(),
    challenge: "ab".repeat(32),
    issued_at: now - 1,
    expires_at: now + 300,
    workspace_origin: "https://forge-do.tailfe35cd.ts.net",
    scope: "jake-only",
    user_key: "jake-wherton",
    user_name: "Jake Wherton",
    jira_key: "COS-709",
    assistant_key: "mac-assistant",
    assistant_name: "MAC Assistant",
    assistant_pubkey: "02".repeat(32),
    identity_pubkey: TEST_IDENTITIES.tyler.pubkey,
    channel_id: CHANNEL_ID,
  };
  const requestPath = process.env.COS709_REQUEST_PATH;
  const request = requestPath
    ? (JSON.parse(readFileSync(requestPath, "utf-8")) as typeof defaultRequest)
    : defaultRequest;

  await page.goto("/");
  await page.getByTestId("open-today-view").click();
  await expect(page.getByTestId("today-assistant")).toContainText(
    "Centrally provided",
  );
  await expect(
    page.getByTestId("open-jake-assistant-activation"),
  ).toBeVisible();
  await expect(page.getByTestId("open-agents-view")).toHaveCount(0);

  await page.getByTestId("open-jake-assistant-activation").click();
  await expect(
    page.getByText("This does not create, import or run an agent"),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Activation request" })
    .fill(JSON.stringify(request));
  await page.getByTestId("attest-jake-assistant").click();
  await expect(
    page.getByTestId("jake-assistant-attestation-ready"),
  ).toBeVisible();

  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commands).toContain("attest_mac_assistant_activation");
  expect(commands).not.toContain("create_managed_agent");
  expect(commands).not.toContain("import_agent_snapshot");

  const outputPath = process.env.COS709_ATTESTATION_OUT;
  if (outputPath) {
    const attestation = await page.evaluate(
      () =>
        (
          window as Window & {
            __BUZZ_E2E_LAST_MAC_ASSISTANT_ATTESTATION__?: string;
          }
        ).__BUZZ_E2E_LAST_MAC_ASSISTANT_ATTESTATION__,
    );
    if (typeof attestation !== "string") {
      throw new Error("E2E attestation result was not captured");
    }
    writeFileSync(outputPath, `${attestation}\n`, { mode: 0o600 });
  }
});
