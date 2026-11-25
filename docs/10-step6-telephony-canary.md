# Step 6 — SIP Trunk and Cost-Aware Canary Planning

Status: **complete — offline fixture, typecheck, lint, build, Prisma, and no-live gates passed. No live call was placed.**

## Goal

Add typed Bolna SIP trunk contracts, trunk/plan safety validation, explicit cost accounting, and a pre-call canary readiness check. This step is **planning only**: it prepares the configuration and guards needed before any real inbound or outbound canary call. No trunk, number, agent mutation, or call was created against Bolna.

Bolna documentation checked for this step:

- `GET /trunk/trunks`, `POST /trunk/trunks`, `GET /trunk/trunks/{trunk_id}`
- `POST /trunk/trunks/{trunk_id}/gateways`, `POST /trunk/trunks/{trunk_id}/ip-acls`
- `POST /trunk/trunks/{trunk_id}/numbers`, `PATCH /trunk/numbers/{number_id}`
- `GET /trunk/pop` for SIP domain, signalling IPs, port, transports, and RTP ports
- `GET /trunk/trunks/{trunk_id}/calls` with `direction`, `limit`, and `number` filters
- `PATCH /v2/agent/{agent_id}` with `agent_config.telephony_provider: "trunk"`
- `POST /call` with `from_phone_number` matching a trunk number
- Carrier minutes are billed separately from the Bolna flat per-minute rate; non-preferred STT/LLM/TTS models move components to variable rates

## What changed

### Typed trunk contracts

Added `platform/lib/bolna/trunk-types.ts`:

- parsers for trunks, gateways, carrier IP ACLs, trunk numbers, connection details, and trunk call lists
- strict limits from the Bolna docs: name 1–100, description ≤ 500, channels 1–1000, at most 8 gateways, at most 32 carrier IPs, `udp|tcp` transport, codecs limited to `PCMU`/`PCMA`
- public IPv4 / `/16`-or-narrower CIDR validation for carrier IPs and gateway hosts; private, loopback, link-local, and broad ranges fail closed
- E.164 validation for trunk numbers and call participants; UUID validation for agent, version, number, and trunk ids
- request validators/serializers for trunk create, gateway, number, carrier IP, and agent telephony patch
- auth username/password must be set together, with forbidden-character checks; passwords are redacted from HTTP error snippets

Extended `platform/lib/bolna/client.ts` with `listTrunks`, `getTrunk`, `createTrunk`, `getTrunkConnectionDetails`, `listTrunkCalls`, `addTrunkGateway`, `addTrunkCarrierIp`, `addTrunkNumber`, `assignTrunkAgent`, and `patchAgentTelephonyProvider`. All use the documented `/trunk` paths — not the legacy `/sip-trunks` endpoints. `request()` now accepts explicit extra secrets to redact, so a carrier password is never echoed in an error.

### Canary plan and readiness

Added `platform/lib/bolna/trunk-config.ts`:

- environment-driven `CanaryTrunkPlan` with a deterministic SHA-256 digest
- canary-specific caps: at most 4 channels and 5 numbers
- requires at least one gateway, one carrier IP range, and one or more E.164 trunk numbers
- requires a default inbound agent or an agent on every number, so inbound calls cannot be silently refused
- the carrier password value is never part of the plan or its digest; only the environment variable *name* is stored
- masked plan output for safe logging

Added `platform/lib/bolna/canary-plan.ts`:

- `buildOutboundCanaryCallRequest()` pins a UUID agent id and UUID agent version id, requires `from_phone_number` to be one of the planned trunk numbers, supports only `en`/`hi`/`te`, tags calls with `user_data.canary` and a run id, and never sets retry/bypass-guardrail flags
- `evaluateCanaryReadiness()` checks active/enabled state, `ready` or `waiting_for_carrier` health, free channel capacity, gateways, carrier IPs, number registration, registered caller ID, inbound agent binding, edge transport match, codec support, RTP range, plan digest, and cost gate

### Cost-aware gate

Added `platform/lib/bolna/call-cost.ts`:

- explicit rates for Bolna Voice AI, Bolna platform fee, carrier per-minute, carrier connection fee, carrier minimum minutes, and carrier billing increment
- worst-case estimate over the full call cap, including carrier rounding and minimums, with Bolna and carrier charges kept separate
- `evaluateCanaryCostGate()` fails on non-preferred STT/LLM/TTS models, too many planned calls, too many concurrent calls, per-call cap breach, or total canary budget breach

### Agent config

`buildElevateBoxAgentRequest()` now emits `telephony_provider` from a validated `default | trunk` option. `pnpm bolna:agent:apply` reads `BOLNA_TELEPHONY_PROVIDER`; the value stays `default` until a carrier trunk and number exist in Bolna. Changing this value changes the agent version digest, so a candidate version is created instead of mutating a live agent.

### Scripts

- `pnpm bolna:trunk:plan` — offline only. Builds and validates the canary plan, call request, cost estimate, and cost gate from env, then prints a masked plan. It fails closed on missing or unsafe config and performs no network request.
- `pnpm bolna:trunk:check` — read-only live check. SKIPs unless `BOLNA_RUN_TRUNK_CHECK=1`; requires `BOLNA_EVAL_GATE=PASS`; fetches `/trunk/pop`, trunks, one trunk, and failed call history, then prints masked numbers. It never creates a trunk or places a call.

No script in this step can place a call. Call construction exists only as a pure, evaluated function for a later, explicitly authorized live canary step.

## Environment

New variables are documented in `platform/.env.example`: `BOLNA_TELEPHONY_PROVIDER`, `BOLNA_RUN_TRUNK_CHECK`, `BOLNA_TRUNK_ID`, `BOLNA_TRUNK_NAME`, `BOLNA_TRUNK_DESCRIPTION`, `BOLNA_TRUNK_PRESET`, `BOLNA_TRUNK_INBOUND_ENABLED`, `BOLNA_TRUNK_OUTBOUND_ENABLED`, `BOLNA_TRUNK_CHANNELS`, `BOLNA_TRUNK_TRANSPORT`, `BOLNA_TRUNK_CODECS`, `BOLNA_TRUNK_OUTBOUND_LEADING_PLUS`, `BOLNA_TRUNK_GATEWAYS`, `BOLNA_TRUNK_CARRIER_IPS`, `BOLNA_TRUNK_NUMBERS`, `BOLNA_TRUNK_DEFAULT_AGENT_ID`, `BOLNA_TRUNK_INBOUND_AGENT_ID`, `BOLNA_TRUNK_AUTH_USERNAME`, `BOLNA_TRUNK_AUTH_PASSWORD_ENV`, `BOLNA_TRUNK_AUTH_PASSWORD`, `BOLNA_CANARY_VERSION_ID`, `BOLNA_CANARY_RECIPIENT_PHONE`, `BOLNA_CANARY_FROM_PHONE`, `BOLNA_CANARY_LANGUAGE`, `BOLNA_CANARY_CUSTOMER_NAME`, `BOLNA_CANARY_RUN_ID`, `BOLNA_CANARY_CALL_CAP_SECONDS`, `BOLNA_CANARY_PLANNED_CALLS`, `BOLNA_CANARY_MAX_CALLS`, `BOLNA_CANARY_MAX_CONCURRENT`, `BOLNA_CANARY_PREFERRED_MODELS`, `BOLNA_CANARY_CURRENCY`, `BOLNA_VOICE_AI_PER_MINUTE`, `BOLNA_PLATFORM_FEE_PER_MINUTE`, `BOLNA_CARRIER_PER_MINUTE`, `BOLNA_CARRIER_CONNECTION_FEE`, `BOLNA_CARRIER_MINIMUM_MINUTES`, `BOLNA_CARRIER_BILLING_INCREMENT_SECONDS`, `BOLNA_CANARY_MAX_COST_PER_CALL`, and `BOLNA_CANARY_MAX_COST`.

Never put the carrier password in `BOLNA_TRUNK_*` planning variables other than the dedicated `BOLNA_TRUNK_AUTH_PASSWORD`, which is gitignored and read only when building a real trunk request.

## Evals

Fixture evals live in `platform/tests/bolna-trunk.test.ts`. All HTTP calls go to a local test server.

Covered cases:

1. Trunk parsers normalize nested gateways, carrier IPs, and numbers; malformed responses fail closed.
2. Connection details and trunk call lists use documented snake_case shapes.
3. Unsafe trunk inputs fail closed: private gateway hosts, broad CIDRs, `tls` transport, `G729` codec, partial credentials, and unknown fields.
4. Plan digest is deterministic and does not change when only the carrier password value changes.
5. Masked plan hides phone numbers and destination keys.
6. Canary plan requires gateways, carrier IPs, numbers, and an inbound agent, and enforces canary channel/number caps.
7. Cost estimate separates Bolna AI, Bolna platform, carrier minutes, connection fee, minimums, and billing rounding.
8. Cost gate blocks non-preferred models, over-budget calls, too many calls, and invalid concurrency.
9. Outbound canary call pins an agent version, uses a trunk number as caller ID, tags the run, and sets no retry or guardrail bypass.
10. Readiness fails degraded trunks, full channels, missing carrier IPs, wrong edge transport, and a failed cost gate.
11. Telephony patch only changes `agent_config.telephony_provider`.
12. Typed trunk client calls `/trunk` endpoints, redacts carrier passwords from errors, and sends bearer auth.

## Verification results

Run from `platform/`:

| Check | Command | Result |
|---|---|---|
| Evals and typecheck | `pnpm eval` | Pass, 81/81 |
| Step 6 fixture evals | `pnpm test` | 11/11 pass |
| Lint | `pnpm lint` | Pass |
| Production build | `pnpm build` | Pass |
| Prisma schema validation | `pnpm exec prisma validate` | Pass |
| Trunk check skip path | `pnpm bolna:trunk:check` | Pass with explicit SKIP |
| Agent apply skip path | `pnpm bolna:agent:apply` | Pass with explicit SKIP |
| Extraction apply skip path | `pnpm bolna:extraction:apply` | Pass with explicit SKIP |
| Knowledge apply skip path | `pnpm bolna:knowledge:apply` | Pass with explicit SKIP |
| Callback smoke skip path | `pnpm bolna:callback:smoke` | Pass with explicit SKIP |
| Offline trunk plan | `pnpm bolna:trunk:plan` | Fails closed without carrier config, no network request |

The only live Bolna request in the migration so far is the Step 1 `GET /user/me` smoke. No live trunk, number, agent mutation, agent promotion, or call was created for this gate.

## Gate decision

- Typed `/trunk` contracts and secret-safe client: **passed**
- Canary trunk plan safety and masking: **passed**
- Cost-aware gate with separate Bolna/carrier accounting: **passed**
- Outbound call request and inbound readiness guards: **passed**
- Agent telephony provider config-as-code: **passed**
- Typecheck, lint, build, Prisma validation, explicit SKIP paths: **passed**

Step 6 planning is complete. A live canary requires a separate, explicit authorization after carrier details, wallet/carrier rates, and a reviewed plan digest are supplied. No phone call is authorized by this gate.
