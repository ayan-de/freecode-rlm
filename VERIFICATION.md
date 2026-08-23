# VERIFICATION.md — paper-to-code fidelity matrix

Audit of this repository against [PAPER_SPEC.md](PAPER_SPEC.md) and
arXiv [2512.24601v3](https://arxiv.org/abs/2512.24601).

**Audit date:** 2026-08-23
**Commit:** `b9bb0d4` (branch `feat/skill-system-websearch`)
**Suite at audit time:** 115 tests, 113 pass / 2 skipped (live-API tests).

Status meanings:

| Status | Meaning |
|---|---|
| `PASS` | Implemented and covered by a test that would fail if it regressed. |
| `PASS*` | Implemented and correct, but no test pins the paper requirement. |
| `FAIL` | Implemented incorrectly, or required by the paper and absent. |
| `DEVIATION` | Differs from the paper on purpose. Recorded in [REPRODUCTION_NOTES.md](REPRODUCTION_NOTES.md). |
| `UNVERIFIED` | Not checked — usually because no eval harness exists yet. |

**A green test suite does not mean fidelity.** Three of the four `FAIL`s below
sit under a fully passing suite, because the tests assert our implementation's
behaviour rather than the paper's requirements.

---

## Summary

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 2 | V-03, V-04 |
| HIGH | 2 | V-01, V-02 |
| MEDIUM | 3 | V-05, V-06, V-09 |
| Reproduction gaps | 5 | V-10 … V-14 |
| Passing | 10 | V-15 … V-24 |

---

## Failures

### V-03 — CRITICAL — REPL state does not persist across iterations

| | |
|---|---|
| **Requirement** | The REPL environment is persistent; each iteration updates REPL state, and the model builds intermediate values into new variables across turns. |
| **Paper reference** | §2 ("initializes a **persistent** REPL programming environment"; "build up intermediate values and the final response into new variables"); Algorithm 1 `(state, stdout) ← REPL(state, code)`; App. C.1 (1a) — the canonical strategy is *"query an LLM per chunk … and save the answers to a buffer"* across turns. |
| **Code location** | `packages/rlm-repl/src/isolated-vm.ts:46-64` |
| **Status** | **FAIL** |

User code is executed as `eval(__USER_CODE__)` inside an
`(async function() { … })()` wrapper. Direct `eval` puts `const`, `let` **and**
`var` declarations into the *wrapper's* scope, which is discarded when
`execute()` returns. The isolate and context are correctly reused
(`isolated-vm.ts:30-31`), so the mechanism is right — only the scoping is wrong.

**Verified failure** (probe run against `IsolatedVmREPL`, 2026-08-23):

```
execute("const buffer = ['x']; buffer.length")  → success, 1
execute("buffer.length")                        → ReferenceError: buffer is not defined
execute("var vbuf = 7;") then execute("vbuf+1") → ReferenceError: vbuf is not defined
```

**Impact.** The paper's central multi-turn strategy — chunk, sub-query,
accumulate into a buffer, aggregate — cannot run. Any trajectory longer than one
code block loses all its work. Single-block tasks (our current e2e and NIAH
tests) are unaffected, which is why this went unnoticed.

**Why no test caught it.** No test executes two `execute()` calls against a real
`IsolatedVmREPL` with a variable carried between them.

**Minimal fix.** Hoist declarations to `globalThis` — either rewrite top-level
`const`/`let`/`var` bindings before eval, or run user code via
`context.evalClosure` at global scope instead of inside a function wrapper.

**Regression test to add.** `isolated-vm.test.ts`: assign in call 1, read in
call 2, for `const`, `let`, `var`, and a bare assignment.

---

### V-04 — CRITICAL — `FINAL_VAR` cannot resolve a model-created variable

| | |
|---|---|
| **Requirement** | The final answer may be the value of a variable the model created in the REPL. |
| **Paper reference** | §2 ("Once the RLM sets the variable `Final` inside the REPL … the value in `Final` is returned"); App. C.1 (1a) option 2, `FINAL_VAR(variable_name)` |
| **Code location** | `packages/rlm-repl/src/isolated-vm.ts:125-129`; consumed by `packages/rlm-core/src/final.ts` |
| **Status** | **FAIL** |

`IsolatedVmREPL.inspect()` iterates `this.bindings` — a **host-side `Map`
populated only by `load()`**. It never reads sandbox globals. So `FINAL_VAR`
can only resolve variables the *host* injected, never ones the *model* created,
which is the entire point of the feature.

**Verified failure:**

```
execute("const answer = 42;") ; inspect()  → {}
```

**Impact.** `FINAL_VAR` is one of only two ways the paper lets a model return an
answer, and it is the one required for answers longer than the model's output
window (§2: "unbounded output tokens"). Currently it silently resolves to the
string `"undefined"` (`final.test.ts:45` documents exactly that behaviour as if
it were correct).

**Why no test caught it.** `rlm.test.ts:188` "resolves FINAL_VAR by reading a
custom-defined variable" uses `FakeREPL`, not `IsolatedVmREPL`. The fake
persists variables; the real implementation does not.

**Minimal fix.** Implement `inspect()` against sandbox global state (enumerate
`globalThis` in-isolate, minus the injected builtins, and copy out). Depends on
V-03 being fixed first — until declarations reach global scope there is nothing
to enumerate.

---

### V-01 — HIGH — stdout is not truncated before entering history

| | |
|---|---|
| **Requirement** | Only constant-size metadata about stdout is appended to the root's history. |
| **Paper reference** | §2 + **footnote 2** ("This is key: it forces `M` to rely on variables and sub-calls to manage long strings instead of polluting its window"); §2 final ¶ ("The LLM can also print from the REPL, but it is truncated"); App. C.1 (1a) tells the model "You will only be able to see truncated outputs". |
| **Code location** | `packages/rlm-core/src/utils/messages.ts:33-40` (`formatResult`) |
| **Status** | **FAIL** |

`formatResult` joins the full `stdout` array and the full stringified expression
into the history message. No cap anywhere in the path — not in `formatResult`,
not in `IsolatedVmREPL`. The design doc's `maxStdoutLength: 100 KB` was never
implemented.

**Impact.** A model that `PRINT`s a 200k-char slice puts 200k chars into the
root context — the exact failure mode the RLM design exists to prevent. It also
inverts the system prompt, which promises truncation that does not happen.

**Reference value.** The authors truncate per code block at **20,000
characters**, tail-trimmed with a `... + [N chars...]` marker
(`rlm/utils/parsing.py:26,59-62`). See PAPER_SPEC AMB-02.

**Note.** Our root-loop compaction (`compaction.ts`) partially masks this by
summarizing when the window fills. That is a *mitigation of a bug*, not the
paper's design — see V-09 and REPRODUCTION_NOTES D-05.

**Regression test to add.** `messages.test.ts`: a 50k-char stdout line yields a
history message ≤ cap + marker.

---

### V-02 — HIGH — system prompt carries no context metadata

| | |
|---|---|
| **Requirement** | The first root call receives constant-size metadata about `P`: its type, total length, chunk lengths, a short prefix, and how to access it. |
| **Paper reference** | §2 ("invokes the root neural model `M` with only (constant-size) metadata about the user prompt, like its length, a short prefix, and how to access parts of it"); App. C.1 (1a) template: `{context_type}`, `{context_total_length}`, `{context_lengths}` |
| **Code location** | `packages/rlm-core/src/prompt.ts:29-37` (`buildSystemPrompt`) |
| **Status** | **FAIL** |

`buildSystemPrompt` takes only `enableSystemTools` and `skills`. The prompt is
otherwise a fixed string. The model is told `context` exists but not what type
it is, how long it is, or how it is chunked — so its first move has to be a
blind probe.

**Impact.** Directly costs iterations, and the paper's Figure 4(a) shows the
first decomposition attempt strongly determines success. Also blocks the
chunking strategies in App. C.1, which are written against known chunk lengths.

**Minimal fix.** Extend `buildSystemPrompt` to take `{ contextType,
totalLength, chunkLengths }` and render the paper's three template slots.

**Regression test to add.** `prompt.test.ts`: prompt contains the character
count and type for a given context.

---

### V-05 — MEDIUM — only the last code block per turn is executed

| | |
|---|---|
| **Paper reference** | Silent. Authors' code runs **all** blocks (`rlm/core/rlm.py:658-663`, `rlm/utils/parsing.py` `format_iteration` loops `iteration.code_blocks`). |
| **Code location** | `packages/rlm-core/src/utils/code-extract.ts:3-13` |
| **Status** | **DEVIATION** (PAPER_SPEC AMB-04) |

Internally consistent — our system prompt tells the model "only the LAST block
per turn runs" — but it silently drops work when a model emits several blocks.
Recorded in REPRODUCTION_NOTES D-03.

---

### V-06 — MEDIUM — `rlm_query` arity differs from Appendix C.1

| | |
|---|---|
| **Paper reference** | App. C.1 (1c): `rlm_query(context, query)` |
| **Code location** | `packages/rlm-repl/src/bridge.ts:15` — `rlmQuery: (prompt: string) => Promise<string>` |
| **Status** | **DEVIATION** (PAPER_SPEC AMB-03) |

The paper's appendix and the authors' released code disagree with each other;
we follow the released code (`rlm/utils/prompts.py:16`). Low risk, but it means
our prompt and the paper's prompt are not interchangeable.

---

### V-09 — MEDIUM — compaction added to the root loop

| | |
|---|---|
| **Paper reference** | §1 and §3.2 treat compaction as a **baseline RLMs outperform** ("compaction is rarely expressive enough for tasks that require dense access throughout the prompt"). It is not part of Algorithm 1. |
| **Code location** | `packages/rlm-core/src/compaction.ts`, wired at `rlm.ts:144-157` |
| **Status** | **DEVIATION** (PAPER_SPEC AMB-09) |

Defensible as an engineering safety net, but it is in tension with the paper's
thesis and it partially conceals V-01. Any reproduction run must disable it, or
the result is not measuring an RLM as defined. Recorded in REPRODUCTION_NOTES D-05.

---

## Reproduction gaps

No evaluation harness exists. Every number in §4 Table 1 is unmeasured.

| ID | Benchmark | Paper anchor | Status |
|---|---|---|---|
| V-10 | S-NIAH (RULER, 50 tasks, 2^13→2^20) | §3.1 | `UNVERIFIED` — `rlm.niah.test.ts` is a single smoke test, skipped without `MINIMAX_API_KEY`, produces no score |
| V-11 | OOLONG `trec_coarse`, 50 tasks | §3.1, Table 1 | `UNVERIFIED` — not implemented |
| V-12 | OOLONG-Pairs, 20 queries, F1 | §3.1, App. D.1 | `UNVERIFIED` — not implemented |
| V-13 | BrowseComp-Plus (1K docs, 150 instances) | §3.1 | `UNVERIFIED` — not implemented |
| V-14 | LongBench-v2 CodeQA | §3.1 | `UNVERIFIED` — not implemented |

Until at least one of these produces a number, the README must report
**NOT REPRODUCED** for all rows.

---

## Passing

| ID | Requirement | Paper ref | Code | Test | Status |
|---|---|---|---|---|---|
| V-15 | Prompt `P` is loaded as a REPL variable, never as a message | §2, Alg. 1 `InitREPL(prompt=P)` | `rlm.ts:103` | `rlm.test.ts:157` "loads the prompt as `context` in the REPL" | `PASS` |
| V-16 | `llm_query` callable from inside the REPL | App. C.1 (1a) item 2 | `bridge.ts` | `bridge.test.ts:10`; `rlm.test.ts:212` | `PASS` |
| V-17 | `rlm_query` spawns a nested RLM with its own REPL | §2; App. C.1 (1c) | `rlm.ts:427-460` | `rlm.test.ts:227` "sub-RLM is invoked when rlm_query is called" | `PASS` |
| V-18 | At the depth cap, `rlm_query` degrades to `llm_query` without raising | App. C.1 (1c) — *"automatically falls back to `llm_query`"* | `rlm.ts:434-441` | — | `PASS*` — no test pins the fallback |
| V-19 | Loop iterates until `Final` is set | §2, Alg. 1 | `rlm.ts:130-226` | `rlm.test.ts:106` | `PASS` |
| V-20 | Literal `FINAL(...)` returns its argument | App. C.1 (1a) option 1 | `final.ts` | `final.test.ts:5` | `PASS` |
| V-21 | Code is delimited by a ` ```repl ` fence | App. C.1 (1a) | `code-extract.ts` | `code-extract.test.ts:5` | `PASS` |
| V-22 | Sub-calls are blocking / sequential | App. B (stated as the authors' behaviour) | `rlm.ts:413-425` | — | `PASS*` — matches by construction |
| V-23 | REPL isolate/context is reused across iterations | §2 "persistent" | `isolated-vm.ts:30-31` | — | `PASS*` — the container persists; its contents do not, see V-03 |
| V-24 | Recursion is bounded and cost-capped | §5, App. B | `budget.ts` | `budget.test.ts`; `rlm.test.ts:243` | `PASS` — beyond the paper, which states no cap |

---

## Fix order

1. **V-03** — restore variable persistence. Everything multi-turn depends on it.
2. **V-04** — implement real `inspect()`. Blocked on V-03.
3. **V-01** — truncate at 20,000 chars/block.
4. **V-02** — inject context metadata into the system prompt.
5. Re-audit, then build the eval harness (V-10 … V-14) and attempt OOLONG
   `trec_coarse` first — cheapest row in Table 1 that exercises sub-calls.

V-05, V-06 and V-09 need no code change; they need to stay documented.
