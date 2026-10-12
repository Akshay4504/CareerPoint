-- CreateEnum
CREATE TYPE "SourceHealth" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY');

-- CreateEnum
CREATE TYPE "RemoteType" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RawJobStatus" AS ENUM ('NEW', 'PROCESSED', 'REJECTED', 'DUPLICATE', 'ERROR');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "AlertFrequency" AS ENUM ('INSTANT', 'DAILY', 'WEEKLY');

-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'INACTIVE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SourceType" ADD VALUE 'GREENHOUSE';
ALTER TYPE "SourceType" ADD VALUE 'LEVER';
ALTER TYPE "SourceType" ADD VALUE 'ASHBY';
ALTER TYPE "SourceType" ADD VALUE 'CAREER_PAGE';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "bimRelevanceScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bimRole" TEXT,
ADD COLUMN     "canonicalJobId" TEXT,
ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "companyKey" TEXT,
ADD COLUMN     "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "duplicateProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "experienceMax" INTEGER,
ADD COLUMN     "experienceMin" INTEGER,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "qualityBreakdown" JSONB,
ADD COLUMN     "qualityScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "remoteType" "RemoteType" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "requirements" TEXT,
ADD COLUMN     "responsibilities" TEXT,
ADD COLUMN     "sourceJobId" TEXT,
ADD COLUMN     "titleKey" TEXT;

-- AlterTable
ALTER TABLE "JobSource" ADD COLUMN     "config" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expireAfterDays" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "health" "SourceHealth" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "lastSuccessAt" TIMESTAMP(3),
ADD COLUMN     "minIntervalMs" INTEGER NOT NULL DEFAULT 1500,
ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "reliability" INTEGER NOT NULL DEFAULT 70,
ADD COLUMN     "runEveryMinutes" INTEGER NOT NULL DEFAULT 360;

-- CreateTable
CREATE TABLE "RawJob" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceJobId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "status" "RawJobStatus" NOT NULL DEFAULT 'NEW',
    "reason" TEXT,
    "jobId" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "RawJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSourceRef" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceJobId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobSourceRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "found" INTEGER NOT NULL DEFAULT 0,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "error" TEXT,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "sourceId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueJob" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "error" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "QueueJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "frequency" "AlertFrequency" NOT NULL DEFAULT 'DAILY',
    "channels" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawJob_status_idx" ON "RawJob"("status");

-- CreateIndex
CREATE INDEX "RawJob_hash_idx" ON "RawJob"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "RawJob_sourceId_sourceJobId_key" ON "RawJob"("sourceId", "sourceJobId");

-- CreateIndex
CREATE INDEX "JobSourceRef_jobId_idx" ON "JobSourceRef"("jobId");

-- CreateIndex
CREATE INDEX "JobSourceRef_sourceId_active_lastSeenAt_idx" ON "JobSourceRef"("sourceId", "active", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobSourceRef_sourceId_sourceJobId_key" ON "JobSourceRef"("sourceId", "sourceJobId");

-- CreateIndex
CREATE INDEX "IngestionRun_sourceId_startedAt_idx" ON "IngestionRun"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "IngestionLog_sourceId_createdAt_idx" ON "IngestionLog"("sourceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QueueJob_dedupeKey_key" ON "QueueJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "QueueJob_status_runAt_idx" ON "QueueJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "QueueJob_queue_status_idx" ON "QueueJob"("queue", "status");

-- CreateIndex
CREATE INDEX "JobAlert_active_frequency_idx" ON "JobAlert"("active", "frequency");

-- CreateIndex
CREATE INDEX "JobAlert_userId_idx" ON "JobAlert"("userId");

-- CreateIndex
CREATE INDEX "Job_status_discoveredAt_idx" ON "Job"("status", "discoveredAt");

-- CreateIndex
CREATE INDEX "Job_status_bimRelevanceScore_idx" ON "Job"("status", "bimRelevanceScore");

-- CreateIndex
CREATE INDEX "Job_country_city_idx" ON "Job"("country", "city");

-- CreateIndex
CREATE INDEX "Job_bimRole_idx" ON "Job"("bimRole");

-- CreateIndex
CREATE INDEX "Job_remoteType_idx" ON "Job"("remoteType");

-- CreateIndex
CREATE INDEX "Job_companyKey_titleKey_idx" ON "Job"("companyKey", "titleKey");

-- CreateIndex
CREATE INDEX "Job_canonicalJobId_idx" ON "Job"("canonicalJobId");

-- CreateIndex
CREATE INDEX "Job_canonicalUrl_idx" ON "Job"("canonicalUrl");

-- CreateIndex
CREATE INDEX "Job_software_idx" ON "Job" USING GIN ("software");

-- CreateIndex
CREATE INDEX "Job_skills_idx" ON "Job" USING GIN ("skills");

-- CreateIndex
CREATE INDEX "JobSource_active_nextRunAt_idx" ON "JobSource"("active", "nextRunAt");

-- AddForeignKey
ALTER TABLE "RawJob" ADD CONSTRAINT "RawJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSourceRef" ADD CONSTRAINT "JobSourceRef_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSourceRef" ADD CONSTRAINT "JobSourceRef_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "JobSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionLog" ADD CONSTRAINT "IngestionLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAlert" ADD CONSTRAINT "JobAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
