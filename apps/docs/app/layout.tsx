import { Footer, Layout, Navbar, ThemeSwitch } from "nextra-theme-blog";
import { Banner, Head, Search } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import "nextra-theme-blog/style.css";
import "./globals.css";

const departureMono = localFont({
  src: "./fonts/DepartureMono-Regular.woff2",
  variable: "--font-departure-mono",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata = {
  title: "freecode-rlm — devlog",
  description:
    "Building a production-grade Recursive Language Model in TypeScript. Notes, design decisions, and lessons learned.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001",
  ),
};

const banner = (
  <Banner storageKey="freecode-rlm-2026" key="banner">
    freecode-rlm — a TypeScript RLM runtime. Built from scratch, in the open.
  </Banner>
);

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${departureMono.variable} ${inter.variable}`}
    >
      <Head backgroundColor={{ dark: "#0b0b0d", light: "#fafaf7" }} />
      <body>
        <Layout banner={banner}>
          <Navbar pageMap={await getPageMap()}>
            <Search />
            <ThemeSwitch />
          </Navbar>

          {children}

          <Footer>
            <span>
              {new Date().getFullYear()} © freecode-rlm. Released under the MIT
              License.
            </span>
          </Footer>
        </Layout>
      </body>
    </html>
  );
}
