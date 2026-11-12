import { describe, expect, it } from "vitest";
import {
  calculateBudgetUsage,
  calculateDistribution,
  calculateSavingsSurplus,
  sumMinor,
  sumTransactions,
  toMinorUnits,
} from "./finance.js";

describe("money in minor units", () => {
  it("converts decimal input to exact integer cents", () => {
    expect(toMinorUnits("125.37")).toBe("12537");
  });

  it("rejects zero, negative and unsafe amounts", () => {
    expect(() => toMinorUnits("0")).toThrow();
    expect(() => toMinorUnits("-1")).toThrow();
    expect(() => toMinorUnits("1.005")).toThrow();
    expect(() => toMinorUnits("90071992547409.92")).toThrow();
    expect(toMinorUnits("90071992547409.91")).toBe("9007199254740991");
  });

  it("sums large minor-unit values without floating-point loss", () => {
    expect(sumMinor(["9007199254740991", "12"])).toBe(9007199254741003n);
  });

  it("sums only matching transaction types", () => {
    const transactions = [
      { kind: "income", amount_minor: "9007199254740991" },
      { kind: "expense", amount_minor: "25" },
    ];
    expect(sumTransactions(transactions, (item) => item.kind === "income")).toBe(9007199254740991n);
  });
});

describe("financial calculations", () => {
  it("calculates budget usage and clamps remaining at zero", () => {
    expect(calculateBudgetUsage("7500", "10000")).toEqual({
      spentMinor: 7500n,
      remainingMinor: 2500n,
      percent: 75,
    });
    expect(calculateBudgetUsage("12000", "10000").remainingMinor).toBe(0n);
  });

  it("transfers only positive salary surplus and applies the selected percentage", () => {
    expect(calculateSavingsSurplus("100000", "60000", "10000", 50)).toBe(15000n);
    expect(calculateSavingsSurplus("50000", "60000", "0", 100)).toBe(0n);
  });

  it("returns a distribution that totals 100 percent", () => {
    expect(calculateDistribution("1", "1", "1")).toEqual([34, 33, 33]);
    expect(calculateDistribution("0", "0", "0")).toEqual([0, 0, 0]);
    expect(calculateDistribution("45", "35", "20").reduce((sum, value) => sum + value, 0)).toBe(100);
  });
});
