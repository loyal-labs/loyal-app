-- Add column as nullable first
ALTER TABLE "summaries" ADD COLUMN "oneliner" text;

-- Backfill existing rows with first topic title (truncated to 110 chars)
UPDATE "summaries" SET "oneliner" = LEFT(topics->0->>'title', 110) WHERE "oneliner" IS NULL;

-- Make column NOT NULL
ALTER TABLE "summaries" ALTER COLUMN "oneliner" SET NOT NULL;