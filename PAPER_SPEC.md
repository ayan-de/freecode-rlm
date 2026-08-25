# PAPER_SPEC.md — Implementation contract

**Paper:** Alex L. Zhang, Tim Kraska, Omar Khattab. *Recursive Language Models.*
arXiv [2512.24601v3](https://arxiv.org/abs/2512.24601), 11 May 2026. MIT CSAIL.
Local copy: `docs/research-paper/originalPaper.pdf` (43 pages).

**Official implementation:** <https://github.com/alexzhang13/rlm> (Python).

**This repository** is an independent TypeScript implementation. This file is
the implementation contract: what the paper requires, where it lives in our
code, and what the paper leaves open. Where this file and the code disagree,
**the paper wins** and the code is a bug — unless the disagreement is recorded
in [REPRODUCTION_NOTES.md](REPRODUCTION_NOTES.md) as an intentional deviation.

Fidelity status per requirement lives in [VERIFICATION.md](VERIFICATION.md).

### Evidence statuses used in this document

| Status | Meaning |
|---|---|
| `SPECIFIED` | The paper states this outright. Citation given. |
| `PARTIALLY_SPECIFIED` | The paper implies or gestures at it but does not pin a value. |
| `UNSPECIFIED` | The paper is silent. Any value we pick is our own. |
| `ASSUMPTION` | Our choice, made to fill an `UNSPECIFIED` or `PARTIALLY_SPECIFIED` gap. |
| `FROM_OFFICIAL_CODE` | Not in the paper; read from the authors' released Python. |

`FROM_OFFICIAL_CODE` entries cite `rlm/…` paths in the authors' repository.
They were read for *values and behaviour*, never copied — see
[AGENTS.md](AGENTS.md).

---

## 1. Central contribution

1. Long prompts should not be fed into the transformer at all. They should be
   treated as **part of the environment** the model manipulates symbolically
   (§2, Figure 2).
2. An RLM is an **inference-time scaffold** around a base model `M` with
   context size `K`. External interface is identical to an LLM: string in,
   string out. Internally it is unbounded in `|P|` (§2, ¶1).
3. The prompt `P` is loaded as a **variable inside a persistent REPL**. The
   root model sees only constant-size *metadata* about it — length, a short
   prefix, how to access it (§2, Algorithm 1 `InitREPL(prompt=P)`).
4. The model is given a function to **recursively invoke itself** on slices of
   `P`. This is *symbolic* recursion — recursive calls are emitted
   programmatically from inside loops, not verbalized autoregressively. This is
   the property that separates RLMs from sub-agent delegation (§2, "Third, and
   perhaps most importantly…").
5. Only constant-size metadata about **stdout** re-enters the root's history
   each iteration. The paper calls this "key" and footnotes it: it forces the
   model to use variables and sub-calls rather than polluting its window
   (§2 + footnote 2).
6. Iteration stops when the model sets `Final` in the REPL. The value of
   `Final` is the response (§2, Algorithm 1).
7. Recursion depth is a knob, not a constant: depth 0 = no sub-calls,
   depth 1 = sub-LM calls, depth >1 = sub-RLM calls (§3.2, "RLM").
8. Empirically this beats base LMs, compaction agents, CodeAct, and coding
   agents on four long-context benchmarks at comparable cost (§4, Table 1),
   and extends to long *reasoning* as well as long *context* (§4, Table 2).
9. An 8B model can be post-trained to be natively recursive with 1,000
   trajectories from unrelated domains (§1, Appendix A). **Out of scope here.**

---

## 2. Modules that must exist

| # | Module | Paper anchor | Our location |
|---|---|---|---|
| M1 | REPL environment `E`, persistent across iterations, holds `P` as a variable | §2, Alg. 1 `InitREPL` | `packages/rlm-repl/src/isolated-vm.ts` |
| M2 | Sub-LM call `llm_query` exposed *inside* `E` | App. C.1 (1a) item 2 | `packages/rlm-repl/src/bridge.ts` |
| M3 | Sub-RLM call `rlm_query` exposed *inside* `E`, spawning a nested loop | §2 "a function for invoking a sub-RLM"; App. C.1 (1c) | `packages/rlm-core/src/rlm.ts` `callRlm` + `bridge.ts` |
| M4 | Root loop: model → code → execute → truncated stdout → repeat | §2, Alg. 1 `while True` | `packages/rlm-core/src/rlm.ts` `completion()` |
| M5 | Stdout truncation before it enters history | §2 + fn. 2; App. C.1 (1a) | **missing** — see VERIFICATION V-01 |
| M6 | Context metadata injected into the system prompt | §2 ¶"In the first iteration…"; App. C.1 template vars | **missing** — see VERIFICATION V-02 |
| M7 | Final-answer extraction: literal and by-variable | §2; App. C.1 (1a) closing block | `packages/rlm-core/src/final.ts` |
| M8 | Code-block extraction from ` ```repl ` fences | App. C.1 (1a) "wrap it in triple backticks with 'repl'" | `packages/rlm-core/src/utils/code-extract.ts` |
| M9 | Depth accounting + degradation at the cap | §3.2; App. C.1 (1c) note | `rlm.ts:435` |
| M10 | Recursion/cost guardrails | §5, App. B (cost blowup) | `packages/rlm-core/src/budget.ts` |
| M11 | Evaluation harness over the paper's benchmarks | §3.1, §4 Table 1 | **not built** — see VERIFICATION V-10..V-14 |

---

## 3. Interfaces — inputs, outputs, types

### M1 — REPL environment

```
InitREPL(prompt: P) -> state
  state holds: context = P            (a variable, never a message)
  state is persistent across iterations of one completion()
Execute(state, code) -> (state', stdout)
  stdout is captured print()/console.log output, in order
```

Paper is language-agnostic in §2 but §2's final paragraph says the authors'
instantiation uses a **Python** REPL. We use JavaScript — see
REPRODUCTION_NOTES D-01.

### M2 — `llm_query`

```
llm_query(prompt: string) -> string
```
`SPECIFIED` (App. C.1 (1a) item 2). The prompt describes it as handling
"around 500K chars" — that is a property of the sub-model chosen for the
paper's experiments (GPT-5-mini), not a requirement of the scaffold.

### M3 — `rlm_query`

The paper's Appendix C.1 (1c) prompt documents a **two-argument** form:

```
rlm_query(context: string, query: string) -> string
```

The authors' released code exposes a **one-argument** form
(`rlm/utils/prompts.py:16`, `rlm/environments/local_repl.py:313`):

```
rlm_query(prompt: str, model: str | None = None) -> str
```

We implement the one-argument form. Recorded as **AMB-03** below.

Behaviour at the depth cap is `SPECIFIED`: *"if the maximum recursion depth is
reached, `rlm_query` automatically falls back to `llm_query`"* (App. C.1 (1c)).
No error is raised into the sandbox.

### M4 — Root loop (Algorithm 1, §2 p.4)

```
Input: prompt P
Output: response Y

state ← InitREPL(prompt = P)
state ← AddFunction(state, sub_RLM_M)
hist  ← [Metadata(state)]              # constant-size, NOT P itself
while True:
    code            ← LLM_M(hist)
    (state, stdout) ← REPL(state, code)
    hist            ← hist ‖ code ‖ Metadata(stdout)   # ← truncation lives here
    if state[Final] is set:
        return state[Final]
```

Two things this pseudocode makes non-negotiable:
- `hist` never contains `P`. Only metadata about it.
- `hist` never contains raw `stdout`. Only metadata about it.

### M7 — Final answer

Two forms, both `SPECIFIED` (App. C.1 (1a), final IMPORTANT block):
- `FINAL(<answer text>)` — the argument is the answer.
- `FINAL_VAR(<variable_name>)` — the named REPL variable's value is the answer.

The paper flags this mechanism as brittle in practice (App. B, "distinguishing
between a final answer and a thought is brittle") and says the authors added
unspecified "minor safeguards". Our safeguards are listed in AMB-07.

---

## 4. Execution order (normative)

1. Load `P` into `E` as `context`.
2. Install `llm_query`, `rlm_query`, `print`/`PRINT`, `FINAL`, `FINAL_VAR`.
3. Build the system prompt **including** context metadata: type, total length,
   per-chunk lengths (App. C.1 (1a) — `{context_type}`,
   `{context_total_length}`, `{context_lengths}`).
4. Loop:
   a. Call `M` with `[system, …history]`.
   b. Extract ` ```repl ` code block(s) from the reply.
   c. Execute in `E`. Capture stdout.
   d. **Truncate** the formatted result, then append `[assistant reply, truncated result]`.
   e. If `Final` was set, stop and return it.
5. If the iteration cap is hit without `Final`, fall back (see AMB-05).

---

## 5. Hyperparameters

### Stated in the paper

| Parameter | Value | Status | Anchor |
|---|---|---|---|
| Root model (GPT-5 experiments) | GPT-5, medium reasoning, default sampling | `SPECIFIED` | §3.2 |
| Sub-call model (GPT-5 experiments) | GPT-5-mini | `SPECIFIED` | §3.2 |
| Root model (open experiments) | Qwen3-Coder-480B-A35B | `SPECIFIED` | §3.2 |
| Recursion depths evaluated | 0, 1, 2, 3 | `SPECIFIED` | §3.2, Table 1 |
| Default depth when unstated | 1 | `SPECIFIED` | §3.2 ("assume depth=1 if not stated") |
| Sub-LM call style | blocking / sequential | `SPECIFIED` | App. B ("RLMs without asynchronous LM calls are slow") |
| Code fence identifier | `repl` | `SPECIFIED` | App. C.1 (1a) |
| Fine-tuning corpus | 1,000 filtered Qwen3-Coder-480B trajectories | `SPECIFIED` | §3.2, App. A |

### Not stated in the paper

| Parameter | Status | Our value | Where |
|---|---|---|---|
| Stdout truncation length | `FROM_OFFICIAL_CODE` | 20,000 chars per block, tail-trimmed, marker `... + [N chars...]` (`rlm/utils/parsing.py:26,59-62`) | not implemented |
| Max root iterations | `UNSPECIFIED` | 50 | `rlm.ts` `maxIterations` |
| Max total sub-calls | `UNSPECIFIED` | 100, shared across all depths of one `completion()` | `budget.ts` |
| REPL execution timeout | `UNSPECIFIED` | 30,000 ms per `execute()` | `isolated-vm.ts` |
| REPL memory limit | `UNSPECIFIED` | 256 MB | `isolated-vm.ts` |
| Wall-clock cap per `completion()` | `UNSPECIFIED` | none | — |
| Temperature / sampling | `PARTIALLY_SPECIFIED` ("default sampling parameters", §3.2) | provider default | `vercel-ai.ts` |

---

## 6. Evaluation procedure

The paper's benchmarks (§3.1), all of which are reproduction targets. **None is
implemented yet** — see VERIFICATION V-10..V-14 and the reproduction-status
table in the README.

| Benchmark | Setup | Metric | Complexity in `|P|` |
|---|---|---|---|
| **S-NIAH** | RULER single-needle; 50 tasks; lengths 2^13 → 2^20 | accuracy | O(1) |
| **BrowseComp-Plus (1K)** | 150 sampled instances; 1000 documents per instance; gold + evidence docs guaranteed present | % correct | fixed doc count |
| **OOLONG** | `trec_coarse` split; 50 tasks; each needs nearly all dataset questions | accuracy | linear |
| **OOLONG-Pairs** | modified `trec_coarse`; 20 queries aggregating *pairs* of chunks; answer is a list | F1 | quadratic |
| **LongBench-v2 CodeQA** | multi-choice code-repo understanding, fixed file count | accuracy | fixed |
| **LongCoT-mini** | long *reasoning*, not long context; ±decomposition hints (App. C.3) | solve rate | — |

Baselines to be aware of when reporting (§3.2): base model, CodeAct (+BM25 /
+sub-calls), compaction agent, OpenCode (± context offloading), Claude Code
(± context offloading).

### Table 1 targets (§4, p.6)

Reproduction targets for GPT-5 as root, GPT-5-mini as sub-model:

| Method | CodeQA | BrowseComp+ (1K) | OOLONG | OOLONG-Pairs |
|---|---|---|---|---|
| Base GPT-5 | 24.0 | 0.0 | 44.0 | 0.1 |
| RLM depth=0 | 58.0 | 88.0 | 36.0 | 43.9 |
| **RLM depth=1** | **62.0** | **91.3** | **56.0** | **58.0** |
| RLM depth=2 | 66.0 | 92.0 | 56.5 | 65.5 |
| RLM depth=3 | 58.0 | 92.0 | 58.0 | 76.0 |

`RLM depth=1` is the headline configuration and the right first target.

---

## 7. Ambiguity table

| ID | Decision | Status | Evidence | Our choice | Alternatives |
|---|---|---|---|---|---|
| AMB-01 | REPL language | `SPECIFIED` as Python (§2 final ¶), but §2's *definition* is language-agnostic | "we equip an LLM with a Python REPL" | JavaScript / isolated-vm | Python via subprocess; Pyodide |
| AMB-02 | Stdout truncation length | `UNSPECIFIED` in paper; `FROM_OFFICIAL_CODE` = 20,000 chars/block | §2 fn.2 says "constant-size"; `parsing.py:26` gives the constant | adopt 20,000 chars/block to match the reference | token-based cap; head+tail window |
| AMB-03 | `rlm_query` arity | Paper and official code **disagree** | App. C.1 (1c) shows `rlm_query(context, query)`; `prompts.py:16` ships `rlm_query(prompt, model=None)` | one-arg `rlm_query(prompt)` | two-arg form; support both |
| AMB-04 | Blocks executed per assistant turn | `FROM_OFFICIAL_CODE`: **all** blocks (`rlm/core/rlm.py:658-663`) | paper is silent | we run **only the last** | run all; run first |
| AMB-05 | Behaviour when the iteration cap is hit without `Final` | `UNSPECIFIED` | paper's Alg. 1 loops forever | return last assistant text | reference has `_fallback_answer` → one non-REPL LM call, then a hard default |
| AMB-06 | Whether the root may see *any* of `P` directly | `PARTIALLY_SPECIFIED` | §2 says "a short prefix" is included in metadata | no prefix included today | include first-N-chars prefix per paper |
| AMB-07 | FINAL brittleness safeguards | `PARTIALLY_SPECIFIED` — paper says "minor safeguards", does not say what | App. B | accept plain-text `FINAL(...)` outside a code block (`extractFinalFromText`); treat a codeless reply as final | strict-only; retry prompt |
| AMB-08 | Context typing | `PARTIALLY_SPECIFIED` | App. C.1 (1a) references `{context_type}` and `{context_lengths}` (plural), and examples iterate `for i, section in enumerate(context)` and index `context["content"]` — so context may be `str`, `List[str]`, or a dict | string only | tagged union of string / string[] / record |
| AMB-09 | Compaction inside the RLM loop | Paper treats compaction as the **baseline RLMs beat**, not a component (§1, §3.2) | §1: "compaction is rarely expressive enough" | we implement compaction in the root loop | remove it; keep it but off by default under a paper-faithful preset |
| AMB-10 | Root/sub model split | `SPECIFIED` for the experiments only | §3.2: GPT-5 root, GPT-5-mini sub | single client for both | per-depth model routing |

---

## 8. Explicitly out of scope

Not implemented here, and the README must not imply otherwise:

- **Appendix A** — post-training RLM-Qwen3-8B (rejection fine-tuning, RLVR).
  Requires GPU training infrastructure.
- **§4 Table 2 / App. C.3** — LongCoT-mini and decomposition-hint prompts.
- Non-`isolated-vm` environments (Docker, Modal, E2B, Daytona, Prime, IPython)
  present in the authors' repo. See [TODO.md](TODO.md).
- Cost/token accounting per model, which the paper reports throughout §4.

## 9. Extensions beyond the paper

Present in this repo, absent from the paper. Must be labelled as ours:

- Skill system + `websearch` skill (`packages/rlm-skills`).
- Host system tools `bash` / `readFile` / `writeFile`, off by default.
- Multi-turn conversation history across `completion()` calls.
- Root-loop compaction (see AMB-09 — this one is in tension with the paper).
