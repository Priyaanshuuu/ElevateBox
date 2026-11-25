-- AlterTable
ALTER TABLE "Call" ADD COLUMN "bolnaExecutionId" TEXT;

-- CreateTable
CREATE TABLE "BolnaExecution" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "agentId" TEXT,
    "agentVersionId" TEXT,
    "batchId" TEXT,
    "status" TEXT NOT NULL,
    "terminationReason" TEXT,
    "errorMessage" TEXT,
    "userNumber" TEXT,
    "agentNumber" TEXT,
    "callType" TEXT,
    "provider" TEXT,
    "providerCallId" TEXT,
    "recordingUrl" TEXT,
    "conversationDuration" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "costBreakdown" JSONB,
    "transcript" TEXT,
    "summary" TEXT,
    "extractedData" JSONB,
    "nodeExtractedData" JSONB,
    "telephonyData" JSONB,
    "occurredAt" TIMESTAMP(3),
    "bolnaCreatedAt" TIMESTAMP(3),
    "bolnaUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BolnaExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BolnaWebhookEvent" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "eventType" TEXT,
    "status" TEXT,
    "sourceIp" TEXT,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "BolnaWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Call_bolnaExecutionId_key" ON "Call"("bolnaExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "BolnaExecution_executionId_key" ON "BolnaExecution"("executionId");

-- CreateIndex
CREATE INDEX "BolnaExecution_status_idx" ON "BolnaExecution"("status");

-- CreateIndex
CREATE INDEX "BolnaExecution_userNumber_idx" ON "BolnaExecution"("userNumber");

-- CreateIndex
CREATE INDEX "BolnaExecution_agentId_idx" ON "BolnaExecution"("agentId");

-- CreateIndex
CREATE INDEX "BolnaExecution_createdAt_idx" ON "BolnaExecution"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BolnaWebhookEvent_dedupeKey_key" ON "BolnaWebhookEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "BolnaWebhookEvent_executionId_idx" ON "BolnaWebhookEvent"("executionId");

-- CreateIndex
CREATE INDEX "BolnaWebhookEvent_status_idx" ON "BolnaWebhookEvent"("status");

-- CreateIndex
CREATE INDEX "BolnaWebhookEvent_receivedAt_idx" ON "BolnaWebhookEvent"("receivedAt");

-- AddForeignKey
ALTER TABLE "BolnaWebhookEvent" ADD CONSTRAINT "BolnaWebhookEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "BolnaExecution"("executionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_bolnaExecutionId_fkey" FOREIGN KEY ("bolnaExecutionId") REFERENCES "BolnaExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
