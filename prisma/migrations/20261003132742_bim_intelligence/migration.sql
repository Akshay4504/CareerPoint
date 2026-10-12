-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'APPLIED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "AiStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "ResumeKind" ADD VALUE 'TARGETED';

-- AlterTable
ALTER TABLE "BIMProfessionalProfile" ADD COLUMN     "achievements" TEXT[],
ADD COLUMN     "availability" TEXT,
ADD COLUMN     "bimDisciplines" TEXT[],
ADD COLUMN     "bimResponsibilities" TEXT[],
ADD COLUMN     "bimRoles" TEXT[],
ADD COLUMN     "bimStandards" TEXT[],
ADD COLUMN     "city" TEXT,
ADD COLUMN     "coordinationYears" INTEGER,
ADD COLUMN     "currentRole" TEXT,
ADD COLUMN     "employmentTypes" TEXT[],
ADD COLUMN     "industries" TEXT[],
ADD COLUMN     "infoMgmtYears" INTEGER,
ADD COLUMN     "lodLevels" TEXT[],
ADD COLUMN     "minSalary" INTEGER,
ADD COLUMN     "modelingYears" INTEGER,
ADD COLUMN     "preferredLocations" TEXT[],
ADD COLUMN     "preferredRoles" TEXT[],
ADD COLUMN     "privacy" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "projectTypes" TEXT[],
ADD COLUMN     "publicResumeId" TEXT,
ADD COLUMN     "salaryCurrency" TEXT,
ADD COLUMN     "vdcYears" INTEGER;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "challenges" TEXT,
ADD COLUMN     "client" TEXT,
ADD COLUMN     "clientPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "discipline" TEXT,
ADD COLUMN     "outcomes" TEXT,
ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "responsibilities" TEXT,
ADD COLUMN     "scale" TEXT,
ADD COLUMN     "solutions" TEXT;

-- AlterTable
ALTER TABLE "Resume" ADD COLUMN     "targetRole" TEXT,
ADD COLUMN     "template" TEXT NOT NULL DEFAULT 'classic';

-- AlterTable
ALTER TABLE "ResumeVersion" ADD COLUMN     "label" TEXT;

-- CreateTable
CREATE TABLE "Language" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeImport" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "fileId" TEXT,
    "rawText" TEXT NOT NULL,
    "extracted" JSONB NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "resumeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "ResumeImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "input" JSONB NOT NULL,
    "original" TEXT,
    "output" TEXT NOT NULL,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "status" "AiStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Language_profileId_name_key" ON "Language"("profileId", "name");

-- CreateIndex
CREATE INDEX "ResumeImport_profileId_status_idx" ON "ResumeImport"("profileId", "status");

-- CreateIndex
CREATE INDEX "AiSuggestion_userId_status_createdAt_idx" ON "AiSuggestion"("userId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "Language" ADD CONSTRAINT "Language_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BIMProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeImport" ADD CONSTRAINT "ResumeImport_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BIMProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
