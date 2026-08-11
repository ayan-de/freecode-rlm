import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1>freecode-rlm</h1>
      <p>Recursive Language Model runtime in TypeScript.</p>
      <p>
        The LLM writes JavaScript inside a sandboxed <code>isolated-vm</code>{" "}
        REPL; it can inspect a large context programmatically and call
        sub-LM or sub-RLM functions.
      </p>
      <h2>Quickstart</h2>
      <pre>
        <code>{`pnpm install
pnpm build
export MINIMAX_API_KEY=sk-...
pnpm -F @freecode-rs/cli dev -- "Print the first 100 powers of two"`}</code>
      </pre>
      <p>
        Default model is <code>MiniMax-M3</code> against the OpenAI-compatible
        endpoint at <code>https://api.minimax.io/v1</code>.
      </p>
      <h2>Layout</h2>
      <ul>
        <li>
          <code>packages/rlm-core</code> — RLM class, types, loop, recursion
          depth + budget
        </li>
        <li>
          <code>packages/rlm-client</code> — LM provider adapters (Vercel AI SDK)
        </li>
        <li>
          <code>packages/rlm-repl</code> — sandbox REPL (<code>isolated-vm</code>)
          + host bridge
        </li>
        <li>
          <code>apps/cli</code> — command-line entry (
          <code>freecode-rlm &lt;prompt&gt; [...]</code>)
        </li>
      </ul>
      <p>
        See{" "}
        <code>docs/superpowers/specs/2026-08-10-freecode-rlm-design.md</code>{" "}
        for the design doc.
      </p>
    </main>
  );
}