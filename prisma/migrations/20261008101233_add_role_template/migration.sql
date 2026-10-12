

-- CreateTable
CREATE TABLE "RoleTemplate" (
    "id" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "description" TEXT,
    "keywords" TEXT[],
    "skills" TEXT[],
    "bulletTemplates" JSONB NOT NULL DEFAULT '[]',
    "formatRules" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleTemplate_roleName_key" ON "RoleTemplate"("roleName");

-- CreateIndex
CREATE INDEX "RoleTemplate_roleName_idx" ON "RoleTemplate"("roleName");
