# Step 12 — Offline Live-Canary Preflight

Status: **preflight harness complete — CURRENTLY BLOCKED pending real inputs; no live call placed.** This step prepares a review packet. It does not authorize or perform a call.

## Goal

Make the remaining retirement gate reviewable without contacting Bolna. The preflight re-runs the passing offline gates, validates the real carrier/trunk plan and cost inputs, masks the pinned call, and reports exactly which authorization fields are missing.

It is deliberately separate from `pnpm bolna:canary:run`, which is live-capable. The preflight always keeps `BOLNA_CANARY_DRY_RUN` enabled and returns `liveCallPlaced: false`.

## What changed

### Preflight packet — `platform/lib/bolna/canary-preflight.ts`

`runCanaryPreflight({ env })` performs eight checks:

1. `offline_transcript_gate` — re-runs the Step 7 transcript gate.
2. `offline_reliability_gate` — re-runs the Step 10 reliability/cost/load gate.
3. `offline_rollback_drill` — re-runs the Step 11 rollback drill.
4. `plan_complete` — builds and validates the canary trunk plan.
5. `cost_inputs` — loads real Bolna/carrier rates and passes the cost gate.
6. `call_pinning` — builds an immutable-version, single-call request.
7. `authorization_fields` — requires opt-in, eval gate, explicit authorization, matching run id, and reviewed plan digest.
8. `dry_run_default` — refuses any offline packet with `BOLNA_CANARY_DRY_RUN=0`.

It returns `READY_FOR_REVIEW` or `BLOCKED`, with reasons, missing input names, a deterministic SHA-256 digest, masked plan/call packets, offline gate digests, `networkRequests: 0`, `liveCallPlaced: false`, and the still-required live checks.

### Script — `pnpm bolna:canary:preflight`

`platform/scripts/bolna-canary-preflight.ts` loads env files but passes only an explicit allowlist of non-secret canary variables into the packet. `DATABASE_URL`, Bolna API keys, carrier passwords, tool tokens, and Twilio credentials are never included in output. The script exits non-zero when the packet is `BLOCKED`.

## Current preflight result

Command: `pnpm bolna:canary:preflight`

Result: **BLOCKED**, digest `1d100b8ae08d772f3d7c49acb03e2a03d69d7e73c42bb32605f617f00415673f`.

Offline gates are passing:

- Step 7 transcript: `2ed137b1455b3ef9e1edc279810655f0b303c49231931ecd1c33bceb48f9f436`
- Step 10 reliability: `8ca11ea4ddb9c1144b6fd8dc079282a0e6394aab554002642b373fd603f977bd`
- Step 11 rollback: `1b36bcfd2f540f8aa851e613946522518ee56acf7d336b2e5762e417f5532733`

Blocking reasons:

- No carrier gateways are configured, so the trunk plan is incomplete.
- Real Bolna/carrier rates are missing.
- Call pinning and authorization digest review cannot proceed until the plan is valid.

Missing non-secret inputs: `BOLNA_RUN_CANARY`, `BOLNA_EVAL_GATE`, `BOLNA_CANARY_AUTHORIZE`, `BOLNA_CANARY_RUN_ID`, `BOLNA_CANARY_AUTHORIZED_RUN_ID`, `BOLNA_CANARY_EXPECTED_PLAN_DIGEST`, `BOLNA_TRUNK_ID`, `BOLNA_TRUNK_GATEWAYS`, `BOLNA_TRUNK_CARRIER_IPS`, `BOLNA_TRUNK_NUMBERS`, `BOLNA_AGENT_ID`, `BOLNA_CANARY_VERSION_ID`, `BOLNA_CANARY_RECIPIENT_PHONE`, `BOLNA_CANARY_FROM_PHONE`, `BOLNA_VOICE_AI_PER_MINUTE`, `BOLNA_PLATFORM_FEE_PER_MINUTE`, `BOLNA_CARRIER_PER_MINUTE`, `BOLNA_CARRIER_CONNECTION_FEE`, `BOLNA_CANARY_MAX_COST_PER_CALL`, `BOLNA_CANARY_MAX_COST`.

No live call, provider request, trunk mutation, number mutation, agent mutation, knowledge upload, workflow callback, tool invocation, WhatsApp message, or database write was performed.

## How to proceed

1. Supply the real carrier gateways, carrier IP ranges, trunk number, pinned agent/version UUIDs, recipient/caller E.164 numbers, real Bolna and carrier rates, caps, and a canary run id.
2. Run `pnpm bolna:canary:preflight` and review the plan digest plus masked call packet.
3. Explicitly authorize the exact run id in review. Keep `BOLNA_CANARY_DRY_RUN=1` initially.
4. Run `pnpm bolna:canary:run`; it still performs read-only trunk checks and stays in dry-run by default.
5. Only after that dry-run passes and a human sets `BOLNA_CANARY_DRY_RUN=0` can one call be placed.

## Evals

`platform/tests/bolna-canary-preflight.test.ts` adds 7 offline evals covering a complete review packet, missing authorization, dry-run lock, poisoned network, secret masking, deterministic digests, and blocked empty inputs.

## Verification results

| Check | Command | Result |
|---|---|---|
| Evals and typecheck | `pnpm eval` | Pass, 142/142 |
| Step 12 fixture evals | `node --test tests/bolna-canary-preflight.test.ts` | Pass, 7/7 |
| Live-canary preflight | `pnpm bolna:canary:preflight` | BLOCKED as expected; `networkRequests: 0`, `liveCallPlaced: false` |
| Lint | `pnpm lint` | Pass |
| Production build | `pnpm build` | Pass |
| Prisma schema validation | `pnpm exec prisma validate` | Pass |
