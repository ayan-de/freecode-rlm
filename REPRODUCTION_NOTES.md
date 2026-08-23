# REPRODUCTION_NOTES.md

Where this implementation departs from
arXiv [2512.24601v3](https://arxiv.org/abs/2512.24601), and why.

Read alongside [PAPER_SPEC.md](PAPER_SPEC.md) (what the paper requires) and
[VERIFICATION.md](VERIFICATION.md) (what we actually verified).

---

## Reproduction status

**Nothing from the paper has been reproduced yet.**

| Paper result | Paper value | Our value | Status |
|---|---|---|---|
| Loop executes end-to-end on a toy task | N/A | passes | Verified (smoke only) |
| Needle-in-a-haystack retrieval (50k-line context) | N/A | passes | Verified (smoke only — no score, no RULER protocol) |
| S-NIAH (RULER, 50 tasks) | see §4 Fig. 1 | — | **NOT REPRODUCED** |
| OOLONG `trec_coarse`, RLM(GPT-5, depth=1) | 56.0 | — | **NOT REPRODUCED** |
| OOLONG-Pairs, RLM(GPT-5, depth=1) | 58.0 F1 | — | **NOT REPRODUCED** |
| BrowseComp-Plus (1K), RLM(GPT-5, depth=1) | 91.3 | — | **NOT REPRODUCED** |
| LongBench-v2 CodeQA, RLM(GPT-5, depth=1) | 62.0 | — | **NOT REPRODUCED** |

The two "Verified" rows are **smoke tests, not benchmarks**. They prove the loop
runs; they measure nothing. They are also skipped in CI because they need a live
API key.

**This repository must not claim to reproduce the paper.** It is an independent
implementation of the method whose fidelity is partially verified and whose
results are unmeasured.

---

## Known-wrong (open defects, not deviations)

Recorded here so nobody mistakes them for design choices. Details and fixes in
[VERIFICATION.md](VERIFICATION.md).

| ID | Defect | Severity |
|---|---|---|
| V-03 | REPL variables do not survive between iterations — `const`/`let`/`var` are scoped to a per-call wrapper. Breaks the paper's chunk-and-accumulate strategy. | CRITICAL |
| V-04 | `FINAL_VAR` cannot read a model-created variable; `inspect()` only returns host-injected bindings. | CRITICAL |
| V-01 | stdout enters the root history untruncated, contrary to §2 fn. 2 and our own system prompt. | HIGH |
| V-02 | The system prompt omits the context metadata the paper injects (`{context_type}`, `{context_total_length}`, `{context_lengths}`). | HIGH |

---

## Intentional deviations

### D-01 — JavaScript REPL instead of Python

**Paper:** §2 — *"we equip an LLM with a Python REPL, where all tools, including
sub-LM or sub-RLM calls, are available as modules."*

**Us:** JavaScript, executed in an `isolated-vm` V8 isolate.

**Why:** the RLM *definition* in §2 is language-agnostic — it requires a
persistent code environment holding `P` as a variable, nothing more. TypeScript
gives us memory-limited, timeout-enforced isolation without a container, and the
whole system ships as one npm package.

**Risk to fidelity — non-trivial.** The paper's system prompt (App. C.1) teaches
strategy through Python examples using `re.split`, slicing, and f-strings. The
model's ability to write correct chunking code is task-relevant: App. B reports
that *"models without sufficient coding capabilities struggle as RLMs"*, and
Figure 4(b) reports syntax-error rates per trajectory. A JS-vs-Python difference
in model coding fluency is a confound in any comparison against Table 1, and it
must be stated whenever we report a number.

**Additional JS-specific friction:** no top-level `await`, so sub-calls must be
wrapped in an async IIFE. We handle this with a system-prompt rule and a
targeted error hint (`isolated-vm.ts:66-68`). The paper has no equivalent
problem.

### D-02 — Default model is MiniMax-M3, not GPT-5

**Paper:** §3.2 — GPT-5 (medium reasoning) as root, GPT-5-mini for sub-calls;
Qwen3-Coder-480B-A35B for the open-model results.

**Us:** default `MiniMax-M3` via an OpenAI-compatible endpoint, one client
shared by root and sub-calls.

**Why:** cost. This is a self-funded implementation.

**Risk:** Table 1 numbers are **not** comparable. The paper also shows
model-specific prompt sensitivity (App. B: the same prompt produced "undesirable
behaviour" on Qwen3-Coder and needed an extra line). Any run against Table 1
must use the paper's models or explicitly label the substitution.

**Not yet supported:** per-depth model routing, so the paper's GPT-5 /
GPT-5-mini split cannot be expressed. Tracked in [TODO.md](TODO.md).

### D-03 — Only the last code block per assistant turn is executed

**Paper:** silent. **Authors' code:** executes every block
(`rlm/core/rlm.py:658-663`).

**Us:** last block only (`code-extract.ts`), and our system prompt says so, so
the model is not misled.

**Why:** a single execution per turn keeps the iteration/result mapping 1:1,
which simplifies budget accounting and compaction.

**Risk:** a model that emits a setup block plus a work block loses the setup.
Interacts badly with V-03 — with persistence broken, multi-block turns are the
natural workaround, and we drop them. Revisit after V-03 is fixed.

### D-04 — One-argument `rlm_query`

The paper's App. C.1 (1c) documents `rlm_query(context, query)`; the authors'
released code ships `rlm_query(prompt, model=None)`
(`rlm/utils/prompts.py:16`). We follow the released code. See PAPER_SPEC AMB-03.

### D-05 — Compaction inside the root loop

**Paper:** compaction is a **baseline that RLMs are shown to beat**, not a
component of an RLM. §1: *"compaction is rarely expressive enough for tasks that
require dense access throughout the prompt. It presumes that some details that
appear early in the prompt can safely be forgotten."* §3.2 evaluates a
"Compaction agent" as a comparison method; Table 1 shows RLM(depth=1) beating it
by a median of 26% on GPT-5.

**Us:** `packages/rlm-core/src/compaction.ts` summarizes older iterations when
the projected message list approaches the context window.

**Why:** without V-01 (stdout truncation), long trajectories overflow. Compaction
was added as a practical fix.

**This is the most consequential deviation in the repo.** Two things follow:

1. It is a symptom, not a feature. The paper's design avoids needing compaction
   *because* stdout never enters the window at full size. Fixing V-01 removes
   most of the pressure that motivated this.
2. **Any reproduction run must disable it** (`compaction: { enabled: false }`).
   An RLM that compacts its root history is not the system Table 1 measures, and
   reporting a number with compaction on would be measuring a hybrid.

Once V-01 lands, compaction should become opt-in and off by default.

### D-06 — Iteration-cap fallback

**Paper:** Algorithm 1 loops unconditionally; the paper states no cap and no
fallback. The authors' code has `_fallback_answer` / `_default_answer`
(`rlm/core/rlm.py:673,698`): one non-REPL LM call, then a hard-coded default.

**Us:** return the last assistant message's text (with `<think>` blocks
stripped). Simpler and cheaper, but lower quality than the reference. See
PAPER_SPEC AMB-05.

---

## Assumptions filling paper gaps

All `UNSPECIFIED` in the paper. Chosen by us; none is load-bearing for the
method, but all affect cost and any measured number.

| Setting | Our value | Reasoning |
|---|---|---|
| `maxIterations` | 50 | Paper §2 fn. 2 says iteration limits are expected ("we typically want to limit the iterations at any level of recursion"), gives no number. |
| `maxSubCalls` | 100, shared across all depths of one `completion()` | Recursion × loops can multiply without bound; App. B reports Qwen3-Coder attempting "thousands of LM subcalls" without a prompt-level warning. This is our structural equivalent of the paper's prompt-level mitigation. |
| REPL timeout | 30,000 ms per `execute()` | Long enough for large-context loops with sequential sub-calls. |
| REPL memory | 256 MB | Must hold `context` plus derived chunks. |
| Wall-clock cap | none | The reference has `_check_timeout` (`rlm.py:492`). Not ported. |
| Sampling | provider default | Paper says "default sampling parameters" (§3.2) without listing them. |

---

## Extensions beyond the paper

Ours, not the paper's. Must never be presented as reproduced behaviour.

| Extension | Location | Note |
|---|---|---|
| Skill system + `websearch` (Serper) | `packages/rlm-skills`, `rlm-repl/src/skills/` | Extra REPL globals. Off unless skills are loaded. Needs `SERPER_API_KEY`. |
| Host tools `bash` / `readFile` / `writeFile` | `rlm.ts:383-410` | Off by default (`enableSystemTools`). Grants arbitrary host command execution to model-written code — a real security boundary, and the reason it is opt-in. |
| Multi-turn history across `completion()` calls | `rlm.ts:93-98`, `utils/messages.ts` | The paper's RLM is single-turn. |
| Budget / `BudgetExceededError` | `budget.ts` | No paper equivalent. |

---

## Environment

| | |
|---|---|
| Node | 22.23.2 (`.mise.toml`). **Note:** root `package.json` declares `engines: node >=18`, which contradicts it — the pin is the accurate one. |
| Package manager | pnpm 9.0.0, lockfile committed |
| TypeScript | 5.9.2, strict |
| Sandbox | `isolated-vm` (native addon — needs a working node-gyp toolchain) |
| Env vars | `MINIMAX_API_KEY` or `OPENAI_API_KEY` (`vercel-ai.ts:22`); `SERPER_API_KEY` for the websearch skill (`websearch.ts:41`). **`.env.example` currently lists only the MiniMax pair — incomplete.** |

Live tests skip silently without `MINIMAX_API_KEY`. `pnpm test` on a clean
checkout with no keys runs 113 tests and skips 2.

**No CI.** `pnpm build && pnpm test` on a fresh checkout is unverified by
machine, contrary to success criterion 4 of the design doc.

---

## Attribution

Independent implementation. **Not affiliated with the authors and not the
official repository.** The official implementation is
<https://github.com/alexzhang13/rlm> (Python).

The authors' code was read for values that the paper leaves unstated — the
20,000-char truncation constant, `rlm_query`'s signature, multi-block execution
semantics, the fallback-answer chain. Those readings are cited inline as
`FROM_OFFICIAL_CODE` in [PAPER_SPEC.md](PAPER_SPEC.md). No code was copied; see
[AGENTS.md](AGENTS.md) for the rule.

A `LICENSE` file has not been added yet, and the authors' license has not been
reviewed for compatibility.
