-- DropIndex
DROP INDEX "Notification_userId_idx";

-- DropIndex
DROP INDEX "UserEpisodeStatus_status_idx";

-- DropIndex
DROP INDEX "WatchEvent_userId_idx";

-- CreateTable
CREATE TABLE "UserSetting" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "dataJson" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Media_igdbId_idx" ON "Media"("igdbId");

-- CreateIndex
CREATE INDEX "Notification_userId_date_idx" ON "Notification"("userId", "date");

-- CreateIndex
CREATE INDEX "UserEpisodeStatus_userId_status_watchedAt_idx" ON "UserEpisodeStatus"("userId", "status", "watchedAt");

-- CreateIndex
CREATE INDEX "WatchEvent_userId_eventDate_idx" ON "WatchEvent"("userId", "eventDate");
