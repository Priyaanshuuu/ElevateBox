-- CreateTable
CREATE TABLE "BolnaToolInvocation" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "executionId" TEXT,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BolnaToolInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BolnaToolInvocation_dedupeKey_key" ON "BolnaToolInvocation"("dedupeKey");

-- CreateIndex
CREATE INDEX "BolnaToolInvocation_toolName_idx" ON "BolnaToolInvocation"("toolName");

-- CreateIndex
CREATE INDEX "BolnaToolInvocation_executionId_idx" ON "BolnaToolInvocation"("executionId");

-- CreateIndex
CREATE INDEX "BolnaToolInvocation_createdAt_idx" ON "BolnaToolInvocation"("createdAt");
