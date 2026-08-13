import type { Iteration } from "./types.js";

/**
 * Configuration for context-window compaction. When the projected message
 * list exceeds `contextWindow - reserveTokens`, older iterations are
 * summarized and replaced with a single summary iteration.
 *
 * Token math throughout this module is conservative: a chars/4 heuristic
 * over the rendered AssistantMessage + REPL result. This is good enough to
 * decide when to trigger compaction but should not be confused with the
 * model's own token counter.
 */
export interface CompactionOptions {
  /** Context window to budget against. Defaults to 200_000 (≈ a typical
   *  Claude-class frontier model). Set explicitly per-model when known. */
  contextWindow?: number;
  /** Tokens to keep free at the head of the window for the model's
   *  next response. Defaults to 16_384. The trigger fires when
   *  currentTokens > contextWindow - reserveTokens. */
  reserveTokens?: number;
  /** Tokens of recent iterations to keep verbatim after compaction.
   *  Defaults to 20_000. Combined with minRecentIterations, whichever
   *  is more conservative wins. */
  keepRecentTokens?: number;
  /** Floor on the number of recent iterations kept regardless of
   *  their token count. Defaults to 1 (so we never compact everything
   *  and strand the model with no recent context). */
  minRecentIterations?: number;
  /** Hard ceiling on compaction calls per completion(). Defaults to 3.
   *  If hit, compaction is skipped on the remaining iterations to avoid
   *  spending the rest of the run summarizing itself. */
  maxCompactions?: number;
}

export const DEFAULT_COMPACTION_OPTIONS: Required<CompactionOptions> = {
  contextWindow: 200_000,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
  minRecentIterations: 1,
  maxCompactions: 3,
};

export interface CompactionEvent {
  /** Iteration index at which compaction fired (the iteration that
   *  triggered it). */
  atIteration: number;
  /** Conservative token estimate of the projected message list before
   *  compaction. */
  tokensBefore: number;
  /** Conservative token estimate of the projected message list after
   *  compaction (a lower bound, since the summary is itself a string
   *  whose final length is decided by the summarizing model). */
  tokensAfter: number;
  /** Number of iterations that were replaced by the summary. */
  iterationsReplaced: number;
  /** 1-based count of how many compactions have run so far on this
   *  completion(). Increments on every call. */
  compactionCount: number;
}

/**
 * Conservative token estimate of an iteration's contribution to the
 * projected message list. Sums a chars/4 heuristic over the assistant
 * message and the REPL result that follows it. ChatMessage.content is
 * a plain string in our current LMClient interface, so there's no
 * block-array handling needed yet — if/when we add a richer content
 * type, extend this.
 */
export function estimateIterationTokens(it: Iteration): number {
  let chars = it.assistantMessage.content.length;
  const result = it.replResult;
  if (!result.success) {
    chars += (result.error?.message?.length ?? 0) + (result.error?.trace?.length ?? 0);
  } else {
    for (const line of result.stdout) chars += line.length;
    if (result.expression !== undefined) {
      chars += JSON.stringify(result.expression).length;
    }
  }
  return Math.ceil(chars / 4);
}

/**
 * Sum of estimateIterationTokens over an array. Also returns the
 * per-iteration breakdown so callers can render a debug log without
 * redoing the work.
 */
export function estimateIterationsTokens(iterations: Iteration[]): number {
  let total = 0;
  for (const it of iterations) total += estimateIterationTokens(it);
  return total;
}

/**
 * True if the projected message list is close enough to the context
 * window to justify compaction. The check operates on the sum of
 * estimated iteration tokens + an `extraTokens` allowance for the
 * framing overhead (system prompt, user prompt, role tags). It does
 * NOT consult the model's own usage: we don't have a uniform Usage
 * channel across providers yet, so a local estimate is the only thing
 * that works for every provider.
 */
export function shouldCompact(
  iterations: Iteration[],
  opts: CompactionOptions = {},
  extraTokens: number = 0,
): boolean {
  const cfg = { ...DEFAULT_COMPACTION_OPTIONS, ...opts };
  if (cfg.contextWindow <= 0) return false;
  const currentTokens = estimateIterationsTokens(iterations) + extraTokens;
  return currentTokens > cfg.contextWindow - cfg.reserveTokens;
}

/**
 * Decide where to start the recent-iterations window. Walks from the
 * newest iteration backwards, accumulating tokens, until either the
 * `keepRecentTokens` budget is satisfied or `minRecentIterations`
 * iterations have been included. The returned index is the FIRST
 * iteration to keep — everything from `cutPoint` onward stays verbatim,
 * everything before it gets summarized.
 *
 * If the entire history fits in the keep-recent budget, returns 0
 * (nothing to summarize). If we ran out of iterations before hitting
 * keepRecentTokens, returns the index that keeps `minRecentIterations`
 * whole iterations (or 0 if the array is shorter).
 */
export function findCutPoint(
  iterations: Iteration[],
  opts: CompactionOptions = {},
): number {
  const cfg = { ...DEFAULT_COMPACTION_OPTIONS, ...opts };
  let accumulated = 0;
  let count = 0;
  // Walk from newest to oldest.
  for (let i = iterations.length - 1; i >= 0; i--) {
    accumulated += estimateIterationTokens(iterations[i]!);
    count++;
    if (count >= cfg.minRecentIterations && accumulated >= cfg.keepRecentTokens) {
      return i;
    }
  }
  // Couldn't honor keepRecentTokens; fall back to the minRecentIterations
  // floor (or everything if we have less than that).
  return Math.max(0, iterations.length - Math.max(count, cfg.minRecentIterations));
}

/**
 * Build the structured summarization prompt. The format mirrors the
 * prime-agent checklist (Goal / Constraints / Progress / Current State
 * / Next Steps) so the model has a concrete scaffold to fill in rather
 * than the free-form "summarize the conversation" that produces
 * summaries the next turn can't act on.
 *
 * The compaction-count and total-iteration-count are included so the
 * model knows how many compactions have happened and how much history
 * it's being asked to compress. Preserve any concrete intermediate
 * results (numbers, variable names, REPL values): losing those is the
 * single most common reason a compacted run loses track of the task.
 */
export function buildSummaryPrompt(args: {
  totalIterations: number;
  compactionCount: number;
}): string {
  return [
    "The conversation above is a long-running RLM trajectory that has been",
    "compacted to free context space. Produce a structured checkpoint",
    "summary that another assistant will use to continue the work without",
    "re-doing anything already done.",
    "",
    "Use EXACTLY this format (no preamble, no extra commentary):",
    "",
    "## Goal",
    "[What is the user trying to accomplish? State it in one sentence.]",
    "",
    "## Constraints & Preferences",
    "- [Any constraints, preferences, or requirements the user stated]",
    "- [Or '(none)' if none were mentioned]",
    "",
    "## Progress",
    "### Done",
    "- [x] [Completed steps, with concrete results: numbers, variable names,",
    "  REPL values — PRESERVE THESE EXACTLY. They are the difference between",
    "  a useful summary and a useless one.]",
    "### In progress",
    "- [Step currently being worked on, and what was last observed]",
    "### Not started",
    "- [Remaining steps still to do]",
    "",
    "## Current State",
    "[Key REPL variables and their values, currently loaded context, and any",
    "in-flight computations. Use REPL-style notation where useful.]",
    "",
    "## Next Steps",
    "1. [Concrete next action the new assistant should take]",
    "2. [Subsequent action]",
    "",
    `This is compaction #${args.compactionCount} of a trajectory that has run`,
    `${args.totalIterations} iterations so far.`,
  ].join("\n");
}

/**
 * A summarizer is just a function that turns a prompt into a string.
 * The caller injects whatever async pipeline it likes (an LMClient.chat
 * call, a smaller-model endpoint, a cached + fallback pair). Keeping
 * this module free of LMClient keeps it reusable and testable.
 */
export type Summarize = (prompt: string) => Promise<string>;

/**
 * Compact an iteration history. The caller is responsible for deciding
 * *whether* to compact (via shouldCompact); this function is the
 * "what to do about it" half.
 *
 * Returns:
 *   - newIterations: a fresh array starting with a single summary
 *     iteration (replResult.success = true, stdout empty, expression
 *     undefined) followed by the kept-recent iterations from
 *     `iterations.slice(cutPoint)`.
 *   - rawSummary: the summary text produced by the summarizer, so
 *     callers can include it in CompactionEvent payloads.
 *   - iterationsReplaced: how many iterations were dropped.
 */
export interface CompactResult {
  newIterations: Iteration[];
  rawSummary: string;
  iterationsReplaced: number;
  tokensBefore: number;
  tokensAfter: number;
}

export async function compactIterations(
  iterations: Iteration[],
  opts: CompactionOptions,
  summarize: Summarize,
  args: { compactionCount: number },
): Promise<CompactResult> {
  const tokensBefore = estimateIterationsTokens(iterations);
  const cutPoint = findCutPoint(iterations, opts);

  // Safety: if cutPoint is 0, findCutPoint decided the entire
  // trajectory fits in keepRecentTokens — there's nothing to summarize.
  // Skip the (expensive) summarizer call and return a fresh slice
  // unchanged. The caller can detect this from
  // `iterationsReplaced === 0` and avoid emitting an event.
  if (cutPoint === 0) {
    return {
      newIterations: iterations.slice(),
      rawSummary: "",
      iterationsReplaced: 0,
      tokensBefore,
      tokensAfter: tokensBefore,
    };
  }

  // Build the conversation transcript the summarizer will see. Only
  // the iterations we are about to drop are included; the kept-recent
  // tail is preserved verbatim on the next iteration so the model can
  // see its own recent work without re-reading it as a summary.
  const dropped = iterations.slice(0, cutPoint);
  const recentKept = iterations.slice(cutPoint);

  const transcriptLines: string[] = [];
  for (const it of dropped) {
    transcriptLines.push(`[assistant]\n${it.assistantMessage.content}`);
    transcriptLines.push(`[repl-result]\n${formatResultForSummary(it)}`);
  }

  const summaryPrompt = buildSummaryPrompt({
    totalIterations: iterations.length,
    compactionCount: args.compactionCount,
  });

  const summarizerInput = [
    "Trajectory to summarize (compaction context):",
    "",
    transcriptLines.join("\n\n"),
    "",
    "---",
    "",
    summaryPrompt,
  ].join("\n");

  const rawSummary = await summarize(summarizerInput);

  const summaryIteration: Iteration = {
    index: 0, // will be re-indexed by the caller
    assistantMessage: { role: "assistant", content: rawSummary },
    replResult: { success: true, stdout: [], durationMs: 0 },
    subCallsAtStart: 0,
  };

  const newIterations = [summaryIteration, ...recentKept];
  const tokensAfter = estimateIterationsTokens(newIterations);

  return {
    newIterations,
    rawSummary,
    iterationsReplaced: dropped.length,
    tokensBefore,
    tokensAfter,
  };
}

/**
 * Render a REPL result the way buildHistoryMessages would, but pulled
 * out so the summarizer sees the same shape the model does. Kept in
 * sync with utils/messages.ts; if you change one, change the other.
 */
function formatResultForSummary(it: Iteration): string {
  if (!it.replResult.success) {
    return `error: ${it.replResult.error?.message ?? "unknown"}\ntrace: ${it.replResult.error?.trace ?? ""}`;
  }
  const stdout = it.replResult.stdout.join("\n");
  const expr = JSON.stringify(it.replResult.expression);
  return `stdout:\n${stdout}\nexpression: ${expr}`;
}
