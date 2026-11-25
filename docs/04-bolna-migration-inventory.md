# Bolna Migration Inventory — Step 0

Status: **Step 8 harness complete — no live call placed**

## Decision

ElevateBox is migrating from LiveKit Agents to **Bolna as the primary voice runtime**.

The Next.js dashboard and Prisma database remain the business source of truth for leads, callbacks, automations, call history, costs, and evaluation results.

Bolna owns:

- agent configuration
- telephony and SIP
- streaming STT / LLM / TTS
- endpointing, interruption, and language switching
- executions, transcripts, recordings, and per-turn debug data
- knowledge bases
- post-call extractions and call summary
- outbound calls and batch campaigns

ElevateBox owns:

- lead identity and CRM state
- callback records
- WhatsApp automation records
- normalized call/execution history
- costs and budgets
- webhook durability and idempotency
- eval suites and release gates
- admin dashboard

## Freeze policy for `my-agent/`

`my-agent/` is now **legacy/rollback-only**.

- Do not add new features to `my-agent/`.
- Do not build new dashboard features on LiveKit events.
- Critical fixes are allowed only if they are required to keep the rollback path operational.
- New work belongs in the platform Bolna provider layer.
- `my-agent/` stays in the repository until the Bolna cutover gate passes.
- Any change inside `my-agent/` needs explicit approval and must be recorded in this document.

## Source-of-truth boundaries

| Concern | Source of truth during migration |
|---|---|
| Product requirements | `README.md` + `docs/` |
| Canonical service knowledge | `knowledge/service-overview.md`, mirrored into a digest-stamped Bolna PDF knowledge base |
| Lead and callback business state | Prisma DB |
| Voice execution state | Bolna execution |
| Final call result | Bolna `completed` execution + our normalized `CallExecution` |
| Webhook delivery proof | Raw webhook payload stored in our DB |
| Agent configuration | Bolna agent version, generated from platform code |
| Release history | Bolna agent versions + our `EvalRun` records |

## Capability inventory

| Capability | Current location | Current implementation | Bolna target | Action | Eval gate |
|---|---|---|---|---|---|
| Agent runtime entrypoint | `my-agent/src/main.ts` | LiveKit worker via `defineAgent` and `cli.runApp` | Bolna v2 agent config | Retire worker after cutover | Agent create/version smoke test |
| Main orchestration | `my-agent/src/agent.ts` | Custom LiveKit room audio handling and manual turns | Bolna conversation agent | Port behavior into agent config + tools | Static transcript + live canary evals |
| Custom STT | `my-agent/src/stt/*` | 2.5s PCM chunks sent to Whisper HTTP API | Bolna transcriber config | Retire custom chunk pipeline | STT accuracy, latency, code-switch evals |
| VAD / turn-taking | `my-agent/src/agent.ts` | `stt: null`, `vad: null`, `turnDetection: "manual"` | Bolna Engine tab + transcriber endpointing/interruption settings | Replace with Bolna-native tuning | Pause, backchannel, interruption, latency evals |
| Sales prompt | `my-agent/src/prompts/sales.ts` | English prompt with injected conversation-state JSON | Per-language Bolna system prompt + welcome message | Port and simplify | Prompt regression evals |
| Conversation state | `my-agent/src/conversation/state.ts` | Regex extraction into in-memory object | Bolna dispositions/extractions + DB snapshots | Port fields to extraction schema | Slot F1 ≥ 90% |
| Intent classification | `my-agent/src/intent/classifier.ts` | Rule-based HOT/WARM/COLD/UNKNOWN | `lead_intent` disposition | Port rules to extraction definition | Intent accuracy ≥ 90% |
| Lead persistence | `my-agent/src/intent/persistence.ts` | Direct Prisma service call from agent | Webhook processor + platform service | Move behind webhook normalization | Idempotency replay test |
| RAG | `my-agent/src/rag/index.ts` | Raw pgvector retrieval with external embeddings | Bolna knowledge base | Generate digest-stamped PDF and attach vector ids to agent v2 | Grounding eval; no fabricated facts |
| Knowledge source | `knowledge/service-overview.md` | Markdown source for RAG ingest | Bolna knowledge base source | Preserve locally; mirror to Bolna | Step 5 canonical source/digest/PDF evals |
| Call summary | `my-agent/src/summary/call-summary.ts` | LiveKit inference LLM summary at track end | Bolna Call Summary extraction; optional fallback summary worker | Enable call summary; compare quality | Summary factuality ≥ 95% |
| HOT WhatsApp | `my-agent/src/automation/whatsapp.ts` | Twilio WhatsApp call from agent | Bolna custom function → platform API | Ported to signed tool endpoint with durable dedupe | Step 5 E.164, offline send, duplicate send = 0 |
| Callback scheduling | `my-agent/src/automation/callback.ts` | Natural-language parser creates DB callback | Bolna custom function + platform API | Ported parser to platform service behind signed tool | Step 5 timezone and dedupe evals |
| Outbound dialing | `my-agent/src/callback-worker.ts` | LiveKit `createSipParticipant` + dispatch | Bolna `POST /call`, batch, or workflow campaign | Retire LiveKit worker | Canary calls; terminal-status handling |
| Inbound calls | Not implemented in current agent | LiveKit room entry assumed | Bolna inbound number → agent mapping | Add in telephony step | 10 inbound canary calls |
| SIP trunk | LiveKit outbound trunk ID | LiveKit SIP | Bolna phone numbers or `/trunk` API | Choose per region/carrier | Echo test + SIP trunk call eval |
| Call records | `platform/lib/services/call.service.ts` | Created from LiveKit room lifecycle | Normalized from Bolna execution webhooks | Rebuild lifecycle mapping | Webhook replay + reconciliation eval |
| Callback records | `platform/lib/services/callback.service.ts` | DB polling worker | DB records triggered by tools/executions | Keep model, replace dialer | Duplicate callback tool call test |
| Automation events | `platform/lib/services/automation.service.ts` | Dedup for WhatsApp automation | Same DB model, driven by tool calls | Keep model | Duplicate event = 0 |
| Dashboard | `platform/app/*` | Read-only LiveKit-era views | Bolna execution/event views | Migrate after provider layer exists | E2E dashboard eval |
| Tests | `my-agent/src/agent.test.ts` | LiveKit starter evals | Bolna eval suite | Replace with fixture-driven evals | Eval report with pass/fail |

## Files intentionally preserved for reference

These files are frozen, not deleted:

- `my-agent/src/agent.ts`
- `my-agent/src/main.ts`
- `my-agent/src/config.ts`
- `my-agent/src/callback-worker.ts`
- `my-agent/src/conversation/state.ts`
- `my-agent/src/intent/*`
- `my-agent/src/prompts/*`
- `my-agent/src/rag/*`
- `my-agent/src/automation/*`
- `my-agent/src/summary/*`
- `my-agent/src/stt/*`
- `my-agent/src/agent.test.ts`

They are useful as a behavioral reference during the port.

## Retire order

LiveKit is removed only after all of these are true:

1. Bolna API client is stable.
2. Webhook processing passes idempotency and replay evals.
3. Agent config-as-code and versioning work.
4. Qualification/extraction evals pass.
5. Multilingual and code-switch evals pass.
6. Knowledge and tool evals pass.
7. Outbound and inbound canary calls pass.
8. Batch campaign evals pass.
9. Dashboard operates from normalized Bolna data.
10. Reliability/cost/load gates pass.
11. Rollback drill is documented and tested.

## Security finding

A token-like comment was found at the end of `platform/prisma/schema.prisma` and removed from the working tree during Step 0.

If that value was ever a real credential, it must be **rotated**, because removing it from the current file does not remove it from Git history.

## Progress

- **Step 0:** complete — LiveKit frozen and migration inventory recorded.
- **Step 1:** complete — see `05-step1-bolna-foundation.md`. Both offline evals and the live `GET /user/me` smoke passed.
- **Step 2:** complete — see `06-step2-webhook-normalization.md`. Durable webhook intake, idempotency, terminal-status guards, replay evals, and corrected Bolna-compatible webhook security (URL token + source IP allowlist + execution verification) passed.
- **Step 3:** complete — see `07-step3-agent-config-versioning.md`. Deterministic agent config, immutable versions, pinned call requests, multilingual/VAD baseline, and secret-safe API evals passed.
- **Step 4:** complete — see `08-step4-extraction-summary.md`. Typed extraction/disposition APIs, deterministic qualification config, grouped extraction normalization, confidence/skip guards, no-user-turn summary safety, and no-live apply gates passed.
- **Step 5:** complete — see `09-step5-knowledge-tools.md`. Digest-stamped knowledge PDF creation, typed KB API, agent KB attachment, signed custom tools with durable dedupe, HMAC-signed workflow callbacks, ported callback/WhatsApp behavior, and explicit SKIP/nightly-safe live paths passed.
- **Step 6:** planning complete — see `10-step6-telephony-canary.md`. Typed `/trunk` APIs, trunk/canary plan safety, cost-aware worst-case estimation and caps, agent telephony provider config-as-code, outbound call pinning, inbound readiness checks, and explicit SKIP/offline-only scripts passed. **No live trunk, number, agent mutation, or call was created.**
- **Step 7:** offline gate complete — see `11-step7-static-transcript-gate.md`. Structured en/hi/te/code-switch transcript parsing, offline webhook → extraction → lead projection, summary safety, signed tool dedupe, callback signature safety, offline WhatsApp alert, and a deterministic pre-call gate digest passed with zero network requests. **No live call was placed.**
- **Step 8:** harness complete — see `12-step8-live-canary-harness.md`. A nine-check, fail-closed execution gate, a default-SKIP/dry-run-first single-call runner, reviewed plan digest binding, real readiness/cost checks, and 12 offline evals passed. **No live call, trunk mutation, or agent mutation was performed.**

## Next step

All offline gates and the live-canary harness are complete. An actual live canary still requires separate, explicit authorization with real carrier details, rate inputs, and a reviewed plan digest. The Step 6 readiness and cost checks must be run against those real inputs immediately before the call. No live call is authorized until that gate is granted.

Gate for Step 1:

- clean install/build/typecheck
- Prisma generation wired correctly
- Bolna API client with typed errors
- `GET /user/me` smoke check
- no secret logging
- env validation for `BOLNA_API_KEY`
