-- AlterTable
ALTER TABLE "Media" ADD COLUMN "translationsJson" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "coverUrl" TEXT,
    "birthYear" INTEGER,
    "gender" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'FR',
    "passwordHash" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'password',
    "providerId" TEXT,
    "googleId" TEXT,
    "facebookId" TEXT,
    "appleId" TEXT,
    "discordId" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("appleId", "avatarUrl", "birthYear", "countryCode", "coverUrl", "createdAt", "discordId", "displayName", "email", "facebookId", "gender", "googleId", "id", "isPrivate", "passwordHash", "provider", "providerId", "updatedAt") SELECT "appleId", "avatarUrl", "birthYear", "countryCode", "coverUrl", "createdAt", "discordId", "displayName", "email", "facebookId", "gender", "googleId", "id", "isPrivate", "passwordHash", "provider", "providerId", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
CREATE UNIQUE INDEX "User_facebookId_key" ON "User"("facebookId");
CREATE UNIQUE INDEX "User_appleId_key" ON "User"("appleId");
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");
CREATE UNIQUE INDEX "User_provider_providerId_key" ON "User"("provider", "providerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
