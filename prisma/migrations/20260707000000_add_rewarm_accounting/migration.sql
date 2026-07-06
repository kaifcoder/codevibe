-- Per-session rewarm accounting for /api/rewarm-sandbox rate limiting.
-- rewarmCount is bumped on every successful provisioning; lastRewarmAt
-- drives a short cooldown so a client can't burst the counter.
ALTER TABLE "Session" ADD COLUMN "rewarmCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Session" ADD COLUMN "lastRewarmAt" TIMESTAMP(3);
