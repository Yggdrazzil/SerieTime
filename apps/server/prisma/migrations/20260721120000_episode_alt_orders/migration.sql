-- AlterTable
ALTER TABLE "Show" ADD COLUMN "defaultEpisodeOrder" TEXT;
ALTER TABLE "Show" ADD COLUMN "episodeOrderCheckedAt" DATETIME;

-- AlterTable
ALTER TABLE "UserMediaStatus" ADD COLUMN "episodeOrder" TEXT;

-- CreateTable
CREATE TABLE "EpisodeAltNumber" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "showId" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    CONSTRAINT "EpisodeAltNumber_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EpisodeAltNumber_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EpisodeAltNumber_showId_orderType_idx" ON "EpisodeAltNumber"("showId", "orderType");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeAltNumber_orderType_episodeId_key" ON "EpisodeAltNumber"("orderType", "episodeId");

