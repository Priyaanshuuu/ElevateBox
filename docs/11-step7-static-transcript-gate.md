# Step 7 — Static Transcript Pre-Call Gate

Status: **complete — offline pipeline, typecheck, lint, build, Prisma, and no-live gates passed. No live call was placed.**

## Goal

Prove, without any network access, that a finished call transcript flows through the whole ElevateBox pipeline and produces the expected persisted state before a live canary is authorized. This is the last offline gate named in the migration requirement: no live call is allowed until static transcript, extraction, summary, and prior evals pass.

This step is **offline only**. It does not create a trunk, register a number, mutate an agent, invoke a live tool endpoint, or place a call. Live readiness and real cost inputs from Step 6 are still explicitly required afterward.

## What changed

### Structured static transcripts

Added `platform/lib/bolna/transcript-eval.ts`:

- `StaticTranscript`, `TranscriptTurn`, `TranscriptSpeaker`, and `TranscriptScript` types
- `parseStaticTranscript()` turns `Agent:` / `User:` dialogue strings into ordered, speaker-tagged turns and rejects unknown speakers, missing separators, empty turns, and unsupported languages
- script detection for Latin, Devanagari, and Telugu text
- deterministic SHA-256 transcript digest
- `extractTranscriptSignals()` reads business, product count, budget, timeline, features, callback request, and hot-intent cues from user turns across English, Hindi, and Telugu
- `evaluateStaticTranscript()` checks agent/user turns, terminal status, summary safety, language coverage, code-switch visibility, and agreement between transcript signals and extracted lead facts

This is a fixture-analysis gate, not a replacement for Bolna's endpointing/VAD or LLM extraction. Pause handling remains config-driven in the agent, and extraction remains provider-native.

### Offline transcript fixtures

Added `platform/lib/bolna/transcript-fixtures.ts`:

- four static cases: English, Hindi, Telugu, and Hindi-English code-switch
- all four carry the same expected qualification facts (`Acme Store`, 120 products, 50000 budget, 4 weeks, catalog/checkout/WhatsApp, HOT intent) so language handling is isolated from fact extraction
- `buildTranscriptWebhookPayload()` creates a terminal Bolna webhook body with transcript, grouped extraction, summary, telephony, and cost data
- `TRANSCRIPT_TOOL_CALLS` contains signed `schedule_callback` and `trigger_hot_lead_whatsapp` invocations
- deterministic fixture digest covering transcript text and tool calls

### Offline gate runner and aggregation

Added `platform/lib/bolna/transcript-gate-runner.ts`:

- normalizes each webhook payload with `parseBolnaWebhookPayload()`
- projects facts with `extractLeadFacts()` and compares them with the expected facts
- evaluates each transcript with `evaluateStaticTranscript()`
- confirms the no-user-turn summary sentinel is sanitized while real summaries survive
- replays each tool call through `handleBolnaToolRequest()` with `createMemoryToolStore()`, asserting one execution and a `duplicate: true` replay
- verifies callback signatures over the exact body and rejects tampering
- builds the WhatsApp alert from transcript context without calling Twilio
- performs all of this with no `fetch` and no database

Added `platform/lib/bolna/precall-gate.ts`: `evaluatePreCallGate()` aggregates transcript, extraction, summary, tool dedupe, callback signature, and WhatsApp-offline checks into a PASS/FAIL result with a deterministic digest and a `liveChecksRequired` list.

### Script

Added `pnpm bolna:transcript:gate` (`scripts/bolna-transcript-gate.ts`). It is fully offline, prints a masked per-transcript report plus fixture/gate digests, and exits non-zero on FAIL. It never reads or writes live provider state.

The gate output explicitly lists the remaining live checks:

1. Step 6 canary readiness against the real carrier trunk.
2. Step 6 cost gate with real Bolna and carrier rates.
3. Explicit live canary authorization with a reviewed plan digest.

## Evals

Fixture evals live in `platform/tests/bolna-transcript-e2e.test.ts`. They use in-memory stores and a throwing `fetch` stub; no HTTP or provider call is made.

Covered cases:

1. Parser produces ordered, speaker-tagged turns and detects Latin/Devanagari/Telugu scripts.
2. Transcript digests are deterministic and change with text.
3. Malformed transcripts, unknown speakers, empty turns, and unsupported languages fail closed.
4. Signal extraction reads all qualification facts from a code-switch transcript.
5. All four transcripts pass the end-to-end transcript evaluation.
6. Webhook normalization projects the expected facts for every language case.
7. No-user-turn summary is removed while real summaries survive.
8. Transcript tool calls execute once and replay is flagged duplicate.
9. Callback signatures verify the exact body and reject tampering.
10. WhatsApp alert is built offline from transcript context.
11. Gate succeeds with `fetch` replaced by a throwing stub.
12. Pre-call gate fails on any missing/failed transcript or offline check.
13. Pre-call gate digest is deterministic and reflects transcript changes.

## Verification results

Run from `platform/`:

| Check | Command | Result |
|---|---|---|
| Evals and typecheck | `pnpm eval` | Pass, 94/94 |
| Step 7 fixture evals | `pnpm test` | 13/13 pass |
| Offline transcript gate | `pnpm bolna:transcript:gate` | Pass, 0 network requests |
| Lint | `pnpm lint` | Pass |
| Production build | `pnpm build` | Pass |
| Prisma schema validation | `pnpm exec prisma validate` | Pass |
| Trunk check skip path | `pnpm bolna:trunk:check` | Pass with explicit SKIP |
| Agent apply skip path | `pnpm bolna:agent:apply` | Pass with explicit SKIP |
| Extraction/knowledge/callback skip paths | `pnpm bolna:extraction:apply`, `pnpm bolna:knowledge:apply`, `pnpm bolna:callback:smoke` | Pass with explicit SKIP |

No live category, disposition, knowledge base, workflow callback, tool invocation, WhatsApp message, trunk, number, agent version, promotion, or call was created for this gate. The only live Bolna request in the migration remains the Step 1 `GET /user/me` smoke.

## Gate decision

- Static transcript parser and script/signal coverage: **passed**
- End-to-end transcript → webhook → extraction → lead state: **passed**
- Summary safety: **passed**
- Signed tool dedupe and callback signature safety: **passed**
- Offline-only execution with zero network requests: **passed**
- Typecheck, lint, build, Prisma validation, explicit SKIP paths: **passed**

Step 7 offline gate is complete. A live canary still requires a separate, explicit authorization after real carrier details and rates are supplied and the Step 6 readiness/cost checks are run against them. No live call is authorized by this gate.
