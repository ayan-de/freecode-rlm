const FENCE = /```(?:repl|js|javascript)?\n([\s\S]*?)```/g;

export function extractReplCode(text: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(FENCE)) {
    const captured = m[1];
    // The regex leaves the line break before the closing fence in the
    // capture; strip it so the returned code is ready to execute.
    last = captured === undefined ? null : captured.replace(/\n$/, "");
  }
  return last;
}
