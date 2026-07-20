-- CreateIndex
CREATE INDEX "ActivityReaction_userId_idx" ON "ActivityReaction"("userId");

-- CreateIndex
CREATE INDEX "Rating_userId_episodeId_idx" ON "Rating"("userId", "episodeId");
