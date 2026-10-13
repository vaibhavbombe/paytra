-- CreateTable
CREATE TABLE "budget_alerts" (
    "id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "threshold_percent" INTEGER NOT NULL,
    "spent_paise" BIGINT NOT NULL,
    "limit_paise" BIGINT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_alerts_user_id_read_at_created_at_idx" ON "budget_alerts"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "budget_alerts_budget_id_period_start_threshold_percent_key" ON "budget_alerts"("budget_id", "period_start", "threshold_percent");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_user_id_category_id_period_key" ON "budgets"("user_id", "category_id", "period") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written rules
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_threshold_range"
  CHECK ("threshold_percent" BETWEEN 1 AND 200);
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_amounts_valid"
  CHECK ("spent_paise" >= 0 AND "limit_paise" > 0);
