# Step 3 — Bolna Agent Configuration-as-Code and Versioning

Status: **complete — fixture, typecheck, lint, and build gates passed**

## Goal

Make the agent definition deterministic, reviewable, and versioned before any live call is placed. The live agent is never mutated by an eval or a routine deploy: every candidate is saved as a new Bolna agent version and pinned with `agent_version_id` for testing. Promotion is a separate, explicit operation.

## What changed

### Typed Bolna API surface

Extended `platform/lib/bolna/client.ts` with:

- `POST /v2/agent` — create an agent; expects `201`, `state: "created"`, and `version_id`
- `POST /v2/agent/{agent_id}/versions` — save an immutable candidate version without changing the live agent
- `GET /v2/agent/{agent_id}/versions` — list versions and identify `is_current`
- `POST /v2/agent/{agent_id}/versions/{version_id}/set_current` — explicit promotion/rollback only
- `POST /call` — place a call, optionally pinned to a specific `agent_version_id`

Added `platform/lib/bolna/agent-types.ts` with typed request shapes and strict response parsers. Malformed provider responses fail closed with `BolnaResponseError`.

### Config-as-code

Added `platform/lib/bolna/agent-config.ts`:

- `createElevateBoxAgentSpec()` builds the canonical ElevateBox sales agent definition.
- `validateElevateBoxAgentSpec()` rejects unsafe or incomplete configs before any HTTP request.
- `buildElevateBoxAgentRequest()` compiles the spec into the Bolna v2 payload.
- `buildAgentVersionPlan()` creates a deterministic config digest and a version request tagged with `config-sha256:<digest>`.

The compiled agent includes:

- `toolchain.pipelines: [["transcriber", "llm", "synthesizer"]]`
- `trunk` telephony with `linear16` input/output, not legacy `sip-trunk`
- `call_summary_enabled: true`
- a 600-second call cap and voicemail detection for cost and stuck-call control
- a response cap of 180 generated tokens, low verbosity, and an 8,000-token context compaction threshold

### Multilingual behavior

The agent is configured for English (`en`), Hindi (`hi`), and Telugu (`te`):

- starts in `en` by default
- `language_switch_trigger: "requested_or_auto_detected"`
- native-script system prompts, welcome messages, and handoff messages per language
- per-language synthesizers with provider language fields where Bolna requires them

The prompts intentionally **do not** contain language-switching instructions. Mid-call switching remains a Bolna platform behavior, so a full sentence in another supported language switches recognition, voice, and replies while the conversation continues with preserved context.

`POST /call` builders use `agent_data.language` and keep it consistent with `user_data.agent_language`. Calls always pin an evaluated version via `agent_version_id`.

### VAD, endpointing, and pauses

Turn handling is configured in the provider config, not inferred by the LLM from silence:

- transcriber `endpointing: 250ms`
- linear delay `450ms`
- VAD threshold `0.5`, prefix padding `300ms`
- interruption word count `2`
- backchanneling enabled
- noise cancellation level `80`
- user-online detection after `12s` of silence
- prompts explicitly tell the agent to wait through quiet moments and not interpret silence

This is the Step 3 baseline. Live pause/backchannel/interruption evals are still required before cutover.

### Immutable version flow

Added `platform/lib/bolna/agent-versioning.ts`:

- `registerCandidateAgentVersion()` either creates a new agent or saves a new version on an existing agent
- `promoteAgentVersion()` is the only code path that calls `set_current`
- `buildElevateBoxCallRequest()` requires a version id and validates E.164 numbers
- `formatBolnaScheduledAt()` enforces the two-minute minimum and rounds up to the next 10-minute boundary using `+00:00`, never `Z`

Routine candidate registration never calls `PUT /v2/agent/{agent_id}` and never calls `set_current`.

### Live apply script

Added `platform/scripts/bolna-agent-apply.ts` and `pnpm bolna:agent:apply`.

Safety gates:

- does nothing unless `BOLNA_RUN_AGENT_APPLY=1`
- requires an HTTPS `BOLNA_WEBHOOK_URL`
- requires real voice ids from the Bolna catalog for all three languages
- does not print the request body or API key
- promotes only when both `BOLNA_ALLOW_PROMOTE=1` and `BOLNA_EVAL_GATE=PASS` are set

New environment variables are documented in `platform/.env.example`.

## Evals

Fixture evals live in `platform/tests/bolna-agent.test.ts` and use a local HTTP server. No live Bolna agent was created and no call was placed.

Covered cases:

1. Placeholder voice ids and unsafe webhook URLs are rejected.
2. Toolchain is an array of arrays in the exact expected order.
3. Token, duration, and cost guardrails are present in the payload.
4. `en`/`hi`/`te` multilingual config and trigger are correct.
5. Prompts contain no language-switching instructions.
6. Voice provider configs include required per-language fields.
7. Endpointing, VAD, interruption, pause, and user-online settings are present.
8. Config digest is deterministic and changes with prompt edits.
9. `POST /v2/agent` parses `201`, `state`, and `version_id`.
10. Existing agent registration only calls the versions endpoint and never mutates the live agent.
11. `set_current` is reachable only through the explicit promote function.
12. Version list response is normalized correctly.
13. `POST /call` pins `agent_version_id` and sets the starting language.
14. `scheduled_at` is rounded, uses `+00:00`, and rejects calls less than two minutes away.
15. Malformed call inputs and conflicting language variables are rejected.
16. API keys are redacted from API errors and nothing is logged.
17. `GET /executions/{id}` returns a typed snapshot for webhook verification.

## Verification results

Run from `platform/`:

| Check | Command | Result |
|---|---|---|
| Evals and typecheck | `pnpm eval` | Pass |
| Step 3 fixture evals | `pnpm test` | 16/16 pass |
| Total evals | `pnpm test` | 40/40 pass |
| Lint | `pnpm lint` | Pass |
| Production build | `pnpm build` | Pass |
| Live apply skip path | `pnpm bolna:agent:apply` | Pass with explicit SKIP |

No live agent creation, version save, version promotion, or call was performed for this gate.

## Gate decision

- Config-as-code: **passed**
- Deterministic digest/version naming: **passed**
- Immutable version vs. live mutation boundary: **passed**
- Multilingual/code-switch config: **passed**
- VAD/endpointing/pause baseline: **passed**
- Pinned call request and `scheduled_at` gotchas: **passed**
- Secret-safe API behavior: **passed**
- Typecheck, lint, build: **passed**

Step 4 may proceed: qualification/extraction and summary evals against the pinned candidate version.
