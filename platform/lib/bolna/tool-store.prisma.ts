import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../prisma.ts";
import type { BolnaToolStore, ToolInvocationRecord, ToolResult } from "./tool-handler.ts";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function toRecord(value: {
  dedupeKey: string;
  toolName: string;
  status: string;
  result: unknown;
  errorMessage: string | null;
}): ToolInvocationRecord {
  return {
    dedupeKey: value.dedupeKey,
    toolName: value.toolName,
    status:
      value.status === "completed" || value.status === "failed" ? value.status : "pending",
    result: value.result && typeof value.result === "object" ? (value.result as ToolResult) : null,
    errorMessage: value.errorMessage,
  };
}

export function createPrismaToolStore(): BolnaToolStore {
  return {
    async claim({ dedupeKey, toolName, executionId }) {
      try {
        await prisma.bolnaToolInvocation.create({
          data: {
            dedupeKey,
            toolName,
            executionId,
            status: "pending",
          },
        });
        return { claimed: true, existing: null };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;

        const existing = await prisma.bolnaToolInvocation.findUnique({ where: { dedupeKey } });
        if (!existing) throw error;
        if (existing.status !== "failed") {
          return { claimed: false, existing: toRecord(existing) };
        }

        const retried = await prisma.bolnaToolInvocation.updateMany({
          where: { id: existing.id, status: "failed" },
          data: { status: "pending", errorMessage: null, result: Prisma.DbNull },
        });
        if (retried.count === 1) return { claimed: true, existing: null };

        const current = await prisma.bolnaToolInvocation.findUnique({ where: { dedupeKey } });
        return { claimed: false, existing: current ? toRecord(current) : null };
      }
    },

    async complete(dedupeKey, result) {
      await prisma.bolnaToolInvocation.update({
        where: { dedupeKey },
        data: { status: "completed", result: result as never, errorMessage: null },
      });
    },

    async fail(dedupeKey, errorMessage) {
      await prisma.bolnaToolInvocation.update({
        where: { dedupeKey },
        data: { status: "failed", errorMessage, result: Prisma.DbNull },
      });
    },
  };
}
