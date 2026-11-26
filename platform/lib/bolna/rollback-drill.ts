import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROLLBACK_DRILL_CHECKS = [
  "repo_layout",
  "legacy_freeze_banners",
  "legacy_entrypoints",
  "legacy_runtime_isolation",
  "rollback_runbook",
  "migration_order",
  "additive_migrations",
  "provider_routes_inventory",
  "live_capable_scripts_inventory",
  "live_optins_documented",
  "offline_gate_stack",
  "offline_runner_safety",
] as const;

export type RollbackDrillCheckName = (typeof ROLLBACK_DRILL_CHECKS)[number];

export interface RollbackDrillCheck {
  name: RollbackDrillCheckName;
  status: "PASS" | "FAIL";
  detail: string;
}

export interface RollbackDrillMetrics {
  requiredArtifacts: number;
  legacyScannedFiles: number;
  runbookSections: number;
  migrations: number;
  providerRoutes: number;
  liveCapableScripts: number;
  liveOptInVariables: number;
  offlineScripts: number;
}

export interface RollbackDrillResult {
  status: "PASS" | "FAIL";
  checks: RollbackDrillCheck[];
  reasons: string[];
  digest: string;
  metrics: RollbackDrillMetrics;
  networkRequests: 0;
  rollbackExecuted: false;
  liveChecksRequired: string[];
}

export interface RollbackDrillInput {
  rootDir?: string;
}

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const LEGACY_FILES: string[][] = [
  ["my-agent", "package.json"],
  ["my-agent", "README.md"],
  ["my-agent", "AGENTS.md"],
  ["my-agent", "Dockerfile"],
  ["my-agent", "src", "main.ts"],
  ["my-agent", "src", "agent.ts"],
  ["my-agent", "src", "callback-worker.ts"],
  ["my-agent", "src", "agent.test.ts"],
];

const REPO_FILES: string[][] = [
  ["README.md"],
  ["docs", "04-bolna-migration-inventory.md"],
  ["docs", "15-step11-rollback-drill.md"],
  ["platform", "package.json"],
  ["platform", ".env.example"],
  ["platform", "lib", "bolna", "index.ts"],
  ["platform", "scripts", "bolna-rollback-drill.ts"],
  ["platform", "app", "api", "bolna", "webhook", "[token]", "route.ts"],
  ["platform", "app", "api", "bolna", "tools", "[tool]", "route.ts"],
];

const WEBHOOK_ROUTE = [
  "platform",
  "app",
  "api",
  "bolna",
  "webhook",
  "[token]",
  "route.ts",
];
const TOOL_ROUTE = ["platform", "app", "api", "bolna", "tools", "[tool]", "route.ts"];

const EXPECTED_MIGRATIONS = [
  "20260823121901_init",
  "20261125120000_add_bolna_webhook_projection",
  "20261126000000_add_bolna_tool_invocations",
];

const LIVE_CAPABLE_SCRIPTS: Record<string, string[]> = {
  "bolna:smoke": ["platform", "scripts", "bolna-smoke.ts"],
  "bolna:agent:apply": ["platform", "scripts", "bolna-agent-apply.ts"],
  "bolna:extraction:apply": ["platform", "scripts", "bolna-extraction-apply.ts"],
  "bolna:knowledge:apply": ["platform", "scripts", "bolna-knowledge-apply.ts"],
  "bolna:callback:smoke": ["platform", "scripts", "bolna-callback-smoke.ts"],
  "bolna:trunk:check": ["platform", "scripts", "bolna-trunk-check.ts"],
  "bolna:canary:run": ["platform", "scripts", "bolna-canary-run.ts"],
};

const EXPECTED_OFFLINE_SCRIPTS: Record<string, string> = {
  test: "node --test",
  eval: "pnpm typecheck && pnpm test",
  lint: "eslint .",
  build: "next build",
  "bolna:transcript:gate": "node scripts/bolna-transcript-gate.ts",
  "bolna:reliability:gate": "node scripts/bolna-reliability-gate.ts",
  "bolna:rollback:drill": "node scripts/bolna-rollback-drill.ts",
};

const LIVE_OPT_IN_VARIABLES = [
  "BOLNA_RUN_LIVE_SMOKE",
  "BOLNA_WEBHOOK_ALLOW_UNAUTHENTICATED",
  "BOLNA_RUN_AGENT_APPLY",
  "BOLNA_ALLOW_PROMOTE",
  "BOLNA_EVAL_GATE",
  "BOLNA_RUN_EXTRACTION_APPLY",
  "BOLNA_RUN_KNOWLEDGE_APPLY",
  "BOLNA_TOOL_ALLOW_UNAUTHENTICATED",
  "BOLNA_RUN_CALLBACK_SMOKE",
  "BOLNA_RUN_TRUNK_CHECK",
  "BOLNA_RUN_CANARY",
  "BOLNA_CANARY_EXPECTED_PLAN_DIGEST",
  "BOLNA_CANARY_AUTHORIZE",
  "BOLNA_CANARY_AUTHORIZED_RUN_ID",
  "BOLNA_CANARY_DRY_RUN",
] as const;

const RUNBOOK_MARKERS = [
  "## Rollback triggers",
  "## Preconditions",
  "## Rollback steps",
  "## Verification",
  "## Restore forward",
  "## Evidence record",
  "no live call",
  "do not run",
  "additive migrations",
  "my-agent",
  "api/bolna/webhook/[token]",
  "api/bolna/tools/[tool]",
  "BOLNA_RUN_CANARY",
  "BOLNA_CANARY_DRY_RUN",
] as const;

const LIVE_CHECKS_REQUIRED = [
  "Explicit approval for any live rollback or canary call recorded in docs/04-bolna-migration-inventory.md.",
  "Fresh Step 6 trunk readiness and cost checks with real carrier and Bolna rates.",
  "An authorized LiveKit call after rollback or an authorized Bolna canary after restore-forward.",
];

const DESTRUCTIVE_SQL = /\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i;

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestFor(checks: readonly RollbackDrillCheck[], metrics: RollbackDrillMetrics): string {
  return createHash("sha256")
    .update(canonical({ checks, metrics, networkRequests: 0, rollbackExecuted: false }))
    .digest("hex");
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function readText(rootDir: string, segments: readonly string[]): string {
  return readFileSync(join(rootDir, ...segments), "utf8");
}

function readJson(rootDir: string, segments: readonly string[]): Record<string, unknown> {
  const value: unknown = JSON.parse(readText(rootDir, segments));
  expect(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `Expected a JSON object at ${segments.join("/")}.`,
  );
  return value as Record<string, unknown>;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  expect(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object.`,
  );
  return value as Record<string, unknown>;
}

function listDirectories(rootDir: string, segments: readonly string[]): string[] {
  return readdirSync(join(rootDir, ...segments), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listFilesRecursive(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

async function check(
  name: RollbackDrillCheckName,
  fn: () => Promise<string> | string,
): Promise<RollbackDrillCheck> {
  try {
    return { name, status: "PASS", detail: await fn() };
  } catch (error) {
    const label = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    return { name, status: "FAIL", detail: `${label}: ${message}` };
  }
}

/** Offline Step 11 drill. It only reads local files: no env loading, DB, or network. */
export async function runRollbackDrill(
  input: RollbackDrillInput = {},
): Promise<RollbackDrillResult> {
  const rootDir = input.rootDir ?? DEFAULT_ROOT;
  const metrics: RollbackDrillMetrics = {
    requiredArtifacts: 0,
    legacyScannedFiles: 0,
    runbookSections: 0,
    migrations: 0,
    providerRoutes: 0,
    liveCapableScripts: 0,
    liveOptInVariables: 0,
    offlineScripts: 0,
  };
  const checks: RollbackDrillCheck[] = [];

  const finish = (): RollbackDrillResult => {
    const reasons = checks
      .filter((item) => item.status === "FAIL")
      .map((item) => `${item.name}: ${item.detail}`);
    return {
      status: reasons.length === 0 ? "PASS" : "FAIL",
      checks,
      reasons,
      digest: digestFor(checks, metrics),
      metrics,
      networkRequests: 0,
      rollbackExecuted: false,
      liveChecksRequired: [...LIVE_CHECKS_REQUIRED],
    };
  };

  checks.push(
    await check("repo_layout", () => {
      const required = [...LEGACY_FILES, ...REPO_FILES];
      const missing = required.filter((segments) => !existsSync(join(rootDir, ...segments)));
      expect(missing.length === 0, `Missing ${missing.map((item) => item.join("/")).join(", ")}.`);
      metrics.requiredArtifacts = required.length;
      return `${required.length} required local artifacts present`;
    }),
  );
  if (checks.some((item) => item.status === "FAIL")) return finish();

  checks.push(
    await check("legacy_freeze_banners", () => {
      const legacyReadme = readText(rootDir, ["my-agent", "README.md"]);
      const legacyAgents = readText(rootDir, ["my-agent", "AGENTS.md"]);
      const inventory = readText(rootDir, ["docs", "04-bolna-migration-inventory.md"]);
      expect(legacyReadme.includes("LEGACY / FROZEN MODULE"), "Legacy README banner is missing.");
      expect(legacyAgents.includes("LEGACY / FROZEN MODULE"), "Legacy AGENTS banner is missing.");
      expect(
        legacyReadme.includes("../docs/04-bolna-migration-inventory.md") &&
          legacyAgents.includes("Critical rollback fixes require explicit approval"),
        "Freeze references are incomplete.",
      );
      expect(
        inventory.includes("Freeze policy for `my-agent/`") &&
          inventory.includes("legacy/rollback-only") &&
          inventory.includes("explicit approval"),
        "Migration inventory freeze policy is incomplete.",
      );
      return "legacy banners and freeze policy reference the recorded rollback path";
    }),
  );

  checks.push(
    await check("legacy_entrypoints", () => {
      const pkg = readJson(rootDir, ["my-agent", "package.json"]);
      const scripts = asRecord(pkg.scripts, "my-agent package scripts");
      const engines = asRecord(pkg.engines, "my-agent engines");
      const dependencies = asRecord(pkg.dependencies, "my-agent dependencies");
      expect(scripts.dev === "tsx src/main.ts dev", "Legacy dev entrypoint changed.");
      expect(scripts.start === "tsx src/main.ts start", "Legacy start entrypoint changed.");
      expect(scripts.test === "vitest --run", "Legacy test command changed.");
      expect(
        scripts["callback:worker"] === "tsx src/callback-worker.ts",
        "Legacy callback worker entrypoint changed.",
      );
      expect(String(engines.node).includes("24"), "Legacy Node engine is not pinned to 24.");
      expect(String(engines.pnpm).includes("10"), "Legacy pnpm engine is not pinned to 10.");
      expect(typeof dependencies["@livekit/agents"] === "string", "LiveKit dependency is missing.");
      const main = readText(rootDir, ["my-agent", "src", "main.ts"]);
      const callbackWorker = readText(rootDir, ["my-agent", "src", "callback-worker.ts"]);
      expect(main.includes("cli.runApp"), "LiveKit worker entrypoint is missing.");
      expect(
        callbackWorker.includes("createDispatch") && callbackWorker.includes("createSipParticipant"),
        "Legacy callback worker SIP path is missing.",
      );
      return "frozen worker, callback worker, and test entrypoints remain intact";
    }),
  );

  checks.push(
    await check("legacy_runtime_isolation", () => {
      const sourceFiles = listFilesRecursive(join(rootDir, "my-agent", "src"));
      const sources = [
        readText(rootDir, ["my-agent", "package.json"]),
        ...sourceFiles.map((path) => readFileSync(path, "utf8")),
      ].join("\n");
      expect(!/bolna/i.test(sources), "Legacy runtime source or package config references Bolna.");
      metrics.legacyScannedFiles = sourceFiles.length + 1;
      return `${metrics.legacyScannedFiles} legacy files contain no Bolna runtime coupling`;
    }),
  );

  const runbook = readText(rootDir, ["docs", "15-step11-rollback-drill.md"]);
  checks.push(
    await check("rollback_runbook", () => {
      const missing = RUNBOOK_MARKERS.filter((marker) => !runbook.includes(marker));
      expect(missing.length === 0, `Runbook is missing ${missing.join(", ")}.`);
      metrics.runbookSections = 6;
      return "runbook covers triggers, preconditions, steps, verification, restore-forward, and evidence";
    }),
  );

  checks.push(
    await check("migration_order", () => {
      const migrations = listDirectories(rootDir, ["platform", "prisma", "migrations"]);
      expect(
        JSON.stringify(migrations) === JSON.stringify(EXPECTED_MIGRATIONS),
        `Unexpected migration order: ${migrations.join(", ")}.`,
      );
      metrics.migrations = migrations.length;
      return `${migrations.length} migrations are present in expected forward order`;
    }),
  );

  checks.push(
    await check("additive_migrations", () => {
      const init = readText(rootDir, [
        "platform",
        "prisma",
        "migrations",
        "20260823121901_init",
        "migration.sql",
      ]);
      const webhook = readText(rootDir, [
        "platform",
        "prisma",
        "migrations",
        "20261125120000_add_bolna_webhook_projection",
        "migration.sql",
      ]);
      const tools = readText(rootDir, [
        "platform",
        "prisma",
        "migrations",
        "20261126000000_add_bolna_tool_invocations",
        "migration.sql",
      ]);
      for (const [name, sql] of [
        ["init", init],
        ["webhook", webhook],
        ["tools", tools],
      ] as const) {
        expect(!DESTRUCTIVE_SQL.test(sql), `${name} migration contains destructive SQL.`);
      }
      expect(
        init.includes('CREATE TABLE "Lead"') && init.includes('CREATE TABLE "Call"'),
        "Init migration does not create legacy tables.",
      );
      expect(
        webhook.includes('ADD COLUMN "bolnaExecutionId"') &&
          webhook.includes('CREATE TABLE "BolnaExecution"') &&
          webhook.includes('CREATE TABLE "BolnaWebhookEvent"'),
        "Webhook projection migration is not additive.",
      );
      expect(
        tools.includes('CREATE TABLE "BolnaToolInvocation"'),
        "Tool invocation migration is not additive.",
      );
      return "migrations are additive forward and contain no DROP/TRUNCATE/DELETE FROM";
    }),
  );

  checks.push(
    await check("provider_routes_inventory", () => {
      const webhookRoute = readText(rootDir, WEBHOOK_ROUTE);
      const toolRoute = readText(rootDir, TOOL_ROUTE);
      expect(webhookRoute.includes("ingestBolnaWebhook"), "Bolna webhook intake is not recognized.");
      expect(
        toolRoute.includes("handleBolnaToolRequest"),
        "Bolna tool intake is not recognized.",
      );
      expect(
        runbook.includes("api/bolna/webhook/[token]") && runbook.includes("api/bolna/tools/[tool]"),
        "Runbook does not name both provider intake routes.",
      );
      metrics.providerRoutes = 2;
      return "webhook and tool intake routes are inventoried and covered by the runbook";
    }),
  );

  checks.push(
    await check("live_capable_scripts_inventory", () => {
      const pkg = readJson(rootDir, ["platform", "package.json"]);
      const scripts = asRecord(pkg.scripts, "platform package scripts");
      for (const [script, path] of Object.entries(LIVE_CAPABLE_SCRIPTS)) {
        expect(typeof scripts[script] === "string", `Script ${script} is missing.`);
        expect(existsSync(join(rootDir, ...path)), `Script file ${path.join("/")} is missing.`);
        expect(runbook.includes(script), `Runbook does not name ${script}.`);
      }
      metrics.liveCapableScripts = Object.keys(LIVE_CAPABLE_SCRIPTS).length;
      return `${metrics.liveCapableScripts} live-capable scripts are inventoried and marked do not run`;
    }),
  );

  checks.push(
    await check("live_optins_documented", () => {
      const example = readText(rootDir, ["platform", ".env.example"]);
      const missingExample = LIVE_OPT_IN_VARIABLES.filter((name) => !example.includes(`${name}=`));
      const missingRunbook = LIVE_OPT_IN_VARIABLES.filter((name) => !runbook.includes(name));
      expect(missingExample.length === 0, `Env example is missing ${missingExample.join(", ")}.`);
      expect(missingRunbook.length === 0, `Runbook is missing ${missingRunbook.join(", ")}.`);
      metrics.liveOptInVariables = LIVE_OPT_IN_VARIABLES.length;
      return `${metrics.liveOptInVariables} live opt-ins are documented without reading .env.local`;
    }),
  );

  checks.push(
    await check("offline_gate_stack", () => {
      const pkg = readJson(rootDir, ["platform", "package.json"]);
      const scripts = asRecord(pkg.scripts, "platform package scripts");
      for (const [name, command] of Object.entries(EXPECTED_OFFLINE_SCRIPTS)) {
        expect(scripts[name] === command, `Offline script ${name} changed or missing.`);
      }
      const gatePaths = [
        ["platform", "scripts", "bolna-transcript-gate.ts"],
        ["platform", "scripts", "bolna-reliability-gate.ts"],
        ["platform", "scripts", "bolna-rollback-drill.ts"],
      ];
      for (const path of gatePaths) {
        expect(existsSync(join(rootDir, ...path)), `Gate script ${path.join("/")} is missing.`);
      }
      expect(
        runbook.includes("pnpm eval") &&
          runbook.includes("pnpm bolna:transcript:gate") &&
          runbook.includes("pnpm bolna:reliability:gate") &&
          runbook.includes("pnpm bolna:rollback:drill"),
        "Runbook does not list the offline verification commands.",
      );
      metrics.offlineScripts = Object.keys(EXPECTED_OFFLINE_SCRIPTS).length;
      return `${metrics.offlineScripts} offline commands are available and documented`;
    }),
  );

  checks.push(
    await check("offline_runner_safety", () => {
      const script = readText(rootDir, ["platform", "scripts", "bolna-rollback-drill.ts"]);
      const forbidden = [
        "dotenv",
        "createBolnaClient",
        "PrismaClient",
        "makeCall",
        "setCurrentAgentVersion",
        "fetch(",
      ];
      const found = forbidden.filter((token) => script.includes(token));
      expect(found.length === 0, `Rollback script contains unsafe imports/calls: ${found.join(", ")}.`);
      expect(script.includes("runRollbackDrill"), "Rollback script does not call the offline gate.");
      return "rollback script loads no env, provider client, Prisma client, or network call";
    }),
  );

  return finish();
}
