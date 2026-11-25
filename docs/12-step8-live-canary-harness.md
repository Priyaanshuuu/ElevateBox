# Step 8 — Gated Live Canary Execution Harness

Status: **harness complete — no live call placed.** The runner is `SKIP` by default and stays in dry-run even after opt-in unless a call is explicitly authorized.

## Goal

Turn the already-passing offline gates into a single, fail-closed path that *could* place one canary call — but only after real carrier/trunk facts, a real cost gate, a reviewed plan digest, and explicit human authorization all agree. This step adds the harness and its evals. It does **not** authorize or perform a call.

The earlier gates still hold: no live call was allowed until the static transcript, extraction, summary, and prior evals passed. Step 7 supplied that offline gate; this step consumes it.

## What changed

### Execution gate — `platform/lib/bolna/canary-execution.ts`

`evaluateCanaryExecutionGate()` returns PASS/FAIL, nine named checks, failure reasons, and a deterministic SHA-256 digest covering the check statuses, reviewed plan digest, pinned agent/version, caller ID, and recipient. Checks:

1. `live_opt_in` — `BOLNA_RUN_CANARY=1`
2. `eval_gate` — `BOLNA_EVAL_GATE=PASS`
3. `explicit_authorization` — `BOLNA_CANARY_AUTHORIZE=1` plus a run id that matches `BOLNA_CANARY_AUTHORIZED_RUN_ID`
4. `offline_gate` — Step 7 pre-call gate is PASS
5. `plan_digest_reviewed` — an explicitly configured digest matches the reviewed trunk plan digest
6. `live_readiness` — Step 6/trunk readiness against the real trunk is PASS
7. `cost_gate` — worst-case cost gate is PASS with a projected cost above zero
8. `single_call` — exactly one planned call and one concurrent call
9. `call_pinning` — UUID agent version, E.164 caller ID from the plan's own trunk numbers, `user_data.canary === true`, no retry config, no guardrail bypass

`runCanaryExecution()` is deliberately small: on FAIL it never touches the provider; in dry-run it returns `DRY_RUN` without calling `placeCall`; only with all gates passing and `BOLNA_CANARY_DRY_RUN=0` does it call `placeCall` once and return `PLACED` with the execution id. Call placement is injected as a dependency, so the entire runner is testable offline.

### Script — `pnpm bolna:canary:run`

`platform/scripts/bolna-canary-run.ts`:

- **Default `SKIP`** unless `BOLNA_RUN_CANARY=1`.
- Fails before any live HTTP request when the cheap authorization flags are missing (`BOLNA_EVAL_GATE`, `BOLNA_CANARY_AUTHORIZE`, matching run id).
- Rebuilds the trunk plan from env with `canaryTrunkPlanFromEnv()` and refuses to continue if its digest differs from the reviewed digest.
- Re-runs the full Step 7 offline transcript gate.
- Builds a pinned, single-call request with `buildOutboundCanaryCallRequest()`.
- Computes worst-case cost from real Bolna and carrier rates with `estimateWorstCaseCallCost()` and `evaluateCanaryCostGate()`.
- Performs only read-only provider checks: `GET /trunk/pop`, `GET /trunk/trunks/{id}`, and optionally failed trunk calls.
- Evaluates live readiness with `evaluateCanaryReadiness()`.
- Passes everything to the execution gate. Dry-run is the default (`BOLNA_CANARY_DRY_RUN=1`); placing a call requires explicitly setting it to `0`.
- Reports a masked call payload, gate checks, plan/offline/gate digests, and `no live call was placed` unless the call was actually placed. It never logs API keys, the carrier password, the callback signing secret, or full phone numbers.

No agent mutation or promotion is performed by this script. The agent version must already be registered and pinned.

### Env documentation

Added the Step 8 opt-in variables to `platform/.env.example`: `BOLNA_RUN_CANARY`, `BOLNA_CANARY_EXPECTED_PLAN_DIGEST`, `BOLNA_CANARY_AUTHORIZE`, `BOLNA_CANARY_AUTHORIZED_RUN_ID`, `BOLNA_CANARY_DRY_RUN` (default `1`), and `BOLNA_CANARY_INSPECT_FAILURES`.

## Evals

`platform/tests/bolna-canary-execution.test.ts` adds 12 offline evals:

1. All nine gate checks pass with valid opt-in, authorization, digest, and pinned call.
2. Missing opt-in/eval-gate/explicit authorization fails closed.
3. Stale plan digest and altered plan block the canary.
4. Failed offline, readiness, or cost gate blocks the canary.
5. More than one planned or concurrent call fails closed.
6. Unpinned, foreign-caller-ID, retrying, or guardrail-bypassing calls fail closed.
7. Gate digest is deterministic and changes with the pinned call.
8. Dry run passes all gates but calls no provider.
9. Explicit live mode places exactly one pinned call and returns the execution id.
10. A failed gate never invokes `placeCall`.
11. The env-built trunk plan matches the reviewed plan digest.
12. Unsafe carrier IPs and non-E.164 numbers in env fail before review.

## Verification results

Run from `platform/`:

| Check | Command | Result |
|---|---|---|
| Evals and typecheck | `pnpm eval` | Pass, 106/106 |
| Step 8 fixture evals | `node --test tests/bolna-canary-execution.test.ts` | Pass, 12/12 |
| Canary runner default path | `pnpm bolna:canary:run` | Pass with explicit SKIP |
| Lint | `pnpm lint` | Pass |
| Production build | `pnpm build` | Pass |
| Prisma schema validation | `pnpm exec prisma validate` | Pass |
| Agent/extraction/knowledge/callback/trunk-check SKIP paths | `pnpm bolna:agent:apply`, `pnpm bolna:extraction:apply`, `pnpm bolna:knowledge:apply`, `pnpm bolna:callback:smoke`, `pnpm bolna:trunk:check` | Pass with explicit SKIP |

No live call, trunk mutation, number mutation, agent mutation, promotion, knowledge upload, workflow callback, tool invocation, or WhatsApp message was performed. The only live Bolna request in the migration remains the Step 1 `GET /user/me` smoke.

## Remaining gate for an actual call

A live canary is **not** authorized by this step. Before running it, supply real carrier gateways/IPs/numbers, real Bolna and carrier rates, and a reviewed plan digest; then run the Step 6 readiness/cost checks against those inputs immediately before the call. Only after a separate, explicit authorization may `BOLNA_CANARY_DRY_RUN=0` be set.
