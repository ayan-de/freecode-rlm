/**
 * websearch skill — Google search via the Serper API.
 *
 * Mirrors prime-agent's `packages/coding-agent/skills/websearch/src/websearch/websearch.py`
 * but for the Node / freecode-rlm toolchain. The LLM calls this from
 * inside the REPL as `await websearch.run("query")` (and the shortcut
 * `await websearch("query")` via the wrapper installed by wrapSkillModule).
 *
 * Auth: `SERPER_API_KEY` env var. Set before running the RLM:
 *
 *   export SERPER_API_KEY=sk-...
 *
 * Returns a plain-text formatted result block: knowledge graph (if any),
 * top N organic results, "People Also Ask" questions. Truncates to
 * `maxOutput` chars (default 8192) with a middle-trim marker.
 */

export const name = "websearch";
export const description =
  "Search Google via the Serper API. Returns titles, URLs, snippets, and a knowledge graph. Call: await websearch.run(query) or await websearch(query). Configure SERPER_API_KEY in env.";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_NUM_RESULTS = 5;
const DEFAULT_MAX_OUTPUT = 8192;

interface SerperResult {
  title?: string;
  link?: string;
  snippet?: string;
}
interface SerperResponse {
  knowledgeGraph?: { title?: string; description?: string; attributes?: Record<string, unknown> };
  organic?: SerperResult[];
  peopleAlsoAsk?: { question?: string; snippet?: string }[];
}

export async function run(
  query: string,
  opts?: { numResults?: number; timeoutMs?: number; maxOutput?: number },
): Promise<string> {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) {
    return (
      "Web search is not set up yet: no SERPER_API_KEY is configured.\n" +
      "Tell the user how to enable it:\n" +
      '  1. Get a free API key at https://serper.dev (sign up, copy the key).\n' +
      "  2. Set the env var before running the RLM: export SERPER_API_KEY=sk-...\n" +
      "  3. Restart the RLM session so the key is picked up.\n"
    );
  }

  const numResults = opts?.numResults ?? DEFAULT_NUM_RESULTS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutput = opts?.maxOutput ?? DEFAULT_MAX_OUTPUT;

  let data: SerperResponse;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const body = await resp.text();
      return `Serper search error (${resp.status}): ${body}`;
    }
    data = (await resp.json()) as SerperResponse;
  } catch (e) {
    return `Error searching for "${query}": ${(e as Error).message}`;
  }

  return formatSerperResults(data, query, numResults, maxOutput);
}

function formatSerperResults(
  data: SerperResponse,
  query: string,
  numResults: number,
  maxOutput: number,
): string {
  const sections: string[] = [];

  const kg = data.knowledgeGraph;
  if (kg) {
    const lines: string[] = [];
    if (kg.title?.trim()) lines.push(`Knowledge Graph: ${kg.title.trim()}`);
    if (kg.description?.trim()) lines.push(kg.description.trim());
    for (const [key, value] of Object.entries(kg.attributes ?? {})) {
      const text = String(value).trim();
      if (text) lines.push(`${key}: ${text}`);
    }
    if (lines.length) sections.push(lines.join("\n"));
  }

  for (let i = 0; i < (data.organic ?? []).slice(0, numResults).length; i++) {
    const r = data.organic![i]!;
    const title = r.title?.trim() || "Untitled";
    const lines = [`Result ${i}: ${title}`];
    if (r.link?.trim()) lines.push(`URL: ${r.link.trim()}`);
    if (r.snippet?.trim()) lines.push(r.snippet.trim());
    sections.push(lines.join("\n"));
  }

  const paa = data.peopleAlsoAsk ?? [];
  if (paa.length) {
    const maxQ = Math.max(1, Math.min(3, paa.length));
    const questions: string[] = [];
    for (const item of paa.slice(0, maxQ)) {
      const q = item.question?.trim();
      if (!q) continue;
      let entry = `Q: ${q}`;
      if (item.snippet?.trim()) entry += `\nA: ${item.snippet.trim()}`;
      questions.push(entry);
    }
    if (questions.length) sections.push("People Also Ask:\n" + questions.join("\n"));
  }

  if (!sections.length) return `No results returned for query: ${query}`;

  const formatted = `Results for query "${query}":\n\n${sections.join("\n\n---\n\n")}`;

  if (formatted.length <= maxOutput) return formatted;

  const marker = `\n... [output truncated, ${formatted.length} chars total] ...\n`;
  const half = Math.max(0, Math.floor((maxOutput - marker.length) / 2));
  const trimmed = formatted.slice(0, half) + marker + formatted.slice(formatted.length - half);
  return trimmed.length > maxOutput ? trimmed.slice(0, maxOutput) : trimmed;
}
