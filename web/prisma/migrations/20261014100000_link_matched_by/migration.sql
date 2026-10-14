-- AlterTable
ALTER TABLE "transaction_source_links" ADD COLUMN     "matched_by" TEXT;


-- Hand-written rules
ALTER TABLE "transaction_source_links" ADD CONSTRAINT "transaction_source_links_matched_by_valid"
  CHECK ("matched_by" IS NULL OR "matched_by" IN ('EXACT', 'CONFIRMED'));
