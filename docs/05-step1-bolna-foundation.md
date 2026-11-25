# Step 1 — Repository Foundation and Bolna API Client

Status: **complete — offline gate and live smoke passed**

## Goal

Establish a clean, reproducible foundation for the Bolna migration and add a typed Bolna API client whose auth and contract can be verified without making paid or live calls.

## What changed

### Repository foundation

- Fixed `platform/pnpm-workspace.yaml` build approvals.
  - Placeholder values were blocking Prisma and resolver install scripts.
- Added `platform/.env.example`.
  - Includes `DATABASE_URL`, `BOLNA_API_KEY`, `BOLNA_API_BASE_URL`, `BOLNA_REQUEST_TIMEOUT_MS`, and `BOLNA_RUN_LIVE_SMOKE`.
- Allowed `.env.example` through `platform/.gitignore`.
- Wired Prisma generation into install/build/dev:
  - `postinstall`
  - `prebuild`
  - `predev`
- Added Platform scripts:
  - `typecheck`
  - `test`
  - `eval`
  - `bolna:smoke`
- Added `allowImportingTsExtensions` to `platform/tsconfig.json` for native Node TypeScript test files.
- Added root CI workflow at `.github/workflows/platform.yml`.
  - Installs dependencies, lints, runs evals/typecheck, and builds the platform.

### Bolna API client

Added under `platform/lib/bolna/`:

- `config.ts`
  - validates `BOLNA_API_KEY`
  - defaults the base URL to `https://api.bolna.ai`
  - defaults the timeout to 15 seconds
  - rejects non-HTTPS production URLs and embedded credentials
- `errors.ts`
  - typed `BolnaError` hierarchy
  - `BolnaConfigError`, `BolnaHttpError`, `BolnaNetworkError`, `BolnaTimeoutError`, `BolnaResponseError`
  - secret redaction for error messages
- `types.ts`
  - typed `BolnaUser` normalization for `GET /user/me`
- `client.ts`
  - bearer auth injection
  - JSON response handling
  - typed network/timeout/HTTP/response failures
  - no logging of headers, keys, or response bodies
- `index.ts`
  - public exports

Also added `platform/scripts/bolna-smoke.ts` for the live `GET /user/me` check.

## Evals

Offline fixture evals live in `platform/tests/bolna-client.test.ts` and run with Node's built-in test runner.

Covered cases:

1. Missing `BOLNA_API_KEY` is rejected.
2. Non-HTTPS and credential-bearing base URLs are rejected.
3. Local fixture base URLs are accepted for offline tests.
4. `GET /user/me` sends bearer auth and Accept JSON.
5. The account payload is normalized to a typed user.
6. Malformed account payloads produce `BolnaResponseError`.
7. HTTP errors are typed with status and retryability.
8. The API key is redacted from error messages.
9. No console logging occurs during a failed authenticated request.
10. Non-JSON responses, transport failures, and timeouts produce typed errors.

## Verification results

Run from `platform/`:

| Check | Command | Result |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | Pass |
| Prisma generate | `pnpm prisma:generate` | Pass |
| Lint | `pnpm lint` | Pass |
| Typecheck | `pnpm typecheck` | Pass |
| Offline evals | `pnpm test` | 10/10 pass |
| Eval bundle | `pnpm eval` | Pass |
| Production build | `pnpm build` | Pass |
| Live smoke skip path | `pnpm bolna:smoke` | Pass with explicit SKIP |
| Missing-key failure path | `BOLNA_RUN_LIVE_SMOKE=1 pnpm bolna:smoke` | Correct failure: `BOLNA_API_KEY is required.` |

## Live smoke status

The real `GET /user/me` smoke was run locally by the user and reported as **PASS**.

The client returned account id, wallet, and concurrency without printing the API key.

## Gate decision

- Offline foundation gate: **passed**
- Live credential gate: **passed**

Step 2 is complete; see `06-step2-webhook-normalization.md`.
