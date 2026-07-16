-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserMediaStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "isOwned" BOOLEAN NOT NULL DEFAULT false,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "favoriteOrder" INTEGER,
    "favoritedAt" DATETIME,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "personalNote" TEXT,
    "rating" REAL,
    "playtimeMinutes" INTEGER,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "lastWatchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserMediaStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserMediaStatus_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserMediaStatus" ("addedAt", "completedAt", "createdAt", "favoriteOrder", "favoritedAt", "id", "isFavorite", "isHidden", "lastWatchedAt", "mediaId", "personalNote", "playtimeMinutes", "rating", "startedAt", "status", "updatedAt", "userId") SELECT "addedAt", "completedAt", "createdAt", "favoriteOrder", "favoritedAt", "id", "isFavorite", "isHidden", "lastWatchedAt", "mediaId", "personalNote", "playtimeMinutes", "rating", "startedAt", "status", "updatedAt", "userId" FROM "UserMediaStatus";
DROP TABLE "UserMediaStatus";
ALTER TABLE "new_UserMediaStatus" RENAME TO "UserMediaStatus";
CREATE INDEX "UserMediaStatus_userId_idx" ON "UserMediaStatus"("userId");
CREATE INDEX "UserMediaStatus_mediaId_idx" ON "UserMediaStatus"("mediaId");
CREATE INDEX "UserMediaStatus_status_idx" ON "UserMediaStatus"("status");
CREATE UNIQUE INDEX "UserMediaStatus_userId_mediaId_key" ON "UserMediaStatus"("userId", "mediaId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
