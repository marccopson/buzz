import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calculatedDeliveryRoomFreshness,
  checkedDeliveryRoomExpiryMs,
  cosDeliveryRoomEndpoint,
  cosDeliveryRoomExpiresAt,
  cosDeliveryRoomGenerationId,
  DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS,
  DELIVERY_ROOM_MAX_SOURCE_AGE_SECONDS,
  deliveryRoomSourceLifetimeMs,
  loadCosDeliveryRoom,
  projectCosDeliveryRoom,
  teamThreadForWork,
  verifyCosDeliveryRoomGeneration,
} from "./cosDeliveryRoom.ts";

const NOW = new Date("2026-07-31T09:05:00.000Z");
const CURRENT = "2026-07-31T09:04:00.000Z";
const REVIEWED_TEMPLATES = JSON.parse(
  readFileSync(
    new URL(
      "../../../../tests/fixtures/mac-delivery-room-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
).deliveryRoom.teamTemplates;

function evidence(id, kind, options = {}) {
  return {
    id,
    source: {
      kind,
      label: `${kind} evidence`,
      ...(options.actorId ? { actorId: options.actorId } : {}),
      ...(options.reference ? { reference: options.reference } : {}),
    },
    detail: options.detail ?? "Current bounded evidence.",
    ...(options.gateOutcome ? { gateOutcome: options.gateOutcome } : {}),
    observedAt: CURRENT,
    freshness: "current",
    freshForMs: 60 * 60 * 1000,
  };
}

function envelope() {
  return {
    schemaVersion: "mac-workspace/delivery-room/v1",
    generatedAt: "2026-07-31T09:05:00.000Z",
    generationId: "0".repeat(64),
    readOnly: true,
    source: {
      status: "fresh",
      maxAgeSeconds: 900,
      issues: [],
      reconciliation: {
        observedAt: CURRENT,
        freshness: "current",
        sha256: "a".repeat(64),
      },
      agentHealth: {
        observedAt: CURRENT,
        freshness: "current",
        sha256: "b".repeat(64),
      },
    },
    deliveryRoom: {
      schemaVersion: "delivery-room-projection/v1",
      generatedAt: "2026-07-31T09:05:00.000Z",
      sourceGeneratedAt: CURRENT,
      attention: {
        needsManager: {
          kind: "needs_manager",
          label: "Needs Marc",
          workItemIds: ["COS-901"],
        },
        blockedOrStalled: {
          kind: "blocked_or_stalled",
          label: "Blocked or stalled",
          workItemIds: ["COS-900"],
        },
      },
      stages: [
        { stage: "ready", label: "Ready", workItemIds: ["COS-900"] },
        { stage: "building", label: "Building", workItemIds: ["COS-901"] },
        {
          stage: "independent_review",
          label: "Independent review",
          workItemIds: [],
        },
        {
          stage: "staging_verification",
          label: "Staging verification",
          workItemIds: [],
        },
        { stage: "complete", label: "Complete", workItemIds: [] },
      ],
      workItems: [
        {
          id: "COS-900",
          title: "Resolve the blocked delivery prerequisite",
          whyItMatters:
            "The delivery team cannot start safely until this is resolved.",
          currentActivity:
            "A required prerequisite remains explicitly blocked.",
          nextAction: "Resolve the recorded prerequisite.",
          owner: { id: "lead", label: "Delivery lead" },
          externalReference: {
            key: "COS-900",
            label: "Blocked prerequisite",
            href: "https://macsurfacing.atlassian.net/browse/COS-900",
          },
          stage: "ready",
          health: "stalled",
          objectiveGates: [],
          evidence: [],
        },
        {
          id: "COS-901",
          title: "Give managers a truthful delivery view",
          whyItMatters:
            "Marc can understand progress without routinely opening Jira.",
          currentActivity:
            "The builder is implementing the bounded client change.",
          nextAction: "Finish the objective test gate.",
          owner: {
            id: "builder",
            label: "Builder",
            teamId: "senior-development-team",
            teamLabel: "Senior Development Team",
          },
          externalReference: {
            key: "COS-901",
            label: "Manager delivery view",
            href: "https://macsurfacing.atlassian.net/browse/COS-901",
          },
          stage: "building",
          health: "needs_manager",
          objectiveGates: [
            { id: "tests", label: "Objective tests", status: "pending" },
          ],
          evidence: [evidence("run-901", "run", { reference: "COS-901" })],
        },
      ],
      teams: [
        {
          id: "senior-development-team",
          name: "Senior Development Team",
          templateId: "senior-development-team",
          chairOrLead: { participantId: "builder", role: "Delivery lead" },
          invitedParticipantIds: ["builder", "reviewer", "marc"],
          actualParticipantIds: ["builder"],
          contributingParticipantIds: ["builder"],
          participants: [
            {
              id: "builder",
              name: "Builder",
              role: "Builder",
              state: "working",
              evidence: [
                evidence("builder-state", "run", { reference: "COS-901" }),
              ],
            },
          ],
          contributions: [
            {
              id: "builder-contribution",
              participantId: "builder",
              summary: "Produced the bounded implementation.",
              evidence: [
                evidence("builder-human", "human", {
                  actorId: "builder",
                  reference: "COS-901",
                }),
              ],
            },
          ],
          dissent: [],
          signOff: {
            status: "not_signed_off",
            reason: "No sign-off has been supplied.",
          },
          absentOrUnavailable: [
            {
              participantId: "reviewer",
              reason: "Invited, but no evidenced contribution is available.",
              state: "unavailable",
            },
            {
              participantId: "marc",
              reason: "Invited, but no evidenced contribution is available.",
              state: "unavailable",
            },
          ],
        },
      ],
      teamTemplates: copy(REVIEWED_TEMPLATES),
    },
  };
}

function copy(value) {
  return structuredClone(value);
}

test("projects the reviewed contract into manager-first attention, stages and language", () => {
  const result = projectCosDeliveryRoom(envelope(), { now: NOW });

  assert.deepEqual(result.deliveryRoom.attention.needsManager.workItemIds, [
    "COS-901",
  ]);
  assert.deepEqual(result.deliveryRoom.attention.blockedOrStalled.workItemIds, [
    "COS-900",
  ]);
  assert.deepEqual(
    result.deliveryRoom.stages.map((stage) => stage.stage),
    [
      "ready",
      "building",
      "independent_review",
      "staging_verification",
      "complete",
    ],
  );
  assert.equal(
    result.deliveryRoom.workItems[1]?.title,
    "Give managers a truthful delivery view",
  );
  assert.equal(
    result.deliveryRoom.workItems[1]?.whyItMatters,
    "Marc can understand progress without routinely opening Jira.",
  );
  assert.equal(
    result.deliveryRoom.workItems[1]?.externalReference?.key,
    "COS-901",
  );
});

test("counts only current actor-attributed participation and preserves quiet invitations", () => {
  const result = projectCosDeliveryRoom(envelope(), { now: NOW });
  const team = result.deliveryRoom.teams[0];

  assert.deepEqual(team?.invitedParticipantIds, [
    "builder",
    "reviewer",
    "marc",
  ]);
  assert.deepEqual(team?.actualParticipantIds, ["builder"]);
  assert.deepEqual(team?.contributingParticipantIds, ["builder"]);
  assert.equal(team?.participants[0]?.state, "working");
  assert.equal(team?.signOff.status, "not_signed_off");
});

test("expires the projection at the earliest source or presented evidence deadline", () => {
  const sourceFirst = projectCosDeliveryRoom(envelope(), { now: NOW });
  assert.equal(
    cosDeliveryRoomExpiresAt(sourceFirst),
    new Date("2026-07-31T09:19:00.000Z").getTime(),
  );

  const envelopeGeneratedFirst = copy(sourceFirst);
  envelopeGeneratedFirst.source.reconciliation.observedAt =
    envelopeGeneratedFirst.generatedAt;
  envelopeGeneratedFirst.source.agentHealth.observedAt =
    envelopeGeneratedFirst.generatedAt;
  assert.equal(
    cosDeliveryRoomExpiresAt(envelopeGeneratedFirst),
    new Date("2026-07-31T09:20:00.000Z").getTime(),
  );

  const evidenceDeadline = new Date("2026-07-31T09:05:30.000Z").getTime();
  const shortEvidence = evidence("short-lived", "human");
  shortEvidence.freshForMs = 90_000;
  const evidenceLocations = [
    (room) => {
      room.deliveryRoom.workItems[1].evidence = [shortEvidence];
    },
    (room) => {
      room.deliveryRoom.workItems[1].objectiveGates[0].evidence = shortEvidence;
    },
    (room) => {
      room.deliveryRoom.teams[0].participants[0].evidence = [shortEvidence];
    },
    (room) => {
      room.deliveryRoom.teams[0].contributions[0].evidence = [shortEvidence];
    },
    (room) => {
      room.deliveryRoom.teams[0].dissent = [
        {
          id: "dissent",
          participantId: "builder",
          summary: "Recorded dissent.",
          evidence: [shortEvidence],
        },
      ];
    },
    (room) => {
      room.deliveryRoom.teams[0].synthesis = {
        participantId: "builder",
        summary: "Recorded synthesis.",
        evidence: [shortEvidence],
      };
    },
    (room) => {
      room.deliveryRoom.teams[0].signOff = {
        status: "signed_off",
        participantId: "builder",
        evidence: shortEvidence,
      };
    },
  ];

  for (const installEvidence of evidenceLocations) {
    const room = copy(sourceFirst);
    installEvidence(room);
    assert.equal(cosDeliveryRoomExpiresAt(room), evidenceDeadline);
  }
});

test("rejects unbounded or unsafe lifetimes and accepts the reviewed boundaries", () => {
  const hugeSourceLifetime = copy(envelope());
  hugeSourceLifetime.source.maxAgeSeconds = 1e308;
  assert.throws(
    () => projectCosDeliveryRoom(hugeSourceLifetime, { now: NOW }),
    /source\.maxAgeSeconds is outside the reviewed lifetime bound/,
  );

  const hugeEvidenceLifetime = copy(envelope());
  hugeEvidenceLifetime.deliveryRoom.workItems[1].evidence[0].freshForMs = 1e308;
  assert.throws(
    () => projectCosDeliveryRoom(hugeEvidenceLifetime, { now: NOW }),
    /freshForMs is outside the reviewed lifetime bound/,
  );

  const boundary = copy(envelope());
  boundary.source.maxAgeSeconds = DELIVERY_ROOM_MAX_SOURCE_AGE_SECONDS;
  boundary.deliveryRoom.workItems[1].evidence[0].freshForMs =
    DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS;
  const projected = projectCosDeliveryRoom(boundary, { now: NOW });
  assert.equal(
    projected.deliveryRoom.workItems[1].evidence[0].freshForMs,
    DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS,
  );
  assert.equal(
    checkedDeliveryRoomExpiryMs(
      new Date(CURRENT).getTime(),
      DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS,
    ),
    new Date(CURRENT).getTime() + DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS,
  );
  const boundaryExpiry =
    new Date(CURRENT).getTime() + DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS;
  assert.equal(
    calculatedDeliveryRoomFreshness(
      CURRENT,
      DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS,
      new Date(boundaryExpiry),
    ),
    "current",
  );
  assert.equal(
    calculatedDeliveryRoomFreshness(
      CURRENT,
      DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS,
      new Date(boundaryExpiry + 1),
    ),
    "stale",
  );

  const aboveSourceBoundary = copy(envelope());
  aboveSourceBoundary.source.maxAgeSeconds =
    DELIVERY_ROOM_MAX_SOURCE_AGE_SECONDS + 1;
  assert.throws(
    () => projectCosDeliveryRoom(aboveSourceBoundary, { now: NOW }),
    /source\.maxAgeSeconds is outside the reviewed lifetime bound/,
  );
});

test("rejects lifetime multiplication and timestamp addition overflow", () => {
  assert.equal(deliveryRoomSourceLifetimeMs(1e308), undefined);
  assert.equal(
    checkedDeliveryRoomExpiryMs(Number.POSITIVE_INFINITY, 1),
    undefined,
  );
  assert.equal(
    checkedDeliveryRoomExpiryMs(0, Number.POSITIVE_INFINITY),
    undefined,
  );
  assert.equal(
    checkedDeliveryRoomExpiryMs(
      Number.MAX_SAFE_INTEGER - DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS + 1,
      DELIVERY_ROOM_MAX_EVIDENCE_LIFETIME_MS,
    ),
    undefined,
  );
  assert.equal(
    checkedDeliveryRoomExpiryMs(
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ),
    undefined,
  );
});

test("fails closed on duplicate fixed-room mappings while preserving reviewed optional mapping semantics", () => {
  const canonicalTemplateIds = [
    "senior-development-team",
    "planning-council",
    "board-of-advisors",
  ];
  const sourceTeam = envelope().deliveryRoom.teams[0];

  for (const templateId of canonicalTemplateIds) {
    const duplicate = copy(envelope());
    duplicate.deliveryRoom.teams = [
      { ...copy(sourceTeam), id: `${templateId}-one`, templateId },
      { ...copy(sourceTeam), id: `${templateId}-two`, templateId },
    ];
    assert.throws(
      () => projectCosDeliveryRoom(duplicate, { now: NOW }),
      /team-room template mappings are duplicated/,
    );
  }

  const fallbackCollision = copy(envelope());
  fallbackCollision.deliveryRoom.teams = [
    { ...copy(sourceTeam), id: "explicit-senior-team" },
    { ...copy(sourceTeam), id: "senior-development-team" },
  ];
  delete fallbackCollision.deliveryRoom.teams[1].templateId;
  assert.throws(
    () => projectCosDeliveryRoom(fallbackCollision, { now: NOW }),
    /team-room template mappings are duplicated/,
  );

  const unique = copy(envelope());
  unique.deliveryRoom.teams = canonicalTemplateIds.map((templateId) => ({
    ...copy(sourceTeam),
    id: `${templateId}-instance`,
    templateId,
  }));
  assert.equal(
    projectCosDeliveryRoom(unique, { now: NOW }).deliveryRoom.teams.length,
    3,
  );

  const absent = copy(envelope());
  absent.deliveryRoom.teams[0].id = "unmapped-observation-room";
  delete absent.deliveryRoom.teams[0].templateId;
  assert.equal(
    projectCosDeliveryRoom(absent, { now: NOW }).deliveryRoom.teams[0]
      .templateId,
    undefined,
  );

  const unknown = copy(envelope());
  unknown.deliveryRoom.teams[0].templateId = "unknown-team-room";
  assert.throws(
    () => projectCosDeliveryRoom(unknown, { now: NOW }),
    /templateId is unsupported/,
  );
});

test("links a detailed card thread only through an explicit current evidence reference", () => {
  const result = projectCosDeliveryRoom(envelope(), { now: NOW });
  const team = result.deliveryRoom.teams[0];
  const linked = teamThreadForWork(team, result.deliveryRoom.workItems[1]);
  const unrelated = teamThreadForWork(team, result.deliveryRoom.workItems[0]);

  assert.equal(linked.contributions.length, 1);
  assert.equal(unrelated.contributions.length, 0);
  assert.equal(linked.signOff, undefined);
});

test("fails closed for stale source evidence and timestamp freshness contradictions", () => {
  const staleSource = copy(envelope());
  staleSource.source.status = "stale";
  assert.throws(
    () => projectCosDeliveryRoom(staleSource, { now: NOW }),
    /signed source is stale or invalid/,
  );

  const falseFreshness = copy(envelope());
  falseFreshness.deliveryRoom.workItems[1].evidence[0].observedAt =
    "2026-07-30T09:00:00.000Z";
  assert.throws(
    () => projectCosDeliveryRoom(falseFreshness, { now: NOW }),
    /freshness contradicts its timestamp/,
  );
});

test("requires timezone-aware RFC3339 timestamps without calendar rollover", () => {
  const timezoneLess = copy(envelope());
  timezoneLess.generatedAt = "2026-07-31T09:05:00";
  timezoneLess.deliveryRoom.generatedAt = "2026-07-31T09:05:00";
  assert.throws(
    () => projectCosDeliveryRoom(timezoneLess, { now: NOW }),
    /generatedAt is stale or invalid/,
  );

  const rollover = copy(envelope());
  rollover.source.reconciliation.observedAt = "2026-02-30T09:04:00.000Z";
  assert.throws(
    () => projectCosDeliveryRoom(rollover, { now: NOW }),
    /reconciliation\.observedAt is stale or invalid/,
  );
});

test("fails closed when attention or stage membership contradicts work state", () => {
  const attention = copy(envelope());
  attention.deliveryRoom.attention.needsManager.workItemIds = [];
  assert.throws(
    () => projectCosDeliveryRoom(attention, { now: NOW }),
    /attention\.needsManager\.workItemIds contradicts work state/,
  );

  const stage = copy(envelope());
  stage.deliveryRoom.stages[0].workItemIds = [];
  assert.throws(
    () => projectCosDeliveryRoom(stage, { now: NOW }),
    /stages\[0\]\.workItemIds contradicts work state/,
  );
});

test("fails closed for fabricated activity, participation and completion", () => {
  const activity = copy(envelope());
  activity.deliveryRoom.workItems[1].evidence = [];
  assert.throws(
    () => projectCosDeliveryRoom(activity, { now: NOW }),
    /claims building without current run or status evidence/,
  );

  const participation = copy(envelope());
  participation.deliveryRoom.teams[0].actualParticipantIds.push("reviewer");
  assert.throws(
    () => projectCosDeliveryRoom(participation, { now: NOW }),
    /participation counts contradict attributed evidence/,
  );

  const completion = copy(envelope());
  completion.deliveryRoom.workItems[1].stage = "complete";
  completion.deliveryRoom.stages[1].workItemIds = [];
  completion.deliveryRoom.stages[4].workItemIds = ["COS-901"];
  assert.throws(
    () => projectCosDeliveryRoom(completion, { now: NOW }),
    /claims completion without passed gates and current evidence/,
  );
});

test("fails closed for non-human authority and writable projections", () => {
  const authority = copy(envelope());
  authority.deliveryRoom.teamTemplates[0].decisionAuthority = "agent";
  assert.throws(
    () => projectCosDeliveryRoom(authority, { now: NOW }),
    /grants non-human authority/,
  );

  const writable = copy(envelope());
  writable.readOnly = false;
  assert.throws(
    () => projectCosDeliveryRoom(writable, { now: NOW }),
    /projection is not read-only/,
  );

  const changedTemplate = copy(envelope());
  changedTemplate.deliveryRoom.teamTemplates[0].roles = [];
  assert.throws(
    () => projectCosDeliveryRoom(changedTemplate, { now: NOW }),
    /reviewed team-room templates were changed/,
  );
});

test("verifies the content digest and loads only the Delivery Room endpoint", async () => {
  const valid = envelope();
  valid.generationId = await cosDeliveryRoomGenerationId(valid);
  await verifyCosDeliveryRoomGeneration(valid);

  const tampered = copy(valid);
  tampered.deliveryRoom.workItems[1].title = "Fabricated title";
  await assert.rejects(
    () => verifyCosDeliveryRoomGeneration(tampered),
    /generationId does not match the received content/,
  );

  const calls = [];
  const result = await loadCosDeliveryRoom({
    relayUrl: "wss://forge-do.tailfe35cd.ts.net/",
    now: NOW,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => valid };
    },
  });

  assert.equal(
    cosDeliveryRoomEndpoint("wss://forge-do.tailfe35cd.ts.net/"),
    "https://forge-do.tailfe35cd.ts.net/api/mac-delivery-room/v1",
  );
  assert.equal(result.generationId, valid.generationId);
  assert.deepEqual(calls, [
    {
      url: "https://forge-do.tailfe35cd.ts.net/api/mac-delivery-room/v1",
      init: { cache: "no-store", signal: undefined },
    },
  ]);
});

test("measures freshness after a delayed response is received", async () => {
  const delayed = envelope();
  delayed.generationId = await cosDeliveryRoomGenerationId(delayed);
  let consumptionTime = NOW;

  await assert.rejects(
    () =>
      loadCosDeliveryRoom({
        relayUrl: "wss://forge-do.tailfe35cd.ts.net/",
        clock: () => consumptionTime,
        fetcher: async () => {
          consumptionTime = new Date("2026-07-31T09:21:00.000Z");
          return { ok: true, json: async () => delayed };
        },
      }),
    /generatedAt is stale or invalid/,
  );
});
