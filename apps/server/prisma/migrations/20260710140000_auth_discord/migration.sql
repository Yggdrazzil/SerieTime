-- SSO Discord : identité par compte.
ALTER TABLE "User" ADD COLUMN "discordId" TEXT;
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");
