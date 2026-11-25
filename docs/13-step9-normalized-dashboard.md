# Step 9 — Dashboard Operates From Normalized Bolna Data

Status: **complete — no live call placed.** Step 9 is an offline read-path migration: the dashboard now exposes the normalized provider records that Steps 2 and 5 already persist. No Prisma schema change, migration, mutation endpoint, or provider request was added.

## Goal

The admin/current e-commerce dashboard previously read only the projected `Lead`, `Call`, `Callback`, and `AutomationEvent` tables. `BolnaExecution`, `BolnaWebhookEvent`, and `BolnaToolInvocation` were written by webhook/tool ingestion but had no read path, so provider status, raw outcome, transcript source, cost, recording, extraction JSON, telephony data, webhook replay metadata, and tool results were invisible to operators.

This step makes those normalized records first-class, read-only dashboard data while keeping the Next.js dashboard and Prisma database the business source of truth.

## What changed

### Pure projection adapter — `platform/lib/bolna/dashboard-projection.ts`

A provider-boundary adapter converts persisted Bolna rows into display models without importing Prisma, the Bolna client, or `DATABASE_URL`:

- `projectExecutionListItem()` / `projectExecutionDetail()` — raw status plus mapped internal `CallStatus`, terminal flag, direction, masked agent version, duration, cost, recording, linked call, transcript, summary, termination reason, error, and formatted JSON for cost breakdown, extraction, node-level extraction, and telephony payloads.
- `projectWebhookEvent()` — event type, raw status, source IP, received/processed/failed times, error, payload presence, and a sanitized header view.
- `projectToolInvocation()` — tool name, status, dedupe key, result JSON, and error.
- `buildBolnaOperationsSummary()` — counts executions, terminal executions, failed executions, webhook events, failed events, tool invocations, failed invocations, and the sum of recorded costs.
- `formatDashboardJson()` / `formatDashboardCost()` / `sanitizeDashboardHeaders()` — deterministic display helpers. Header sanitization drops `authorization`, `cookie`, `api-key`, `token`, and `secret` keys before rendering; large JSON is truncated at a fixed length.

Raw statuses are never guessed: `call-disconnected` remains non-terminal with a null internal status, matching the Step 2 guard that prevents a non-terminal webhook from finalizing a call.

### Read layer — `platform/lib/dashboard-bolna.ts`

Server-only getters backed by the existing Prisma models:

- `getBolnaExecutions()` — executions with linked lead/call identity.
- `getBolnaExecutionDetail(id)` — an execution by its internal row id or provider execution id, with its webhook events and tool invocations.
- `getBolnaEvents()` — webhook deliveries with execution status and caller number.
- `getBolnaToolInvocations()` — signed tool call records.
- `getBolnaOperationsSummary()` — aggregate metrics.
- `getExecutionForCall(executionId)` — the normalized execution linked to a call detail page.

### Pages and navigation

- `/executions` — provider execution history with outcome, direction, version, number, duration, and recorded cost.
- `/executions/[id]` — full execution detail: provider identifiers, telephony/cost fields, recording, linked call, transcript, summary, raw JSON payloads, webhook events, tool invocations, and provider timestamps.
- `/events` — webhook deliveries and tool invocations, with collapsible payload/header and result inspection. Sensitive headers are never rendered.
- `/` — adds provider metrics and a recent-execution table alongside the existing business metrics.
- `/calls/[id]` — adds a normalized Bolna execution panel when the call has a `bolnaExecutionId`.
- Sidebar adds Executions and Events; the runtime label now says Bolna instead of LiveKit.

All pages remain async Server Components with the existing `DashboardShell`, `StatusBadge`, `formatDate`, and try/catch error fallback conventions. No client components, forms, fetch calls, or mutation endpoints were added.

### Exports and styling

`platform/lib/bolna/index.ts` re-exports the projection functions and types. `platform/app/globals.css` gains status classes for raw Bolna terminal outcomes and styles for inspectable payload sections.

## Evals

`platform/tests/bolna-dashboard-projection.test.ts` adds 9 offline evals:

1. Terminal raw status maps to the internal call status; ids are short and version is masked.
2. `call-disconnected` stays non-terminal with no internal status.
3. Execution detail exposes every normalized field, including raw JSON payloads and linked call id.
4. Missing transcript/summary produce explicit empty-state copy.
5. Sensitive webhook headers are redacted and safe headers are preserved.
6. Tool invocation results and errors are rendered without losing status.
7. Large JSON payloads are truncated deterministically.
8. Operation summary counts terminal/failed rows and sums recorded costs accurately.
9. Missing and non-finite costs render as an empty value.

The evals use fixture objects only. They never connect to PostgreSQL or Bolna.

## Verification results

Run from `platform/`:

| Check | Command | Result |
|---|---|---|
| Evals and typecheck | `pnpm eval` | Pass, 115/115 (9 new Step 9 evals) |
| Step 9 fixture evals | `node --test tests/bolna-dashboard-projection.test.ts` | Pass, 9/9 |
| Lint | `pnpm lint` | Pass |
| Production build | `pnpm build` | Pass — `/executions`, `/executions/[id]`, and `/events` added to the route table |
| Prisma schema validation | `pnpm exec prisma validate` | Pass |

No live call, trunk mutation, number mutation, agent mutation or promotion, knowledge upload, workflow callback, tool invocation, or WhatsApp message was performed. The only live Bolna request in the migration remains the Step 1 `GET /user/me` smoke. A live canary still requires the separate explicit authorization described in `12-step8-live-canary-harness.md`.
