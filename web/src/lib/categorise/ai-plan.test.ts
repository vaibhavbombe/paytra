import { describe, expect, it } from "vitest";

import { AI_BATCH_LIMIT, aiCategoryOptions, aiUpdates, planAiBatch } from "./ai-plan";

const tx = (id: string, merchant: string | null, direction: "DEBIT" | "CREDIT" = "DEBIT", description = merchant ?? "") => ({
  id,
  direction,
  merchant,
  description,
});

const CATS = [
  { id: "food", name: "Food & Dining", kind: "EXPENSE" as const, userId: null },
  { id: "salary", name: "Salary", kind: "INCOME" as const, userId: null },
  { id: "self", name: "Self Transfer", kind: "TRANSFER" as const, userId: null },
];

describe("planAiBatch", () => {
  it("asks once per payee + direction, most frequent first", () => {
    const plan = planAiBatch([tx("1", "ZOMATO"), tx("2", "SWIGGY"), tx("3", "Swiggy"), tx("4", "SWIGGY", "CREDIT")]);
    expect(plan.items.map((i) => [i.payee, i.direction])).toEqual([
      ["SWIGGY", "DEBIT"],
      ["SWIGGY", "CREDIT"],
      ["ZOMATO", "DEBIT"],
    ]);
    expect(plan.transactionIds.get(plan.items[0].id)).toEqual(["2", "3"]);
  });

  it("sends only id, payee and direction (no amount or account data)", () => {
    const [item] = planAiBatch([tx("1", "SWIGGY")]).items;
    expect(Object.keys(item).sort()).toEqual(["direction", "id", "payee"]);
  });

  it("uses the description when there is no merchant, and trims long names", () => {
    const [item] = planAiBatch([tx("1", null, "DEBIT", `  ${"A".repeat(120)}  `)]).items;
    expect(item.payee).toBe("A".repeat(80));
  });

  it("gives the same payee the same id every time", () => {
    expect(planAiBatch([tx("1", "SWIGGY")]).items[0].id).toBe(planAiBatch([tx("9", "swiggy")]).items[0].id);
  });

  it("caps the batch and reports what is left", () => {
    const many = Array.from({ length: AI_BATCH_LIMIT + 7 }, (_, n) => tx(String(n), `PAYEE ${n}`));
    const plan = planAiBatch(many);
    expect(plan.items).toHaveLength(AI_BATCH_LIMIT);
    expect(plan.leftOver).toBe(7);
  });

  it("returns nothing for an empty list", () => {
    expect(planAiBatch([])).toMatchObject({ items: [], leftOver: 0 });
  });
});

describe("aiCategoryOptions", () => {
  it("prefers the user's own category on a name clash", () => {
    const mine = { id: "my-food", name: "Food & Dining", kind: "EXPENSE" as const, userId: "u1" };
    const { options, byName } = aiCategoryOptions([...CATS, mine]);
    expect(options.filter((o) => o.name === "Food & Dining")).toHaveLength(1);
    expect(byName.get("Food & Dining")?.id).toBe("my-food");
  });
});

describe("aiUpdates", () => {
  const plan = planAiBatch([tx("1", "SWIGGY"), tx("2", "SWIGGY"), tx("3", "ACME PAYROLL", "CREDIT"), tx("4", "RANDOM SHOP")]);
  const id = (payee: string) => plan.items.find((i) => i.payee === payee)!.id;
  const { byName } = aiCategoryOptions(CATS);

  it("applies confident answers to every transaction of that payee", () => {
    const { updates, unsure } = aiUpdates(
      plan,
      [
        { id: id("SWIGGY"), category: "Food & Dining", confidence: "high" },
        { id: id("ACME PAYROLL"), category: "Salary", confidence: "high" },
      ],
      byName,
    );
    expect(updates.get("food")).toEqual(["1", "2"]);
    expect(updates.get("salary")).toEqual(["3"]);
    expect(unsure).toBe(0);
  });

  it("leaves low-confidence, unknown and invented answers for the user", () => {
    const { updates, unsure } = aiUpdates(
      plan,
      [
        { id: id("SWIGGY"), category: "Food & Dining", confidence: "low" },
        { id: id("RANDOM SHOP"), category: null, confidence: null },
        { id: id("ACME PAYROLL"), category: "Lottery Winnings", confidence: "high" },
      ],
      byName,
    );
    expect(updates.size).toBe(0);
    expect(unsure).toBe(3);
  });

  it("rejects an income category on money out, and ignores ids it never sent", () => {
    const { updates } = aiUpdates(
      plan,
      [
        { id: id("SWIGGY"), category: "Salary", confidence: "high" },
        { id: "not-ours", category: "Food & Dining", confidence: "high" },
      ],
      byName,
    );
    expect(updates.size).toBe(0);
  });
});
