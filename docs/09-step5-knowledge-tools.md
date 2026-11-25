# Step 5 — Bolna Knowledge Grounding and Signed Tools/Callbacks

Status: **complete — fixture, typecheck, lint, build, Prisma, and no-live-apply gates passed**

## Goal

Give the pinned Bolna agent a canonical, versioned knowledge base and port the legacy callback and HOT-lead WhatsApp behavior behind signed, idempotent platform endpoints. No phone call, live agent mutation, live knowledge upload, live workflow callback, or live WhatsApp message was performed for this gate.

Bolna documentation checked for this step:

- `POST /knowledgebase`, `GET /knowledgebase/all`, `GET /knowledgebase/{rag_id}`, `DELETE /knowledgebase/{rag_id}`
- knowledge base create accepts multipart form data with a PDF file or a URL, `chunk_size`, `similarity_top_k`, `overlapping`, and `language_support=multilingual`
- knowledge bases attach to agent v2 through `agent_type: "knowledgebase_agent"` and `vector_store.provider_config.vector_ids`
- custom functions use OpenAI-style definitions with `key: "custom_task"`, `pre_call_message`, `%()` parameter specifiers, and API parameters keyed by tool name
- `GET /workflows/{workflow_id}/nodes/{node_id}/callback` and `POST .../callback:rotate` return the live URL, slug, and 64-character hex signing secret
- workflow callbacks send `X-Bolna-Signature: sha256=<HMAC-SHA256>` over the exact raw body, keyed by the literal ASCII secret

## What changed

### Canonical knowledge config

Added `platform/lib/bolna/knowledge-config.ts`:

- reads `knowledge/service-overview.md` as the canonical source
- validates required facts: custom e-commerce websites, Razorpay, Stripe, both timelines, and discovery-call pricing
- rejects fixed-price and guaranteed-quote language
- pins `chunk_size: 512`, `similarity_top_k: 15`, `overlapping: 128`, and `language_support: "multilingual"`
- produces a deterministic SHA-256 source digest
- names the generated PDF `elevatebox-service-overview-<digest-prefix>.pdf`, so a source change creates a new knowledge base instead of silently reusing stale content
- generates a minimal single-page PDF locally because Bolna accepts PDF or URL, not Markdown
- defines fixture grounding questions that require source facts and reject fabricated timelines or fixed prices

Added `platform/lib/bolna/knowledge-types.ts` and extended `platform/lib/bolna/client.ts` with typed `createKnowledgeBase`, `listKnowledgeBases`, `getKnowledgeBase`, and `deleteKnowledgeBase`. The client sends `FormData` without forcing a JSON content type and rejects malformed provider responses with `BolnaResponseError`.

`buildElevateBoxAgentRequest()` now emits `knowledgebase_agent` plus `vector_store.provider_config.vector_ids` when processed knowledge base ids are configured. Without ids it stays on the Step 3 `simple_llm_agent` baseline.

### Signed custom-function tools

Added `platform/lib/bolna/tool-config.ts`:

- `schedule_callback`
- `trigger_hot_lead_whatsapp`

Both tools are deterministic, use `key: "custom_task"`, carry explicit descriptions and `pre_call_message`, and map arguments with `%()` specifiers. `tools_params` contains the signed POST URL, `Bearer` token, JSON content type, and parameter map. Invalid tokens, non-HTTPS public URLs, unknown tools, non-POST methods, and malformed parameter maps fail before any request.

Added `platform/lib/bolna/tool-auth.ts` for the inbound tool route:

- strong shared `BOLNA_TOOL_TOKEN` with timing-safe `Bearer` comparison
- source IP allowlist using Bolna's published tool/IP addresses by default
- body size limit with both `Content-Length` pre-check and raw body check
- explicit local-only unauthenticated escape hatch, never enabled by default

Added `platform/lib/bolna/tool-handler.ts` and `platform/lib/bolna/tool-store.prisma.ts`:

- strict argument validation, including IANA timezones and E.164 phone numbers
- callback time parsing ported into `platform/lib/services/callback-time.ts`, with English and Hindi/Telugu day/time cues
- deterministic invocation dedupe keyed by tool name, execution id, and normalized arguments
- durable `BolnaToolInvocation` claim/complete/fail lifecycle backed by a new Prisma migration
- HOT-lead WhatsApp ported into `platform/lib/services/whatsapp.service.ts`, reusing `AutomationEvent` dedupe and state transitions
- no live Twilio request in the gate; the send function is injectable for fixture tests

Added `platform/app/api/bolna/tools/[tool]/route.ts`, a dynamic Next.js Route Handler that keeps the raw body, applies auth/source/size gates, and returns typed JSON errors.

### Signed workflow callbacks

Added `platform/lib/bolna/callback-types.ts`:

- strict endpoint parser requiring an HTTPS URL, slug, and 64-character hex signing secret
- literal ASCII secret HMAC-SHA256 signing; the secret is never hex-decoded
- `sha256=<hex>` signature header
- secret redaction in HTTP error snippets

Added `platform/lib/bolna/callback-config.ts` with a canonical callback body builder that requires an E.164 phone and at least one correlation id (`leadId` or `executionId`).

Extended `platform/lib/bolna/client.ts` with `getWorkflowCallback`, `rotateWorkflowCallback`, and `postWorkflowCallback`. `postWorkflowCallback` signs the exact raw body, refuses to log the signing secret, and treats `429`/`5xx` as retryable.

### Live scripts

Added `pnpm bolna:knowledge:apply` (`scripts/bolna-knowledge-apply.ts`):

- no-op unless `BOLNA_RUN_KNOWLEDGE_APPLY=1`
- requires `BOLNA_EVAL_GATE=PASS`
- reuses a knowledge base only when the digest-stamped file name matches
- waits for `status: "processed"` guidance before printing the vector id to attach
- never places a call

Added `pnpm bolna:callback:smoke` (`scripts/bolna-callback-smoke.ts`):

- no-op unless `BOLNA_RUN_CALLBACK_SMOKE=1`
- requires `BOLNA_EVAL_GATE=PASS`
- fetches the live callback endpoint, signs a fixture event, and posts it
- never logs the signing secret and never places a call

`pnpm bolna:agent:apply` now reads `BOLNA_KNOWLEDGE_BASE_IDS`, `BOLNA_TOOLS_BASE_URL`, and `BOLNA_TOOL_TOKEN`. Both tool values must be set together or both omitted. The generated agent version digest changes when knowledge ids or tool config change.

## Environment

New variables are documented in `platform/.env.example`:

- `BOLNA_RUN_KNOWLEDGE_APPLY`
- `BOLNA_KNOWLEDGE_BASE_IDS`
- `BOLNA_TOOLS_BASE_URL`
- `BOLNA_TOOL_TOKEN`
- `BOLNA_TOOL_IP_ALLOWLIST`
- `BOLNA_TOOL_MAX_BODY_BYTES`
- `BOLNA_TOOL_ALLOW_UNAUTHENTICATED`
- `CALLBACK_DEFAULT_HOUR`
- `WHATSAPP_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`
- `BOLNA_RUN_CALLBACK_SMOKE`, `BOLNA_WORKFLOW_ID`, `BOLNA_CALLBACK_NODE_ID`, `BOLNA_CALLBACK_PHONE`, `BOLNA_CALLBACK_LEAD_ID`, `BOLNA_CALLBACK_EXECUTION_ID`

## Evals

Fixture evals live in `platform/tests/bolna-knowledge.test.ts` and `platform/tests/bolna-tools.test.ts`. All HTTP calls are to local test servers or injected fake fetch functions.

Covered cases:

1. Canonical knowledge source validation and deterministic plan/digest.
2. Rejection of sources missing required facts or promising fixed prices.
3. Valid single-page PDF generation.
4. Grounding answers require source facts and reject fabrication.
5. Malformed knowledge base responses fail closed.
6. Knowledge create/list/get/delete endpoints use multipart form data and bearer auth.
7. Knowledge ids and `api_tools` attach to a deterministic agent version.
8. Duplicate or non-UUID knowledge ids and tampered tool config are rejected.
9. Custom tool schemas use `custom_task`, OpenAI-style parameters, and `%()` specifiers.
10. Tool auth requires a strong token and allowed source IP.
11. Duplicate tool invocation is executed once.
12. Auth, source, size, JSON, and argument failures fail closed.
13. E.164 validation for callback and WhatsApp phone numbers.
14. Callback signatures detect tampering, missing headers, and malformed secrets.
15. Callback bodies require correlation ids and E.164 phones.
16. Callback endpoint parser rejects non-HTTPS URLs and malformed secrets.
17. Callback get/rotate/signed POST use documented contracts and sign raw bytes.
18. Callback error snippets never expose the signing secret.
19. Natural-language and explicit callback times resolve in the caller timezone.
20. HOT-lead WhatsApp message and Twilio request stay offline.

## Verification results

Run from `platform/`:

| Check | Command | Result |
|---|---|---|
| Evals and typecheck | `pnpm eval` | Pass, 70/70 |
| Step 5 fixture evals | `pnpm test` | 20/20 pass |
| Lint | `pnpm lint` | Pass |
| Production build | `pnpm build` | Pass |
| Prisma schema validation | `pnpm exec prisma validate` | Pass |
| Agent apply skip path | `pnpm bolna:agent:apply` | Pass with explicit SKIP |
| Extraction apply skip path | `pnpm bolna:extraction:apply` | Pass with explicit SKIP |
| Knowledge apply skip path | `pnpm bolna:knowledge:apply` | Pass with explicit SKIP |
| Callback smoke skip path | `pnpm bolna:callback:smoke` | Pass with explicit SKIP |

Generated Prisma migration: `platform/prisma/migrations/20261126000000_add_bolna_tool_invocations/migration.sql`. It was generated and schema-validated but not applied to a live database. Deploy with `pnpm prisma:migrate:deploy` when authorized.

No live knowledge base, workflow callback, tool invocation, WhatsApp message, agent version, promotion, or call was created for this gate.

## Gate decision

- Knowledge source/digest/PDF safety: **passed**
- Typed knowledge API and agent attachment: **passed**
- Grounding fixture evals: **passed**
- Custom tool schema and agent version digest: **passed**
- Inbound tool auth, dedupe, and argument safety: **passed**
- Callback HMAC, rotation parser, and secret safety: **passed**
- Callback time and WhatsApp behavior ported offline: **passed**
- Typecheck, lint, build, Prisma validation, explicit SKIP paths: **passed**

Step 5 is complete. The next work belongs in Step 6: telephony/SIP and cost-aware outbound/inbound canary planning, still gated before any live call.
