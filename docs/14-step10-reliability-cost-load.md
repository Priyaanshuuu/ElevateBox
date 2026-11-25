# Step 10 — Offline Reliability, Cost, and Load Gate

Status: **complete — offline gate PASS, no live call placed.** Step 10 is fixture-driven and requires no env vars, no PostgreSQL writes, and no Bolna requests.

## Goal

Satisfy the retire-order requirement "Reliability/cost/load gates pass" before any LiveKit retirement or live canary. The gate proves that the existing webhook, tool, and cost logic behaves correctly under replay, out-of-order delivery, store failure, and concurrent bursts — using only in-memory adapters and pure functions.

This is **not** a production load test and **not** live-call authorization. It asserts correctness invariants (cardinality, ordering, dedupe, and cost caps), not latency or throughput against real infrastructure.

## What changed

### In-memory webhook store — `platform/lib/bolna/memory-webhook-store.ts`

An exported, deterministic `BolnaWebhookStore` implementation for offline use:

- `MemoryWebhookStore` tracks events, executions, calls, leads, processed events, and failed events.
- `ReliabilityStoreError` plus `failProcessedEvents` fault injection simulate a durable write failure after projection.
- `snapshot()` returns cardinalities for gate assertions.
- No Prisma, provider client, or network dependency.

### Offline gate — `platform/lib/bolna/reliability-gate.ts`

`runReliabilityGate(input)` composes existing pure functions and in-memory adapters. It returns PASS/FAIL, 13 named checks, reasons, a deterministic SHA-256 digest, metrics, `networkRequests: 0`, and the still-required live checks.

Checks:

1. `input_validation` — burst limits, call cap, and positive cost caps.
2. `webhook_replay` — one accepted delivery and one duplicate produce one event, execution, call, and lead.
3. `key_order_dedupe` — reordered JSON keys produce the same dedupe key.
4. `out_of_order` — a late `in-progress` webhook never downgrades a terminal execution or call.
5. `terminal_refresh` — a repeated `completed` status refreshes recorded cost without duplicating the call.
6. `non_terminal_guard` — `call-disconnected` stays non-terminal and creates no call or lead.
7. `missing_phone` — a missing phone number stores the event but creates no business records.
8. `store_failure_recovery` — a processed-event write failure marks the event failed and is recovered by idempotent replay.
9. `concurrent_webhook_load` — 32 simultaneous identical deliveries produce exactly one call.
10. `concurrent_tool_load` — 16 simultaneous signed tool invocations execute the handler exactly once.
11. `tool_pending_claim` — an in-flight claim returns HTTP 202 without re-executing.
12. `cost_gate` — fixture rates and caps produce a positive worst-case estimate that passes the budget gate.
13. `budget_failure` — over-budget and invalid-concurrency inputs fail closed.

Load sizes can be overridden with `webhookBurst` (2–128) and `toolBurst` (2–64); invalid inputs fail closed before any scenario runs. Cost inputs can be overridden with `rates`, `callCapSeconds`, `perCallCap`, and `canaryCap`. The defaults are explicit fixtures, **not real carrier or Bolna rates**.

### Script — `pnpm bolna:reliability:gate`

`scripts/bolna-reliability-gate.ts` prints the gate digest, checks, reasons, metrics, live checks still required, and `networkRequests: 0`, then exits non-zero on FAIL. It loads env files only for consistency with the other scripts; no variable is required by the gate.

### Exports

`platform/lib/bolna/index.ts` re-exports the gate, check names, result types, memory store, and fault-injection error.

## Evals

`platform/tests/bolna-reliability-gate.test.ts` adds 12 offline evals covering all checks, deterministic digests, invalid-input fail-closed behavior, poisoned `fetch`, and direct memory-store fault recovery. The poisoned-network eval proves the gate never attempts an HTTP request.

## Verification results

Run from `platform/`:

| Check | Command | Result |
|---|---|---|
| Evals and typecheck | `pnpm eval` | Pass, 127/127 (12 new Step 10 evals) |
| Step 10 fixture evals | `node --test tests/bolna-reliability-gate.test.ts` | Pass, 12/12 |
| Offline gate script | `pnpm bolna:reliability:gate` | PASS, `networkRequests: 0` |
| Lint | `pnpm lint` | Pass |
| Production build | `pnpm build` | Pass |
| Prisma schema validation | `pnpm exec prisma validate` | Pass |

Default gate digest: `8ca11ea4ddb9c1144b6fd8dc079282a0e6394aab554002642b373fd603f977bd`.

No live call, trunk mutation, number mutation, agent mutation or promotion, knowledge upload, workflow callback, tool invocation against a live endpoint, WhatsApp message, or database write was performed. The only live Bolna request in the migration remains the Step 1 `GET /user/me` smoke.

## Still required before a live call

1. Step 6 canary readiness against the real carrier trunk.
2. Step 6 cost gate with real Bolna and carrier rates.
3. Step 8 explicit live canary authorization with a reviewed plan digest.
