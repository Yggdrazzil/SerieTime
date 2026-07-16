-- CreateTable
CREATE TABLE "ExploreImpression" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "servedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExploreImpression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ExploreImpression_userId_servedAt_idx" ON "ExploreImpression"("userId", "servedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExploreImpression_userId_itemKey_key" ON "ExploreImpression"("userId", "itemKey");
