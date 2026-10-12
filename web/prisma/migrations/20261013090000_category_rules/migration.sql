-- CreateEnum
CREATE TYPE "CategorySource" AS ENUM ('RULE', 'USER');

-- CreateEnum
CREATE TYPE "RuleMatchType" AS ENUM ('EXACT', 'CONTAINS');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "category_rule_id" UUID,
ADD COLUMN     "category_source" "CategorySource";

-- CreateTable
CREATE TABLE "category_rules" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "pattern" TEXT NOT NULL,
    "match_type" "RuleMatchType" NOT NULL,
    "direction" "Direction",
    "category_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_rules_user_id_idx" ON "category_rules"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_rules_user_id_pattern_match_type_direction_key" ON "category_rules"("user_id", "pattern", "match_type", "direction") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_rule_id_fkey" FOREIGN KEY ("category_rule_id") REFERENCES "category_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written rules
-- Backfill: categories that already exist were chosen by the user (manual entry).
UPDATE "transactions" SET "category_source" = 'USER' WHERE "category_id" IS NOT NULL AND "category_source" IS NULL;

-- Patterns are stored normalised so matching is a plain string compare.
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_pattern_normalised"
  CHECK ("pattern" ~ '^[A-Z0-9]+( [A-Z0-9]+)*$' AND length("pattern") <= 80);
-- NOTE (expand/contract): the rule "category_id and category_source are set
-- together" is added in a LATER migration, once code that writes
-- category_source is live. The web app and this database are shared by the
-- running version, which doesn't know the column yet.
-- Only RULE-categorised transactions point at a rule.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_rule_only_for_rule"
  CHECK ("category_rule_id" IS NULL OR "category_source" = 'RULE');
