import { normalizePages } from "nextra/normalize-pages";
import { getPageMap } from "nextra/page-map";

export async function getPosts() {
  const { directories } = normalizePages({
    list: await getPageMap("/posts"),
    route: "/posts",
  });
  return directories
    .filter((post) => post.name !== "index")
    .sort(
      (a, b) =>
        new Date(b.frontMatter.date).valueOf() -
        new Date(a.frontMatter.date).valueOf(),
    );
}

export async function getTags(): Promise<string[]> {
  const posts = await getPosts();
  return posts.flatMap((post) => post.frontMatter.tags ?? []);
}
