import { formatPaise } from "@/lib/money";
import type { BudgetStatus } from "@/lib/budgets/service";

import { DeleteBudgetButton } from "./delete-budget-button";

const BAR = { ok: "bg-success", warning: "bg-warning", over: "bg-danger" } as const;
const TEXT = { ok: "text-success", warning: "text-warning", over: "text-danger" } as const;

/** Server component: amounts are formatted here, BigInt never reaches the client. */
export function BudgetCard({ b, showDelete = true }: { b: BudgetStatus; showDelete?: boolean }) {
  const left = b.limitPaise - b.spentPaise;
  const width = Math.min(b.percent, 100);

  return (
    <li className="space-y-2 rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{b.name}</p>
          <p className="text-xs text-muted">
            {b.period === "WEEKLY" ? "Weekly" : "Monthly"} · {b.periodLabel} · {b.daysLeft} day{b.daysLeft === 1 ? "" : "s"} left
          </p>
        </div>
        {showDelete && <DeleteBudgetButton budgetId={b.id} name={b.name} />}
      </div>

      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-hover"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-label={`${b.name} budget ${b.percent}% used`}
      >
        <div className={`h-full ${BAR[b.level]}`} style={{ width: `${width}%` }} />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-mono">
          {formatPaise(b.spentPaise)} <span className="text-muted">of {formatPaise(b.limitPaise)}</span>
        </span>
        <span className={`font-medium ${TEXT[b.level]}`}>
          {b.percent}% · {left >= 0n ? `${formatPaise(left)} left` : `${formatPaise(-left)} over`}
        </span>
      </div>
    </li>
  );
}
