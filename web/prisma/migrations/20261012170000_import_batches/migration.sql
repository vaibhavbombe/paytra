-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "source" "TransactionSource" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" CHAR(64) NOT NULL,
    "period_from" DATE,
    "period_to" DATE,
    "row_count" INTEGER NOT NULL,
    "inserted_count" INTEGER NOT NULL,
    "duplicate_count" INTEGER NOT NULL,
    "error_count" INTEGER NOT NULL,
    "balance_check" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_source_links" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "import_batch_id" UUID,
    "source" "TransactionSource" NOT NULL,
    "source_line" INTEGER,
    "created" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_source_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_user_id_created_at_idx" ON "import_batches"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "import_batches_account_id_file_sha256_idx" ON "import_batches"("account_id", "file_sha256");

-- CreateIndex
CREATE INDEX "transaction_source_links_transaction_id_idx" ON "transaction_source_links"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_source_links_import_batch_id_transaction_id_key" ON "transaction_source_links"("import_batch_id", "transaction_id");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_source_links" ADD CONSTRAINT "transaction_source_links_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_source_links" ADD CONSTRAINT "transaction_source_links_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written rules
-- ─────────────────────────────────────────────────────────────────────────

-- Import outcome counts must be non-negative and add up: every parsed row is
-- either inserted or a duplicate; rows with errors are counted separately.
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_counts_valid" CHECK (
  "row_count" >= 0 AND "inserted_count" >= 0 AND "duplicate_count" >= 0 AND "error_count" >= 0
  AND "inserted_count" + "duplicate_count" = "row_count"
);
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_balance_check_valid"
  CHECK ("balance_check" IN ('ok', 'mismatch', 'unavailable'));
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_sha256_hex"
  CHECK ("file_sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_period_valid"
  CHECK ("period_from" IS NULL OR "period_to" IS NULL OR "period_from" <= "period_to");
