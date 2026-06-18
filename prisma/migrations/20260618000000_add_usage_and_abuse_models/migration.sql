-- CreateTable
CREATE TABLE "Usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "sessionId" TEXT,
    "modelId" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreateTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbuseEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "windowStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbuseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Usage_userId_createdAt_idx" ON "Usage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Usage_threadId_idx" ON "Usage"("threadId");

-- CreateIndex
CREATE INDEX "Usage_createdAt_idx" ON "Usage"("createdAt");

-- CreateIndex
CREATE INDEX "AbuseEvent_userId_createdAt_idx" ON "AbuseEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AbuseEvent_kind_createdAt_idx" ON "AbuseEvent"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AbuseEvent_userId_kind_windowStart_key" ON "AbuseEvent"("userId", "kind", "windowStart");
