-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('SAVINGS', 'CURRENT', 'CREDIT_CARD', 'WALLET', 'CASH');

-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('MANUAL', 'CSV', 'PDF', 'AA', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('EXPENSE', 'INCOME', 'TRANSFER');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('AA_FETCH', 'GMAIL_READ', 'SMS_READ', 'STATEMENT_UPLOAD');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "institution_name" TEXT NOT NULL,
    "nickname" TEXT,
    "type" "AccountType" NOT NULL,
    "last4" CHAR(4),
    "account_number_enc" BYTEA,
    "account_number_hash" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "Direction" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "txn_date" DATE NOT NULL,
    "occurred_at" TIMESTAMPTZ(3),
    "description" TEXT NOT NULL,
    "merchant" TEXT,
    "reference" TEXT,
    "narration_enc" BYTEA,
    "notes" TEXT,
    "category_id" UUID,
    "source" "TransactionSource" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL,
    "icon" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" UUID,
    "period" "BudgetPeriod" NOT NULL,
    "limit_paise" BIGINT NOT NULL,
    "alert_at_percents" INTEGER[] DEFAULT ARRAY[80, 100]::INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "data_from" DATE,
    "data_to" DATE,
    "external_ref" TEXT,
    "details" JSONB,
    "granted_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users"("firebase_uid");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_user_id_account_number_hash_key" ON "accounts"("user_id", "account_number_hash");

-- CreateIndex
CREATE INDEX "transactions_user_id_txn_date_idx" ON "transactions"("user_id", "txn_date" DESC);

-- CreateIndex
CREATE INDEX "transactions_user_id_category_id_txn_date_idx" ON "transactions"("user_id", "category_id", "txn_date");

-- CreateIndex
CREATE INDEX "transactions_account_id_reference_idx" ON "transactions"("account_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_account_id_fingerprint_key" ON "transactions"("account_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "categories_user_id_name_key" ON "categories"("user_id", "name") NULLS NOT DISTINCT;

-- CreateIndex
CREATE INDEX "budgets_user_id_active_idx" ON "budgets"("user_id", "active");

-- CreateIndex
CREATE INDEX "consents_user_id_purpose_status_idx" ON "consents"("user_id", "purpose", "status");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written rules (Prisma schema can't express these). Keep them here so
-- the database itself refuses bad money data, whatever code path writes it.
-- ─────────────────────────────────────────────────────────────────────────

-- Money: positive integer paise only; direction carries the sign.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_paise_positive" CHECK ("amount_paise" > 0);
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_limit_paise_positive" CHECK ("limit_paise" > 0);

-- Only INR for now (multi-currency would need FX rates and is out of scope).
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_currency_inr" CHECK ("currency" = 'INR');
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_inr" CHECK ("currency" = 'INR');

-- Masking: last4 must be exactly 4 digits (never a full account number).
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_last4_digits" CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$');

-- Alert thresholds are percentages of the limit.
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_alert_percents_range"
  CHECK (1 <= ALL ("alert_at_percents") AND 200 >= ALL ("alert_at_percents"));

-- Consent window must be valid.
ALTER TABLE "consents" ADD CONSTRAINT "consents_data_range_valid"
  CHECK ("data_from" IS NULL OR "data_to" IS NULL OR "data_from" <= "data_to");

-- Audit log is append-only. The single allowed UPDATE is the FK action
-- ON DELETE SET NULL when a user deletes their data (user_id -> NULL, every
-- other column unchanged). Note: the table owner can still disable triggers;
-- Phase 8 adds a restricted app role without that right.
CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."user_id" IS NOT NULL
       AND NEW."user_id" IS NULL
       AND (to_jsonb(NEW) - 'user_id') = (to_jsonb(OLD) - 'user_id') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER "audit_logs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_append_only"();
