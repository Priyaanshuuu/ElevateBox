# Step 11 — Offline Rollback Drill

Status: **complete — offline drill PASS, no rollback executed, no live call placed.** This is a documentation and readiness drill for reverting from Bolna to the frozen LiveKit runtime. It does not switch runtimes by itself.

## Rollback triggers

Rollback is considered only when one of these is true and an operator records explicit approval in `docs/04-bolna-migration-inventory.md`:

- Bolna webhook, tool, or provider intake is unavailable or unsafe for an unacceptable period.
- A live or dry-run canary reveals a correctness, safety, or cost-cap breach.
- Normalized Bolna data is corrupted and cannot be trusted for the dashboard.
- A provider security incident requires inbound intake to be stopped immediately.

This drill places no live call; no live call is authorized by this document alone.

## Preconditions

- `my-agent/` is the rollback reference: a frozen LiveKit Agents project with `src/main.ts` as the worker entrypoint and `src/callback-worker.ts` for callback-triggered SIP calls. Do not add features to it. Do not edit it for this drill.
- Keep all three Prisma migrations as **additive migrations** in forward order. Do not run `prisma migrate dev`, `prisma migrate deploy`, `prisma studio`, or any hand-written reverse SQL during rollback. Reversing them would drop provider data and is not part of the rollback path.
- Keep the git working tree clean for the drill. Any critical rollback fix inside `my-agent/` needs explicit approval and a record in `docs/04-bolna-migration-inventory.md`.
- In the rollback environment, keep these live opt-ins unset or explicitly off: `BOLNA_RUN_LIVE_SMOKE`, `BOLNA_WEBHOOK_ALLOW_UNAUTHENTICATED`, `BOLNA_RUN_AGENT_APPLY`, `BOLNA_ALLOW_PROMOTE`, `BOLNA_EVAL_GATE`, `BOLNA_RUN_EXTRACTION_APPLY`, `BOLNA_RUN_KNOWLEDGE_APPLY`, `BOLNA_TOOL_ALLOW_UNAUTHENTICATED`, `BOLNA_RUN_CALLBACK_SMOKE`, `BOLNA_RUN_TRUNK_CHECK`, `BOLNA_RUN_CANARY`, `BOLNA_CANARY_EXPECTED_PLAN_DIGEST`, `BOLNA_CANARY_AUTHORIZE`, `BOLNA_CANARY_AUTHORIZED_RUN_ID`. Keep `BOLNA_CANARY_DRY_RUN=1` if the canary script exists but is not being used.
- Never print or copy `DATABASE_URL`, Bolna credentials, carrier credentials, webhook/tool tokens, or Twilio credentials into an evidence record.
- There is no runtime feature flag. Rollback is a procedural change of deployed worker and provider intake, not a database mutation.

## Rollback steps

1. **Stop Bolna intake.** Disable or return a controlled error from `api/bolna/webhook/[token]` and `api/bolna/tools/[tool]` at the deployment/load-balancer layer. Do not delete the route files or provider rows; retaining them preserves the audit trail and makes restore-forward possible.
2. **Stop live automation.** Keep all live opt-ins from `platform/.env.example` off. In particular, do not run `bolna:smoke`, `bolna:agent:apply`, `bolna:extraction:apply`, `bolna:knowledge:apply`, `bolna:callback:smoke`, `bolna:trunk:check`, or `bolna:canary:run`. `BOLNA_RUN_CANARY` must remain unset/off, and `BOLNA_CANARY_DRY_RUN` must remain `1` unless a separately authorized live canary is pending.
3. **Deploy the frozen worker.** From `my-agent/`, install with the pinned lockfile and Node/pnpm versions, supply LiveKit and STT credentials from the operator secret store, and start `pnpm start`. Start `pnpm callback:worker` only after confirming callback state and only when callback placement is explicitly required.
4. **Keep business history intact.** Leave `Lead`, `Call`, `Callback`, `AutomationEvent`, `BolnaExecution`, `BolnaWebhookEvent`, and `BolnaToolInvocation` rows in place. Hide Bolna-specific dashboard panels if they confuse operators, but keep the read-only normalized data available for audit.
5. **Record the decision.** Note the trigger, approver, commit/rollback revision, masked flag states, start time, and verification results in `docs/04-bolna-migration-inventory.md`.

## Verification

Offline checks first, with no env loading and no provider access:

- `pnpm eval`
- `pnpm bolna:transcript:gate`
- `pnpm bolna:reliability:gate`
- `pnpm bolna:rollback:drill`

Then, only with explicit approval, perform a LiveKit canary call and verify:

- The frozen worker joins and completes the call with the expected en/hi/te behavior.
- New `Lead`, `Call`, and `Callback` rows are created through the legacy path.
- No Bolna webhook/tool route writes occur while rollback intake is disabled.
- Callback/WhatsApp automations behave according to the frozen agent settings.

## Restore forward

1. Stop the LiveKit worker and callback worker only after the rollback window is closed and approved.
2. Re-enable `api/bolna/webhook/[token]` and `api/bolna/tools/[tool]`.
3. Re-run Step 6 readiness/cost checks with real trunk and carrier rates, Step 8 gates with a fresh reviewed plan digest, and Step 10 offline gates.
4. Restore the dashboard Bolna panels and confirm normalized events are current.
5. Place no call until `BOLNA_RUN_CANARY`, `BOLNA_CANARY_AUTHORIZE`, the matching authorized run id, and the reviewed digest have passed again. `BOLNA_CANARY_DRY_RUN` stays `1` until explicit live authorization.
6. Record the restore-forward result in `docs/04-bolna-migration-inventory.md`.

## Evidence record

Store only non-secret evidence: timestamp, actor, reason, approval reference, deployed revision, masked flag state (`set`/`unset`, never values), offline gate digests, and live verification outcome. Secret values must stay in operator secret storage and `platform/.env.local`, which is gitignored.

## Offline drill result

`pnpm bolna:rollback:drill` verifies the frozen entrypoints, freeze banners, runbook sections, additive migration order, provider route inventory, live-capable script inventory, documented opt-ins, offline gate stack, and a network-free runner. It returns `rollbackExecuted: false` and `networkRequests: 0`. Recorded digest: `1b36bcfd2f540f8aa851e613946522518ee56acf7d336b2e5762e417f5532733`.

All 12 checks pass, with 17 required artifacts, 20 scanned legacy files, 3 additive migrations, 2 provider routes, 7 live-capable scripts, 15 live opt-ins, and 7 offline commands inventoried. No rollback was executed, no runtime was switched, no database was written, and no provider request or live call was made. The only live Bolna request in the migration remains the Step 1 `GET /user/me` smoke.
