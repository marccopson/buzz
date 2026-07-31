# COS-745 Delivery Room implementation plan

## Done condition

MAC Workspace presents the signed COS Delivery Room projection as a read-only,
manager-first desktop and phone view. Invalid, stale, contradictory or
unverifiable input never renders as delivery truth. Existing Workspace access
gating and non-Delivery-Room behaviour remain unchanged.

## Contract-to-UI map

| Projection field | UI state | Fail-closed rule |
| --- | --- | --- |
| Envelope `schemaVersion`, `readOnly`, `generationId` | Trusted read-only source banner | Reject unsupported schema, writable authority or malformed generation identity |
| `source.status`, source evidence and timestamps | Source health and freshness | Only `fresh` plus current reconciliation and agent-health evidence may render |
| `attention.needsManager` | Fixed **Needs Marc** attention strip | IDs must exactly match work with `needs_manager` health |
| `attention.blockedOrStalled` | Fixed **Blocked or stalled** attention strip | IDs must exactly match `stalled` or `unavailable` work |
| Five `stages` | Ready → Building → Independent Review → Staging Verification → Complete | Exact stage set and card membership must agree with each work item |
| `workItems` narrative fields | Plain-English title, why, current activity and next action | Missing narrative is invalid; Jira key is secondary only |
| `owner`, `objectiveGates`, `evidence` | Owner, gate status and evidence freshness | Non-pending gates require current evidence of the required kind and matching outcome |
| `participants.state` | Working, Reviewing, Waiting, Available, Needs you, Stalled or Unavailable | Active states require current evidence; no other state is accepted |
| Team participation arrays | Evidenced participation counts and details | Invitations never count; actual/contributing IDs must reconcile to attributed evidence |
| `contributions`, `dissent`, `synthesis`, `signOff` | Detailed team-room thread | Only current, actor-attributed human evidence can establish participation or authority |
| `teamTemplates.decisionAuthority` | Human-authority notice | Each reviewed room template must remain human-authorised |

## Implementation and verification

1. Replace the legacy running-order adapter with a strict Delivery Room v1
   client for `/api/mac-delivery-room/v1`.
2. Replace the technical running-order screen with the manager attention strip,
   evidenced team rooms, five-stage delivery flow and detailed card/team views.
3. Keep the existing `/running-order` route and `running_order` entitlement for
   backward-compatible navigation while relabelling it **Delivery Room**.
4. Add parser and E2E regressions for freshness, contradictions, stage mapping,
   participation, language, attention order, access gating and desktop/phone
   layouts.
5. Run targeted tests, repository `just ci`, deterministic desktop/phone UI
   captures and a live read-only dependency probe. No dispatch, Jira mutation,
   merge, deployment or production authority is added.

## Out of scope

Dispatching agents, changing Jira, merging pull requests, deploying revisions
and granting production authority remain explicitly unavailable.
