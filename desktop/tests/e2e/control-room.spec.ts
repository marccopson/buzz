import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const HEALTH_NOW = new Date("2026-07-29T06:00:20Z");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(HEALTH_NOW);
});

const DIMENSIONS = Object.fromEntries(
  [
    "alive",
    "connected",
    "authenticated",
    "capable",
    "working",
    "fresh",
    "safe",
    "recoverable",
  ].map((name) => [
    name,
    {
      state: name === "working" || name === "recoverable" ? "unknown" : "pass",
      evidence: [`${name} evidence`],
    },
  ]),
);

const HEALTH = {
  schemaVersion: "mac-agent-health/v1",
  generatedAt: "2026-07-29T06:00:00Z",
  authority: {
    id: "brain-vps-health-check",
    role: "authoritative-estate-observer",
  },
  operationalStatus: "green",
  assuranceStatus: "partial",
  assuranceGaps: [
    "current-run and last-success evidence",
    "checkpoint and recovery evidence",
  ],
  source: {
    status: "fresh",
    maxAgeSeconds: 93600,
    estate: {
      path: "/root/MAC-Local/reports/infra-check-latest.md",
      observedAt: "2026-07-29T06:00:00Z",
      ageSeconds: 20,
      sha256: "a".repeat(64),
    },
    agents: {
      path: "/root/MAC-Local/reports/mac-workspace-hermes-latest.md",
      observedAt: "2026-07-29T06:00:00Z",
      ageSeconds: 20,
      sha256: "b".repeat(64),
    },
  },
  nodes: ["Brain", "AVC DO", "Forge DO", "Mac mini"].map((name) => ({
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    status: "green",
    detail: "Baseline checks OK",
  })),
  agents: ["sammi", "maria", "zac", "hermes-admin"].map((id) => ({
    id,
    name:
      id === "hermes-admin"
        ? "Hermes Admin"
        : id[0].toUpperCase() + id.slice(1),
    operationalStatus: "green",
    assuranceStatus: "partial",
    dimensions: DIMENSIONS,
  })),
  components: [
    {
      id: "buzz-runtime",
      name: "Buzz runtime",
      status: "green",
      detail: "MAC Workspace 0.5.0 is available",
    },
  ],
  issues: [],
};

test("shows estate health separately from assurance gaps", async ({ page }) => {
  await installMockBridge(page, { cosUserContext: "admin" });
  await page.route("**/api/mac-agent-health/v1", async (route) => {
    await route.fulfill({
      body: JSON.stringify(HEALTH),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/");
  await page.getByTestId("open-control-room-view").click();

  await expect(
    page.getByRole("heading", { name: "Control Room" }),
  ).toBeVisible();
  await expect(page.getByTestId("control-room-operational")).toContainText(
    "Operational: Healthy",
  );
  await expect(page.getByTestId("control-room-assurance")).toContainText(
    "Assurance: partial",
  );
  await expect(page.getByTestId("control-room-agent-sammi")).toContainText(
    "working",
  );
  await expect(page.getByTestId("control-room-agent-sammi")).toContainText(
    "recoverable",
  );
});

test("labels every stale desktop health group as last known", async ({
  page,
}) => {
  await installMockBridge(page, { cosUserContext: "admin" });
  await page.route("**/api/mac-agent-health/v1", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ...HEALTH,
        source: { ...HEALTH.source, status: "stale" },
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/");
  await page.getByTestId("open-control-room-view").click();

  await expect(page.getByTestId("control-room-data-warning")).toContainText(
    "Evidence stale",
  );
  await expect(page.getByTestId("control-room-agent-sammi")).toContainText(
    "Last known: Healthy",
  );
  await expect(
    page.getByTestId("control-room-component-buzz-runtime"),
  ).toContainText("Last known: Healthy");
});
