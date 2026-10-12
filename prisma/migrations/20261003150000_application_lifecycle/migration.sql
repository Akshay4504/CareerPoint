-- Application lifecycle: renames IN_REVIEW to RECRUITER_REVIEW and HIRED to ACCEPTED in place (no data loss) and adds the new stages,
-- interactions, recruiter notes, interviews, messages, contact requests, invites, notification preferences and the email outbox.
-- AlterEnum
BEGIN;
CREATE TYPE "ApplicationStatus_new" AS ENUM ('DISCOVERED', 'SAVED', 'PINNED', 'APPLYING', 'APPLIED', 'RECRUITER_REVIEW', 'SHORTLISTED', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');
ALTER TABLE "public"."Application" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Application" ALTER COLUMN "status" TYPE "ApplicationStatus_new" USING ((CASE "status"::text WHEN 'IN_REVIEW' THEN 'RECRUITER_REVIEW' WHEN 'HIRED' THEN 'ACCEPTED' ELSE "status"::text END)::"ApplicationStatus_new");
ALTER TABLE "ApplicationEvent" ALTER COLUMN "fromStatus" TYPE "ApplicationStatus_new" USING ((CASE "fromStatus"::text WHEN 'IN_REVIEW' THEN 'RECRUITER_REVIEW' WHEN 'HIRED' THEN 'ACCEPTED' ELSE "fromStatus"::text END)::"ApplicationStatus_new");
ALTER TABLE "ApplicationEvent" ALTER COLUMN "toStatus" TYPE "ApplicationStatus_new" USING ((CASE "toStatus"::text WHEN 'IN_REVIEW' THEN 'RECRUITER_REVIEW' WHEN 'HIRED' THEN 'ACCEPTED' ELSE "toStatus"::text END)::"ApplicationStatus_new");
ALTER TYPE "ApplicationStatus" RENAME TO "ApplicationStatus_old";
ALTER TYPE "ApplicationStatus_new" RENAME TO "ApplicationStatus";
DROP TYPE "public"."ApplicationStatus_old";
ALTER TABLE "Application" ALTER COLUMN "status" SET DEFAULT 'APPLIED';
COMMIT;

-- AlterEnum
ALTER TYPE "EmployerRole" ADD VALUE 'EMPLOYER';

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'COMPANY_LOGO';

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "appliedAt" TIMESTAMP(3),
ADD COLUMN     "applyClickedAt" TIMESTAMP(3),
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "origin" TEXT,
ADD COLUMN     "portfolioItemIds" TEXT[],
ADD COLUMN     "portfolioProjectIds" TEXT[],
ADD COLUMN     "sourceLabel" TEXT,
ADD COLUMN     "viewedByEmployerAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ApplicationEvent" ADD COLUMN     "meta" JSONB,
ADD COLUMN     "visibleToCandidate" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "industry" TEXT,
ADD COLUMN     "locations" TEXT[],
ADD COLUMN     "logoFileId" TEXT,
ADD COLUMN     "size" TEXT;

-- AlterTable

-- AlterTable
ALTER TABLE "ProfileView" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'PROFILE',
ADD COLUMN     "meta" JSONB;

-- CreateTable
CREATE TABLE "ApplicationNote" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 45,
    "mode" TEXT NOT NULL DEFAULT 'VIDEO',
    "locationOrLink" TEXT,
    "messageToCandidate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "candidateResponse" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationMessage" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "senderId" TEXT,
    "senderRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "ApplicationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobInteraction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "senderId" TEXT,
    "profileId" TEXT NOT NULL,
    "jobId" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerInvite" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "EmployerRole" NOT NULL DEFAULT 'RECRUITER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployerInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId","event")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicationNote_applicationId_createdAt_idx" ON "ApplicationNote"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "Interview_applicationId_idx" ON "Interview"("applicationId");

-- CreateIndex
CREATE INDEX "Interview_scheduledAt_status_idx" ON "Interview"("scheduledAt", "status");

-- CreateIndex
CREATE INDEX "ApplicationMessage_applicationId_createdAt_idx" ON "ApplicationMessage"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "JobInteraction_userId_jobId_createdAt_idx" ON "JobInteraction"("userId", "jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobInteraction_jobId_type_idx" ON "JobInteraction"("jobId", "type");

-- CreateIndex
CREATE INDEX "ContactRequest_profileId_status_idx" ON "ContactRequest"("profileId", "status");

-- CreateIndex
CREATE INDEX "ContactRequest_companyId_createdAt_idx" ON "ContactRequest"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerInvite_tokenHash_key" ON "EmployerInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "EmployerInvite_companyId_idx" ON "EmployerInvite"("companyId");

-- CreateIndex
CREATE INDEX "EmployerInvite_email_idx" ON "EmployerInvite"("email");

-- CreateIndex
CREATE INDEX "EmailOutbox_status_createdAt_idx" ON "EmailOutbox"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Company_logoFileId_key" ON "Company"("logoFileId");

-- CreateIndex
CREATE INDEX "ProfileView_profileId_kind_createdAt_idx" ON "ProfileView"("profileId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_logoFileId_fkey" FOREIGN KEY ("logoFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationNote" ADD CONSTRAINT "ApplicationNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationNote" ADD CONSTRAINT "ApplicationNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationMessage" ADD CONSTRAINT "ApplicationMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobInteraction" ADD CONSTRAINT "JobInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobInteraction" ADD CONSTRAINT "JobInteraction_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BIMProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerInvite" ADD CONSTRAINT "EmployerInvite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

