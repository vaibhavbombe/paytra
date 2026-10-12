-- Contract step of the category_source change (see 20261013090000).
-- Every deployed version now writes category_source alongside category_id,
-- so the database can enforce that they always go together.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_source_consistent"
  CHECK (("category_id" IS NULL) = ("category_source" IS NULL));
