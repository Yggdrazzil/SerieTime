-- Liaison multi-fournisseurs : un compte peut cumuler mot de passe + Google + Facebook + Apple.
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;
ALTER TABLE "User" ADD COLUMN "facebookId" TEXT;
ALTER TABLE "User" ADD COLUMN "appleId" TEXT;

-- Reprise des comptes SSO existants (provider/providerId) vers les nouvelles colonnes.
UPDATE "User" SET "googleId" = "providerId" WHERE "provider" = 'google' AND "providerId" IS NOT NULL;
UPDATE "User" SET "facebookId" = "providerId" WHERE "provider" = 'facebook' AND "providerId" IS NOT NULL;
UPDATE "User" SET "appleId" = "providerId" WHERE "provider" = 'apple' AND "providerId" IS NOT NULL;

CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
CREATE UNIQUE INDEX "User_facebookId_key" ON "User"("facebookId");
CREATE UNIQUE INDEX "User_appleId_key" ON "User"("appleId");
