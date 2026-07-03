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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("avatarUrl", "birthYear", "countryCode", "coverUrl", "createdAt", "displayName", "email", "gender", "id", "passwordHash", "updatedAt") SELECT "avatarUrl", "birthYear", "countryCode", "coverUrl", "createdAt", "displayName", "email", "gender", "id", "passwordHash", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_provider_providerId_key" ON "User"("provider", "providerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
