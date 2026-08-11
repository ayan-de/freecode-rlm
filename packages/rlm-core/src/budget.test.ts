import { describe, it, expect } from "vitest";
import { Budget, BudgetExceededError } from "./budget.js";

describe("Budget", () => {
  it("allows consumption up to the limit", () => {
    const b = new Budget({ maxIterations: 3, maxSubCalls: 5 });
    b.tryConsumeIteration();
    b.tryConsumeIteration();
    b.tryConsumeIteration();
    expect(() => b.tryConsumeIteration()).toThrow(BudgetExceededError);
  });

  it("counts sub-calls across the run", () => {
    const b = new Budget({ maxIterations: 100, maxSubCalls: 2 });
    b.tryConsumeSubCall();
    b.tryConsumeSubCall();
    expect(() => b.tryConsumeSubCall()).toThrow(BudgetExceededError);
  });

  it("exposes totals", () => {
    const b = new Budget({ maxIterations: 100, maxSubCalls: 100 });
    b.tryConsumeIteration();
    b.tryConsumeSubCall();
    b.tryConsumeSubCall();
    expect(b.iterations).toBe(1);
    expect(b.subCalls).toBe(2);
  });

  it("does not mutate state when consumption throws", () => {
    const b = new Budget({ maxIterations: 1, maxSubCalls: 1 });
    b.tryConsumeIteration();
    expect(() => b.tryConsumeIteration()).toThrow(BudgetExceededError);
    expect(b.iterations).toBe(1); // still 1, the throw didn't bump it
  });

  it("BudgetExceededError carries the failing kind", () => {
    const b = new Budget({ maxIterations: 0, maxSubCalls: 0 });
    try {
      b.tryConsumeIteration();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect((err as BudgetExceededError).kind).toBe("iterations");
      expect((err as BudgetExceededError).message).toBe("budget exceeded: iterations");
    }
    try {
      b.tryConsumeSubCall();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect((err as BudgetExceededError).kind).toBe("subcalls");
      expect((err as BudgetExceededError).message).toBe("budget exceeded: subcalls");
    }
  });

  it("iteration and sub-call budgets are independent", () => {
    const b = new Budget({ maxIterations: 2, maxSubCalls: 1 });
    b.tryConsumeIteration();
    b.tryConsumeSubCall(); // sub-call budget exhausted (1 of 1)
    expect(() => b.tryConsumeSubCall()).toThrow(BudgetExceededError);
    // iteration budget still has 1 left
    b.tryConsumeIteration();
    expect(() => b.tryConsumeIteration()).toThrow(BudgetExceededError);
  });
});
