/*
  Warnings:

  - You are about to drop the column `code` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the column `language` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the column `messages` on the `Session` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Session" DROP COLUMN "code",
DROP COLUMN "language",
DROP COLUMN "messages",
ADD COLUMN     "githubBranch" TEXT,
ADD COLUMN     "githubRepo" TEXT,
ADD COLUMN     "templateDecided" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "templateType" TEXT NOT NULL DEFAULT 'nextjs',
ADD COLUMN     "threadId" TEXT;

-- CreateIndex
CREATE INDEX "Session_threadId_idx" ON "Session"("threadId");
