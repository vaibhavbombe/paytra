import { describe, expect, it, vi } from "vitest";

// service.ts is server-only; the helper under test is pure.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/push/service", () => ({ sendPush: vi.fn() }));

const { highestPerBudgetPeriod } = await import("./service");

const oct = new Date("2026-10-01T00:00:00Z");
const nov = new Date("2026-11-01T00:00:00Z");
const row = (id: string, budgetId: string, periodStart: Date, thresholdPercent: number) => ({ id, budgetId, periodStart, thresholdPercent });

describe("highestPerBudgetPeriod", () => {
  it("shows only 100% when 80% and 100% were reached together", () => {
    const rows = [row("a1", "shopping", oct, 80), row("a2", "shopping", oct, 100)];
    expect(highestPerBudgetPeriod(rows).map((r) => r.id)).toEqual(["a2"]);
  });

  it("keeps different budgets and different periods separate", () => {
    const rows = [
      row("a1", "food", oct, 80),
      row("a2", "groceries", oct, 80),
      row("a3", "food", nov, 80),
      row("a4", "food", oct, 100),
    ];
    expect(highestPerBudgetPeriod(rows).map((r) => r.id)).toEqual(["a2", "a3", "a4"]);
  });

  it("keeps the original order", () => {
    const rows = [row("b", "x", oct, 100), row("a", "y", oct, 80)];
    expect(highestPerBudgetPeriod(rows).map((r) => r.id)).toEqual(["b", "a"]);
  });
});
