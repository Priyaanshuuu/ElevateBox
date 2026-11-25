# Step 2 — Bolna Webhook Normalization and Durable Intake

Status: **complete — fixture, replay, typecheck, lint, build, and Prisma gates passed**

> Correction applied before Step 4: Bolna does **not** sign outgoing call webhooks and does **not** provide a webhook signing secret. The earlier `BOLNA_WEBHOOK_SECRET` / `X-Webhook-Secret` design was removed. Securing this endpoint now uses the mechanisms Bolna actually supports.

## Goal

Accept Bolna call/webhook deliveries safely, preserve the raw payload as delivery proof, normalize it into durable platform records, and prevent duplicate or late events from corrupting call state.

The hard rule for this step: **`call-disconnected` is never a final result**. Duration, cost, recording, transcript, and extracted data are only projected from `completed` or a hard-failure terminal status.

## What changed

### Data model

Added under `platform/prisma/schema.prisma`:

- `BolnaExecution`
  - normalized execution state keyed by stable `executionId`
  - agent, agent version, batch, caller/agent numbers, provider call id
  - status, termination reason, error message
  - terminal-only fields: recording URL, duration, cost, cost breakdown, transcript, summary, extracted data
  - raw telephony data and Bolna timestamps
- `BolnaWebhookEvent`
  - raw webhook payload and safe headers
  - unique `dedupeKey`
  - received/processed/failed timestamps
  - source IP and normalized status
- `Call.bolnaExecutionId`
  - links the existing dashboard `Call` row to a normalized Bolna execution

Migration added:

- `platform/prisma/migrations/20261125120000_add_bolna_webhook_projection/migration.sql`

The migration has been generated and the schema validates, but it has **not** been applied to a live database during this offline gate. Deploy it with `pnpm prisma:migrate:deploy`.

### Webhook normalization

Added `platform/lib/bolna/webhook.ts`:

- accepts both `execution_id` and `id` execution identifiers
- normalizes status, direction, phone number, timestamps, telephony fields, costs, recording, transcript, summary, and extraction payloads
- distinguishes terminal success (`completed`) from hard failures (`no-answer`, `busy`, `failed`, `canceled`, `stopped`, `error`, `balance-low`, `aborted`)
- treats `call-disconnected` as **non-terminal**
- maps Bolna statuses into the existing internal `CallStatus` values
- extracts lead facts from nested disposition/extraction payloads
- builds a stable dedupe key from execution id plus a canonical JSON digest, so object key order does not create false duplicates
- sanitizes stored headers so authorization, cookies, webhook secrets, and API keys are never persisted

Added `platform/lib/bolna/errors.ts`:

- `BolnaWebhookError` for malformed webhook payloads

### Durable intake boundary

Added:

- `platform/lib/bolna/webhook-store.ts` — provider-neutral store interface
- `platform/lib/bolna/webhook-store.prisma.ts` — Prisma implementation
- `platform/lib/bolna/webhook-service.ts` — idempotent ingestion and projection logic
- `platform/app/api/bolna/webhook/[token]/route.ts` — Next.js 16 route handler with the token in the URL path

Ingestion rules:

1. Reject invalid payloads and missing execution ids.
2. Check the unique dedupe key; an exact replay returns `duplicate` and creates no extra side effects.
3. Upsert the normalized execution.
4. Store the raw event with safe headers and processing state.
5. Project into `Call` and `Lead` only when a mapped status exists.
6. Project terminal-only fields only from terminal events.
7. Never let a different late status overwrite a terminal result.
8. Allow a repeated identical terminal status to refresh finalized fields.
9. Mark the event processed, or mark it failed without leaking error details.

### Webhook security

Bolna's documented security model for outbound webhooks is:

> “There is no HMAC signature on webhook payloads or tool call requests in the current version. Source IP verification is the primary trust mechanism.”  
> — [Security & data handling](https://www.bolna.ai/docs/concepts/security.md)

Bolna sends webhooks from:

- `13.203.39.153`
- `13.126.9.249`
- `13.202.133.53`

The endpoint therefore uses three layers:

1. **Secret URL token**
   - route: `/api/bolna/webhook/<BOLNA_WEBHOOK_URL_TOKEN>`
   - token is compared with `crypto.timingSafeEqual`
   - token must be at least 32 characters
   - generate one with `openssl rand -hex 32`
   - the same token must be appended to `BOLNA_WEBHOOK_URL`

2. **Source IP allowlist**
   - production defaults to all three Bolna IPs
   - configurable with `BOLNA_WEBHOOK_IP_ALLOWLIST`
   - local mode may disable the allowlist only through explicit `BOLNA_WEBHOOK_ALLOW_UNAUTHENTICATED=1`
   - app-level checks use `x-forwarded-for`, `cf-connecting-ip`, or `x-real-ip`; enforce the same allowlist at the firewall or load balancer for a trustworthy boundary

3. **Source-of-truth execution verification**
   - enabled by default in production
   - for terminal webhooks only, fetch `GET /executions/{execution_id}` with `BOLNA_API_KEY`
   - accept only if Bolna reports the same terminal status
   - verification failure returns `502` so Bolna can retry; mismatch returns `409`

There is **no** `BOLNA_WEBHOOK_SECRET` and no expected `X-Webhook-Secret` header. Workflow Callback node signing secrets are for webhooks we send into Bolna and are unrelated to this endpoint.

Environment variables in `platform/.env.example`:

- `BOLNA_WEBHOOK_URL_TOKEN`
- `BOLNA_WEBHOOK_ALLOW_UNAUTHENTICATED`
- `BOLNA_WEBHOOK_IP_ALLOWLIST`
- `BOLNA_WEBHOOK_MAX_BODY_BYTES`
- `BOLNA_WEBHOOK_VERIFY_EXECUTION`
- `BOLNA_WEBHOOK_URL`

### Typed execution verification client

Added to `platform/lib/bolna/client.ts`:

- `getExecution(executionId)` for `GET /executions/{execution_id}`

Added to `platform/lib/bolna/types.ts`:

- `BolnaExecutionSnapshot`
- `parseBolnaExecutionSnapshot()` with strict typed parsing

This keeps verification provider-specific code in the Bolna adapter instead of leaking into the webhook service or dashboard.

## Evals

Fixture/replay evals live in `platform/tests/bolna-webhook.test.ts` and run with Node's built-in test runner against an in-memory store.

Covered cases:

1. Completed execution normalizes and projects finalized fields.
2. Duplicate replay creates no duplicate events, executions, calls, or leads.
3. Dedupe key ignores JSON object key order.
4. `call-disconnected` never finalizes cost, transcript, recording, or call status.
5. A late non-terminal event cannot downgrade a terminal projection.
6. A repeated terminal status refreshes finalized fields without duplicate side effects.
7. Missing phone number stores the event without creating lead or call.
8. All hard-failure statuses map to `FAILED`; `completed` maps to `COMPLETED`.
9. Workflow-style webhook payloads with `execution_id` are accepted.
10. Missing, short, and wrong URL tokens are rejected.
11. Webhook config requires a URL token outside explicit local mode.
12. Production config defaults to Bolna source IPs and execution verification.
13. Sanitized headers drop authorization, cookies, and API keys.
14. Custom source IP allowlist rejects unknown IPs.

Step 3 fixture evals in `platform/tests/bolna-agent.test.ts` also cover the typed `GET /executions/{id}` snapshot used by verification.

## Verification results

Run from `platform/`:

| Check | Command | Result |
|---|---|---|
| Prisma schema validation | `pnpm exec prisma validate` | Pass |
| Prisma client generation | `pnpm prisma:generate` | Pass |
| Evals and typecheck | `pnpm eval` | Pass |
| Step 1 foundation evals | `pnpm test` | 10/10 pass |
| Step 2 webhook/replay evals | `pnpm test` | 14/14 pass |
| Step 3 agent/version evals | `pnpm test` | 16/16 pass |
| Total evals | `pnpm test` | 40/40 pass |
| Lint | `pnpm lint` | Pass |
| Production build | `pnpm build` | Pass |
| Live agent apply script | `pnpm bolna:agent:apply` | Pass with explicit SKIP |

No live calls or live webhook deliveries were made for this gate.

## Gate decision

- Webhook normalization: **passed**
- Idempotent replay: **passed**
- Terminal-status safety: **passed**
- URL-token/IP/source verification security: **passed**
- Secret-safe intake: **passed**
- Typecheck, lint, build, Prisma validation: **passed**

Step 3 may proceed.
