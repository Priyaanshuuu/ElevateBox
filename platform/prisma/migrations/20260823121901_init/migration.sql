-- CreateEnum
CREATE TYPE "LeadIntent" AS ENUM ('HOT', 'WARM', 'COLD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('INITIATED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CallbackStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "AutomationType" AS ENUM ('INTERESTED_LEAD_WHATSAPP', 'CALLBACK');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('PENDING', 'TRIGGERED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "name" TEXT,
    "business" TEXT,
    "productCount" INTEGER,
    "budget" DOUBLE PRECISION,
    "timeline" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "intent" "LeadIntent" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'INITIATED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "transcript" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Callback" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "callId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "CallbackStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Callback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "callId" TEXT,
    "type" "AutomationType" NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "errorMessage" TEXT,
    "triggeredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_phoneNumber_key" ON "Lead"("phoneNumber");

-- CreateIndex
CREATE INDEX "Lead_intent_idx" ON "Lead"("intent");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Call_leadId_idx" ON "Call"("leadId");

-- CreateIndex
CREATE INDEX "Call_createdAt_idx" ON "Call"("createdAt");

-- CreateIndex
CREATE INDEX "Callback_leadId_idx" ON "Callback"("leadId");

-- CreateIndex
CREATE INDEX "Callback_scheduledAt_idx" ON "Callback"("scheduledAt");

-- CreateIndex
CREATE INDEX "Callback_status_idx" ON "Callback"("status");

-- CreateIndex
CREATE INDEX "AutomationEvent_leadId_idx" ON "AutomationEvent"("leadId");

-- CreateIndex
CREATE INDEX "AutomationEvent_callId_idx" ON "AutomationEvent"("callId");

-- CreateIndex
CREATE INDEX "AutomationEvent_type_idx" ON "AutomationEvent"("type");

-- CreateIndex
CREATE INDEX "AutomationEvent_status_idx" ON "AutomationEvent"("status");

-- CreateIndex
CREATE INDEX "AutomationEvent_createdAt_idx" ON "AutomationEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Callback" ADD CONSTRAINT "Callback_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Callback" ADD CONSTRAINT "Callback_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationEvent" ADD CONSTRAINT "AutomationEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationEvent" ADD CONSTRAINT "AutomationEvent_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;
