import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { ROLLBACK_DRILL_CHECKS, runRollbackDrill } from "../lib/bolna/index.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function createFixture(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "elevatebox-rollback-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const paths = [
    "README.md",
    "docs",
    "my-agent",
    "platform/app/api/bolna",
    "platform/lib/bolna",
    "platform/prisma/migrations",
    "platform/scripts",
    "platform/package.json",
    "platform/.env.example",
  ];
  for (const relative of paths) {
    const source = join(ROOT, relative);
    if (!existsSync(source)) continue;
    const destination = join(directory, relative);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
  }
  return directory;
}

function replaceOnce(path: string, from: string, to: string): void {
  const before = readFileSync(path, "utf8");
  assert.ok(before.includes(from), `Fixture is missing ${from}.`);
  writeFileSync(path, before.replace(from, to));
}

describe("Step 11 — offline rollback drill evals", () => {
  it("eval: the default drill passes all twelve named checks", async () => {
    const report = await runRollbackDrill();
    assert.equal(report.status, "PASS", report.reasons.join(" | "));
    assert.deepEqual(
      report.checks.map((item) => item.name),
      [...ROLLBACK_DRILL_CHECKS],
    );
    assert.ok(report.checks.every((item) => item.status === "PASS"));
    assert.equal(report.reasons.length, 0);
    assert.equal(report.networkRequests, 0);
    assert.equal(report.rollbackExecuted, false);
    assert.equal(report.liveChecksRequired.length, 3);
  });

  it("eval: the digest is deterministic and an invalid root fails closed", async () => {
    const first = await runRollbackDrill();
    const second = await runRollbackDrill();
    assert.equal(first.digest, second.digest);

    const missingRoot = join(tmpdir(), `elevatebox-rollback-missing-${process.pid}`);
    const report = await runRollbackDrill({ rootDir: missingRoot });
    assert.equal(report.status, "FAIL");
    assert.equal(report.checks.length, 1);
    assert.equal(report.checks[0]?.name, "repo_layout");
    assert.equal(report.rollbackExecuted, false);
  });

  it("eval: dangerous env flags and poisoned network do not change the drill", async () => {
    const originalFetch = globalThis.fetch;
    const keys = ["BOLNA_RUN_CANARY", "BOLNA_ALLOW_PROMOTE", "BOLNA_RUN_LIVE_SMOKE"] as const;
    const originalEnv = new Map(keys.map((key) => [key, process.env[key]]));
    globalThis.fetch = (() => {
      throw new Error("network is disabled for Step 11");
    }) as unknown as typeof fetch;
    for (const key of keys) process.env[key] = "1";

    try {
      const report = await runRollbackDrill();
      assert.equal(report.status, "PASS", report.reasons.join(" | "));
      assert.equal(report.networkRequests, 0);
    } finally {
      globalThis.fetch = originalFetch;
      for (const key of keys) {
        const value = originalEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("eval: a mutated legacy freeze banner fails the drill", async (t) => {
    const root = createFixture(t);
    replaceOnce(
      join(root, "my-agent", "README.md"),
      "LEGACY / FROZEN MODULE",
      "ACTIVE MODULE",
    );
    const report = await runRollbackDrill({ rootDir: root });
    assert.equal(report.status, "FAIL");
    const banner = report.checks.find((item) => item.name === "legacy_freeze_banners");
    assert.equal(banner?.status, "FAIL");
    assert.match(banner?.detail ?? "", /banner is missing/);
  });

  it("eval: a missing restore-forward section fails the drill", async (t) => {
    const root = createFixture(t);
    replaceOnce(
      join(root, "docs", "15-step11-rollback-drill.md"),
      "## Restore forward",
      "## Forward only",
    );
    const report = await runRollbackDrill({ rootDir: root });
    assert.equal(report.status, "FAIL");
    const runbook = report.checks.find((item) => item.name === "rollback_runbook");
    assert.equal(runbook?.status, "FAIL");
    assert.match(runbook?.detail ?? "", /Runbook is missing/);
  });

  it("eval: a destructive migration fails the additive migration check", async (t) => {
    const root = createFixture(t);
    replaceOnce(
      join(
        root,
        "platform",
        "prisma",
        "migrations",
        "20261126000000_add_bolna_tool_invocations",
        "migration.sql",
      ),
      'CREATE TABLE "BolnaToolInvocation"',
      'DROP TABLE "BolnaToolInvocation";\nCREATE TABLE "BolnaToolInvocation"',
    );
    const report = await runRollbackDrill({ rootDir: root });
    assert.equal(report.status, "FAIL");
    const migrations = report.checks.find((item) => item.name === "additive_migrations");
    assert.equal(migrations?.status, "FAIL");
    assert.match(migrations?.detail ?? "", /destructive SQL/);
  });

  it("eval: an env-loading rollback script fails the offline runner safety check", async (t) => {
    const root = createFixture(t);
    replaceOnce(
      join(root, "platform", "scripts", "bolna-rollback-drill.ts"),
      'import { runRollbackDrill } from "../lib/bolna/rollback-drill.ts";',
      'import { config } from "dotenv";\nimport { runRollbackDrill } from "../lib/bolna/rollback-drill.ts";',
    );
    const report = await runRollbackDrill({ rootDir: root });
    assert.equal(report.status, "FAIL");
    const safety = report.checks.find((item) => item.name === "offline_runner_safety");
    assert.equal(safety?.status, "FAIL");
    assert.match(safety?.detail ?? "", /unsafe imports\/calls/);
  });

  it("eval: metrics and details cover the complete rollback surface", async () => {
    const report = await runRollbackDrill();
    const byName = new Map(report.checks.map((item) => [item.name, item]));
    assert.match(byName.get("repo_layout")?.detail ?? "", /required local artifacts present/);
    assert.match(byName.get("legacy_entrypoints")?.detail ?? "", /remain intact/);
    assert.match(byName.get("legacy_runtime_isolation")?.detail ?? "", /no Bolna runtime coupling/);
    assert.match(byName.get("migration_order")?.detail ?? "", /expected forward order/);
    assert.match(byName.get("provider_routes_inventory")?.detail ?? "", /intake routes/);
    assert.match(byName.get("live_capable_scripts_inventory")?.detail ?? "", /do not run/);
    assert.match(byName.get("live_optins_documented")?.detail ?? "", /without reading \.env\.local/);
    assert.equal(report.metrics.migrations, 3);
    assert.equal(report.metrics.providerRoutes, 2);
    assert.equal(report.metrics.liveCapableScripts, 7);
    assert.equal(report.metrics.liveOptInVariables, 15);
    assert.equal(report.metrics.offlineScripts, 7);
    assert.ok(report.metrics.legacyScannedFiles >= 5);
  });
});
