# VERIFICATION.md — paper-to-code fidelity matrix

Audit of this repository against [PAPER_SPEC.md](PAPER_SPEC.md) and
arXiv [2512.24601v3](https://arxiv.org/abs/2512.24601).

**First audited:** 2026-08-23 at `b9bb0d4`
**Last updated:** 2026-08-23 — V-03 and V-04 fixed
**Suite:** 151 tests, 148 pass / 3 skipped (live-API tests).

Status meanings:

| Status | Meaning |
|---|---|
| `PASS` | Implemented and covered by a test that would fail if it regressed. |
| `PASS*` | Implemented and correct, but no test pins the paper requirement. |
| `FAIL` | Implemented incorrectly, or required by the paper and absent. |
| `DEVIATION` | Differs from the paper on purpose. Recorded in [REPRODUCTION_NOTES.md](REPRODUCTION_NOTES.md). |
| `UNVERIFIED` | Not checked — usually because no eval harness exists yet. |

**A green test suite does not mean fidelity.** Every `FAIL` recorded here was
found under a fully passing suite, because the tests asserted our
implementation's behaviour rather than the paper's requirements. Both
CRITICALs (V-03, V-04) were caught this way and are now fixed.

---

## Summary

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 2 | V-01, V-02 |
| MEDIUM | 3 | V-05, V-06, V-09 |
| Reproduction gaps | 5 | V-10 … V-14 |
| Passing | 12 | V-03, V-04, V-15 … V-24 |
| Fixed since first audit | 2 | V-03, V-04 |

---

## Failures

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
| V-03 | REPL state persists across iterations; the model accumulates values into variables over turns | §2 ("**persistent** REPL"; "build up intermediate values … into new variables"); Alg. 1 `(state, stdout) ← REPL(state, code)`; App. C.1 (1a) buffer strategy | `isolated-vm.ts` `execute()` | `isolated-vm.test.ts` — "IsolatedVmREPL state persistence across execute() calls" (8 tests) | `PASS` — **fixed 2026-08-23**, see below |
| V-04 | The response may be the value of a variable the model built in the REPL (`FINAL_VAR`) | §2 ("Once the RLM sets the variable `Final` inside the REPL … the value in `Final` is returned"); App. C.1 (1a) option 2 | `isolated-vm.ts` `lookup()`, `final.ts` | `isolated-vm.test.ts` — "IsolatedVmREPL.lookup" (7 tests); `rlm.test.ts` — "resolves FINAL_VAR against a variable the model built in the real sandbox" | `PASS` — **fixed 2026-08-23**, see below |
| V-15 | Prompt `P` is loaded as a REPL variable, never as a message | §2, Alg. 1 `InitREPL(prompt=P)` | `rlm.ts:103` | `rlm.test.ts:157` "loads the prompt as `context` in the REPL" | `PASS` |
| V-16 | `llm_query` callable from inside the REPL | App. C.1 (1a) item 2 | `bridge.ts` | `bridge.test.ts:10`; `rlm.test.ts:212` | `PASS` |
| V-17 | `rlm_query` spawns a nested RLM with its own REPL | §2; App. C.1 (1c) | `rlm.ts:427-460` | `rlm.test.ts:227` "sub-RLM is invoked when rlm_query is called" | `PASS` |
| V-18 | At the depth cap, `rlm_query` degrades to `llm_query` without raising | App. C.1 (1c) — *"automatically falls back to `llm_query`"* | `rlm.ts:434-441` | — | `PASS*` — no test pins the fallback |
| V-19 | Loop iterates until `Final` is set | §2, Alg. 1 | `rlm.ts:130-226` | `rlm.test.ts:106` | `PASS` |
| V-20 | Literal `FINAL(...)` returns its argument | App. C.1 (1a) option 1 | `final.ts` | `final.test.ts:5` | `PASS` |
| V-21 | Code is delimited by a ` ```repl ` fence | App. C.1 (1a) | `code-extract.ts` | `code-extract.test.ts:5` | `PASS` |
| V-22 | Sub-calls are blocking / sequential | App. B (stated as the authors' behaviour) | `rlm.ts:413-425` | — | `PASS*` — matches by construction |
| V-23 | REPL isolate/context is reused across iterations | §2 "persistent" | `isolated-vm.ts:30-31` | covered by the V-03 suite | `PASS` |
| V-24 | Recursion is bounded and cost-capped | §5, App. B | `budget.ts` | `budget.test.ts`; `rlm.test.ts:243` | `PASS` — beyond the paper, which states no cap |

---

## Fix order

1. ~~**V-03** — restore variable persistence.~~ **Done 2026-08-23.**
2. ~~**V-04** — resolve `FINAL_VAR` by name against sandbox scope.~~ **Done 2026-08-23.**
3. **V-01** — truncate at 20,000 chars/block.
4. **V-02** — inject context metadata into the system prompt.
5. Re-audit, then build the eval harness (V-10 … V-14) and attempt OOLONG
   `trec_coarse` first — cheapest row in Table 1 that exercises sub-calls.

V-05, V-06 and V-09 need no code change; they need to stay documented.

---

## Fix log

### V-03 — fixed 2026-08-23

**Root cause.** `execute()` ran the model's code as
`eval(__USER_CODE__)` inside an `(async function(){ … })()` wrapper. Direct
`eval` records `const`, `let` **and** `var` declarations in the *wrapper's*
scope, which is discarded on return. The isolate and context were already
reused correctly (`isolated-vm.ts:30-31`) — only the scoping was wrong.

Measured before the fix:

```
execute("const buf = ['x']; buf.length")  → 1
execute("buf.length")                     → ReferenceError: buf is not defined
execute("var n = 7") → execute("n + 1")   → ReferenceError: n is not defined
```

**Fix.** Run the model's code as **top-level global script code**
(`isolate.compileScript(code).run(context)`) instead of inside a wrapper.
Global code records declarations in the context's global lexical environment,
which lives as long as the isolate. Dropping the wrapper cost us the closure
that held stdout capture and the FINAL side-channel, so those are now
bracketed by two small control scripts (`runControlScript` / `collectTail`)
that run before and after the user's code — the tail collector runs whether
the code succeeded, threw, or timed out, so partial output is never lost.

`const`, `let`, `var`, function declarations and object mutation all persist.
Verified with 8 tests, including the Appendix C.1 buffer pattern (accumulate
across four calls, then aggregate) and survival of state across a throwing
call.

**Known cost.** A `const`/`let` name declared in an earlier turn cannot be
re-declared in a later one — real JS global-script semantics, and the price of
genuine persistence. `execute()` now appends a recovery hint to that
`SyntaxError` explaining that the name is held over and suggesting assignment
or a new name, mirroring the existing bare-top-level-`await` hint. Worth
revisiting if trajectories show models tripping on it often.

**Also fixed incidentally.** The old outer `catch` returned the *cumulative*
`this.stdout` rather than the current call's output. Per-call stdout is now
consistent on every path.

### V-04 — fixed 2026-08-23

**Root cause.** `IsolatedVmREPL.inspect()` iterated a host-side `Map`
populated only by `load()`. It never read sandbox scope, so `FINAL_VAR` could
resolve only variables the *host* injected — never one the *model* created,
which is the entire point of the feature. It failed silently, resolving to the
string `"undefined"`.

Measured before the fix:

```
execute("const answer = 42;") ; inspect()  → {}
```

**Fix.** Replaced `inspect(): Promise<Record<string, unknown>>` with
`lookup(name): Promise<unknown>` across the `REPL` and `CoreREPL` interfaces.
Enumeration cannot work here: now that V-03 is fixed, top-level `const`/`let`
are global *lexical* bindings, which are not properties of `globalThis` and
cannot be listed. `lookup()` instead evaluates the identifier as global code
(`typeof <name> === "undefined" ? undefined : <name>`), which reaches lexical
bindings and `globalThis` properties alike. `FINAL_VAR(name)` already carries
the name, so the narrower contract is also the one the core actually needs.

`name` arrives from model-written `FINAL_VAR(...)`, so it is checked against a
bare-identifier pattern before it is interpolated into sandbox source. The
sandbox already runs model code, so this is robustness rather than a trust
boundary — a malformed name reads as "no such variable". `promise: true` on
the lookup means a variable holding a pending Promise resolves to its value.

**Why no test caught it.** `rlm.test.ts` tested `FINAL_VAR` against `FakeREPL`,
which persisted variables, while the real sandbox did not. The new regression
test runs against `IsolatedVmREPL` and builds the variable across two turns,
the way Appendix C.1 describes.

**Incidental simplification.** `FakeREPL` carried ~25 lines of globals-harvesting
that existed only to satisfy `inspect()`'s enumerate-everything contract. With
`lookup()` it is a two-line method, and `IsolatedVmREPL` no longer needs its
`bindings` Map at all.
