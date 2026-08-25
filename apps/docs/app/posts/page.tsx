import Link from "next/link";
import { PostCard } from "nextra-theme-blog";
import { getPosts, getTags } from "./get-posts";

export const metadata = {
  title: "Devlog",
  description: "Notes on building a TypeScript Recursive Language Model.",
};

export default async function PostsPage() {
  const tags = await getTags();
  const posts = await getPosts();
  const tagCounts = Object.create(null) as Record<string, number>;

  for (const tag of tags) {
    tagCounts[tag] ??= 0;
    tagCounts[tag] += 1;
  }

  return (
    <div data-pagefind-ignore="all">
      <h1>{metadata.title}</h1>

      <p>
        A chronological journal of how <code>freecode-rlm</code> came together:
        the architectural decisions, the dead ends, and the tests that pinned
        each milestone down.
      </p>

      {Object.keys(tagCounts).length > 0 && (
        <div
          className="not-prose"
          style={{ display: "flex", flexWrap: "wrap", gap: ".5rem" }}
        >
          {Object.entries(tagCounts).map(([tag, count]) => (
            <Link key={tag} href={`/tags/${tag}`} className="nextra-tag">
              {tag} ({count})
            </Link>
          ))}
        </div>
      )}

      {posts.map((post) => (
        <PostCard key={post.route} post={post} />
      ))}
    </div>
  );
}
