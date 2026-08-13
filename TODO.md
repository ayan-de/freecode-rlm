# TODO — Porting from the Python `rlm/` reference

`freecode-rlm` is the **TypeScript port** of the Python reference at `githubProjects/agents/rlm/rlm/`. Prime-agent (`githubProjects/agents/rlm/prime-agent/`) is a *separate* project — a full coding-agent harness that *uses* an RLM core as one of its tools. It's not the reference for this port.

The right gap analysis is against `rlm/rlm/`.

## What's already implemented in freecode-rlm

- `packages/rlm-repl/` — `isolated-vm` sandbox, `FINAL` / `FINAL_VAR` / `PRINT` builtins, host bridge for `llm_query` / `rlm_query` / `bash` / `readFile` / `writeFile`
- `packages/rlm-core/rlm.ts` — iterative loop, recursive `rlmQuery`, budget, depth limit, pending-subcall draining
- `packages/rlm-client/` — `LMClient` interface + Vercel-AI adapter + mock
- `packages/rlm-core/budget.ts` — `Budget`, `BudgetExceededError`
- `packages/rlm-core/final.ts` — `extractFinal` / `extractFinalFromText`
- `packages/rlm-core/prompt.ts` — `buildSystemPrompt`

## Gaps to port from `rlm/rlm/`

### REPL / Environment layer (P0)

- [ ] **Multiple environment backends** — Python has 7 (`local`, `ipython`, `docker`, `modal`, `prime`, `daytona`, `e2b`) under `rlm/environments/`. freecode-rlm has only one (`IsolatedVmREPL`). Most important to add:
  - [ ] **`LocalREPL`** — plain Node `vm` module equivalent of `local_repl.py`. Faster, no memory isolation, useful for trusted code. Already half-implied by the `CoreREPL` interface.
  - [ ] **`PrimeREPL`** — `prime_repl.py` exposes a *host-managed* REPL the model interacts with via REPL commands over IPC, not a sandbox. Different shape from `isolated-vm`.
  - [ ] **`DockerREPL`** — `docker_repl.py` runs code in a container. The closest analogue in JS would be `dockerode`.
- [ ] **Persistent environment support** — Python has `SupportsPersistence` protocol + `_validate_persistent_environment_support()` / `_env_supports_persistence()` (`rlm.py:872`). Lets a session's variables survive across `completion()` calls. freecode-rlm's `REPL` interface (`rlm-repl/src/types.ts:13`) is per-call only.
- [ ] **`base_env.py` abstraction** — `BaseEnv` defines `setup()` / `load_context()` / `execute_code()` / `add_context()` / `display_context()` / `reset()`. freecode-rlm's `CoreREPL` is similar but lacks `add_context` (incremental context loading) and `display_context`.

### Core / loop layer (P0)

- [x] **Compaction** — `rlm.py:587` has `_get_compaction_status`, `_should_compact`, `_compact_history`. `compaction_example.py` and `compaction_history_retrieval_example.py` are dedicated examples. **freecode-rlm has zero compaction** — context grows unbounded across iterations.
- [ ] **Persistent history across `completion()` calls** — Python's `RLM.completion()` accepts `persistent=True` (`rlm.py:326`) so the message history and REPL state survive. freecode-rlm does support `history` as a parameter but doesn't have a mode where the REPL itself persists.
- [ ] **Sub-call batching** — `rlm_query_batched_example.py`. Parallel `rlm_query` invocations inside a single iteration. freecode-rlm's `callRlm` is one-shot; `pendingSubCalls` (`rlm.ts:42`) tracks them but doesn't batch.
- [ ] **Model-per-subcall routing** — `rlm.py:706` `_subcall(self, prompt, model=None)` lets the orchestrator pick a different model for recursive calls. freecode-rlm's `callRlm` inherits the parent's `LMClient`.
- [ ] **`_fallback_answer` / `_default_answer`** — `rlm.py:673,698` — when the loop times out without `FINAL`, fall back to a single non-REPL LM call, then a hard-coded default. freecode-rlm currently just returns the last assistant text.
- [ ] **`_check_timeout`** — wall-clock timeout for the whole `completion()` (`rlm.py:492`). freecode-rlm has per-iteration REPL timeout, not a wall-clock cap.

### Client layer (P1)

- [ ] **Multiple LM clients** — Python has `anthropic.py`, `openai.py`, `azure_openai.py`, `gemini.py`, `portkey.py`, plus `BaseLM` and `vercel` (`clients/`). `ClientBackend` type lists 8 providers. freecode-rlm has one Vercel-AI adapter and a mock.
- [ ] **Per-model usage + cost tracking** — `types.py:ModelUsageSummary` / `UsageSummary` track `total_calls`, `total_input_tokens`, `total_output_tokens`, `total_cost` per model. `RLMMetadata` includes a `UsageSummary`. freecode-rlm's `RLMResult.metadata` (`packages/rlm-core/src/types.ts:51`) tracks `totalSubCalls` only — no per-model token / cost aggregation.
- [ ] **`BaseLM` abstraction** — `clients/base_lm.py` defines `chat_completion` / `stream_chat_completion`. freecode-rlm's `LMClient` (`packages/rlm-client/src/types.ts:10`) is similar but lacks structured usage / cost return types.

### Utilities (P1)

- [ ] **`parsing.py` — `find_code_blocks` / `format_iteration`** — extracts fenced code blocks from model output. freecode-rlm has `utils/code-extract.ts` but Python's version is more permissive (handles multiple blocks, chooses the last by default).
- [ ] **`prompts.py` — `RLM_SYSTEM_PROMPT` + `build_rlm_system_prompt` + `build_user_prompt` + `QueryMetadata`** — Python builds prompts dynamically with metadata (context length, model name, subcall count). freecode-rlm's `buildSystemPrompt` is a single static template.
- [ ] **`token_utils.py` — `count_tokens`, `get_context_limit`** — model-aware token counting + context-window lookup. freecode-rlm has `LMClient.estimateTokens?` as an optional hook; nothing uses it for window checks.
- [ ] **`rlm_utils.py` — `filter_sensitive_keys`** — strips API keys / secrets from logged data. freecode-rlm has no equivalent; the `enableSystemTools` path logs raw bash output.

### Logger (P2)

- [ ] **`rlm/logger/`** — `RLMLogger` + `VerbosePrinter` for structured iteration logs (`logger_example.py`). freecode-rlm has `verbose: boolean` but only logs plain text.

### Tests / examples parity (P2)

- [ ] Port `examples/` to `apps/cli/src/examples/` or `tests/`:
  - [ ] `quickstart.py` — basic non-REPL fallback
  - [ ] `lm_in_repl.py` / `lm_in_prime_repl.py` — LM call inside REPL
  - [ ] `custom_tools_example.py` — `enableSystemTools`-equivalent path
  - [ ] `depth_metadata_example.py` — recursive depth reporting
  - [ ] `daytona_repl_example.py` / `docker_repl_example.py` / `e2b_repl_example.py` / `modal_repl_example.py` — once those backends are ported
  - [ ] `compaction_example.py` / `compaction_history_retrieval_example.py` — examples of compaction usage (library already supports it; needs a worked example)
  - [ ] `rlm_query_batched_example.py` — once batching lands

## Reference paths (Python `rlm/`)

- Core loop: `rlm/core/rlm.py`
- Types: `rlm/core/types.py`
- LM handler: `rlm/core/lm_handler.py`
- Environments: `rlm/environments/{base_env,local_repl,ipython_repl,docker_repl,modal_repl,prime_repl,daytona_repl,e2b_repl}.py`
- Clients: `rlm/clients/{base_lm,openai,anthropic,azure_openai,gemini,portkey}.py`
- Utils: `rlm/utils/{parsing,prompts,rlm_utils,token_utils,exceptions}.py`
- Logger: `rlm/logger/`
- Examples: `examples/*.py`

## Reference paths (freecode-rlm — current state)

- RLM loop: `packages/rlm-core/src/rlm.ts`
- REPL: `packages/rlm-repl/src/{isolated-vm,builtins,bridge}.ts`
- Client: `packages/rlm-client/src/{types,vercel-ai,mock}.ts`
- Budget: `packages/rlm-core/src/budget.ts`
- Final extraction: `packages/rlm-core/src/final.ts`
- Prompt: `packages/rlm-core/src/prompt.ts`
- Code extract: `packages/rlm-core/src/utils/code-extract.ts`
- Tests: `packages/rlm-core/src/rlm.{test,e2e.test,niah.test}.ts`, `packages/rlm-repl/src/{bridge,builtins,isolated-vm}.test.ts`, `packages/rlm-client/src/{mock,vercel-ai}.test.ts`