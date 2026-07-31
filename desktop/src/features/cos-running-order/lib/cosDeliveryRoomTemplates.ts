import type { DeliveryRoomTeamTemplate } from "./cosDeliveryRoomTypes.ts";

export const REVIEWED_TEAM_TEMPLATES = [
  {
    id: "senior-development-team",
    name: "Senior Development Team",
    decisionAuthority: "human",
    roles: [
      {
        key: "delivery_lead",
        label: "Delivery lead",
        purpose: "Owns synthesis and delivery clarity.",
        required: true,
      },
      {
        key: "builder",
        label: "Builder",
        purpose: "Implements the bounded change.",
        required: true,
      },
      {
        key: "isolated_reviewer",
        label: "Isolated reviewer",
        purpose: "Reviews independently from the builder.",
        required: true,
        independent: true,
      },
      {
        key: "deterministic_verification",
        label: "Deterministic verification",
        purpose: "Supplies reproducible gate evidence.",
        required: true,
        independent: true,
      },
    ],
  },
  {
    id: "planning-council",
    name: "Planning Council",
    decisionAuthority: "human",
    roles: [
      {
        key: "chair_synthesis",
        label: "Chair and synthesis",
        purpose: "Frames the decision and synthesises advice.",
        required: true,
      },
      {
        key: "feasibility_challenge",
        label: "Feasibility challenge",
        purpose: "Tests execution feasibility and dependencies.",
        required: true,
        independent: true,
      },
      {
        key: "independent_challenge",
        label: "Independent challenge",
        purpose: "Challenges assumptions when genuinely available.",
        required: false,
        independent: true,
      },
    ],
  },
  {
    id: "board-of-advisors",
    name: "Board of Advisors",
    decisionAuthority: "human",
    roles: [
      {
        key: "constraint",
        label: "Constraint",
        purpose: "Identifies the binding constraint.",
        required: true,
      },
      {
        key: "commercial_mechanism",
        label: "Commercial mechanism",
        purpose: "Tests how value is created and captured.",
        required: true,
      },
      {
        key: "cash_unit_economics",
        label: "Cash and unit economics",
        purpose: "Tests cash impact and unit economics.",
        required: true,
      },
      {
        key: "execution_ownership",
        label: "Execution and ownership",
        purpose: "Tests accountable ownership and delivery.",
        required: true,
      },
      {
        key: "protection",
        label: "Protection",
        purpose: "Tests downside, resilience, and defensibility.",
        required: true,
      },
      {
        key: "capital_independence",
        label: "Capital and independence",
        purpose: "Tests capital needs and retained independence.",
        required: true,
      },
    ],
  },
] as const satisfies readonly DeliveryRoomTeamTemplate[];
