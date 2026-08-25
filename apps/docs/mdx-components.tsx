import { useMDXComponents as getBlogMDXComponents } from "nextra-theme-blog";

const blogComponents = getBlogMDXComponents({
  // Use Inter for the blog title; the default nextra-theme-blog title uses a
  // serif. We want a clean, technical look instead.
  h1: ({ children }) => (
    <h1
      style={{
        fontFamily: "var(--font-departure-mono), monospace",
        letterSpacing: "-0.02em",
      }}
    >
      {children}
    </h1>
  ),
  DateFormatter: ({ date }) =>
    new Date(date).toLocaleDateString("en", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
});

export function useMDXComponents(components: Record<string, unknown> = {}) {
  return {
    ...blogComponents,
    ...components,
  };
}
