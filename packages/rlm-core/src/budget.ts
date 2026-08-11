export interface BudgetLimits {
  maxIterations: number;
  maxSubCalls: number;
}

export class BudgetExceededError extends Error {
  constructor(public readonly kind: "iterations" | "subcalls") {
    super(`budget exceeded: ${kind}`);
    this.name = "BudgetExceededError";
  }
}

/**
 * Caps total iterative work produced by an RLM run. Counts are
 * incremented in-place; counters that hit their limit throw
 * BudgetExceededError so callers can stop cleanly.
 */
export class Budget {
  iterations = 0;
  subCalls = 0;
  private readonly maxIterations: number;
  private readonly maxSubCalls: number;

  constructor(opts: BudgetLimits) {
    this.maxIterations = opts.maxIterations;
    this.maxSubCalls = opts.maxSubCalls;
  }

  tryConsumeIteration(): void {
    if (this.iterations >= this.maxIterations) {
      throw new BudgetExceededError("iterations");
    }
    this.iterations++;
  }

  tryConsumeSubCall(): void {
    if (this.subCalls >= this.maxSubCalls) {
      throw new BudgetExceededError("subcalls");
    }
    this.subCalls++;
  }
}
