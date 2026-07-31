import assert from "node:assert/strict";
import test from "node:test";

import {
  cosDeliveryRoomEndpoint,
  cosDeliveryRoomGenerationId,
  loadCosDeliveryRoom,
  projectCosDeliveryRoom,
  teamThreadForWork,
  verifyCosDeliveryRoomGeneration,
} from "./cosDeliveryRoom.ts";

const NOW = new Date("2026-07-31T09:05:00.000Z");
const CURRENT = "2026-07-31T09:04:00.000Z";

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

function template(id, name) {
  return {
    id,
    name,
    decisionAuthority: "human",
    roles: [
      {
        key: "lead",
        label: "Lead",
        purpose: "Own evidenced room synthesis.",
        required: true,
      },
    ],
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
      teamTemplates: [
        template("senior-development-team", "Senior Development Team"),
        template("planning-council", "Planning Council"),
        template("board-of-advisors", "Board of Advisors"),
      ],
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
