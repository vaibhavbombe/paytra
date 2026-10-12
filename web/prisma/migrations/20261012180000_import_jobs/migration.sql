-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('AWAITING_UPLOAD', 'PARSING', 'READY', 'COMMITTED', 'FAILED');

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "object_path" TEXT NOT NULL,
    "source" "TransactionSource" NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'AWAITING_UPLOAD',
    "error" TEXT,
    "file_sha256" CHAR(64),
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "import_batch_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_jobs_object_path_key" ON "import_jobs"("object_path");

-- CreateIndex
CREATE UNIQUE INDEX "import_jobs_import_batch_id_key" ON "import_jobs"("import_batch_id");

-- CreateIndex
CREATE INDEX "import_jobs_user_id_created_at_idx" ON "import_jobs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "import_jobs_status_expires_at_idx" ON "import_jobs"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written rules
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_source_file" CHECK ("source" IN ('CSV', 'PDF'));
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_object_path_shape"
  CHECK ("object_path" ~ '^uploads/[0-9a-f-]{36}/[0-9a-f-]{36}$');
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_attempts_nonneg" CHECK ("attempts" >= 0);
-- A committed job must point at its import batch.
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_committed_has_batch"
  CHECK ("status" <> 'COMMITTED' OR "import_batch_id" IS NOT NULL);
