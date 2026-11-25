# Step 4 — Bolna Qualification Extraction and Summary Safety

Status: **complete — fixture, typecheck, lint, build, Prisma, and no-live-apply gates passed**

## Goal

Port the legacy LiveKit regex state and intent classification into Bolna's native post-call extraction system, normalize the nested result format into ElevateBox lead facts, and make sure Bolna's no-user-turn summary sentinel never becomes dashboard text.

No live phone call, live agent mutation, or live disposition registration was performed for this gate. All checks were fixture-driven and all live scripts were verified on their explicit SKIP path.

## Bolna contracts pinned

Documentation checked:

- `POST /agent/{agent_id}/extraction-categories` — create and attach one category
- `GET /agent/{agent_id}/extraction-categories` — list categories with their dispositions
- `POST /dispositions/` — create one disposition
- `POST /dispositions/bulk` — atomically create multiple dispositions
- `POST /v2/agent/{agent_id}/dispositions/test` — run all dispositions against a sample transcript
- extraction leaves are nested as `extracted_data[category][disposition_name]`
- each leaf carries `subjective`, `objective`, `confidence`, `confidence_label`, `status`, and `status_reason`
- top-level `summary` keeps working and is now sourced by Bolna's Call Summary extraction
- a call with no user turn returns `Summary not generated as there was no user turn`

## What changed

### Typed extraction API surface

Extended `platform/lib/bolna/client.ts` with:

- `createExtractionCategory(agentId, request)`
- `listExtractionCategories(agentId)`
- `createDisposition(request)`
- `createDispositionsBulk(request)`
- `testDispositions(agentId, request)`

Added `platform/lib/bolna/extraction-types.ts` with strict request/response parsers. Malformed provider data fails closed with `BolnaResponseError` instead of leaking unknown shapes into the dashboard.

### Qualification config-as-code

Added `platform/lib/bolna/qualification-config.ts`:

- one `Lead Qualification` category
- model `gpt-4.1-mini`
- `min_duration_s: 8`
- `skip_voicemail: true`
- no follow-up rules; this is a starting category
- deterministic SHA-256 digest in `createLeadQualificationPlan()`

The category owns the model and runs as **one LLM pass per eligible call**. Six dispositions live inside it:

| Disposition | Type | ElevateBox field |
|---|---|---|
| `business` | subjective text | `Lead.business` |
| `product_count` | subjective numeric | `Lead.productCount` |
| `budget` | subjective text | `Lead.budget` |
| `timeline` | subjective text | `Lead.timeline` |
| `features` | subjective text, comma list | `Lead.features` |
| `lead_intent` | objective options | `Lead.intent` |

`lead_intent` uses the configured values `HOT`, `WARM`, `COLD`, and `UNKNOWN`, replacing the legacy rule-based classifier with a provider-native extraction.

`validateLeadQualificationPlan()` rejects:

- empty category name or model
- invalid `min_duration_s`
- follow-up rules on the starting category
- duplicate disposition names
- dispositions with neither subjective nor objective enabled
- objective dispositions without non-empty `objective_options`
- regex dispositions without a pattern
- both `category` and `category_id` on one disposition

This keeps the config safe before any HTTP request.

### Grouped extraction normalization

Extended `platform/lib/bolna/webhook.ts`:

- `extractLeadFactsFromData(...sources)` reads Bolna's nested `category -> disposition -> result` format
- nested structured results take priority over legacy flat keys
- a low-confidence or skipped structured result is treated as **missing** and never falls back to a flat value
- `MIN_EXTRACTION_CONFIDENCE = 0.5`
- only `status: "completed"` results can project lead facts
- `objective` is preferred over `subjective`, matching Bolna's classification output

`extractLeadFacts(normalized)` now delegates to this normalizer for both `extracted_data` and `node_extracted_data`.

This retires flat `extracted_data` keys as the primary contract while keeping a fallback only when no structured result exists for that field.

### Summary safety

Added `sanitizeCallSummary()`:

- trims the flat top-level `summary`
- converts `Summary not generated as there was no user turn` to `null`
- preserves real summaries unchanged

`parseBolnaWebhookPayload()` applies this before the value reaches `BolnaWebhookEvent`, `BolnaExecution`, or `Call`. The dashboard therefore never displays Bolna's no-user-turn sentinel as a user-facing summary.

### Live apply script

Added `platform/scripts/bolna-extraction-apply.ts` and `pnpm bolna:extraction:apply`.

Safety gates:

- does nothing unless `BOLNA_RUN_EXTRACTION_APPLY=1`
- additionally requires `BOLNA_EVAL_GATE=PASS`
- requires `BOLNA_AGENT_ID`
- lists categories first and reuses the existing `Lead Qualification` category instead of blindly creating a duplicate
- creates only missing dispositions by name
- uses `category_id` from the actual category, never both `category` and `category_id`
- runs the code-switch transcript through `POST /v2/agent/{agent_id}/dispositions/test`
- asserts the grouped result matches the expected lead facts before reporting success
- never places a phone call
- does not print the API key or request body

New environment variable in `platform/.env.example`:

- `BOLNA_RUN_EXTRACTION_APPLY`

`BOLNA_EVAL_GATE` and `BOLNA_AGENT_ID` already existed and are reused.

## Evals

Fixture evals live in `platform/tests/bolna-extraction.test.ts` and use a local HTTP server. No live Bolna disposition endpoint was called.

Covered cases:

1. Qualification plan is deterministic, valid, and a starting category.
2. Invalid disposition configuration is rejected.
3. Dispositions attach by `category_id` and keep objective options.
4. Category create, category list, disposition create, disposition bulk create, and disposition test use the documented endpoints.
5. Requests carry bearer auth and category create does not duplicate `agent_id` in the body.
6. Nested results override legacy flat keys and produce expected lead facts.
7. Low-confidence results are treated as missing.
8. Skipped results never fall back to a flat legacy value.
9. Disposition test parser preserves grouped category/name structure.
10. English and code-switch fixtures both carry qualification signals.
11. No-user-turn summary sentinel is never stored as a summary.
12. Webhook normalization sanitizes summary and still extracts facts.

## Verification results

Run from `platform/`:

| Check | Command | Result |
|---|---|---|
| Evals and typecheck | `pnpm eval` | Pass, 50/50 |
| Step 4 fixture evals | `pnpm test` | 10/10 pass |
| Step 1 fixture evals | `pnpm test` | 10/10 pass |
| Step 2 fixture evals | `pnpm test` | 14/14 pass |
| Step 3 fixture evals | `pnpm test` | 16/16 pass |
| Lint | `pnpm lint` | Pass |
| Production build | `pnpm build` | Pass |
| Prisma schema validation | `pnpm exec prisma validate` | Pass |
| Agent apply skip path | `pnpm bolna:agent:apply` | Pass with explicit SKIP |
| Extraction apply skip path | `pnpm bolna:extraction:apply` | Pass with explicit SKIP |

No live category, disposition, agent version, promotion, or call was created for this gate.

## Gate decision

- Typed extraction API: **passed**
- Qualification config-as-code: **passed**
- Grouped extraction normalization: **passed**
- Low-confidence and skipped-result safety: **passed**
- Summary/no-user-turn safety: **passed**
- Secret-safe, no-live apply path: **passed**
- Typecheck, lint, build, Prisma validation: **passed**

Step 4 is complete. The next work belongs in Step 5: knowledge base grounding and signed tool/callback endpoints, still gated before any live canary call.
