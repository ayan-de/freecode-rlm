# `apps/docs`

The devlog / learning journal for `freecode-rlm`, built with
[Nextra 4](https://nextra.site) and the blog theme.

## Stack

- **Nextra 4.6.1** with `nextra-theme-blog`, App Router, page-file convention.
- **Next 16.0.11** (see "Version note" below).
- **React 19.2**.
- Self-hosted **Departure Mono** (SIL OFL 1.1, bundled in `app/fonts/`)
  for code/headings.
- **Inter** via `next/font/google` for body.
- **Pagefind** for static search (`postbuild` step).

## Layout

```
app/
  layout.tsx                 # root layout: fonts, Navbar, Footer, Search, ThemeSwitch
  globals.css                # Departure Mono / Inter theming
  page.mdx                   # home/about (hidden from nav)
  _meta.global.ts            # top-level nav config
  posts/
    page.tsx                 # post index
    get-posts.ts             # page-map helpers
    <slug>/page.mdx          # each post lives in its own directory
fonts/DepartureMono-Regular.woff2   # imported via next/font/local
public/fonts/LICENSE                 # OFL attribution
```

## Commands

```bash
pnpm -F docs dev        # next dev --webpack --port 3001
pnpm -F docs build      # next build --webpack + pagefind
pnpm -F docs lint
pnpm -F docs check-types
```

## Version note

`apps/docs` is pinned to **Next 16.0.11** while `apps/web` is on **Next 16.3.0**.
This is intentional.

Nextra 4.6.1 + Next 16.1+ breaks the page-file convention used by the blog
theme: frontmatter `metadata` exports from MDX pages are rejected by Next 16's
stricter server/client boundary rule. Pinning to Next 16.0.11 (the highest
version where the bug is absent) keeps the monorepo buildable.

The rest of the workspace stays on 16.3.0 because nothing else uses Nextra.
If/when Nextra ships a fix (track
[issue #4830](https://github.com/shuding/nextra/issues/4830)), drop the pin
and align both apps to the same Next version.

The dev/build scripts also force `--webpack` — Next 16's default Turbopack
does not have the `next-mdx-import-source-file` import map alias that Nextra
relies on.