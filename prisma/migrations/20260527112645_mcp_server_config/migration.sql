-- CreateTable
CREATE TABLE "McpServerConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authType" TEXT NOT NULL,
    "encryptedBearerToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "McpServerConfig_userId_idx" ON "McpServerConfig"("userId");
