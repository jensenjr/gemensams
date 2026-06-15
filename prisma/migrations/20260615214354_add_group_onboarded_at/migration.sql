-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "onboardedAt" TIMESTAMP(3);

-- Mark all existing groups as already onboarded so current users aren't forced into the wizard.
-- A fresh install seeds its group AFTER migrate runs, so seed groups stay NULL → wizard shows.
UPDATE "Group" SET "onboardedAt" = NOW() WHERE "onboardedAt" IS NULL;
